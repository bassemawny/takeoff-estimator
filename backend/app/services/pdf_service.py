from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import fitz  # pymupdf

UPLOADS_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"

# Render at 2x for crisp display — 144 DPI (default is 72)
RENDER_DPI = 144


def get_project_dir(project_id: str) -> Path:
    return UPLOADS_DIR / project_id


def get_plan_dir(project_id: str, plan_id: str) -> Path:
    return get_project_dir(project_id) / plan_id


def get_plans_index_path(project_id: str) -> Path:
    return get_project_dir(project_id) / "plans.json"


def _read_plans_index(project_id: str) -> list[dict]:
    path = get_plans_index_path(project_id)
    if not path.exists():
        return []
    return json.loads(path.read_text())


def _write_plans_index(project_id: str, plans: list[dict]):
    path = get_plans_index_path(project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(plans, indent=2))


def process_pdf(project_id: str, filename: str, pdf_bytes: bytes) -> dict:
    plan_id = uuid.uuid4().hex[:12]
    plan_dir = get_plan_dir(project_id, plan_id)
    pages_dir = plan_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    # Save original PDF
    (plan_dir / "original.pdf").write_bytes(pdf_bytes)

    # Extract pages as PNG
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page_count = len(doc)
    zoom = RENDER_DPI / 72
    matrix = fitz.Matrix(zoom, zoom)

    for i in range(page_count):
        page = doc[i]
        pix = page.get_pixmap(matrix=matrix)
        pix.save(str(pages_dir / f"{i + 1}.png"))

    doc.close()

    plan = {
        "id": plan_id,
        "project_id": project_id,
        "filename": filename,
        "page_count": page_count,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }

    # Update index
    plans = _read_plans_index(project_id)
    plans.append(plan)
    _write_plans_index(project_id, plans)

    return plan


def list_plans(project_id: str) -> list[dict]:
    return _read_plans_index(project_id)


def get_plan(project_id: str, plan_id: str) -> dict | None:
    plans = _read_plans_index(project_id)
    return next((p for p in plans if p["id"] == plan_id), None)


def get_page_image_path(plan_id: str, page_number: int) -> Path | None:
    # Search across all projects for this plan_id
    if not UPLOADS_DIR.exists():
        return None
    for project_dir in UPLOADS_DIR.iterdir():
        if not project_dir.is_dir():
            continue
        page_path = project_dir / plan_id / "pages" / f"{page_number}.png"
        if page_path.exists():
            return page_path
    return None


def _find_plan_dir(plan_id: str) -> Path | None:
    """Find plan directory across all projects."""
    if not UPLOADS_DIR.exists():
        return None
    for project_dir in UPLOADS_DIR.iterdir():
        if not project_dir.is_dir():
            continue
        plan_dir = project_dir / plan_id
        if plan_dir.is_dir():
            return plan_dir
    return None


def get_scale(plan_id: str, page_number: int) -> dict | None:
    plan_dir = _find_plan_dir(plan_id)
    if not plan_dir:
        return None
    scale_path = plan_dir / "scale.json"
    if not scale_path.exists():
        return None
    scales = json.loads(scale_path.read_text())
    return scales.get(str(page_number))


def get_all_scales(plan_id: str) -> dict:
    plan_dir = _find_plan_dir(plan_id)
    if not plan_dir:
        return {}
    scale_path = plan_dir / "scale.json"
    if not scale_path.exists():
        return {}
    return json.loads(scale_path.read_text())


def save_scale(
    plan_id: str,
    page_number: int,
    pixel_distance: float,
    real_distance: float,
    unit: str,
) -> dict:
    plan_dir = _find_plan_dir(plan_id)
    if not plan_dir:
        raise FileNotFoundError(f"Plan {plan_id} not found")

    scale_path = plan_dir / "scale.json"
    scales: dict = {}
    if scale_path.exists():
        scales = json.loads(scale_path.read_text())

    pixels_per_unit = pixel_distance / real_distance
    scale_entry = {
        "pixel_distance": pixel_distance,
        "real_distance": real_distance,
        "unit": unit,
        "pixels_per_unit": pixels_per_unit,
    }
    scales[str(page_number)] = scale_entry
    scale_path.write_text(json.dumps(scales, indent=2))
    return scale_entry


def delete_plan(project_id: str, plan_id: str) -> bool:
    plans = _read_plans_index(project_id)
    updated = [p for p in plans if p["id"] != plan_id]
    if len(updated) == len(plans):
        return False

    _write_plans_index(project_id, updated)

    # Remove files
    import shutil
    plan_dir = get_plan_dir(project_id, plan_id)
    if plan_dir.exists():
        shutil.rmtree(plan_dir)

    return True
