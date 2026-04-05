"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { type Plan, uploadPlan, listPlans, deletePlan } from "@/lib/api";

const PROJECT_ID = "default";

export default function Home() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPlans = useCallback(async () => {
    try {
      const data = await listPlans(PROJECT_ID);
      setPlans(data);
    } catch {
      // No plans yet — that's fine
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      await uploadPlan(PROJECT_ID, file);
      await loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(planId: string) {
    try {
      await deletePlan(planId, PROJECT_ID);
      await loadPlans();
    } catch {
      setError("Failed to delete plan");
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">Takeoff Estimator</h1>
        <p className="mt-2 text-zinc-500">Upload construction plans to get started</p>

        {/* Upload */}
        <div className="mt-8">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700">
            {uploading ? "Uploading..." : "Upload PDF"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}

        {/* Plan list */}
        {plans.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold">Plans</h2>
            <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
              {plans.map((plan) => (
                <li key={plan.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-medium">{plan.filename}</p>
                    <p className="text-sm text-zinc-500">
                      {plan.page_count} page{plan.page_count !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/plans/${plan.id}`}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      View
                    </Link>
                    <button
                      onClick={() => handleDelete(plan.id)}
                      className="text-sm text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
