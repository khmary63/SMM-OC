import { requireWorkspace, canAdmin } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/types";
import type { WorkspaceRole } from "@/lib/types";
import {
  updateWorkspace,
  inviteMember,
  updateMemberRole,
  removeMember,
} from "./actions";

const ASSIGNABLE_ROLES: WorkspaceRole[] = [
  "admin",
  "smm",
  "editor",
  "approver",
  "viewer",
];

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("workspace_members")
    .select("user_id, role, is_active, joined_at, profiles:user_id(display_name)")
    .eq("workspace_id", ctx.workspace.id)
    .eq("is_active", true)
    .order("joined_at");

  const admin = canAdmin(ctx.role);
  const updateWsAction = updateWorkspace.bind(null, ws);
  const inviteAction = inviteMember.bind(null, ws);
  const roleAction = updateMemberRole.bind(null, ws);
  const removeAction = removeMember.bind(null, ws);

  return (
    <div>
      <PageHeader title="Настройки" subtitle="Рабочее пространство и команда." />

      <form action={updateWsAction} className="card space-y-4">
        <p className="font-medium">Рабочее пространство</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">Название</label>
            <input
              name="name"
              className="input"
              defaultValue={ctx.workspace.name}
              disabled={!admin}
              required
            />
          </div>
          <div>
            <label className="label">Часовой пояс</label>
            <select
              name="timezone"
              className="input"
              defaultValue={ctx.workspace.timezone}
              disabled={!admin}
            >
              <option value="Europe/Moscow">Москва</option>
              <option value="Europe/Kaliningrad">Калининград</option>
              <option value="Asia/Yekaterinburg">Екатеринбург</option>
              <option value="Asia/Novosibirsk">Новосибирск</option>
              <option value="Asia/Vladivostok">Владивосток</option>
            </select>
          </div>
        </div>
        {admin && <button className="btn-primary">Сохранить</button>}
      </form>

      <div className="card mt-6">
        <p className="mb-4 font-medium">Команда</p>
        <div className="space-y-3">
          {members?.map((m) => {
            const profile = m.profiles as unknown as {
              display_name: string | null;
            } | null;
            return (
              <div
                key={m.user_id}
                className="flex flex-wrap items-center gap-3 border-b border-zinc-100 pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {profile?.display_name ?? m.user_id.slice(0, 8)}
                    {m.user_id === ctx.userId && (
                      <span className="ml-2 text-xs text-zinc-400">(вы)</span>
                    )}
                  </p>
                </div>
                {admin && m.role !== "owner" ? (
                  <form action={roleAction} className="flex items-center gap-2">
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <select
                      name="role"
                      className="input w-auto"
                      defaultValue={m.role}
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <button className="btn-secondary">Сменить</button>
                  </form>
                ) : (
                  <span className="badge bg-zinc-100 text-zinc-600">
                    {ROLE_LABELS[m.role as WorkspaceRole]}
                  </span>
                )}
                {admin && m.role !== "owner" && (
                  <form action={removeAction}>
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <button className="btn-danger">Убрать</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>

        {admin && (
          <form
            action={inviteAction}
            className="mt-5 flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-5"
          >
            <div className="min-w-52 flex-1">
              <label className="label">Email нового участника</label>
              <input
                name="email"
                type="email"
                className="input"
                placeholder="colleague@agency.ru"
                required
              />
            </div>
            <div>
              <label className="label">Роль</label>
              <select name="role" className="input" defaultValue="editor">
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn-primary">Пригласить</button>
          </form>
        )}
      </div>
    </div>
  );
}
