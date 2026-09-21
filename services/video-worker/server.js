/**
 * MARIA SMM OS — Video Render Worker (FFmpeg).
 *
 * Детерминированная сборка коротких роликов по шаблону (WF-CONTENT-003):
 * принимает render manifest, собирает MP4 + thumbnail, отдаёт статус job.
 * Генеративное text-to-video подключается отдельным провайдером — не здесь.
 *
 * Запуск: VIDEO_RENDER_TOKEN=... node server.js
 */

const http = require("http");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT || 8082);
const TOKEN = process.env.VIDEO_RENDER_TOKEN || "";
const WORK_DIR = process.env.WORK_DIR || path.join(os.tmpdir(), "maria-render");

fs.mkdirSync(WORK_DIR, { recursive: true });

// Шрифт для drawtext. Берём жирный гротеск — максимальная читабельность
// заголовка поверх произвольной подложки. DejaVu покрывает и латиницу, и
// кириллицу, поэтому стоит первым fallback'ом.
const FONT_CANDIDATES = [
  process.env.OVERLAY_FONT_FILE,
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
].filter(Boolean);

function resolveFont() {
  const found = FONT_CANDIDATES.find((f) => fs.existsSync(f));
  if (!found) {
    throw new Error(
      `No overlay font found. Tried: ${FONT_CANDIDATES.join(", ")}. ` +
        `Install fonts-dejavu-core or set OVERLAY_FONT_FILE.`
    );
  }
  return found;
}

