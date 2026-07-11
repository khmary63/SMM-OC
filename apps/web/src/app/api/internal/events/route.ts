import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { emitWorkspaceEvent } from "@/lib/webhooks";

/**
 * POST /api/internal/events — приём событий от n8n (publication.published,
 * publication.failed, metrics.collected и т.д.) для рассылки внешним вебхукам.
 * Аутентификация: HMAC тела запроса ключом N8N_WEBHOOK_TOKEN
 * в заголовке x-smm-signature (тот же контракт, что у job intake).
 */
export async function POST(request: Request) {
  const token = process.env.N8N_WEBHOOK_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Не настроен" }, { status: 503 });
  }

  const rawBody = await request.text();
  const provided = request.headers.get("x-smm-signature") ?? "";
  const expected = createHmac("sha256", token).update(rawBody).digest("hex");

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Неверная подпись" }, { status: 401 });
  }

  let body: {
    workspace_id?: string;
    event_type?: string;
    data?: Record<string, unknown>;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Невалидный JSON" }, { status: 400 });
  }

  if (!body.workspace_id || !body.event_type) {
    return NextResponse.json(
      { error: "workspace_id и event_type обязательны" },
      { status: 400 }
    );
  }

  await emitWorkspaceEvent(body.workspace_id, body.event_type, body.data ?? {});
  return NextResponse.json({ ok: true });
}
