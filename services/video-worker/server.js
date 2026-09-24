/**
 * MARIA SMM OS — Video Render Worker (FFmpeg).
 *
 * Детерминированная сборка коротких роликов по шаблону (WF-CONTENT-003):
 * принимает render manifest, собирает MP4 + thumbnail, отдаёт статус job.
 * Генеративное text-to-video подключается отдельным провайдером — не здесь.
 *
 * Второй режим (WF-9 «Instagram Reels Daily»): готовая видео-подложка
 * заливается в /upload, /render/reel кладёт поверх неё заголовок на всю
 * длительность и отдаёт вертикальный ролик 1080×1920.
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
const SOURCE_DIR = path.join(WORK_DIR, "sources");

// Подложки — до 100 МБ: в папке Рилсов лежат ролики на 40 МБ.
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024);

// Шрифт для заголовка поверх кадра: читабельность важнее характера,
// поэтому жирный гротеск. Путь переопределяется, если в образе другой набор.
const FONT_FILE =
  process.env.REEL_FONT_FILE ||
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

fs.mkdirSync(WORK_DIR, { recursive: true });
fs.mkdirSync(SOURCE_DIR, { recursive: true });

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

/**
 * Приём подложки в /upload: пишем поток сразу на диск.
 * readBody здесь не годится — он копит тело строкой и режет на 10 МБ,
 * а ролики из папки Рилсов весят до сорока.
 */
function saveUpload(req) {
  return new Promise((resolve, reject) => {
    const sourceId = randomUUID();
    const file = path.join(SOURCE_DIR, `${sourceId}.mp4`);
    const out = fs.createWriteStream(file);
    let size = 0;
    let aborted = false;

    function fail(err) {
      if (aborted) return;
      aborted = true;
      out.destroy();
      fs.rm(file, { force: true }, () => reject(err));
    }

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        fail(new Error(`Upload exceeds ${MAX_UPLOAD_BYTES} bytes`));
        req.destroy();
      }
    });
    req.on("error", fail);
    out.on("error", fail);
    out.on("finish", () => {
      if (aborted) return;
      if (size === 0) return fail(new Error("Empty upload"));
      resolve({ source_id: sourceId, bytes: size });
    });
    req.pipe(out);
  });
}

/**
 * Перенос заголовка по строкам: drawtext сам не переносит, а хук
 * в одну строку на 1080 пикселей превращается в нечитаемый шрифт.
 */
function wrapText(text, maxChars) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Рендер рилса: заголовок поверх подложки на всю длительность ролика.
 * body: { source_id: string, text: string, max_seconds?: number }
 */
async function renderReelJob(jobId, body) {
  const job = jobs.get(jobId);
  const dir = path.join(WORK_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });

  try {
    const sourceId = String(body.source_id || "");
    const text = String(body.text || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(sourceId)) throw new Error("source_id is invalid");
    if (!text) throw new Error("text is required");

    const source = path.join(SOURCE_DIR, `${sourceId}.mp4`);
    if (!fs.existsSync(source)) throw new Error(`source ${sourceId} not found`);
    if (!fs.existsSync(FONT_FILE)) throw new Error(`font ${FONT_FILE} not found`);

    const width = Number(body.width || 1080);
    const height = Number(body.height || 1920);
    const maxSeconds = Number(body.max_seconds || 60);
    const sourceDuration = await probeDuration(source);
    const duration = Math.max(3, Math.min(sourceDuration || maxSeconds, maxSeconds));

    // Текст — в файл: drawtext требует экранировать кавычки, двоеточия
    // и проценты, и один апостроф в английском хуке рвёт всю команду.
    const lines = wrapText(text, 18);
    const textFile = path.join(dir, "overlay.txt");
    fs.writeFileSync(textFile, lines.join("\n"), "utf8");

    const longest = lines.reduce((max, l) => Math.max(max, l.length), 1);
    const margin = Math.round(width * 0.11);
    const fontSize = Math.min(
      96,
      Math.max(44, Math.floor((width - 2 * margin) / (longest * 0.62)))
    );

    const output = path.join(dir, "output.mp4");
    const thumbnail = path.join(dir, "thumbnail.jpg");

    // Заполняем кадр целиком: чёрные поля по бокам в ленте Instagram
    // читаются как чужой, перезалитый ролик.
    const fill =
      `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height},setsar=1`;

    // Обводка и тень — чтобы белый заголовок держался на светлом кадре.
    const drawtext = [
      `drawtext=fontfile=${FONT_FILE}`,
      `textfile=${textFile}`,
      "reload=0",
      `fontsize=${fontSize}`,
      "fontcolor=white",
      "borderw=7",
      "bordercolor=black@0.85",
      "shadowx=0",
      "shadowy=4",
      "shadowcolor=black@0.6",
      "line_spacing=16",
      // Без text_align строки внутри блока липнут влево, и заголовок
      // из трёх строк выглядит рваным.
      "text_align=C",
      "x=(w-text_w)/2",
      // Верхняя треть: снизу Instagram кладёт подпись и кнопки.
      "y=h*0.16",
    ].join(":");

    await ffmpeg([
      "-y",
      "-t", String(duration),
      "-i", source,
      "-vf", `${fill},${drawtext}`,
      "-r", "30",
      "-pix_fmt", "yuv420p",
      "-c:v", "libx264",
      "-preset", "medium",
      "-profile:v", "high",
      "-movflags", "+faststart",
      // Звук подложки не нужен: музыку Мария выбирает внутри Instagram,
      // и случайный фон из стока с ней только конфликтует.
      "-an",
      output,
    ]);

    await ffmpeg(["-y", "-i", output, "-vframes", "1", "-q:v", "3", thumbnail]);

    job.status = "succeeded";
    job.output = `/files/${jobId}/output.mp4`;
    job.thumbnail = `/files/${jobId}/thumbnail.jpg`;
    job.duration = Math.round(duration);
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
  }
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const proc = spawn(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    // Длительность — подсказка для обрезки, а не обязательное поле:
    // если ffprobe промолчал, ролик всё равно режется по max_seconds.
    proc.on("close", () => resolve(Number.parseFloat(out.trim()) || 0));
    proc.on("error", () => resolve(0));
  });
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

  if (url.pathname === "/upload" && req.method === "POST") {
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
    try {
      const saved = await saveUpload(req);
      return json(res, 201, saved);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  // Проверяется до общего /render/:job_id — иначе POST на /render/reel
  // уйдёт в ветку статуса и вернёт «job not found».
  if (url.pathname === "/render/reel" && req.method === "POST") {
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
    try {
      const body = await readBody(req);
      const jobId = randomUUID();
      jobs.set(jobId, { status: "processing" });
      renderReelJob(jobId, body);
      return json(res, 202, { job_id: jobId, status: "processing" });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
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
