"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS } from "@/lib/types";
import type { WorkspaceRole } from "@/lib/types";

const NAV = [
  { href: "dashboard", label: "Дашборд", icon: "📊" },
  { href: "calendar", label: "Календарь", icon: "🗓️" },
  { href: "content", label: "Контент", icon: "📝" },
  { href: "library", label: "Медиатека", icon: "🖼️" },
  { href: "approvals", label: "Согласование", icon: "✅" },
  { href: "publications", label: "Публикации", icon: "🚀" },
  { href: "analytics", label: "Аналитика", icon: "📈" },
  { href: "recommendations", label: "Рекомендации", icon: "💡" },
  { href: "reports", label: "Отчёты", icon: "📄" },
  { href: "plans", label: "План месяца", icon: "🧭" },
  { href: "brands", label: "Бренды", icon: "🏷️" },
  { href: "channels", label: "Каналы", icon: "🔗" },
  { href: "settings", label: "Настройки", icon: "⚙️" },
];

export function Sidebar({
  currentSlug,
  workspaceName,
  role,
  workspaces,
}: {
  currentSlug: string;
  workspaceName: string;
  role: WorkspaceRole;
  workspaces: { slug: string; name: string }[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
      {NAV.map((item) => {
        const href = `/w/${currentSlug}/${item.href}`;
        const active = pathname.startsWith(href);
        return (
          <Link
            key={item.href}
            href={href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              active
                ? "bg-indigo-50 font-medium text-indigo-700"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const header = (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 font-bold text-white">
          M
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">MARIA SMM OS</p>
          <p className="truncate text-xs text-zinc-500">{ROLE_LABELS[role]}</p>
        </div>
      </div>
      <select
        className="input mt-3"
        value={currentSlug}
        onChange={(e) => router.push(`/w/${e.target.value}/dashboard`)}
      >
        {workspaces.map((w) => (
          <option key={w.slug} value={w.slug}>
            {w.name}
          </option>
        ))}
      </select>
      <Link
        href="/onboarding"
        className="mt-1 block px-1 text-xs text-indigo-600 hover:underline"
      >
        + Новое пространство
      </Link>
    </div>
  );

  const footer = (
    <div className="border-t border-zinc-200 p-3">
      <button
        onClick={signOut}
        className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-100"
      >
        Выйти
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-sm font-bold text-white">
            M
          </div>
          <span className="text-sm font-semibold">{workspaceName}</span>
        </div>
        <button
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
          onClick={() => setOpen(!open)}
        >
          Меню
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 lg:hidden" onClick={() => setOpen(false)}>
          <div
            className="flex h-full w-72 flex-col bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            {header}
            {nav}
            {footer}
          </div>
        </div>
      )}
      <div className="h-14 lg:hidden" />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-zinc-200 bg-white lg:flex">
        {header}
        {nav}
        {footer}
      </aside>
    </>
  );
}
