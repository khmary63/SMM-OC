"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GeneratePlanForm({
  workspaceId,
  brands,
}: {
  workspaceId: string;
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          brand_id: brandId,
          posts_per_week: postsPerWeek,
          instructions: instructions.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Ошибка генерации");
      setSummary(
        `Создано тем: ${json.created_items}. ${json.summary ?? ""}`.trim()
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  if (brands.length === 0) {
    return (
      <p className="text-sm text-amber-600">
        Сначала создайте бренд, чтобы планировать контент.
      </p>
    );
  }

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
        <label className="label">Постов в неделю</label>
        <input
          type="number"
          min={1}
          max={14}
          className="input w-28"
          value={postsPerWeek}
          onChange={(e) => setPostsPerWeek(Number(e.target.value))}
        />
      </div>
      <div className="w-full">
        <label className="label">
          Инструкции для этой генерации (необязательно)
        </label>
        <textarea
          className="input"
          rows={2}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Например: в этом месяце сделать упор на рубрику «Кейсы», добавить 2 темы про новую услугу…"
        />
      </div>
      <button className="btn-primary" disabled={loading}>
        {loading ? "Генерируем…" : "✨ Сгенерировать план (AI)"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
      {summary && <p className="w-full text-sm text-emerald-700">{summary}</p>}
    </form>
  );
}
