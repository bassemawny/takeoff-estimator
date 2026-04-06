"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  type Scale,
  type Measurement,
  getPlanPages,
  getPageImageUrl,
  getScale,
  setScale as saveScale,
  listMeasurements,
  createMeasurement,
  deleteMeasurement as apiDeleteMeasurement,
  updateMeasurement,
} from "@/lib/api";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.15;
const SNAP_RADIUS = 12; // pixels on screen

const UNIT_LABELS: Record<string, string> = {
  ft: "feet",
  in: "inches",
  m: "meters",
  cm: "centimeters",
};

const AREA_UNIT_LABELS: Record<string, string> = {
  ft: "sq ft",
  in: "sq in",
  m: "sq m",
  cm: "sq cm",
};

type Point = { x: number; y: number };
type Mode = "pan" | "calibrate" | "measure" | "area" | "object";
type ObjectType = "door" | "window" | "opening";

const OBJECT_COLORS: Record<ObjectType, string> = {
  door: "#f43f5e",
  window: "#0ea5e9",
  opening: "#f97316",
};

const OBJECT_LABELS: Record<ObjectType, string> = {
  door: "Door",
  window: "Window",
  opening: "Opening",
};

// Compute distance between two image-space points
function ptDist(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// Total polyline length in image pixels
function polylinePixelLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += ptDist(points[i - 1], points[i]);
  }
  return total;
}

// Polygon perimeter (closed loop)
function polygonPerimeter(points: Point[]): number {
  if (points.length < 2) return 0;
  let total = polylinePixelLength(points);
  total += ptDist(points[points.length - 1], points[0]);
  return total;
}

// Polygon area via shoelace formula (image-space pixels squared)
function polygonPixelArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// Polygon centroid
function polygonCentroid(points: Point[]): Point {
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  return { x: cx / points.length, y: cy / points.length };
}

// Format a real-world distance for display
function formatDistance(pixels: number, scale: Scale | null): string {
  if (!scale) return `${Math.round(pixels)} px`;
  const real = pixels / scale.pixels_per_unit;
  if (real < 0.01) return `0 ${UNIT_LABELS[scale.unit] || scale.unit}`;
  return `${real < 10 ? real.toFixed(2) : real.toFixed(1)} ${UNIT_LABELS[scale.unit] || scale.unit}`;
}

// Format a real-world area for display
function formatArea(pixelsSq: number, scale: Scale | null): string {
  if (!scale) return `${Math.round(pixelsSq)} px²`;
  const realSq = pixelsSq / (scale.pixels_per_unit ** 2);
  const label = AREA_UNIT_LABELS[scale.unit] || `sq ${scale.unit}`;
  if (realSq < 0.01) return `0 ${label}`;
  return `${realSq < 10 ? realSq.toFixed(2) : realSq.toFixed(1)} ${label}`;
}

