from __future__ import annotations

import pytest

pytestmark = pytest.mark.anyio


async def _upload(client, sample_pdf, project_id="default"):
    """Helper: upload a sample PDF and return the plan dict."""
    resp = await client.post(
        f"/api/projects/{project_id}/plans",
        files={"file": ("floor-plan.pdf", sample_pdf, "application/pdf")},
    )
    assert resp.status_code == 200
    return resp.json()


# --- Plans ---


async def test_upload_plan(client, sample_pdf):
    plan = await _upload(client, sample_pdf)
    assert plan["filename"] == "floor-plan.pdf"
    assert plan["page_count"] == 2
    assert plan["project_id"] == "default"
    assert "id" in plan


async def test_upload_rejects_non_pdf(client):
    resp = await client.post(
        "/api/projects/default/plans",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 400
    assert "PDF" in resp.json()["detail"]


async def test_list_plans(client, sample_pdf):
    await _upload(client, sample_pdf)
    await _upload(client, sample_pdf)

    resp = await client.get("/api/projects/default/plans")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_list_pages(client, sample_pdf):
    plan = await _upload(client, sample_pdf)

    resp = await client.get(f"/api/plans/{plan['id']}/pages")
    assert resp.status_code == 200
    data = resp.json()
    assert data["page_count"] == 2
    assert data["pages"] == [1, 2]


async def test_get_page_image(client, sample_pdf):
    plan = await _upload(client, sample_pdf)

    resp = await client.get(f"/api/plans/{plan['id']}/pages/1")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert len(resp.content) > 0


async def test_get_page_image_not_found(client, sample_pdf):
    plan = await _upload(client, sample_pdf)
    resp = await client.get(f"/api/plans/{plan['id']}/pages/99")
    assert resp.status_code == 404


async def test_delete_plan(client, sample_pdf):
    plan = await _upload(client, sample_pdf)

    resp = await client.delete(f"/api/plans/{plan['id']}?project_id=default")
    assert resp.status_code == 200

    resp = await client.get("/api/projects/default/plans")
    assert len(resp.json()) == 0


async def test_delete_plan_not_found(client):
    resp = await client.delete("/api/plans/nonexistent?project_id=default")
    assert resp.status_code == 404


# --- Scale ---


async def test_set_and_get_scale(client, sample_pdf):
    plan = await _upload(client, sample_pdf)

    resp = await client.put(
        f"/api/plans/{plan['id']}/pages/1/scale",
        json={"pixel_distance": 100.0, "real_distance": 10.0, "unit": "ft"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["pixels_per_unit"] == pytest.approx(10.0)
    assert data["unit"] == "ft"

    resp = await client.get(f"/api/plans/{plan['id']}/pages/1/scale")
    assert resp.status_code == 200
    assert resp.json()["pixels_per_unit"] == pytest.approx(10.0)


async def test_get_scale_not_set(client, sample_pdf):
    plan = await _upload(client, sample_pdf)
    resp = await client.get(f"/api/plans/{plan['id']}/pages/1/scale")
    assert resp.status_code == 404


async def test_scale_per_sheet(client, sample_pdf):
    plan = await _upload(client, sample_pdf)

    await client.put(
        f"/api/plans/{plan['id']}/pages/1/scale",
        json={"pixel_distance": 100.0, "real_distance": 10.0, "unit": "ft"},
    )
    await client.put(
        f"/api/plans/{plan['id']}/pages/2/scale",
        json={"pixel_distance": 200.0, "real_distance": 5.0, "unit": "m"},
    )

    resp = await client.get(f"/api/plans/{plan['id']}/scale")
    assert resp.status_code == 200
    scales = resp.json()
    assert "1" in scales
    assert "2" in scales
    assert scales["1"]["unit"] == "ft"
    assert scales["2"]["unit"] == "m"


async def test_scale_rejects_invalid_unit(client, sample_pdf):
    plan = await _upload(client, sample_pdf)
    resp = await client.put(
        f"/api/plans/{plan['id']}/pages/1/scale",
        json={"pixel_distance": 100.0, "real_distance": 10.0, "unit": "miles"},
    )
    assert resp.status_code == 400


async def test_scale_rejects_zero_distance(client, sample_pdf):
    plan = await _upload(client, sample_pdf)
    resp = await client.put(
        f"/api/plans/{plan['id']}/pages/1/scale",
        json={"pixel_distance": 100.0, "real_distance": 0, "unit": "ft"},
    )
    assert resp.status_code == 400


# --- Measurements ---


async def test_create_and_list_measurements(client, sample_pdf):
    plan = await _upload(client, sample_pdf)

    resp = await client.post(
        f"/api/plans/{plan['id']}/pages/1/measurements",
        json={"type": "line", "points": [[0, 0], [100, 0], [100, 100]]},
    )
    assert resp.status_code == 200
    m = resp.json()
    assert m["type"] == "line"
    assert len(m["points"]) == 3
    assert "id" in m
    assert "created_at" in m

    resp = await client.get(f"/api/plans/{plan['id']}/pages/1/measurements")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_measurements_per_sheet(client, sample_pdf):
    plan = await _upload(client, sample_pdf)

    await client.post(
        f"/api/plans/{plan['id']}/pages/1/measurements",
        json={"type": "line", "points": [[0, 0], [50, 50]]},
    )
    await client.post(
        f"/api/plans/{plan['id']}/pages/2/measurements",
        json={"type": "line", "points": [[10, 10], [20, 20]]},
    )

    resp1 = await client.get(f"/api/plans/{plan['id']}/pages/1/measurements")
    resp2 = await client.get(f"/api/plans/{plan['id']}/pages/2/measurements")
    assert len(resp1.json()) == 1
    assert len(resp2.json()) == 1


async def test_update_measurement(client, sample_pdf):
    plan = await _upload(client, sample_pdf)

    resp = await client.post(
        f"/api/plans/{plan['id']}/pages/1/measurements",
        json={"type": "line", "points": [[0, 0], [100, 0]]},
    )
    m_id = resp.json()["id"]

    resp = await client.put(
        f"/api/plans/{plan['id']}/pages/1/measurements/{m_id}",
        json={"points": [[0, 0], [200, 0]], "label": "north wall"},
    )
    assert resp.status_code == 200
    assert resp.json()["label"] == "north wall"
    assert resp.json()["points"] == [[0, 0], [200, 0]]


async def test_delete_measurement(client, sample_pdf):
    plan = await _upload(client, sample_pdf)

    resp = await client.post(
        f"/api/plans/{plan['id']}/pages/1/measurements",
        json={"type": "line", "points": [[0, 0], [100, 0]]},
    )
    m_id = resp.json()["id"]

    resp = await client.delete(f"/api/plans/{plan['id']}/pages/1/measurements/{m_id}")
    assert resp.status_code == 200

    resp = await client.get(f"/api/plans/{plan['id']}/pages/1/measurements")
    assert len(resp.json()) == 0


async def test_delete_measurement_not_found(client, sample_pdf):
    plan = await _upload(client, sample_pdf)
    resp = await client.delete(f"/api/plans/{plan['id']}/pages/1/measurements/nonexistent")
    assert resp.status_code == 404


async def test_measurement_with_label(client, sample_pdf):
    plan = await _upload(client, sample_pdf)

    resp = await client.post(
        f"/api/plans/{plan['id']}/pages/1/measurements",
        json={"type": "line", "points": [[0, 0], [100, 0]], "label": "garage wall"},
    )
    assert resp.status_code == 200
    assert resp.json()["label"] == "garage wall"


# --- Health ---


async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
