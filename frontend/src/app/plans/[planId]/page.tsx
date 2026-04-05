"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  type Scale,
  getPlanPages,
  getPageImageUrl,
  getScale,
  setScale as saveScale,
} from "@/lib/api";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.15;

const UNIT_LABELS: Record<string, string> = {
  ft: "feet",
  in: "inches",
  m: "meters",
  cm: "centimeters",
};

type Point = { x: number; y: number };

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

  // Scale calibration state
  const [calibrating, setCalibrating] = useState(false);
  const [calPoint1, setCalPoint1] = useState<Point | null>(null);
  const [calPoint2, setCalPoint2] = useState<Point | null>(null);
  const [calMousePos, setCalMousePos] = useState<Point | null>(null);
  const [showScaleDialog, setShowScaleDialog] = useState(false);
  const [scaleDistance, setScaleDistance] = useState("");
  const [scaleUnit, setScaleUnit] = useState("ft");
  const [currentScale, setCurrentScale] = useState<Scale | null>(null);
  const [savingScale, setSavingScale] = useState(false);

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

  // Load scale for current page
  useEffect(() => {
    if (!planId || pages.length === 0) return;
    getScale(planId, currentPage).then(setCurrentScale);
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

  // Convert screen coordinates to image-space coordinates
  function screenToImage(clientX: number, clientY: number): Point | null {
    const container = containerRef.current;
    if (!container || imageSize.width === 0) return null;
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    // Image top-left in screen space
    const imgScreenX = centerX + offset.x - (imageSize.width * zoom) / 2;
    const imgScreenY = centerY + offset.y - (imageSize.height * zoom) / 2;
    return {
      x: (clientX - imgScreenX) / zoom,
      y: (clientY - imgScreenY) / zoom,
    };
  }

  // Convert image-space coordinates to the transform coordinate system for SVG overlay
  function imageToOverlay(pt: Point): Point {
    return {
      x: offset.x - (imageSize.width * zoom) / 2 + pt.x * zoom,
      y: offset.y - (imageSize.height * zoom) / 2 + pt.y * zoom,
    };
  }

  // Pixel distance between two image-space points
  function pixelDistance(a: Point, b: Point): number {
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
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

  // Pointer handlers — branch between pan mode and calibration mode
  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || showScaleDialog) return;

    if (calibrating) {
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

    setIsPanning(true);
    setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (calibrating && calPoint1 && !calPoint2) {
      const pt = screenToImage(e.clientX, e.clientY);
      if (pt) setCalMousePos(pt);
      return;
    }
    if (!isPanning) return;
    setOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  }

  function handlePointerUp() {
    setIsPanning(false);
  }

  // Scale calibration actions
  function startCalibration() {
    setCalibrating(true);
    setCalPoint1(null);
    setCalPoint2(null);
    setCalMousePos(null);
    setShowScaleDialog(false);
    setScaleDistance("");
    setScaleUnit("ft");
  }

  function cancelCalibration() {
    setCalibrating(false);
    setCalPoint1(null);
    setCalPoint2(null);
    setCalMousePos(null);
    setShowScaleDialog(false);
  }

  async function confirmScale() {
    if (!calPoint1 || !calPoint2 || !scaleDistance) return;
    const dist = parseFloat(scaleDistance);
    if (isNaN(dist) || dist <= 0) return;

    const pxDist = pixelDistance(calPoint1, calPoint2);
    setSavingScale(true);
    try {
      const saved = await saveScale(planId, currentPage, pxDist, dist, scaleUnit);
      setCurrentScale(saved);
      cancelCalibration();
    } catch {
      // keep dialog open on error
    } finally {
      setSavingScale(false);
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (calibrating && e.key === "Escape") {
        e.preventDefault();
        cancelCalibration();
        return;
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
        case "Escape":
          router.push("/");
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length, zoomToFit, router, calibrating]);

  // Reset view when page changes
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
    setImageSize({ width: 0, height: 0 });
    cancelCalibration();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // Build SVG overlay for calibration line
  function renderCalibrationOverlay() {
    if (!calibrating || !calPoint1) return null;

    const endPoint = calPoint2 || calMousePos;
    if (!endPoint) {
      // Just show the first point
      const p = imageToOverlay(calPoint1);
      return (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <circle cx={`calc(50% + ${p.x}px)`} cy={`calc(50% + ${p.y}px)`} r={5} fill="#f59e0b" />
        </svg>
      );
    }

    const p1 = imageToOverlay(calPoint1);
    const p2 = imageToOverlay(endPoint);

    return (
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <line
          x1={`calc(50% + ${p1.x}px)`}
          y1={`calc(50% + ${p1.y}px)`}
          x2={`calc(50% + ${p2.x}px)`}
          y2={`calc(50% + ${p2.y}px)`}
          stroke="#f59e0b"
          strokeWidth={2}
          strokeDasharray="6 3"
        />
        <circle cx={`calc(50% + ${p1.x}px)`} cy={`calc(50% + ${p1.y}px)`} r={5} fill="#f59e0b" />
        <circle cx={`calc(50% + ${p2.x}px)`} cy={`calc(50% + ${p2.y}px)`} r={5} fill="#f59e0b" />
      </svg>
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
              onClick={cancelCalibration}
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

  // Format scale for display
  function scaleLabel(): string | null {
    if (!currentScale) return null;
    const { real_distance, unit, pixel_distance } = currentScale;
    // Express as "1 inch on plan = X unit"
    // pixel_distance was at native image resolution (144 DPI), so 1 inch on paper = 144 px
    const pxPerInch = 144;
    const realPerInch = (pxPerInch / pixel_distance) * real_distance;
    return `1″ = ${realPerInch.toFixed(1)} ${UNIT_LABELS[unit] || unit}`;
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
          <button
            onClick={calibrating ? cancelCalibration : startCalibration}
            className={`rounded px-2 py-1 text-sm font-medium hover:bg-zinc-700 ${
              calibrating ? "bg-amber-600 text-white" : "text-amber-400"
            }`}
            title="Set scale — draw a line over a known dimension"
          >
            {calibrating ? "Cancel Scale" : "Set Scale"}
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

      {/* Calibration banner */}
      {calibrating && !showScaleDialog && (
        <div className="bg-amber-600/90 px-4 py-2 text-center text-sm font-medium text-white">
          {!calPoint1
            ? "Click the first point of a known dimension on the plan"
            : "Click the second point to complete the line"}
        </div>
      )}

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

        {/* Viewer canvas */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden"
          style={{ cursor: calibrating ? "crosshair" : isPanning ? "grabbing" : "grab" }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
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

          {/* Calibration line overlay */}
          {renderCalibrationOverlay()}

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
          <span className="mr-4"><kbd>+/-</kbd> Zoom</span>
          <span className="mr-4"><kbd>&larr;&rarr;</kbd> Sheets</span>
          <span><kbd>S</kbd> Toggle panel</span>
        </div>
        {currentScale && (
          <span className="text-amber-500/70">
            Scale: {currentScale.real_distance} {UNIT_LABELS[currentScale.unit] || currentScale.unit} per {Math.round(currentScale.pixel_distance)} px
          </span>
        )}
      </div>
    </div>
  );
}
