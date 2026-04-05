const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Plan {
  id: string;
  project_id: string;
  filename: string;
  page_count: number;
  uploaded_at: string;
}

export async function uploadPlan(
  projectId: string,
  file: File
): Promise<Plan> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}/api/projects/${projectId}/plans`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Upload failed");
  }

  return res.json();
}

export async function listPlans(projectId: string): Promise<Plan[]> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/plans`);
  if (!res.ok) throw new Error("Failed to fetch plans");
  return res.json();
}

export async function deletePlan(planId: string, projectId: string = "default"): Promise<void> {
  const res = await fetch(`${API_URL}/api/plans/${planId}?project_id=${projectId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete plan");
}

export function getPageImageUrl(planId: string, pageNumber: number): string {
  return `${API_URL}/api/plans/${planId}/pages/${pageNumber}`;
}

export interface PlanPages {
  plan_id: string;
  page_count: number;
  pages: number[];
}

export async function getPlanPages(planId: string): Promise<PlanPages> {
  const res = await fetch(`${API_URL}/api/plans/${planId}/pages`);
  if (!res.ok) throw new Error("Failed to fetch plan pages");
  return res.json();
}

export interface Scale {
  pixel_distance: number;
  real_distance: number;
  unit: string;
  pixels_per_unit: number;
}

export async function getScale(planId: string, pageNumber: number): Promise<Scale | null> {
  const res = await fetch(`${API_URL}/api/plans/${planId}/pages/${pageNumber}/scale`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to fetch scale");
  return res.json();
}

export async function getAllScales(planId: string): Promise<Record<string, Scale>> {
  const res = await fetch(`${API_URL}/api/plans/${planId}/scale`);
  if (!res.ok) return {};
  return res.json();
}

export async function setScale(
  planId: string,
  pageNumber: number,
  pixelDistance: number,
  realDistance: number,
  unit: string
): Promise<Scale> {
  const res = await fetch(`${API_URL}/api/plans/${planId}/pages/${pageNumber}/scale`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pixel_distance: pixelDistance,
      real_distance: realDistance,
      unit,
    }),
  });
  if (!res.ok) throw new Error("Failed to save scale");
  return res.json();
}

// --- Measurements ---

export interface Measurement {
  id: string;
  type: string;
  points: number[][];
  label: string;
  created_at: string;
}

export async function listMeasurements(
  planId: string,
  pageNumber: number
): Promise<Measurement[]> {
  const res = await fetch(
    `${API_URL}/api/plans/${planId}/pages/${pageNumber}/measurements`
  );
  if (!res.ok) return [];
  return res.json();
}

export async function createMeasurement(
  planId: string,
  pageNumber: number,
  type: string,
  points: number[][],
  label: string = ""
): Promise<Measurement> {
  const res = await fetch(
    `${API_URL}/api/plans/${planId}/pages/${pageNumber}/measurements`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, points, label }),
    }
  );
  if (!res.ok) throw new Error("Failed to save measurement");
  return res.json();
}

export async function updateMeasurement(
  planId: string,
  pageNumber: number,
  measurementId: string,
  updates: { points?: number[][]; label?: string }
): Promise<Measurement> {
  const res = await fetch(
    `${API_URL}/api/plans/${planId}/pages/${pageNumber}/measurements/${measurementId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );
  if (!res.ok) throw new Error("Failed to update measurement");
  return res.json();
}

export async function deleteMeasurement(
  planId: string,
  pageNumber: number,
  measurementId: string
): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/plans/${planId}/pages/${pageNumber}/measurements/${measurementId}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Failed to delete measurement");
}
