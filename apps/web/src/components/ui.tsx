import type {
  ConnectionStatus,
  ContentStatus,
  PublicationStatus,
} from "@/lib/types";
import {
  CONTENT_STATUS_LABELS,
  PUBLICATION_STATUS_LABELS,
} from "@/lib/types";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center py-12 text-center">
      <p className="font-medium text-zinc-700">{title}</p>
      {description && (
        <p className="mt-1 max-w-md text-sm text-zinc-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const CONTENT_STATUS_COLORS: Record<string, string> = {
  idea: "bg-zinc-100 text-zinc-600",
  planned: "bg-sky-50 text-sky-700",
  in_progress: "bg-amber-50 text-amber-700",
  text_ready: "bg-cyan-50 text-cyan-700",
  design_ready: "bg-cyan-50 text-cyan-700",
  awaiting_approval: "bg-violet-50 text-violet-700",
  revision_requested: "bg-orange-50 text-orange-700",
  approved: "bg-emerald-50 text-emerald-700",
  scheduled: "bg-indigo-50 text-indigo-700",
  published: "bg-emerald-100 text-emerald-800",
  publish_error: "bg-red-50 text-red-700",
  cancelled: "bg-zinc-100 text-zinc-500",
};

export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  return (
    <span className={`badge ${CONTENT_STATUS_COLORS[status] ?? "bg-zinc-100 text-zinc-600"}`}>
      {CONTENT_STATUS_LABELS[status] ?? status}
    </span>
  );
}

const PUB_STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  queued: "bg-indigo-50 text-indigo-700",
  processing: "bg-amber-50 text-amber-700",
  published: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-zinc-100 text-zinc-500",
};

export function PublicationStatusBadge({
  status,
}: {
  status: PublicationStatus;
}) {
  return (
    <span className={`badge ${PUB_STATUS_COLORS[status] ?? "bg-zinc-100 text-zinc-600"}`}>
      {PUBLICATION_STATUS_LABELS[status] ?? status}
    </span>
  );
}

const CONNECTION_COLORS: Record<ConnectionStatus, string> = {
  disconnected: "bg-zinc-100 text-zinc-600",
  active: "bg-emerald-50 text-emerald-700",
  expired: "bg-orange-50 text-orange-700",
  error: "bg-red-50 text-red-700",
  disabled: "bg-zinc-100 text-zinc-500",
};

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  disconnected: "Не подключён",
  active: "Активен",
  expired: "Токен истёк",
  error: "Ошибка",
  disabled: "Отключён",
};

export function ConnectionStatusBadge({
  status,
}: {
  status: ConnectionStatus;
}) {
  return (
    <span className={`badge ${CONNECTION_COLORS[status]}`}>
      {CONNECTION_LABELS[status]}
    </span>
  );
}
