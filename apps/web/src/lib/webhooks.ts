import "server-only";

import { createHmac } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/** События, на которые можно подписаться. */
export const WEBHOOK_EVENTS = [
  "content.created",
  "content.approved",
  "content.revision_requested",
  "publication.queued",
  "publication.published",
  "publication.failed",
  "publication.cancelled",
  "metrics.collected",
  "report.generated",
  "recommendation.generated",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * Отправляет событие workspace всем подписанным endpoint'ам.
 * Подпись: X-Maria-Signature = hex(HMAC-SHA256(raw_body, endpoint.secret)).
 * Доставка best-effort с фиксацией результата; неудачные попытки
 * попадают в очередь automation_jobs (job_type=webhook_retry) для n8n.
 */
export async function emitWorkspaceEvent(
  workspaceId: string,
  eventType: WebhookEvent | string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: endpoints } = await admin
      .from("webhook_endpoints")
      .select("id, url, secret, events")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);

    const targets = (endpoints ?? []).filter(
      (e) => e.events.length === 0 || e.events.includes(eventType)
    );
    if (targets.length === 0) return;

    const payload = {
      event: eventType,
      workspace_id: workspaceId,
      timestamp: new Date().toISOString(),
      data,
    };
    const rawBody = JSON.stringify(payload);

    await Promise.allSettled(
      targets.map(async (endpoint) => {
        const { data: delivery } = await admin
          .from("webhook_deliveries")
          .insert({
            workspace_id: workspaceId,
            endpoint_id: endpoint.id,
            event_type: eventType,
            payload,
            status: "processing",
            attempts: 1,
          })
          .select("id")
          .single();

        const signature = createHmac("sha256", endpoint.secret)
          .update(rawBody)
          .digest("hex");

        try {
          const res = await fetch(endpoint.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "user-agent": "MARIA-SMM-OS/1.0",
              "x-maria-event": eventType,
              "x-maria-signature": signature,
              "x-maria-delivery": delivery?.id ?? "",
            },
            body: rawBody,
            signal: AbortSignal.timeout(8000),
          });

          await admin
            .from("webhook_deliveries")
            .update({
              status: res.ok ? "succeeded" : "failed",
              response_status: res.status,
              delivered_at: res.ok ? new Date().toISOString() : null,
              last_error: res.ok ? null : `HTTP ${res.status}`,
              next_retry_at: res.ok
                ? null
                : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            })
            .eq("id", delivery?.id ?? "");
        } catch (err) {
          await admin
            .from("webhook_deliveries")
            .update({
              status: "failed",
              last_error:
                err instanceof Error ? err.message.slice(0, 500) : "network error",
              next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            })
            .eq("id", delivery?.id ?? "");
        }
      })
    );
  } catch {
    // Вебхуки не должны ломать основную операцию.
  }
}
