-- MARIA SMM OS
-- Поддержка изображений (логотипы и т.п.) в базе знаний бренда:
--  - добавляем image/svg+xml в разрешённые типы smm-assets (jpeg/png/webp/gif
--    там уже были разрешены изначально);
--  - extraction_status получает статус 'not_applicable' — для изображений
--    текст не извлекается, это ожидаемо, а не ошибка/незавершённость.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'smm-assets',
  'smm-assets',
  false,
  524288000,
  array[
    'image/jpeg','image/png','image/webp','image/gif','image/svg+xml',
    'video/mp4','video/webm','audio/mpeg','audio/wav',
    'application/pdf','text/plain','text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set allowed_mime_types = excluded.allowed_mime_types;

alter table public.brand_knowledge_sources
  drop constraint if exists brand_knowledge_sources_extraction_status_check;

alter table public.brand_knowledge_sources
  add constraint brand_knowledge_sources_extraction_status_check
  check (extraction_status in ('pending','done','unsupported','failed','not_applicable'));

commit;