export default function PlanViewer() {
  const { planId } = useParams<{ planId: string }>();
  const router = useRouter();

  // Plan state
  const [pages, setPages] = useState<number[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Viewer state
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [sheetPanelOpen, setSheetPanelOpen] = useState(true);

  // Tool mode
  const [mode, setMode] = useState<Mode>("pan");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [objectType, setObjectType] = useState<ObjectType>("door");
  const [hoveringMeasurement, setHoveringMeasurement] = useState(false);

  // Scale calibration state
  const [calPoint1, setCalPoint1] = useState<Point | null>(null);
  const [calPoint2, setCalPoint2] = useState<Point | null>(null);
  const [calMousePos, setCalMousePos] = useState<Point | null>(null);
  const [showScaleDialog, setShowScaleDialog] = useState(false);
  const [scaleDistance, setScaleDistance] = useState("");
  const [scaleUnit, setScaleUnit] = useState("ft");
  const [currentScale, setCurrentScale] = useState<Scale | null>(null);
  const [savingScale, setSavingScale] = useState(false);

  // Measurement state
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [measureMousePos, setMeasureMousePos] = useState<Point | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapPoint, setSnapPoint] = useState<Point | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const distanceInputRef = useRef<HTMLInputElement>(null);

  // Load plan pages
  useEffect(() => {
    if (!planId) return;
    setLoading(true);
    getPlanPages(planId)
      .then((data) => {
        setPages(data.pages);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load plan");
        setLoading(false);
      });
  }, [planId]);

  // Load scale + measurements for current page
  useEffect(() => {
    if (!planId || pages.length === 0) return;
    getScale(planId, currentPage).then(setCurrentScale);
    listMeasurements(planId, currentPage).then(setMeasurements);
  }, [planId, currentPage, pages.length]);

  // Zoom to fit
  const zoomToFit = useCallback(() => {
    const container = containerRef.current;
    if (!container || imageSize.width === 0) return;
    const rect = container.getBoundingClientRect();
    const fitZoom = Math.min(rect.width / imageSize.width, rect.height / imageSize.height) * 0.95;
    setZoom(fitZoom);
    setOffset({ x: 0, y: 0 });
  }, [imageSize]);

  function handleImageLoad() {
    const img = imageRef.current;
    if (!img) return;
    setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
  }

  useEffect(() => {
    if (imageSize.width > 0) zoomToFit();
  }, [imageSize, zoomToFit]);

  // Coordinate conversions
  function screenToImage(clientX: number, clientY: number): Point | null {
    const container = containerRef.current;
    if (!container || imageSize.width === 0) return null;
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const imgScreenX = centerX + offset.x - (imageSize.width * zoom) / 2;
    const imgScreenY = centerY + offset.y - (imageSize.height * zoom) / 2;
    return {
      x: (clientX - imgScreenX) / zoom,
      y: (clientY - imgScreenY) / zoom,
    };
  }

  function imageToOverlay(pt: Point): Point {
    return {
      x: offset.x - (imageSize.width * zoom) / 2 + pt.x * zoom,
      y: offset.y - (imageSize.height * zoom) / 2 + pt.y * zoom,
    };
  }

  // Find nearest snap point from all existing measurements
  function findSnapPoint(imgPt: Point): Point | null {
    let best: Point | null = null;
    let bestScreenDist = Infinity;

    const allPoints: Point[] = [];
    for (const m of measurements) {
      for (const p of m.points) {
        allPoints.push({ x: p[0], y: p[1] });
      }
    }

    for (const p of allPoints) {
      const screenP = imageToOverlay(p);
      const screenImg = imageToOverlay(imgPt);
      const d = ptDist(screenP, screenImg);
      if (d < SNAP_RADIUS && d < bestScreenDist) {
        bestScreenDist = d;
        best = p;
      }
    }
    return best;
  }

  // Mouse wheel zoom
  function handleWheel(e: React.WheelEvent) {
    if (showScaleDialog) return;
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;
    const direction = e.deltaY < 0 ? 1 : -1;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (1 + direction * ZOOM_STEP)));
    const s = newZoom / zoom;
    setOffset({ x: mouseX - s * (mouseX - offset.x), y: mouseY - s * (mouseY - offset.y) });
    setZoom(newZoom);
  }

  // --- Pointer handlers ---
  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || showScaleDialog) return;

    // Space held = always pan, regardless of active tool
    if (spaceHeld) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (mode === "calibrate") {
      const pt = screenToImage(e.clientX, e.clientY);
      if (!pt) return;
      if (!calPoint1) {
        setCalPoint1(pt);
      } else if (!calPoint2) {
        setCalPoint2(pt);
        setShowScaleDialog(true);
        setTimeout(() => distanceInputRef.current?.focus(), 50);
      }
      return;
    }

    if (mode === "measure" || mode === "area" || mode === "object") {
      // Single click adds a point; don't start panning
      return;
    }

    // Pan mode
    setIsPanning(true);
    setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleClick(e: React.MouseEvent) {
    if (spaceHeld) return; // suppress clicks while space-panning
    if (showScaleDialog) return;

    // Pan mode: only allow selecting/deselecting existing measurements
    if (mode === "pan") {
      const clicked = findClickedMeasurement(e.clientX, e.clientY);
      setSelectedId(clicked ? (clicked.id === selectedId ? null : clicked.id) : null);
      return;
    }

    if (mode !== "measure" && mode !== "area" && mode !== "object") return;

    const rawPt = screenToImage(e.clientX, e.clientY);
    if (!rawPt) return;
    const pt = snapPoint || rawPt;

    // Area mode: close polygon when clicking near first point
    if (mode === "area" && drawingPoints.length >= 3) {
      const firstSvg = imageToOverlay(drawingPoints[0]);
      const clickSvg = imageToOverlay(pt);
      if (ptDist(firstSvg, clickSvg) < SNAP_RADIUS) {
        finishMeasurement();
        return;
      }
    }

    // Object mode: auto-finish after 2 points
    if (mode === "object" && drawingPoints.length === 1) {
      const allPts = [...drawingPoints, pt];
      const points = allPts.map((p) => [p.x, p.y]);
      createMeasurement(planId, currentPage, objectType, points)
        .then((m) => setMeasurements((prev) => [...prev, m]))
        .catch(() => {});
      setDrawingPoints([]);
      setMeasureMousePos(null);
      setSnapPoint(null);
      return;
    }

    setDrawingPoints((prev) => [...prev, pt]);
  }

  function handleDoubleClick(e: React.MouseEvent) {
    if (mode !== "measure" && mode !== "area" && mode !== "object") return;
    e.preventDefault();
    finishMeasurement();
  }

  function handlePointerMove(e: React.PointerEvent) {
    // Space-pan takes priority
    if (isPanning) {
      setOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    if (mode === "calibrate" && calPoint1 && !calPoint2) {
      const pt = screenToImage(e.clientX, e.clientY);
      if (pt) setCalMousePos(pt);
      return;
    }

    if (mode === "measure" || mode === "area" || mode === "object") {
      const pt = screenToImage(e.clientX, e.clientY);
      if (pt) {
        const snap = findSnapPoint(pt);
        setSnapPoint(snap);
        setMeasureMousePos(snap || pt);
      }
      return;
    }

    // Pan mode: detect hovering over selectable measurements
    if (mode === "pan") {
      const hovering = !!findClickedMeasurement(e.clientX, e.clientY);
      if (hovering !== hoveringMeasurement) setHoveringMeasurement(hovering);
    }
  }

  function handlePointerUp() {
    setIsPanning(false);
  }

  // Find measurement near click
  function findClickedMeasurement(clientX: number, clientY: number): Measurement | null {
    const clickPt = screenToImage(clientX, clientY);
    if (!clickPt) return null;

    const threshold = 8 / zoom;

    const objectTypes = ["door", "window", "opening"];
    for (const m of measurements) {
      const pts = m.points.map((p) => ({ x: p[0], y: p[1] }));
      // For areas, check if point is inside the polygon
      if (m.type === "area" && pointInPolygon(clickPt, pts)) return m;
      // Check edges (including closing edge for areas)
      const edgeCount = m.type === "area" ? pts.length : pts.length - 1;
      // Object types are single-edge (2 points), use wider threshold
      const objThreshold = objectTypes.includes(m.type) ? threshold * 2 : threshold;
      for (let i = 0; i < edgeCount; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (pointToSegmentDist(clickPt, a, b) < objThreshold) return m;
      }
    }
    return null;
  }

  function pointInPolygon(pt: Point, poly: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i].y, yj = poly[j].y;
      const xi = poly[i].x, xj = poly[j].x;
      if ((yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function pointToSegmentDist(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return ptDist(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return ptDist(p, { x: a.x + t * dx, y: a.y + t * dy });
  }

  // --- Mode switching ---
  function switchMode(newMode: Mode) {
    // Cancel any in-progress work
    cancelCalibration();
    cancelMeasurement();
    setSelectedId(null);
    setHoveringMeasurement(false);
    setMode(newMode);
  }

  // --- Scale calibration ---
  function cancelCalibration() {
    setCalPoint1(null);
    setCalPoint2(null);
    setCalMousePos(null);
    setShowScaleDialog(false);
  }

  async function confirmScale() {
    if (!calPoint1 || !calPoint2 || !scaleDistance) return;
    const dist = parseFloat(scaleDistance);
    if (isNaN(dist) || dist <= 0) return;

    const pxDist = ptDist(calPoint1, calPoint2);
    setSavingScale(true);
    try {
      const saved = await saveScale(planId, currentPage, pxDist, dist, scaleUnit);
      setCurrentScale(saved);
      cancelCalibration();
      setMode("pan");
    } catch {
      // keep dialog open
    } finally {
      setSavingScale(false);
    }
  }

  // --- Measurements ---
  function cancelMeasurement() {
    setDrawingPoints([]);
    setMeasureMousePos(null);
    setSnapPoint(null);
  }

  async function finishMeasurement() {
    const minPoints = mode === "area" ? 3 : 2;
    if (drawingPoints.length < minPoints) return;
    const points = drawingPoints.map((p) => [p.x, p.y]);
    const type = mode === "object" ? objectType : mode === "area" ? "area" : "line";
    try {
      const m = await createMeasurement(planId, currentPage, type, points);
      setMeasurements((prev) => [...prev, m]);
    } catch {
      // ignore
    }
    setDrawingPoints([]);
    setMeasureMousePos(null);
    setSnapPoint(null);
  }

  async function deleteSelected() {
    if (!selectedId) return;
    try {
      await apiDeleteMeasurement(planId, currentPage, selectedId);
      setMeasurements((prev) => prev.filter((m) => m.id !== selectedId));
      setSelectedId(null);
    } catch {
      // ignore
    }
  }

  // --- Space-to-pan ---
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === " ") {
        e.preventDefault();
        setSpaceHeld(false);
        setIsPanning(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " ") return; // handled by space-to-pan

      // Delete selected measurement from any mode
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
        return;
      }

      // Door: R = swap hinge side, F = flip swing direction
      if ((e.key === "r" || e.key === "f") && selectedId) {
        const sel = measurements.find((m) => m.id === selectedId);
        if (sel && sel.type === "door" && sel.points.length === 2) {
          e.preventDefault();
          const updates: { points?: number[][]; label?: string } = {};
          if (e.key === "r") {
            updates.points = [sel.points[1], sel.points[0]];
          } else {
            updates.label = sel.label === "flipped" ? "" : "flipped";
          }
          updateMeasurement(planId, currentPage, selectedId, updates)
            .then((updated) => {
              setMeasurements((prev) => prev.map((m) => m.id === updated.id ? updated : m));
            })
            .catch(() => {});
          return;
        }
      }

      // Mode-specific
      if (mode === "calibrate" && e.key === "Escape") {
        e.preventDefault();
        switchMode("pan");
        return;
      }
      if (mode === "measure" || mode === "area" || mode === "object") {
        if (e.key === "Escape") {
          e.preventDefault();
          if (drawingPoints.length > 0) {
            cancelMeasurement();
          } else {
            switchMode("pan");
          }
          return;
        }
        const minToFinish = mode === "area" ? 3 : 2;
        if (e.key === "Enter" && drawingPoints.length >= minToFinish) {
          e.preventDefault();
          finishMeasurement();
          return;
        }
        if (e.key === "z" && (e.metaKey || e.ctrlKey) && drawingPoints.length > 0) {
          e.preventDefault();
          setDrawingPoints((prev) => prev.slice(0, -1));
          return;
        }
        // Object subtype shortcuts
        if (mode === "object") {
          if (e.key === "1") { e.preventDefault(); setObjectType("door"); return; }
          if (e.key === "2") { e.preventDefault(); setObjectType("window"); return; }
          if (e.key === "3") { e.preventDefault(); setObjectType("opening"); return; }
        }
      }

      switch (e.key) {
        case "+":
        case "=":
          e.preventDefault();
          setZoom((z) => Math.min(MAX_ZOOM, z * (1 + ZOOM_STEP)));
          break;
        case "-":
          e.preventDefault();
          setZoom((z) => Math.max(MIN_ZOOM, z * (1 - ZOOM_STEP)));
          break;
        case "0":
          e.preventDefault();
          setZoom(1);
          setOffset({ x: 0, y: 0 });
          break;
        case "f":
          e.preventDefault();
          zoomToFit();
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          setCurrentPage((p) => Math.max(1, p - 1));
          break;
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          setCurrentPage((p) => Math.min(pages.length, p + 1));
          break;
        case "s":
          e.preventDefault();
          setSheetPanelOpen((o) => !o);
          break;
        case "l":
          e.preventDefault();
          switchMode(mode === "measure" ? "pan" : "measure");
          break;
        case "a":
          e.preventDefault();
          switchMode(mode === "area" ? "pan" : "area");
          break;
        case "o":
          e.preventDefault();
          switchMode(mode === "object" ? "pan" : "object");
          break;
        case "Escape":
          router.push("/");
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length, zoomToFit, router, mode, drawingPoints, selectedId, objectType, measurements, planId, currentPage]);

  // Reset state when page changes
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
    setImageSize({ width: 0, height: 0 });
    cancelCalibration();
    cancelMeasurement();
    setSelectedId(null);
    setMode("pan");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // --- SVG rendering helpers ---

  // Convert image-space point to absolute SVG coordinates
  function toSvg(pt: Point): Point {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const o = imageToOverlay(pt);
    return { x: el.clientWidth / 2 + o.x, y: el.clientHeight / 2 + o.y };
  }

  function svgMidpoint(a: Point, b: Point): Point {
    return toSvg({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }

  // Render saved measurements
  function renderMeasurements() {
    if (measurements.length === 0) return null;

    const objectTypes = ["door", "window", "opening"];
    return measurements.map((m) => {
      const isSelected = m.id === selectedId;
      const pts = m.points.map((p) => ({ x: p[0], y: p[1] }));

      if (m.type === "area") {
        return renderAreaMeasurement(m.id, pts, isSelected, false);
      }

      if (objectTypes.includes(m.type)) {
        return renderObjectMeasurement(m.id, pts, m.type, isSelected, false, m.label);
      }

      // Line measurement
      const color = isSelected ? "#60a5fa" : "#10b981";
      const totalPx = polylinePixelLength(pts);

      // Scale labels with zoom: full size at zoom >= 1, shrink proportionally below
      const labelScale = Math.min(1, zoom);

      return (
        <g key={m.id}>
          {pts.slice(1).map((pt, i) => {
            const prev = pts[i];
            const s1 = toSvg(prev);
            const s2 = toSvg(pt);
            const mid = svgMidpoint(prev, pt);
            const segLabel = formatDistance(ptDist(prev, pt), currentScale);
            const labelW = segLabel.length * 6.5 + 8;
            return (
              <g key={i}>
                <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={color} strokeWidth={isSelected ? 3 : 2} strokeLinecap="round" />
                <g transform={`translate(${mid.x}, ${mid.y - 14}) scale(${labelScale}) translate(${-mid.x}, ${-(mid.y - 14)})`}>
                  <rect x={mid.x - labelW / 2} y={mid.y - 22} width={labelW} height={16} rx={3} fill="rgba(0,0,0,0.7)" />
                  <text x={mid.x} y={mid.y - 10} fill={color} fontSize={11} fontWeight={500} textAnchor="middle">{segLabel}</text>
                </g>
              </g>
            );
          })}
          {pts.map((pt, i) => {
            const s = toSvg(pt);
            return <circle key={i} cx={s.x} cy={s.y} r={4} fill={color} stroke="white" strokeWidth={1} />;
          })}
          {pts.length > 2 && (() => {
            const last = toSvg(pts[pts.length - 1]);
            const label = `Total: ${formatDistance(totalPx, currentScale)}`;
            const labelW = label.length * 7 + 8;
            const cx = last.x + 8 + labelW / 2;
            const cy = last.y + 6 + 9;
            return (
              <g transform={`translate(${cx}, ${cy}) scale(${labelScale}) translate(${-cx}, ${-cy})`}>
                <rect x={last.x + 8} y={last.y + 6} width={labelW} height={18} rx={3} fill="rgba(0,0,0,0.75)" />
                <text x={last.x + 12} y={last.y + 19} fill={color} fontSize={12} fontWeight={700}>{label}</text>
              </g>
            );
          })()}
        </g>
      );
    });
  }

  // Render a closed area polygon
  function renderAreaMeasurement(key: string, pts: Point[], isSelected: boolean, isDrawing: boolean) {
    const color = isDrawing ? "#a78bfa" : isSelected ? "#60a5fa" : "#8b5cf6"; // purple for areas
    const fillColor = isDrawing ? "rgba(167,139,250,0.15)" : isSelected ? "rgba(96,165,250,0.2)" : "rgba(139,92,246,0.15)";
    const svgPts = pts.map(toSvg);
    const polyStr = svgPts.map((p) => `${p.x},${p.y}`).join(" ");
    const areaPx = polygonPixelArea(pts);
    const perimPx = polygonPerimeter(pts);
    const center = toSvg(polygonCentroid(pts));
    const areaLabel = formatArea(areaPx, currentScale);
    const perimLabel = `Perim: ${formatDistance(perimPx, currentScale)}`;
    const mainLabelW = areaLabel.length * 7.5 + 10;
    const perimLabelW = perimLabel.length * 6.5 + 8;

    // Scale labels with zoom: full size at zoom >= 1, shrink proportionally below
    const labelScale = Math.min(1, zoom);

    return (
      <g key={key}>
        <polygon points={polyStr} fill={fillColor} stroke={color} strokeWidth={isSelected ? 3 : 2} strokeLinejoin="round" />
        {/* Edge length labels */}
        {pts.length >= 2 && pts.map((pt, i) => {
          const next = pts[(i + 1) % pts.length];
          // Skip closing edge for in-progress drawings with < 3 points
          if (isDrawing && pts.length < 3 && i === pts.length - 1) return null;
          const mid = svgMidpoint(pt, next);
          const edgeLabel = formatDistance(ptDist(pt, next), currentScale);
          const edgeLabelW = edgeLabel.length * 6.5 + 8;
          return (
            <g key={`edge-${i}`} transform={`translate(${mid.x}, ${mid.y - 14}) scale(${labelScale}) translate(${-mid.x}, ${-(mid.y - 14)})`}>
              <rect x={mid.x - edgeLabelW / 2} y={mid.y - 22} width={edgeLabelW} height={16} rx={3} fill="rgba(0,0,0,0.7)" />
              <text x={mid.x} y={mid.y - 10} fill={color} fontSize={11} fontWeight={500} textAnchor="middle">{edgeLabel}</text>
            </g>
          );
        })}
        {svgPts.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={4} fill={color} stroke="white" strokeWidth={1} />
        ))}
        {pts.length >= 3 && (
          <g transform={`translate(${center.x}, ${center.y}) scale(${labelScale}) translate(${-center.x}, ${-center.y})`}>
            <rect x={center.x - mainLabelW / 2} y={center.y - 24} width={mainLabelW} height={20} rx={4} fill="rgba(0,0,0,0.75)" />
            <text x={center.x} y={center.y - 10} fill={color} fontSize={13} fontWeight={700} textAnchor="middle">{areaLabel}</text>
            <rect x={center.x - perimLabelW / 2} y={center.y + 2} width={perimLabelW} height={16} rx={3} fill="rgba(0,0,0,0.7)" />
            <text x={center.x} y={center.y + 14} fill={color} fontSize={11} fontWeight={500} textAnchor="middle">{perimLabel}</text>
          </g>
        )}
      </g>
    );
  }

  // Render a wall object (door/window/opening)
  function renderObjectMeasurement(key: string, pts: Point[], type: string, isSelected: boolean, isDrawing: boolean, measurementLabel?: string) {
    const objType = type as ObjectType;
    const baseColor = OBJECT_COLORS[objType] || "#f43f5e";
    const color = isSelected ? "#60a5fa" : baseColor;
    const label = OBJECT_LABELS[objType] || type;
    const labelScale = Math.min(1, zoom);
    const flipped = measurementLabel === "flipped";

    if (pts.length < 2) {
      // Single point placed — show dot
      const s = toSvg(pts[0]);
      return (
        <g key={key}>
          <circle cx={s.x} cy={s.y} r={5} fill={color} stroke="white" strokeWidth={1} />
        </g>
      );
    }

    const s1 = toSvg(pts[0]);
    const s2 = toSvg(pts[1]);
    const mid = svgMidpoint(pts[0], pts[1]);
    const widthLabel = formatDistance(ptDist(pts[0], pts[1]), currentScale);
    const widthLabelW = widthLabel.length * 6.5 + 8;
    const typeLabelW = label.length * 7 + 8;

    // Compute perpendicular direction for tick marks (window) or arc (door)
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = len > 0 ? -dy / len : 0; // perpendicular unit vector
    const ny = len > 0 ? dx / len : 0;
    const tickLen = 8;

    return (
      <g key={key}>
        {/* Main line */}
        <line
          x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y}
          stroke={color}
          strokeWidth={isSelected ? 4 : 3}
          strokeLinecap="round"
          strokeDasharray={objType === "opening" ? "6 4" : undefined}
        />

        {/* Type-specific decorations */}
        {objType === "door" && len > 0 && (() => {
          // Quarter-circle arc from one endpoint, radius = door width
          // flipped controls which side of the wall the door swings to
          const sign = flipped ? -1 : 1;
          const arcEndX = s1.x + nx * len * sign;
          const arcEndY = s1.y + ny * len * sign;
          const sweepFlag = flipped ? 0 : 1;
          return (
            <path
              d={`M ${s2.x},${s2.y} A ${len},${len} 0 0,${sweepFlag} ${arcEndX},${arcEndY}`}
              fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="4 3"
            />
          );
        })()}

        {objType === "window" && (
          <>
            {/* Perpendicular ticks at each end */}
            <line x1={s1.x - nx * tickLen} y1={s1.y - ny * tickLen} x2={s1.x + nx * tickLen} y2={s1.y + ny * tickLen} stroke={color} strokeWidth={2} strokeLinecap="round" />
            <line x1={s2.x - nx * tickLen} y1={s2.y - ny * tickLen} x2={s2.x + nx * tickLen} y2={s2.y + ny * tickLen} stroke={color} strokeWidth={2} strokeLinecap="round" />
            {/* Center line */}
            <line x1={mid.x - nx * tickLen * 0.6} y1={mid.y - ny * tickLen * 0.6} x2={mid.x + nx * tickLen * 0.6} y2={mid.y + ny * tickLen * 0.6} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
          </>
        )}

        {/* Endpoints */}
        <circle cx={s1.x} cy={s1.y} r={4} fill={color} stroke="white" strokeWidth={1} />
        <circle cx={s2.x} cy={s2.y} r={4} fill={color} stroke="white" strokeWidth={1} />

        {/* Width label */}
        <g transform={`translate(${mid.x}, ${mid.y - 14}) scale(${labelScale}) translate(${-mid.x}, ${-(mid.y - 14)})`}>
          <rect x={mid.x - widthLabelW / 2} y={mid.y - 22} width={widthLabelW} height={16} rx={3} fill="rgba(0,0,0,0.7)" />
          <text x={mid.x} y={mid.y - 10} fill={color} fontSize={11} fontWeight={500} textAnchor="middle">{widthLabel}</text>
        </g>

        {/* Type label below */}
        <g transform={`translate(${mid.x}, ${mid.y + 4}) scale(${labelScale}) translate(${-mid.x}, ${-(mid.y + 4)})`}>
          <rect x={mid.x - typeLabelW / 2} y={mid.y + 2} width={typeLabelW} height={16} rx={3} fill="rgba(0,0,0,0.75)" />
          <text x={mid.x} y={mid.y + 14} fill={color} fontSize={11} fontWeight={600} textAnchor="middle">{label}</text>
        </g>
      </g>
    );
  }

  // Render in-progress drawing
  function renderDrawing() {
    if ((mode !== "measure" && mode !== "area" && mode !== "object") || drawingPoints.length === 0) return null;

    const allPts = [...drawingPoints];
    const mouseTarget = measureMousePos;

    // Object mode: show in-progress line
    if (mode === "object") {
      const previewPts = mouseTarget ? [...allPts, mouseTarget] : allPts;
      return (
        <g>
          {renderObjectMeasurement("drawing", previewPts, objectType, false, true)}
          {snapPoint && (() => {
            const s = toSvg(snapPoint);
            return <circle cx={s.x} cy={s.y} r={8} fill="none" stroke="#f59e0b" strokeWidth={2} />;
          })()}
        </g>
      );
    }

    // Area mode: show live polygon preview
    if (mode === "area") {
      const previewPts = mouseTarget ? [...allPts, mouseTarget] : allPts;
      // Show close indicator when near first point
      const nearFirst = mouseTarget && allPts.length >= 3 &&
        ptDist(imageToOverlay(mouseTarget), imageToOverlay(allPts[0])) < SNAP_RADIUS;

      return (
        <g>
          {renderAreaMeasurement("drawing", previewPts, false, true)}
          {/* Closing indicator */}
          {nearFirst && (() => {
            const s = toSvg(allPts[0]);
            return <circle cx={s.x} cy={s.y} r={10} fill="none" stroke="#a78bfa" strokeWidth={2} strokeDasharray="4 2" />;
          })()}
          {snapPoint && !nearFirst && (() => {
            const s = toSvg(snapPoint);
            return <circle cx={s.x} cy={s.y} r={8} fill="none" stroke="#f59e0b" strokeWidth={2} />;
          })()}
        </g>
      );
    }

    // Line mode
    const color = "#22d3ee";

    return (
      <g>
        {allPts.slice(1).map((pt, i) => {
          const prev = allPts[i];
          const s1 = toSvg(prev);
          const s2 = toSvg(pt);
          const mid = svgMidpoint(prev, pt);
          const segLabel = formatDistance(ptDist(prev, pt), currentScale);
          const labelW = segLabel.length * 6.5 + 8;
          return (
            <g key={i}>
              <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={color} strokeWidth={2} strokeLinecap="round" />
              <rect x={mid.x - labelW / 2} y={mid.y - 22} width={labelW} height={16} rx={3} fill="rgba(0,0,0,0.7)" />
              <text x={mid.x} y={mid.y - 10} fill={color} fontSize={11} fontWeight={500} textAnchor="middle">{segLabel}</text>
            </g>
          );
        })}
        {mouseTarget && (() => {
          const s1 = toSvg(allPts[allPts.length - 1]);
          const s2 = toSvg(mouseTarget);
          const mid = svgMidpoint(allPts[allPts.length - 1], mouseTarget);
          const rbLabel = formatDistance(ptDist(allPts[allPts.length - 1], mouseTarget), currentScale);
          const rbW = rbLabel.length * 6.5 + 8;
          return (
            <g>
              <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={color} strokeWidth={2} strokeDasharray="6 3" strokeLinecap="round" />
              <rect x={mid.x - rbW / 2} y={mid.y - 22} width={rbW} height={16} rx={3} fill="rgba(0,0,0,0.7)" />
              <text x={mid.x} y={mid.y - 10} fill={color} fontSize={11} fontWeight={500} textAnchor="middle">{rbLabel}</text>
            </g>
          );
        })()}
        {allPts.map((pt, i) => {
          const s = toSvg(pt);
          return <circle key={i} cx={s.x} cy={s.y} r={4} fill={color} stroke="white" strokeWidth={1} />;
        })}
        {snapPoint && (() => {
          const s = toSvg(snapPoint);
          return <circle cx={s.x} cy={s.y} r={8} fill="none" stroke="#f59e0b" strokeWidth={2} />;
        })()}
        {allPts.length >= 2 && mouseTarget && (() => {
          const totalPx = polylinePixelLength(allPts) + ptDist(allPts[allPts.length - 1], mouseTarget);
          const last = toSvg(mouseTarget);
          const label = `Total: ${formatDistance(totalPx, currentScale)}`;
          const labelW = label.length * 7 + 8;
          return (
            <g>
              <rect x={last.x + 8} y={last.y + 6} width={labelW} height={18} rx={3} fill="rgba(0,0,0,0.75)" />
              <text x={last.x + 12} y={last.y + 19} fill={color} fontSize={12} fontWeight={700}>{label}</text>
            </g>
          );
        })()}
      </g>
    );
  }

  // Render calibration overlay
  function renderCalibrationOverlay() {
    if (mode !== "calibrate" || !calPoint1) return null;

    const endPoint = calPoint2 || calMousePos;
    if (!endPoint) {
      const s = toSvg(calPoint1);
      return <circle cx={s.x} cy={s.y} r={5} fill="#f59e0b" />;
    }

    const s1 = toSvg(calPoint1);
    const s2 = toSvg(endPoint);
    return (
      <g>
        <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" />
        <circle cx={s1.x} cy={s1.y} r={5} fill="#f59e0b" />
        <circle cx={s2.x} cy={s2.y} r={5} fill="#f59e0b" />
      </g>
    );
  }

  // Scale dialog
  function renderScaleDialog() {
    if (!showScaleDialog) return null;

    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="w-80 rounded-lg bg-zinc-800 p-5 shadow-xl">
          <h3 className="text-base font-semibold text-white">Set Scale</h3>
          <p className="mt-1 text-sm text-zinc-400">
            Enter the real-world length of the line you drew.
          </p>
          <div className="mt-4 flex gap-2">
            <input
              ref={distanceInputRef}
              type="number"
              min="0"
              step="any"
              value={scaleDistance}
              onChange={(e) => setScaleDistance(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmScale(); }}
              placeholder="Distance"
              className="flex-1 rounded bg-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-400 outline-none focus:ring-2 focus:ring-amber-500"
            />
            <select
              value={scaleUnit}
              onChange={(e) => setScaleUnit(e.target.value)}
              className="rounded bg-zinc-700 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="ft">feet</option>
              <option value="in">inches</option>
              <option value="m">meters</option>
              <option value="cm">cm</option>
            </select>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => { cancelCalibration(); setMode("pan"); }}
              className="rounded px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
            >
              Cancel
            </button>
            <button
              onClick={confirmScale}
              disabled={!scaleDistance || savingScale}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40"
            >
              {savingScale ? "Saving..." : "Set Scale"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Format scale for toolbar
  function scaleLabel(): string | null {
    if (!currentScale) return null;
    const { real_distance, unit, pixel_distance } = currentScale;
    const pxPerInch = 144;
    const realPerInch = (pxPerInch / pixel_distance) * real_distance;
    return `1\u2033 = ${realPerInch.toFixed(1)} ${UNIT_LABELS[unit] || unit}`;
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-zinc-400">
        Loading plan...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-zinc-900 text-zinc-400">
        <p>{error}</p>
        <button
          onClick={() => router.push("/")}
          className="rounded bg-zinc-700 px-4 py-2 text-sm text-white hover:bg-zinc-600"
        >
          Back to plans
        </button>
      </div>
    );
  }

  const zoomPercent = Math.round(zoom * 100);
  const scale = scaleLabel();
  const cursor = spaceHeld
    ? (isPanning ? "grabbing" : "grab")
    : (mode === "calibrate" || mode === "measure" || mode === "area" || mode === "object") ? "crosshair"
    : isPanning ? "grabbing"
    : hoveringMeasurement ? "default"
    : "grab";

  return (
    <div className="flex h-screen flex-col bg-zinc-900 text-white select-none">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-700 bg-zinc-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-700"
            title="Back (Esc)"
          >
            &larr; Back
          </button>
          <span className="text-sm text-zinc-400">
            Sheet {currentPage} of {pages.length}
          </span>
          {scale && (
            <>
              <div className="h-4 w-px bg-zinc-600" />
              <span className="text-sm text-amber-400" title="Current scale">{scale}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <button
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z * (1 - ZOOM_STEP)))}
            className="rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-700"
            title="Zoom out (-)"
          >
            &minus;
          </button>
          <span className="w-14 text-center text-sm text-zinc-300">{zoomPercent}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * (1 + ZOOM_STEP)))}
            className="rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-700"
            title="Zoom in (+)"
          >
            +
          </button>
          <div className="mx-1 h-4 w-px bg-zinc-600" />
          <button
            onClick={zoomToFit}
            className="rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-700"
            title="Zoom to fit (F)"
          >
            Fit
          </button>
          <button
            onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
            className="rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-700"
            title="Zoom to 100% (0)"
          >
            100%
          </button>

          <div className="mx-1 h-4 w-px bg-zinc-600" />

          {/* Tool buttons */}
          <button
            onClick={() => switchMode("calibrate")}
            className={`rounded px-2 py-1 text-sm font-medium hover:bg-zinc-700 ${
              mode === "calibrate" ? "bg-amber-600 text-white" : "text-amber-400"
            }`}
            title="Set scale — draw a line over a known dimension"
          >
            Scale
          </button>
          <button
            onClick={() => switchMode(mode === "measure" ? "pan" : "measure")}
            className={`rounded px-2 py-1 text-sm font-medium hover:bg-zinc-700 ${
              mode === "measure" ? "bg-emerald-600 text-white" : "text-emerald-400"
            }`}
            title="Linear measurement (L)"
          >
            Line
          </button>
          <button
            onClick={() => switchMode(mode === "area" ? "pan" : "area")}
            className={`rounded px-2 py-1 text-sm font-medium hover:bg-zinc-700 ${
              mode === "area" ? "bg-purple-600 text-white" : "text-purple-400"
            }`}
            title="Area measurement (A)"
          >
            Area
          </button>
          <button
            onClick={() => switchMode(mode === "object" ? "pan" : "object")}
            className={`rounded px-2 py-1 text-sm font-medium hover:bg-zinc-700 ${
              mode === "object" ? "bg-rose-600 text-white" : "text-rose-400"
            }`}
            title="Mark doors, windows, openings (O)"
          >
            Objects
          </button>

          <div className="mx-1 h-4 w-px bg-zinc-600" />
          <button
            onClick={() => setSheetPanelOpen((o) => !o)}
            className={`rounded px-2 py-1 text-sm hover:bg-zinc-700 ${sheetPanelOpen ? "text-white" : "text-zinc-400"}`}
            title="Toggle sheets panel (S)"
          >
            Sheets
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
            title="Previous sheet"
          >
            &lsaquo; Prev
          </button>
          <button
            onClick={() => setCurrentPage((p) => Math.min(pages.length, p + 1))}
            disabled={currentPage >= pages.length}
            className="rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
            title="Next sheet"
          >
            Next &rsaquo;
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sheet navigation panel */}
        {sheetPanelOpen && (
          <div className="w-48 shrink-0 overflow-y-auto border-r border-zinc-700 bg-zinc-800/50">
            <div className="p-2">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Sheets
              </h3>
              <ul className="space-y-1">
                {pages.map((page) => (
                  <li key={page}>
                    <button
                      onClick={() => setCurrentPage(page)}
                      className={`w-full rounded px-3 py-2 text-left text-sm transition-colors ${
                        page === currentPage
                          ? "bg-blue-600 text-white"
                          : "text-zinc-300 hover:bg-zinc-700"
                      }`}
                    >
                      Sheet {page}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Viewer */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden"
          style={{ cursor }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        >
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) translate(-50%, -50%) scale(${zoom})`,
              transformOrigin: "center center",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={getPageImageUrl(planId, currentPage)}
              alt={`Sheet ${currentPage}`}
              onLoad={handleImageLoad}
              draggable={false}
              className="max-w-none"
            />
          </div>

          {/* SVG overlay for all annotations */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {renderMeasurements()}
            {renderDrawing()}
            {renderCalibrationOverlay()}
          </svg>

          {/* Context banner — absolutely positioned to avoid layout shift */}
          {mode === "calibrate" && !showScaleDialog && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-amber-600/90 px-4 py-2 text-center text-sm font-medium text-white">
              {!calPoint1
                ? "Click the first point of a known dimension on the plan"
                : "Click the second point to complete the line"}
            </div>
          )}
          {mode === "measure" && drawingPoints.length === 0 && !selectedId && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-emerald-600/90 px-4 py-2 text-center text-sm font-medium text-white">
              Click to start measuring. Double-click or Enter to finish. Esc to cancel.
              {!currentScale && " (Set scale first for real-world units)"}
            </div>
          )}
          {mode === "measure" && drawingPoints.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-emerald-600/90 px-4 py-2 text-center text-sm font-medium text-white">
              Click to add points. Double-click or Enter to finish. Ctrl+Z to undo last point.
            </div>
          )}
          {mode === "area" && drawingPoints.length === 0 && !selectedId && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-purple-600/90 px-4 py-2 text-center text-sm font-medium text-white">
              Click to place polygon vertices. Click first point or Enter to close. Esc to cancel.
              {!currentScale && " (Set scale first for real-world units)"}
            </div>
          )}
          {mode === "area" && drawingPoints.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-purple-600/90 px-4 py-2 text-center text-sm font-medium text-white">
              Click to add vertices. {drawingPoints.length >= 3 ? "Click first point or Enter to close shape." : "Need at least 3 points."} Ctrl+Z to undo.
            </div>
          )}
          {mode === "object" && drawingPoints.length === 0 && !selectedId && (
            <div className="pointer-events-auto absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-3 bg-rose-600/90 px-4 py-2 text-sm font-medium text-white">
              <span>Click to mark the start of the opening.</span>
              <span className="mx-1 h-4 w-px bg-white/30" />
              {(["door", "window", "opening"] as ObjectType[]).map((t, i) => (
                <button
                  key={t}
                  onClick={(e) => { e.stopPropagation(); setObjectType(t); }}
                  className={`rounded px-2 py-0.5 text-xs font-semibold ${objectType === t ? "bg-white/25" : "bg-white/10 hover:bg-white/15"}`}
                >
                  {i + 1}. {OBJECT_LABELS[t]}
                </button>
              ))}
            </div>
          )}
          {mode === "object" && drawingPoints.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-3 bg-rose-600/90 px-4 py-2 text-sm font-medium text-white">
              <span>Click the other end of the opening to finish.</span>
              <span className="text-xs opacity-70">({OBJECT_LABELS[objectType]})</span>
            </div>
          )}
          {selectedId && drawingPoints.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-blue-600/90 px-4 py-2 text-center text-sm font-medium text-white">
              Measurement selected. Press Delete to remove.{" "}
              {measurements.find((m) => m.id === selectedId)?.type === "door" && "R = move hinge, F = flip swing. "}
              Click elsewhere to deselect.
            </div>
          )}

          {/* Scale dialog */}
          {renderScaleDialog()}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-zinc-700 bg-zinc-800 px-4 py-1.5 text-xs text-zinc-500">
        <div>
          <span className="mr-4">Scroll to zoom</span>
          <span className="mr-4">Drag to pan</span>
          <span className="mr-4"><kbd>F</kbd> Fit</span>
          <span className="mr-4"><kbd>0</kbd> 100%</span>
          <span className="mr-4"><kbd>L</kbd> Line</span>
          <span className="mr-4"><kbd>A</kbd> Area</span>
          <span className="mr-4"><kbd>O</kbd> Objects</span>
          <span className="mr-4"><kbd>&larr;&rarr;</kbd> Sheets</span>
          <span><kbd>S</kbd> Toggle panel</span>
        </div>
        <div className="flex items-center gap-4">
          {(() => {
            const objectTypes = ["door", "window", "opening"];
            const objCount = measurements.filter((m) => objectTypes.includes(m.type)).length;
            const measCount = measurements.length - objCount;
            return (
              <>
                {measCount > 0 && (
                  <span className="text-emerald-500/70">
                    {measCount} measurement{measCount !== 1 ? "s" : ""}
                  </span>
                )}
                {objCount > 0 && (
                  <span className="text-rose-500/70">
                    {objCount} object{objCount !== 1 ? "s" : ""}
                  </span>
                )}
              </>
            );
          })()}
          {currentScale && (
            <span className="text-amber-500/70">
              Scale: {currentScale.real_distance} {UNIT_LABELS[currentScale.unit] || currentScale.unit} per {Math.round(currentScale.pixel_distance)} px
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
