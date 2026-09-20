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

## Manifest: слайдшоу из изображений

```json
{
  "image_urls": ["https://...signed-url-1", "https://...signed-url-2"],
  "duration_per_slide": 3,
  "width": 1080,
  "height": 1920
}
```

n8n-workflow передаёт signed URLs из Supabase Storage, опрашивает статус и загружает результат обратно в Storage (шаги 3–5 WF-CONTENT-003).

## Manifest: Reels с заголовком (`type: "reel"`)

```json
{
  "type": "reel",
  "video_url": "https://...signed-url",
  "headline": "I Quit My Job After This",
  "max_duration": 60,
  "max_lines": 3,
  "headline_top": 0.2
}
```

Подложка масштабируется с обрезкой до 1080×1920 (без чёрных полей), заголовок
держится поверх кадра всю длительность: белый DejaVu Sans Bold с чёрной обводкой
на полупрозрачной подложке, по центру, в верхней трети.

Кегль подбирается автоматически — самый крупный из ряда 104…52, при котором
заголовок укладывается в `max_lines` строк. Если не влезает даже минимальный,
текст **не обрезается**: ролик рендерится с лишними строками, а в ответе
приходит `overflow: true` — сигнал, что заголовок стоит сократить.

Ответ `GET /render/:job_id` при успехе дополнительно содержит `headline_lines`,
`font_size` и `overflow`.

Заголовок передаётся в ffmpeg через `textfile` с `expansion=none`, поэтому
апострофы, двоеточия, проценты, запятые и тире в тексте безопасны.

Ограничения Reels на стороне Instagram: 9:16, от 3 секунд до 15 минут, MP4/MOV.
`max_duration` обрезает длинную подложку — по умолчанию до 60 секунд.
