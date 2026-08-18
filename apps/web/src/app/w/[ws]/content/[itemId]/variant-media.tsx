"use client";

import { useState } from "react";

export type MediaAsset = {
  id: string;
  fileName: string;
  type: string;
  previewUrl?: string;
};

function Thumb({ asset }: { asset: MediaAsset }) {
  if (asset.previewUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={asset.previewUrl}
        alt={asset.fileName}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <span className="text-2xl">
      {asset.type === "video" ? "🎬" : asset.type === "audio" ? "🎵" : asset.type === "document" ? "📄" : "📦"}
    </span>
  );
}

/**
 * Прикрепление медиа из медиатеки к варианту контента до публикации.
 * Использует серверные экшены attach/detach (переданы как пропсы).
 */
export function VariantMedia({
  variantId,
  contentItemId,
  attached,
  available,
  editable,
  attachAction,
  detachAction,
}: {
  variantId: string;
  contentItemId: string;
  attached: MediaAsset[];
  available: MediaAsset[];
  editable: boolean;
  attachAction: (formData: FormData) => Promise<void>;
  detachAction: (formData: FormData) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);

  const attachedIds = new Set(attached.map((a) => a.id));
  const selectable = available.filter((a) => !attachedIds.has(a.id));

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">
          Медиа{attached.length > 0 ? ` · ${attached.length}` : ""}
        </p>
        {editable && (
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setPicking((v) => !v)}
          >
            {picking ? "Закрыть" : "📎 Прикрепить"}
          </button>
        )}
      </div>

      {attached.length === 0 && !picking && (
        <p className="text-xs text-zinc-400">
          Нет вложений. Прикрепите изображение или видео из медиатеки.
        </p>
      )}

      {attached.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attached.map((a) => (
            <div key={a.id} className="relative w-24">
              <div className="flex h-20 w-24 items-center justify-center overflow-hidden rounded border border-zinc-200 bg-zinc-50">
                <Thumb asset={a} />
              </div>
              <p className="mt-0.5 truncate text-[10px] text-zinc-500" title={a.fileName}>
                {a.fileName}
              </p>
              {editable && (
                <form action={detachAction} className="absolute -right-1.5 -top-1.5">
                  <input type="hidden" name="variant_id" value={variantId} />
                  <input type="hidden" name="asset_id" value={a.id} />
                  <input type="hidden" name="content_item_id" value={contentItemId} />
                  <button
                    type="submit"
                    title="Открепить"
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs text-white shadow hover:bg-red-600"
                  >
                    ✕
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {picking && editable && (
        <div className="mt-3 rounded border border-zinc-200 bg-zinc-50 p-3">
          {selectable.length === 0 ? (
            <p className="text-xs text-zinc-500">
              Нет доступных файлов. Загрузите их в{" "}
              <span className="font-medium">Медиатеку</span>.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {selectable.map((a) => (
                <form key={a.id} action={attachAction}>
                  <input type="hidden" name="variant_id" value={variantId} />
                  <input type="hidden" name="asset_id" value={a.id} />
                  <input type="hidden" name="content_item_id" value={contentItemId} />
                  <button
                    type="submit"
                    title={`Прикрепить ${a.fileName}`}
                    className="block w-full text-left"
                  >
                    <div className="flex h-16 w-full items-center justify-center overflow-hidden rounded border border-zinc-200 bg-white hover:border-zinc-900">
                      <Thumb asset={a} />
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-zinc-500" title={a.fileName}>
                      {a.fileName}
                    </p>
                  </button>
                </form>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
