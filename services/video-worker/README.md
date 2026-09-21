# Video Render Worker

FFmpeg-worker детерминированной сборки коротких роликов (WF-CONTENT-003).

MVP-возможность: вертикальное слайдшоу из изображений (1080×1920, 30 fps) + thumbnail.
Remotion-шаблоны и генеративное видео подключаются позже отдельными провайдерами.

## API

| Method | Path | Описание |
|---|---|---|
| GET | `/health` | статус |
| POST | `/render` | слайдшоу из картинок → `{job_id, status}` (202) |
| POST | `/render/reels` | заголовок поверх готовой видео-подложки → `{job_id, status}` (202) |
| GET | `/render/:job_id` | статус рендера |
| GET | `/files/:job_id/output.mp4` | готовый ролик |

Все запросы (кроме `/health`) — с заголовком `Authorization: Bearer $VIDEO_RENDER_TOKEN`.

## Manifest `/render` (слайдшоу)

```json
{
  "image_urls": ["https://...signed-url-1", "https://...signed-url-2"],
  "duration_per_slide": 3,
  "width": 1080,
  "height": 1920
}
```

n8n-workflow передаёт signed URLs из Supabase Storage, опрашивает статус и загружает результат обратно в Storage (шаги 3–5 WF-CONTENT-003).

## Manifest `/render/reels` (рилс с заголовком)

Накладывает кликбейт-заголовок на готовую видео-подложку и отдаёт вертикальный
ролик, готовый к публикации в Instagram через `create_video_post`.

```json
{
  "video_url": "https://...signed-url-подложки",
  "headline": "I Made $12,000 In 30 Days Using AI While I Was Asleep",
  "duration": 8,
  "position": "center",
  "audio_url": "https://...signed-url-трека",
  "mute_source": false
}
```

| Поле | По умолчанию | Описание |
|---|---|---|
| `video_url` | — | обязательное, публично доступный URL подложки |
| `headline` | — | обязательное, текст заголовка |
| `duration` | длина подложки, но не меньше 3 с и не больше 90 с | итоговая длительность |
| `position` | `center` | `top` / `center` / `bottom` |
| `width` / `height` | 1080 / 1920 | размер кадра |
| `font_size` | `width * 0.085` | стартовый кегль, дальше подбирается автоматически |
| `max_lines` | 4 | во сколько строк максимум уложить заголовок |
| `audio_url` | — | звуковая дорожка; без неё остаётся звук подложки |
| `mute_source` | `false` | вырезать звук подложки |

Поведение:

- подложка масштабируется и обрезается под 9:16 — без чёрных полей;
- если подложка короче `duration`, она зацикливается, заголовок держится весь ролик;
- заголовок переносится по словам, кегль уменьшается, пока текст не уложится
  в `max_lines`; белый жирный текст с обводкой на полупрозрачной плашке —
  читается на любом фоне;
- шрифт берётся из `OVERLAY_FONT_FILE`, иначе DejaVu Sans Bold (есть в образе).

**Важно:** Instagram Graph API не умеет подставлять треки из внутренней
библиотеки Instagram. Любая музыка должна быть вшита в файл (`audio_url`) —
см. `docs/instagram_reels_autopost.md`.
