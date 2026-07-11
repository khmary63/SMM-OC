// Типы предметной области MARIA SMM OS.
// Соответствуют supabase/migrations/20260710000001_init.sql.

export type WorkspaceRole =
  | "owner"
  | "admin"
  | "smm"
  | "editor"
  | "approver"
  | "viewer";

export type ChannelPlatform =
  | "vk"
  | "telegram"
  | "max"
  | "youtube"
  | "rutube"
  | "instagram"
  | "dzen"
  | "ok"
  | "website"
  | "other";

export type ConnectionStatus =
  | "disconnected"
  | "active"
  | "expired"
  | "error"
  | "disabled";

export type ContentStatus =
  | "idea"
  | "planned"
  | "in_progress"
  | "text_ready"
  | "design_ready"
  | "awaiting_approval"
  | "revision_requested"
  | "approved"
  | "scheduled"
  | "published"
  | "publish_error"
  | "cancelled";

export type ContentFormat =
  | "text"
  | "image"
  | "gallery"
  | "carousel"
  | "video"
  | "short_video"
  | "story"
  | "link"
  | "poll"
  | "document"
  | "mixed";

export type ContentGoal =
  | "reach"
  | "engagement"
  | "growth"
  | "trust"
  | "expertise"
  | "traffic"
  | "leads"
  | "sales"
  | "retention"
  | "awareness";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type PublicationStatus =
  | "draft"
  | "queued"
  | "processing"
  | "published"
  | "failed"
  | "cancelled";

export type JobStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type RecommendationConfidence =
  | "insufficient"
  | "low"
  | "medium"
  | "high";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  timezone: string;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  is_active: boolean;
  joined_at: string;
}

export interface Brand {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: "active" | "paused" | "archived";
  timezone: string;
  locale: string;
  created_at: string;
}

export interface BrandProfile {
  id: string;
  brand_id: string;
  positioning: string | null;
  tone_of_voice: string | null;
  prohibited_topics: string[];
  prohibited_phrases: string[];
  prompt_rules: string | null;
  content_score_weights: Record<string, number>;
}

export interface Channel {
  id: string;
  workspace_id: string;
  brand_id: string;
  platform: ChannelPlatform;
  name: string;
  external_channel_id: string | null;
  username: string | null;
  public_url: string | null;
  status: ConnectionStatus;
  timezone: string | null;
  last_sync_at: string | null;
  sync_error: string | null;
  created_at: string;
}

export interface ContentItem {
  id: string;
  workspace_id: string;
  brand_id: string;
  title: string;
  topic: string | null;
  rubric: string | null;
  goal: ContentGoal | null;
  base_text: string | null;
  hook: string | null;
  cta: string | null;
  format: ContentFormat;
  status: ContentStatus;
  planned_at: string | null;
  ai_generated: boolean;
  approved_version_no: number | null;
  created_at: string;
}

export interface ContentVariant {
  id: string;
  workspace_id: string;
  content_item_id: string;
  channel_id: string | null;
  version_no: number;
  title: string | null;
  body: string | null;
  hook: string | null;
  cta: string | null;
  hashtags: string[];
  scheduled_at: string | null;
  status: ContentStatus;
  created_at: string;
}

export interface Asset {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  type: "image" | "video" | "audio" | "document" | "logo" | "template" | "other";
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface Approval {
  id: string;
  workspace_id: string;
  content_variant_id: string;
  requested_by: string | null;
  approver_user_id: string | null;
  version_no: number;
  status: ApprovalStatus;
  comment: string | null;
  requested_at: string;
  decided_at: string | null;
}

export interface Publication {
  id: string;
  workspace_id: string;
  content_variant_id: string;
  channel_id: string;
  scheduled_at: string;
  status: PublicationStatus;
  idempotency_key: string;
  external_post_id: string | null;
  external_url: string | null;
  published_at: string | null;
  attempt_count: number;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
}

export interface AutomationJob {
  id: string;
  workspace_id: string;
  job_type: string;
  entity_type: string | null;
  entity_id: string | null;
  status: JobStatus;
  run_after: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  last_error: string | null;
  created_at: string;
}

export interface Insight {
  id: string;
  workspace_id: string;
  brand_id: string;
  channel_id: string | null;
  period_start: string;
  period_end: string;
  insight_type: string;
  title: string;
  body: string;
  evidence: unknown[];
  confidence: RecommendationConfidence;
  created_at: string;
}

export interface Recommendation {
  id: string;
  workspace_id: string;
  brand_id: string;
  insight_id: string | null;
  action: string;
  reason: string;
  evidence: unknown[];
  confidence: RecommendationConfidence;
  test_metric: string | null;
  test_period_days: number | null;
  status: "proposed" | "accepted" | "rejected" | "implemented" | "expired";
  created_at: string;
}

export interface MonthlyReport {
  id: string;
  workspace_id: string;
  brand_id: string;
  report_month: string;
  period_start: string;
  period_end: string;
  status: JobStatus;
  summary_json: Record<string, unknown>;
  generated_at: string | null;
  created_at: string;
}

export const PLATFORM_LABELS: Record<ChannelPlatform, string> = {
  vk: "ВКонтакте",
  telegram: "Telegram",
  max: "MAX",
  youtube: "YouTube",
  rutube: "RuTube",
  instagram: "Instagram",
  dzen: "Дзен",
  ok: "Одноклассники",
  website: "Сайт",
  other: "Другое",
};

export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  idea: "Идея",
  planned: "Запланировано",
  in_progress: "В работе",
  text_ready: "Текст готов",
  design_ready: "Дизайн готов",
  awaiting_approval: "На согласовании",
  revision_requested: "Доработка",
  approved: "Согласовано",
  scheduled: "В очереди",
  published: "Опубликовано",
  publish_error: "Ошибка публикации",
  cancelled: "Отменено",
};

export const PUBLICATION_STATUS_LABELS: Record<PublicationStatus, string> = {
  draft: "Черновик",
  queued: "В очереди",
  processing: "Публикуется",
  published: "Опубликовано",
  failed: "Ошибка",
  cancelled: "Отменено",
};

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  smm: "SMM-менеджер",
  editor: "Редактор",
  approver: "Согласующий",
  viewer: "Наблюдатель",
};

export const FORMAT_LABELS: Record<ContentFormat, string> = {
  text: "Текст",
  image: "Изображение",
  gallery: "Галерея",
  carousel: "Карусель",
  video: "Видео",
  short_video: "Короткое видео",
  story: "История",
  link: "Ссылка",
  poll: "Опрос",
  document: "Документ",
  mixed: "Смешанный",
};

export const GOAL_LABELS: Record<ContentGoal, string> = {
  reach: "Охват",
  engagement: "Вовлечённость",
  growth: "Рост подписчиков",
  trust: "Доверие",
  expertise: "Экспертность",
  traffic: "Трафик",
  leads: "Лиды",
  sales: "Продажи",
  retention: "Удержание",
  awareness: "Узнаваемость",
};
