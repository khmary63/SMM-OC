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

function assetTypeOf(mime: string): "image" | "video" | "audio" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

type FileState = {
  name: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
};

/**
 * Массовая загрузка файлов напрямую в Supabase Storage (RLS bucket'а проверяет
 * роль), затем регистрация каждого в таблице assets. Файлы загружаются
 * последовательно, статус по каждому виден пользователю.
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
  const [progress, setProgress] = useState<FileState[]>([]);

  async function uploadOne(file: File): Promise<void> {
    const supabase = createClient();
    const assetId = generateUuid();
    const safeName = file.name.replace(/[^\w.\-()а-яА-ЯёЁ ]+/g, "_");
    const path = `${workspaceId}/${brandId || "shared"}/${assetId}/${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("smm-assets")
      .upload(path, file, { contentType: file.type });
    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase.from("assets").insert({
      id: assetId,
      workspace_id: workspaceId,
      brand_id: brandId || null,
      type: assetTypeOf(file.type),
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
    setProgress(files.map((f) => ({ name: f.name, status: "pending" })));

    let uploaded = 0;
    for (let i = 0; i < files.length; i++) {
      setProgress((prev) =>
        prev.map((p, idx) => (idx === i ? { ...p, status: "uploading" } : p))
      );
      try {
        await uploadOne(files[i]);
        uploaded++;
        setProgress((prev) =>
          prev.map((p, idx) => (idx === i ? { ...p, status: "done" } : p))
        );
      } catch (err) {
        setProgress((prev) =>
          prev.map((p, idx) =>
            idx === i
              ? {
                  ...p,
                  status: "error",
                  error: err instanceof Error ? err.message : "Ошибка",
                }
              : p
          )
        );
      }
    }

    setLoading(false);
    if (uploaded > 0) {
      // Оставляем только неудачно загруженные для повторной попытки.
      setFiles([]);
      router.refresh();
    }
  }

  const doneCount = progress.filter((p) => p.status === "done").length;
  const errorCount = progress.filter((p) => p.status === "error").length;

  return (
    <form onSubmit={upload} className="card space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label className="label">Файлы (можно несколько)</label>
          <input
            type="file"
            multiple
            className="input"
            accept="image/*,video/*,audio/*,.pdf"
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []));
              setProgress([]);
            }}
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
        <button className="btn-primary" disabled={files.length === 0 || loading}>
          {loading
            ? "Загрузка…"
            : files.length > 1
              ? `Загрузить (${files.length})`
              : "Загрузить"}
        </button>
      </div>

      {files.length > 0 && progress.length === 0 && (
        <p className="text-xs text-zinc-500">
          Выбрано файлов: {files.length}
        </p>
      )}

      {progress.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-zinc-500">
            Загружено {doneCount} из {progress.length}
            {errorCount > 0 && ` · ошибок: ${errorCount}`}
          </p>
          <ul className="space-y-0.5">
            {progress.map((p, idx) => (
              <li key={idx} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-center">
                  {p.status === "done"
                    ? "✅"
                    : p.status === "error"
                      ? "⚠️"
                      : p.status === "uploading"
                        ? "⏳"
                        : "•"}
                </span>
                <span className="truncate" title={p.name}>
                  {p.name}
                </span>
                {p.error && (
                  <span className="text-red-600" title={p.error}>
                    — {p.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
