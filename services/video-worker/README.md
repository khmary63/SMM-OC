# Video Render Worker

FFmpeg-worker детерминированной сборки коротких роликов (WF-CONTENT-003).

MVP-возможность: вертикальное слайдшоу из изображений (1080×1920, 30 fps) + thumbnail.
Remotion-шаблоны и генеративное видео подключаются позже отдельными провайдерами.

## API

| Method | Path | Описание |
|---|---|---|
| GET | `/health` | статус |
| POST | `/render` | manifest → `{job_id, status}` (202) |
| GET | `/render/:job_id` | статус рендера |
| GET | `/files/:job_id/output.mp4` | готовый ролик |

Все запросы (кроме `/health`) — с заголовком `Authorization: Bearer $VIDEO_RENDER_TOKEN`.

## Manifest

```json
{
  "image_urls": ["https://...signed-url-1", "https://...signed-url-2"],
  "duration_per_slide": 3,
  "width": 1080,
  "height": 1920
}
```

n8n-workflow передаёт signed URLs из Supabase Storage, опрашивает статус и загружает результат обратно в Storage (шаги 3–5 WF-CONTENT-003).
