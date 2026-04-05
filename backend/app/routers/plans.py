from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.services import pdf_service

router = APIRouter(prefix="/api", tags=["plans"])

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB


@router.post("/projects/{project_id}/plans")
async def upload_plan(project_id: str, file: UploadFile):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    pdf_bytes = await file.read()
    if len(pdf_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 100 MB)")

    plan = pdf_service.process_pdf(project_id, file.filename, pdf_bytes)
    return plan


@router.get("/projects/{project_id}/plans")
def list_plans(project_id: str):
    return pdf_service.list_plans(project_id)


@router.get("/plans/{plan_id}/pages")
def list_pages(plan_id: str):
    # Find plan across projects
    from app.services.pdf_service import UPLOADS_DIR

    if not UPLOADS_DIR.exists():
        raise HTTPException(status_code=404, detail="Plan not found")

    for project_dir in UPLOADS_DIR.iterdir():
        if not project_dir.is_dir():
            continue
        plan = pdf_service.get_plan(project_dir.name, plan_id)
        if plan:
            return {
                "plan_id": plan_id,
                "page_count": plan["page_count"],
                "pages": list(range(1, plan["page_count"] + 1)),
            }

    raise HTTPException(status_code=404, detail="Plan not found")


@router.get("/plans/{plan_id}/pages/{page_number}")
def get_page_image(plan_id: str, page_number: int):
    path = pdf_service.get_page_image_path(plan_id, page_number)
    if not path:
        raise HTTPException(status_code=404, detail="Page not found")
    return FileResponse(path, media_type="image/png")


class ScaleInput(BaseModel):
    pixel_distance: float
    real_distance: float
    unit: str  # "ft", "in", "m", "cm"


@router.get("/plans/{plan_id}/scale")
def get_all_scales(plan_id: str):
    return pdf_service.get_all_scales(plan_id)


@router.get("/plans/{plan_id}/pages/{page_number}/scale")
def get_scale(plan_id: str, page_number: int):
    scale = pdf_service.get_scale(plan_id, page_number)
    if not scale:
        raise HTTPException(status_code=404, detail="Scale not set for this page")
    return scale


@router.put("/plans/{plan_id}/pages/{page_number}/scale")
def set_scale(plan_id: str, page_number: int, body: ScaleInput):
    if body.real_distance <= 0:
        raise HTTPException(status_code=400, detail="Distance must be positive")
    if body.unit not in ("ft", "in", "m", "cm"):
        raise HTTPException(status_code=400, detail="Unit must be ft, in, m, or cm")
    try:
        return pdf_service.save_scale(
            plan_id, page_number, body.pixel_distance, body.real_distance, body.unit
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Plan not found")


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: str, project_id: str = "default"):
    if not pdf_service.delete_plan(project_id, plan_id):
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"status": "deleted"}