/** @type {Map<string, {status: string, output?: string, thumbnail?: string, error?: string}>} */
const jobs = new Map();

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  const header = req.headers.authorization || "";
  return TOKEN && header === `Bearer ${TOKEN}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * MVP-рендер: слайдшоу из изображений с наложением текста.
 * manifest: { image_urls: string[], text?: string, duration_per_slide?: number,
 *             width?: number, height?: number }
 */
async function renderJob(jobId, manifest) {
  const job = jobs.get(jobId);
  const dir = path.join(WORK_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });

  try {
    const images = manifest.image_urls || [];
    if (images.length === 0) throw new Error("image_urls is required");

    // Скачиваем исходники
    const files = [];
    for (let i = 0; i < images.length; i++) {
      const res = await fetch(images[i]);
      if (!res.ok) throw new Error(`Failed to fetch ${images[i]}: ${res.status}`);
      const file = path.join(dir, `src-${i}.img`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      files.push(file);
    }

    const duration = Number(manifest.duration_per_slide || 3);
    const width = Number(manifest.width || 1080);
    const height = Number(manifest.height || 1920);
    const output = path.join(dir, "output.mp4");
    const thumbnail = path.join(dir, "thumbnail.jpg");

    // concat list для ffmpeg
    const listFile = path.join(dir, "list.txt");
    fs.writeFileSync(
      listFile,
      files
        .map((f) => `file '${f}'\nduration ${duration}`)
        .join("\n") + `\nfile '${files[files.length - 1]}'\n`
    );

    const scale = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;

    await ffmpeg([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-vf", scale,
      "-r", "30",
      "-pix_fmt", "yuv420p",
      "-c:v", "libx264",
      "-preset", "medium",
      output,
    ]);

    await ffmpeg(["-y", "-i", output, "-vframes", "1", "-q:v", "3", thumbnail]);

    job.status = "succeeded";
    job.output = `/files/${jobId}/output.mp4`;
    job.thumbnail = `/files/${jobId}/thumbnail.jpg`;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
  }
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))
    );
  });
}

/** Длительность медиафайла в секундах (0, если определить не удалось). */
function probeDuration(file) {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("close", () => resolve(Number(out.trim()) || 0));
    proc.on("error", () => resolve(0));
  });
}

/** Скачивает URL в файл. */
async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/**
 * Перенос заголовка по словам. ffmpeg сам не умеет переносить текст, поэтому
 * разбиваем заранее и рисуем каждую строку отдельным drawtext.
 */
function wrapLines(text, maxChars) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Подбирает кегль так, чтобы заголовок уложился в maxLines строк по ширине
 * кадра. Средняя ширина глифа жирного гротеска ≈ 0.55 * font_size.
 */
function fitHeadline(text, width, maxLines, startSize) {
  // 0.78 — ширина текста без плашки: boxborderw добавляет поля по бокам,
  // без этого запаса длинные строки упираются в края кадра.
  let size = startSize;
  for (; size > 28; size -= 4) {
    const maxChars = Math.floor((width * 0.78) / (size * 0.55));
    const lines = wrapLines(text, maxChars);
    if (lines.length <= maxLines) return { size, lines };
  }
  const maxChars = Math.floor((width * 0.78) / (size * 0.55));
  return { size, lines: wrapLines(text, maxChars).slice(0, maxLines) };
}

/**
 * drawtext-фильтры заголовка: белый жирный текст в тёмной подложке-плашке
 * плюс обводка — читается на любом фоне и держится весь ролик.
 *
 * Текст передаём через textfile + expansion=none: так ffmpeg не пытается
 * интерпретировать %, : и кавычки внутри заголовка.
 */
function buildDrawtext(dir, headline, opts) {
  const { width, height, position, fontFile, maxLines, startSize } = opts;
  const { size, lines } = fitHeadline(headline, width, maxLines, startSize);

  const lineStep = Math.round(size * 1.34);
  const block = lineStep * lines.length;
  const anchor =
    position === "top"
      ? Math.round(height * 0.14)
      : position === "bottom"
        ? Math.round(height * 0.80) - block
        : Math.round((height - block) / 2);

  return lines.map((line, i) => {
    const file = path.join(dir, `line-${i}.txt`);
    fs.writeFileSync(file, line, "utf8");
    return [
      `drawtext=fontfile=${fontFile}`,
      `textfile=${file}`,
      `expansion=none`,
      `fontcolor=white`,
      `fontsize=${size}`,
      `borderw=${Math.max(3, Math.round(size * 0.07))}`,
      `bordercolor=black@0.92`,
      `box=1`,
      `boxcolor=black@0.42`,
      `boxborderw=${Math.round(size * 0.24)}`,
      `x=(w-text_w)/2`,
      `y=${anchor + i * lineStep}`,
    ].join(":");
  });
}

/**
 * Рендер рилса: готовая видео-подложка + заголовок поверх на всю длительность.
 * manifest: { video_url: string, headline: string, duration?: number,
 *             width?: number, height?: number, position?: 'top'|'center'|'bottom',
 *             audio_url?: string, mute_source?: boolean, font_size?: number,
 *             max_lines?: number }
 */
async function renderReelsJob(jobId, manifest) {
  const job = jobs.get(jobId);
  const dir = path.join(WORK_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });

  try {
    if (!manifest.video_url) throw new Error("video_url is required");
    if (!manifest.headline) throw new Error("headline is required");

    const fontFile = resolveFont();
    const width = Number(manifest.width || 1080);
    const height = Number(manifest.height || 1920);
    const position = manifest.position || "center";
    const output = path.join(dir, "output.mp4");
    const thumbnail = path.join(dir, "thumbnail.jpg");

    const source = await download(manifest.video_url, path.join(dir, "source.mp4"));
    const sourceDuration = await probeDuration(source);

    // Instagram требует не короче 3 с. Если подложка короче целевой длины —
    // зацикливаем её, чтобы заголовок висел весь ролик.
    const target = manifest.duration
      ? Number(manifest.duration)
      : Math.min(Math.max(sourceDuration, 3), 90);

    const args = ["-y"];
    if (!sourceDuration || sourceDuration < target) {
      args.push("-stream_loop", "-1");
    }
    args.push("-i", source);

    const audio = manifest.audio_url
      ? await download(manifest.audio_url, path.join(dir, "audio.m4a"))
      : null;
    if (audio) args.push("-stream_loop", "-1", "-i", audio);

    // Подложка заполняет кадр 9:16 целиком: увеличиваем и обрезаем лишнее,
    // чтобы не было чёрных полей.
    const fill =
      `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height}`;
    const drawtext = buildDrawtext(dir, manifest.headline, {
      width,
      height,
      position,
      fontFile,
      maxLines: Number(manifest.max_lines || 4),
      startSize: Number(manifest.font_size || Math.round(width * 0.085)),
    });

    args.push("-vf", [fill, ...drawtext].join(","));
    args.push("-t", String(target));

    if (audio) {
      args.push("-map", "0:v:0", "-map", "1:a:0");
    } else if (manifest.mute_source) {
      args.push("-an");
    }

    args.push(
      "-r", "30",
      "-pix_fmt", "yuv420p",
      "-c:v", "libx264",
      "-preset", "medium",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      output
    );

    await ffmpeg(args);
    await ffmpeg(["-y", "-i", output, "-vframes", "1", "-q:v", "3", thumbnail]);

    job.status = "succeeded";
    job.output = `/files/${jobId}/output.mp4`;
    job.thumbnail = `/files/${jobId}/thumbnail.jpg`;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    return json(res, 200, { status: "ok", jobs: jobs.size });
  }

  // Отдача готовых файлов
  if (url.pathname.startsWith("/files/") && req.method === "GET") {
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
    const rel = url.pathname.slice("/files/".length);
    const file = path.join(WORK_DIR, path.normalize(rel));
    if (!file.startsWith(WORK_DIR) || !fs.existsSync(file)) {
      return json(res, 404, { error: "not found" });
    }
    const { size } = fs.statSync(file);
    res.writeHead(200, {
      "content-type": file.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
      "content-length": size,
      connection: "close",
    });
    fs.createReadStream(file).pipe(res);
    return;
  }

  if (url.pathname === "/render" && req.method === "POST") {
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
    try {
      const manifest = await readBody(req);
      const jobId = randomUUID();
      jobs.set(jobId, { status: "processing" });
      renderJob(jobId, manifest);
      return json(res, 202, { job_id: jobId, status: "processing" });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (url.pathname === "/render/reels" && req.method === "POST") {
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
    try {
      const manifest = await readBody(req);
      const jobId = randomUUID();
      jobs.set(jobId, { status: "processing" });
      renderReelsJob(jobId, manifest);
      return json(res, 202, { job_id: jobId, status: "processing" });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (url.pathname.startsWith("/render/") && req.method === "GET") {
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
    const jobId = url.pathname.split("/")[2];
    const job = jobs.get(jobId);
    if (!job) return json(res, 404, { error: "job not found" });
    return json(res, 200, { job_id: jobId, ...job });
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`MARIA video worker listening on :${PORT}`);
});
