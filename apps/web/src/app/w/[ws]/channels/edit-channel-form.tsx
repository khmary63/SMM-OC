"use client";

import { useState } from "react";
import { updateChannel } from "./actions";
import type { Channel } from "@/lib/types";

export function EditChannelForm({ ws, channel }: { ws: string; channel: Channel }) {
  const [open, setOpen] = useState(false);
  const action = updateChannel.bind(null, ws);

  if (!open) {
    return (
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        Редактировать
      </button>
    );
  }

  return (
    <form
      action={action}
      className="mt-3 w-full space-y-3 border-t border-zinc-100 pt-3"
      onSubmit={() => setOpen(false)}
    >
      <input type="hidden" name="channel_id" value={channel.id} />
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">Название канала</label>
          <input name="name" className="input" defaultValue={channel.name} required />
        </div>
        <div>
          <label className="label">ID канала (chat_id / owner_id / group_id)</label>
          <input
            name="external_channel_id"
            className="input"
            defaultValue={channel.external_channel_id ?? ""}
            placeholder="-1001234567890 или -123456"
          />
        </div>
        <div>
          <label className="label">Username (без @)</label>
          <input
            name="username"
            className="input"
            defaultValue={channel.username ?? ""}
            placeholder="mychannel"
          />
        </div>
        <div>
          <label className="label">Публичная ссылка</label>
          <input
            name="public_url"
            className="input"
            defaultValue={channel.public_url ?? ""}
            placeholder="https://t.me/mychannel"
          />
        </div>
      </div>
      <div>
        <label className="label">
          Новый токен (bot token / access token) — оставьте пустым, чтобы не менять
        </label>
        <input name="token" className="input" type="password" placeholder="••••••••" />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary">Сохранить</button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
    </form>
  );
}
