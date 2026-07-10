import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Workspace, WorkspaceRole } from "@/lib/types";

export interface WorkspaceContext {
  userId: string;
  workspace: Workspace;
  role: WorkspaceRole;
  memberships: { workspace: Workspace; role: WorkspaceRole }[];
}

const CONTENT_ROLES: WorkspaceRole[] = ["owner", "admin", "smm", "editor"];
const PUBLISH_ROLES: WorkspaceRole[] = ["owner", "admin", "smm"];
const ADMIN_ROLES: WorkspaceRole[] = ["owner", "admin"];
const APPROVE_ROLES: WorkspaceRole[] = ["owner", "admin", "smm", "approver"];

export function canEditContent(role: WorkspaceRole) {
  return CONTENT_ROLES.includes(role);
}
export function canPublish(role: WorkspaceRole) {
  return PUBLISH_ROLES.includes(role);
}
export function canAdmin(role: WorkspaceRole) {
  return ADMIN_ROLES.includes(role);
}
export function canApprove(role: WorkspaceRole) {
  return APPROVE_ROLES.includes(role);
}

/** Загружает контекст workspace по slug; редиректит на /login или /onboarding при отсутствии. */
export async function requireWorkspace(slug: string): Promise<WorkspaceContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows } = await supabase
    .from("workspace_members")
    .select("role, workspaces(*)")
    .eq("user_id", user.id)
    .eq("is_active", true);

  const memberships = (rows ?? [])
    .filter((r) => r.workspaces)
    .map((r) => ({
      workspace: r.workspaces as unknown as Workspace,
      role: r.role as WorkspaceRole,
    }));

  if (memberships.length === 0) redirect("/onboarding");

  const current = memberships.find((m) => m.workspace.slug === slug);
  if (!current) redirect(`/w/${memberships[0].workspace.slug}/dashboard`);

  return {
    userId: user.id,
    workspace: current.workspace,
    role: current.role,
    memberships,
  };
}

export function slugify(name: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
    ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
    я: "ya",
  };
  const base = name
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || `ws-${Date.now().toString(36)}`;
}
