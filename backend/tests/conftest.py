from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import fitz  # pymupdf
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services import pdf_service


@pytest.fixture(autouse=True)
def tmp_uploads(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Redirect all uploads to a temp directory so tests don't pollute real data."""
    monkeypatch.setattr(pdf_service, "UPLOADS_DIR", tmp_path)
    yield tmp_path


@pytest.fixture()
def sample_pdf() -> bytes:
    """Generate a minimal 2-page PDF in memory."""
    doc = fitz.open()
    for i in range(2):
        page = doc.new_page(width=200, height=200)
        page.insert_text((50, 100), f"Page {i + 1}")
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


@pytest.fixture()
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
