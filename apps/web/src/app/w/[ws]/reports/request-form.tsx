"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RequestReportForm({
  workspaceId,
  brands,
}: {
  workspaceId: string;
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();
  const prevMonth = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [month, setMonth] = useState(prevMonth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          brand_id: brandId,
          report_month: month,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Ошибка");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  if (brands.length === 0) return null;

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3">
      <div>
        <label className="label">Бренд</label>
        <select
          className="input"
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Месяц</label>
        <input
          type="month"
          className="input"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>
      <button className="btn-primary" disabled={loading || !brandId}>
        {loading ? "Ставим в очередь…" : "Сформировать отчёт"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
