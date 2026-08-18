"use client";

import { useState } from "react";
import { attachContentItemAssets, removeContentItemAsset } from "../actions";

export type MediaAsset = {
  id: string;
  fileName: string;
  type: string;
  url?: string;
};

function Thumb({ asset }: { asset: MediaAsset }) {
  if (asset.url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={asset.url}
        alt={asset.fileName}
        className="h-full w-full object-cover"
      />
    );
  }
  const icon =
    asset.type === "video"
      ? "🎬"
      : asset.type === "audio"
        ? "🎵"
        : asset.type === "document"
          ? "📄"
          : "📦";
  return <span className="text-2xl">{icon}</span>;
}

export function AttachedMedia({
  ws,
  contentItemId,
  attached,
  available,
  editable,
}: {
  ws: string;
  contentItemId: string;
  attached: MediaAsset[];
  available: MediaAsset[];
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const attachAction = attachContentItemAssets.bind(null, ws);
  const removeAction = removeContentItemAsset.bind(null, ws);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="card mt-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-medium">Медиафайлы</p>
        {editable && available.length > 0 && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Закрыть" : "+ Добавить медиа"}
          </button>
        )}
      </div>

      {attached.length === 0 && !open && (
        <p className="text-sm text-zinc-500">
          Медиафайлы не прикреплены. Загрузите их в Медиатеке и прикрепите
          здесь.
        </p>
      )}

      {attached.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {attached.map((a) => (
            <div
              key={a.id}
              className="relative overflow-hidden rounded-lg border border-zinc-200"
            >
              <div className="flex h-24 items-center justify-center bg-zinc-100">
                <Thumb asset={a} />
              </div>
              {editable && (
                <form action={removeAction} className="absolute right-1 top-1">
                  <input
                    type="hidden"
                    name="content_item_id"
                    value={contentItemId}
                  />
                  <input type="hidden" name="asset_id" value={a.id} />
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white"
                    title="Открепить"
                  >
                    ×
                  </button>
                </form>
              )}
              <p className="truncate p-1 text-xs" title={a.fileName}>
                {a.fileName}
              </p>
            </div>
          ))}
        </div>
      )}

      {open && (
        <form
          action={attachAction}
          className="mt-4 space-y-3 border-t border-zinc-100 pt-4"
          onSubmit={() => {
            setOpen(false);
            setSelected(new Set());
          }}
        >
          <input type="hidden" name="content_item_id" value={contentItemId} />
          {available.length === 0 ? (
            <p className="text-sm text-zinc-500">
              В Медиатеке нет файлов для этого бренда.
            </p>
          ) : (
            <>
              <p className="text-sm text-zinc-500">
                Выберите файлы из Медиатеки для прикрепления:
              </p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {available.map((a) => (
                  <label
                    key={a.id}
                    className={`relative cursor-pointer overflow-hidden rounded-lg border ${
                      selected.has(a.id)
                        ? "border-indigo-500 ring-2 ring-indigo-200"
                        : "border-zinc-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="asset_ids"
                      value={a.id}
                      checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)}
                      className="absolute left-1 top-1 z-10"
                    />
                    <div className="flex h-24 items-center justify-center bg-zinc-100">
                      <Thumb asset={a} />
                    </div>
                    <p className="truncate p-1 text-xs" title={a.fileName}>
                      {a.fileName}
                    </p>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={selected.size === 0}>
                  Прикрепить выбранные ({selected.size})
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setOpen(false)}
                >
                  Отмена
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
