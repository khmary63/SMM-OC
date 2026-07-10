import "server-only";

import { createHash, createHmac, randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export interface EnqueueJobInput {
  workspaceId: string;
  jobType: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  runAfter?: Date;
  priority?: number;
}

export interface EnqueuedJob {
  id: string;
  status: string;
}

/**
 * Ставит фоновую задачу: запись в automation_jobs (source of truth)
 * + best-effort уведомление n8n webhook (WF-CORE-002 Job Intake).
 * Если n8n недоступен, задачу подберёт WF-CORE-003 Dispatcher по расписанию.
 */
export async function enqueueJob(input: EnqueueJobInput): Promise<EnqueuedJob> {
  const admin = createAdminClient();
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  const { data: existing } = await admin
    .from("automation_jobs")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    return { id: existing.id, status: existing.status };
  }

  const { data, error } = await admin
    .from("automation_jobs")
    .insert({
      workspace_id: input.workspaceId,
      job_type: input.jobType,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      payload: input.payload ?? {},
      idempotency_key: idempotencyKey,
      run_after: (input.runAfter ?? new Date()).toISOString(),
      priority: input.priority ?? 100,
    })
    .select("id, status")
    .single();

  if (error) throw new Error(`Не удалось создать задачу: ${error.message}`);

  await notifyN8n({
    job_id: data.id,
    workspace_id: input.workspaceId,
    job_type: input.jobType,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    idempotency_key: idempotencyKey,
    payload: input.payload ?? {},
  });

  return { id: data.id, status: data.status };
}

async function notifyN8n(body: Record<string, unknown>): Promise<void> {
  const url = process.env.N8N_WEBHOOK_URL;
  const token = process.env.N8N_WEBHOOK_TOKEN;
  if (!url || !token) return; // n8n ещё не подключён — dispatcher подберёт job

  try {
    const raw = JSON.stringify(body);
    const signature = createHmac("sha256", token).update(raw).digest("hex");
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-smm-signature": signature,
      },
      body: raw,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort: очередь в БД — источник истины.
  }
}

/** Идемпотентный ключ публикации по формуле из архитектуры (§8). */
export function publicationIdempotencyKey(params: {
  workspaceId: string;
  channelId: string;
  contentVariantId: string;
  scheduledAt: string;
  versionNo: number;
}): string {
  return createHash("sha256")
    .update(
      [
        params.workspaceId,
        params.channelId,
        params.contentVariantId,
        params.scheduledAt,
        String(params.versionNo),
      ].join("|")
    )
    .digest("hex");
}
