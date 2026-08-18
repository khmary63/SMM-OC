"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * UUID v4 без зависимости от secure context: crypto.randomUUID() доступен
 * только по HTTPS/localhost, а сайт открывается по обычному HTTP.
 * crypto.getRandomValues работает и в небезопасном контексте.
 */
function generateUuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

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
  const [files, setFiles] = useState<File[]>([]);
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  async function uploadOne(file: File) {
    const supabase = createClient();
    const assetId = generateUuid();
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
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    setProgress({ done: 0, total: files.length });

    const failed: string[] = [];
    for (const file of files) {
      try {
        await uploadOne(file);
      } catch (err) {
        failed.push(
          `${file.name}: ${err instanceof Error ? err.message : "ошибка"}`
        );
      }
      setProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
    }

    setLoading(false);
    setProgress(null);
    setFiles([]);
    if (failed.length > 0) setError(failed.join("; "));
    router.refresh();
  }

  return (
    <form onSubmit={upload} className="card flex flex-wrap items-end gap-3">
      <div>
        <label className="label">Файлы</label>
        <input
          type="file"
          className="input"
          multiple
          accept="image/*,video/*,audio/*,.pdf"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        {files.length > 0 && (
          <p className="mt-1 text-xs text-zinc-500">
            Выбрано файлов: {files.length}
          </p>
        )}
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
      <button className="btn-primary" disabled={files.length === 0 || loading}>
        {loading
          ? `Загрузка… ${progress ? `${progress.done}/${progress.total}` : ""}`
          : files.length > 1
            ? `Загрузить (${files.length})`
            : "Загрузить"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
