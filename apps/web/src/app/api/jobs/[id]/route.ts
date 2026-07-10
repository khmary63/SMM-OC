import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Статус фоновой задачи. RLS даёт доступ только участникам workspace. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data: job } = await supabase
    .from("automation_jobs")
    .select(
      "id, workspace_id, job_type, entity_type, entity_id, status, attempts, max_attempts, run_after, result, last_error, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!job) {
    return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
  }

  return NextResponse.json(job);
}
