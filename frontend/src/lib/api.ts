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
