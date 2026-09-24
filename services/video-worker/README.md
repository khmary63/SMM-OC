# Video Render Worker

FFmpeg-worker детерминированной сборки коротких роликов (WF-CONTENT-003).

Два режима:

1. **Слайдшоу** (WF-CONTENT-003) — вертикальный ролик из изображений (1080×1920, 30 fps) + thumbnail.
2. **Рилс с заголовком** (воркфлоу «9. Instagram Reels Daily») — готовая видео-подложка
   из папки Рилсов заливается в `/upload`, `/render/reel` кладёт заголовок поверх кадра
   на всю длительность ролика.

Remotion-шаблоны и генеративное видео подключаются позже отдельными провайдерами.

## API

| Method | Path | Описание |
|---|---|---|
| GET | `/health` | статус |
| POST | `/upload` | подложка (`application/octet-stream`) → `{source_id, bytes}` (201) |
| POST | `/render` | manifest слайдшоу → `{job_id, status}` (202) |
| POST | `/render/reel` | заголовок поверх подложки → `{job_id, status}` (202) |
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

## Рилс с заголовком

```bash
# 1. Заливаем подложку (до 100 МБ, переопределяется MAX_UPLOAD_BYTES)
curl -X POST "$VIDEO_RENDER_URL/upload" \
  -H "Authorization: Bearer $VIDEO_RENDER_TOKEN" \
  -H "content-type: application/octet-stream" \
  --data-binary @background.mp4
# → {"source_id":"…","bytes":22227474}

# 2. Ставим заголовок поверх кадра
curl -X POST "$VIDEO_RENDER_URL/render/reel" \
  -H "Authorization: Bearer $VIDEO_RENDER_TOKEN" \
  -H "content-type: application/json" \
  -d '{"source_id":"…","text":"I QUIT my job and AI paid my rent","max_seconds":60}'
# → {"job_id":"…","status":"processing"}

# 3. Ждём и забираем
curl -H "Authorization: Bearer $VIDEO_RENDER_TOKEN" "$VIDEO_RENDER_URL/render/$JOB_ID"
# → {"status":"succeeded","output":"/files/…/output.mp4","duration":24}
```

Что делает рендер:

- кадр заполняется целиком (`scale`+`crop` до 1080×1920), без чёрных полей;
- заголовок переносится по строкам, размер шрифта подбирается под самую длинную
  строку (44–96 px), блок центрируется и стоит в верхней трети — низ занимает
  подпись Instagram;
- белый текст с чёрной обводкой и тенью — читается на любой подложке;
- ролик обрезается по `max_seconds` (по умолчанию 60), звук подложки вырезается:
  музыку Мария выбирает внутри Instagram при публикации.

Шрифт — `REEL_FONT_FILE` (по умолчанию DejaVu Sans Bold). Кириллицу он тоже держит,
но заголовки для англоязычной аудитории идут латиницей.
