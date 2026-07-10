import { requireWorkspace } from "@/lib/workspace";
import { Sidebar } from "@/components/sidebar";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ ws: string }>;
}) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        currentSlug={ctx.workspace.slug}
        workspaceName={ctx.workspace.name}
        role={ctx.role}
        workspaces={ctx.memberships.map((m) => ({
          slug: m.workspace.slug,
          name: m.workspace.name,
        }))}
      />
      <div className="flex-1 lg:pl-64">
        <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
