"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Загрузка файла напрямую в Supabase Storage (RLS bucket'а проверяет роль),
 * затем регистрация в таблице assets.
 * Путь: smm-assets/<workspace_id>/<brand_id>/<asset_id>/<filename>
 */
export function UploadForm({
  workspaceId,
  brands,
}: {
  workspaceId: string;
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const assetId = crypto.randomUUID();
      const safeName = file.name.replace(/[^\w.\-()а-яА-ЯёЁ ]+/g, "_");
      const path = `${workspaceId}/${brandId || "shared"}/${assetId}/${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("smm-assets")
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const type = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : file.type.startsWith("audio/")
            ? "audio"
            : "document";

      const { error: insertError } = await supabase.from("assets").insert({
        id: assetId,
        workspace_id: workspaceId,
        brand_id: brandId || null,
        type,
        storage_bucket: "smm-assets",
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      });
      if (insertError) throw insertError;

      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={upload} className="card flex flex-wrap items-end gap-3">
      <div>
        <label className="label">Файл</label>
        <input
          type="file"
          className="input"
          accept="image/*,video/*,audio/*,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div>
        <label className="label">Бренд</label>
        <select
          className="input"
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
        >
          <option value="">Без бренда</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <button className="btn-primary" disabled={!file || loading}>
        {loading ? "Загрузка…" : "Загрузить"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
