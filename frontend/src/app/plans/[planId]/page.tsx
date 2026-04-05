"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getPlanPages, getPageImageUrl } from "@/lib/api";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.15;

export default function PlanViewer() {
  const { planId } = useParams<{ planId: string }>();
  const router = useRouter();

  const [pages, setPages] = useState<number[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [sheetPanelOpen, setSheetPanelOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

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

  // Zoom to fit when image loads or page changes
  const zoomToFit = useCallback(() => {
    const container = containerRef.current;
    if (!container || imageSize.width === 0) return;

    const rect = container.getBoundingClientRect();
    const scaleX = rect.width / imageSize.width;
    const scaleY = rect.height / imageSize.height;
    const fitZoom = Math.min(scaleX, scaleY) * 0.95;

    setZoom(fitZoom);
    setOffset({ x: 0, y: 0 });
  }, [imageSize]);

  function handleImageLoad() {
    const img = imageRef.current;
    if (!img) return;
    setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
  }

  // Auto zoom-to-fit when image size is first available
  useEffect(() => {
    if (imageSize.width > 0) {
      zoomToFit();
    }
  }, [imageSize, zoomToFit]);

  // Mouse wheel zoom
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;

    const direction = e.deltaY < 0 ? 1 : -1;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (1 + direction * ZOOM_STEP)));
    const scale = newZoom / zoom;

    setOffset({
      x: mouseX - scale * (mouseX - offset.x),
      y: mouseY - scale * (mouseY - offset.y),
    });
    setZoom(newZoom);
  }

  // Pan handlers
  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!isPanning) return;
    setOffset({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y,
    });
  }

  function handlePointerUp() {
    setIsPanning(false);
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

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
  }, [pages.length, zoomToFit, router]);

  // Reset view when page changes
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
    setImageSize({ width: 0, height: 0 });
  }, [currentPage]);

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
            title="Previous sheet (←)"
          >
            &lsaquo; Prev
          </button>
          <button
            onClick={() => setCurrentPage((p) => Math.min(pages.length, p + 1))}
            disabled={currentPage >= pages.length}
            className="rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
            title="Next sheet (→)"
          >
            Next &rsaquo;
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sheet navigation panel */}
        {sheetPanelOpen && (
          <div className="w-48 shrink-0 overflow-y-auto border-r border-zinc-700 bg-zinc-850 bg-zinc-800/50">
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
          style={{ cursor: isPanning ? "grabbing" : "grab" }}
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
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="border-t border-zinc-700 bg-zinc-800 px-4 py-1.5 text-xs text-zinc-500">
        <span className="mr-4">Scroll to zoom</span>
        <span className="mr-4">Drag to pan</span>
        <span className="mr-4"><kbd>F</kbd> Fit</span>
        <span className="mr-4"><kbd>0</kbd> 100%</span>
        <span className="mr-4"><kbd>+/-</kbd> Zoom</span>
        <span className="mr-4"><kbd>&larr;&rarr;</kbd> Sheets</span>
        <span><kbd>S</kbd> Toggle panel</span>
      </div>
    </div>
  );
}
