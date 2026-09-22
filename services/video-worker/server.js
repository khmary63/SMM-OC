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

// Instagram забирает видео сам, своим загрузчиком, без наших заголовков.
// Поэтому готовый ролик отдаётся ещё и по /public/:job/:token/ — без Bearer,
// но по неугадываемой ссылке. Базовый адрес должен быть виден из интернета.
const PUBLIC_BASE_URL = (process.env.VIDEO_PUBLIC_URL || "").replace(/\/+$/, "");
const OVERLAY_FONT =
  process.env.OVERLAY_FONT || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const UPLOAD_DIR = path.join(WORK_DIR, "uploads");
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 500 * 1024 * 1024);

fs.mkdirSync(WORK_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * @type {Map<string, {status: string, output?: string, thumbnail?: string,
 *   error?: string, token?: string, public_url?: string, duration?: number}>}
 */
const jobs = new Map();

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendFile(res, file, method) {
  const { size } = fs.statSync(file);
  res.writeHead(200, {
    "content-type": file.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
    "content-length": size,
    "accept-ranges": "none",
    connection: "close",
  });
  if (method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
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

function ffprobe(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) =>
      code === 0
        ? resolve(stdout.trim())
        : reject(new Error(`ffprobe exited ${code}: ${stderr.slice(-300)}`))
    );
  });
}

/**
 * Экранирование пути внутри аргумента фильтра ffmpeg: двоеточие там
 * разделяет опции, а обратный слэш и апостроф — служебные символы.
 */
function escapeFilterPath(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

/**
 * Перенос заголовка по словам. Кликбейт-заголовок в одну строку на
 * вертикальном кадре уезжает за границы, а drawtext сам не переносит.
 */
function wrapHeadline(text, maxCharsPerLine) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    if (!line) {
      line = word;
    } else if ((line + " " + word).length <= maxCharsPerLine) {
      line += " " + word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);

  return lines;
}

/**
 * Рендер рилса: заголовок поверх видео-подложки на всю её длину.
 *
 * manifest: { video_url: string, text: string, video_headers?: object,
 *             width?: number, height?: number, max_seconds?: number,
 *             text_position?: number }
 *
 * Подложка приводится к вертикали 1080×1920 обрезкой по центру: рилс с
 * чёрными полями выглядит как чужой репост и режет охваты.
 */
async function renderReel(jobId, manifest) {
  const job = jobs.get(jobId);
  const dir = path.join(WORK_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });

  try {
    const videoUrl = manifest.video_url;
    const sourceId = manifest.source_id;
    const text = String(manifest.text || "").trim();
    if (!videoUrl && !sourceId) throw new Error("video_url or source_id is required");
    if (!text) throw new Error("text is required");

    const width = Number(manifest.width || 1080);
    const height = Number(manifest.height || 1920);
    const maxSeconds = Number(manifest.max_seconds || 60);

    // Подложки лежат в Drive, а он отдаёт файл только с токеном. Чтобы не
    // хранить в воркере чужие доступы, n8n сам скачивает подложку своим
    // Drive-креденшлом и кладёт её сюда через /upload; video_url остаётся
    // для источников, открытых по прямой ссылке.
    let source;
    if (sourceId) {
      source = path.join(UPLOAD_DIR, path.basename(String(sourceId)));
      if (!fs.existsSync(source)) throw new Error(`source_id не найден: ${sourceId}`);
    } else {
      source = path.join(dir, "source.mp4");
      const res = await fetch(videoUrl, { headers: manifest.video_headers || {} });
      if (!res.ok) throw new Error(`Failed to fetch video: ${res.status}`);
      fs.writeFileSync(source, Buffer.from(await res.arrayBuffer()));
    }

    const rawDuration = Number(
      await ffprobe([
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1",
        source,
      ])
    );
    if (!Number.isFinite(rawDuration) || rawDuration < 1) {
      throw new Error("Не удалось определить длительность подложки");
    }
    // Instagram принимает рилс от 3 секунд; подложку длиннее лимита режем.
    const duration = Math.min(rawDuration, maxSeconds);
    if (duration < 3) throw new Error(`Подложка короче 3 секунд: ${rawDuration}s`);

    const audioStreams = await ffprobe([
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      source,
    ]);
    const hasAudio = audioStreams.length > 0;

    // Кегль подбираем под самую длинную строку: у DejaVu Sans Bold средняя
    // ширина глифа около 0.6 кегля, и заголовок должен занимать ~88% кадра.
    const lines = wrapHeadline(text, 18);
    const longest = lines.reduce((max, l) => Math.max(max, l.length), 1);
    const fontSize = Math.max(44, Math.min(104, Math.round((width * 0.88) / (0.6 * longest))));

    const textFile = path.join(dir, "headline.txt");
    fs.writeFileSync(textFile, lines.join("\n"), "utf8");

    const output = path.join(dir, "output.mp4");
    const thumbnail = path.join(dir, "thumbnail.jpg");

    // Заголовок держим в верхней трети: снизу Instagram рисует подпись,
    // аватар и кнопки, и текст под ними не читается.
    const y = manifest.text_position != null ? Number(manifest.text_position) : 0.14;

    const filter = [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      "setsar=1",
      [
        "drawtext=fontfile=" + escapeFilterPath(OVERLAY_FONT),
        "textfile=" + escapeFilterPath(textFile),
        "fontcolor=white",
        `fontsize=${fontSize}`,
        `line_spacing=${Math.round(fontSize * 0.28)}`,
        "x=(w-text_w)/2",
        `y=h*${y}`,
        // Подложки бывают светлые: белый текст на них исчезает.
        // Плашка плюс обводка читаются на любом кадре.
        "box=1",
        "boxcolor=black@0.45",
        `boxborderw=${Math.round(fontSize * 0.34)}`,
        "borderw=4",
        "bordercolor=black@0.9",
      ].join(":"),
      "format=yuv420p",
    ].join(",");

    const args = ["-y", "-i", source];
    if (!hasAudio) {
      // Ролик без звуковой дорожки Instagram иногда отбраковывает на приёмке.
      args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
    }
    args.push(
      "-map", "0:v:0",
      "-map", hasAudio ? "0:a:0" : "1:a:0",
      "-vf", filter,
      "-t", String(duration),
      "-r", "30",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-profile:v", "high",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "44100",
      "-ac", "2",
      // Без faststart moov-атом остаётся в конце файла, и загрузчик
      // Instagram отваливается по таймауту на длинном ролике.
      "-movflags", "+faststart",
      output
    );

    await ffmpeg(args);
    await ffmpeg([
      "-y",
      "-ss", String(Math.min(1, duration / 2)),
      "-i", output,
      "-vframes", "1",
      "-q:v", "3",
      thumbnail,
    ]);

    const publicToken = job.token;
    job.status = "succeeded";
    job.duration = Math.round(duration);
    job.output = `/files/${jobId}/output.mp4`;
    job.thumbnail = `/files/${jobId}/thumbnail.jpg`;
    if (PUBLIC_BASE_URL) {
      job.public_url = `${PUBLIC_BASE_URL}/public/${jobId}/${publicToken}/output.mp4`;
      job.public_cover_url = `${PUBLIC_BASE_URL}/public/${jobId}/${publicToken}/thumbnail.jpg`;
    }
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
  } finally {
    // Подложки весят десятки мегабайт: без уборки два слота в день
    // забивают диск воркера за пару недель.
    if (manifest.source_id) {
      fs.rmSync(path.join(UPLOAD_DIR, path.basename(String(manifest.source_id))), {
        force: true,
      });
    }
    fs.rmSync(path.join(dir, "source.mp4"), { force: true });
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
    return sendFile(res, file, req.method);
  }

  // Публичная отдача для загрузчика Instagram: он приходит без наших
  // заголовков, поэтому вместо Bearer — одноразовый токен задачи в пути.
  if (url.pathname.startsWith("/public/") && (req.method === "GET" || req.method === "HEAD")) {
    const [, , jobId, token, name] = url.pathname.split("/");
    const job = jobs.get(jobId);
    if (!job || !job.token || token !== job.token) {
      return json(res, 404, { error: "not found" });
    }
    if (name !== "output.mp4" && name !== "thumbnail.jpg") {
      return json(res, 404, { error: "not found" });
    }
    const file = path.join(WORK_DIR, jobId, name);
    if (!fs.existsSync(file)) return json(res, 404, { error: "not found" });
    return sendFile(res, file, req.method);
  }

  if (url.pathname === "/render" && req.method === "POST") {
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
    try {
      const manifest = await readBody(req);
      const jobId = randomUUID();
      jobs.set(jobId, { status: "processing", token: randomUUID().replace(/-/g, "") });
      renderJob(jobId, manifest);
      return json(res, 202, { job_id: jobId, status: "processing" });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  // Приём подложки телом запроса: n8n скачивает файл из Drive своим
  // креденшлом и отдаёт сюда байтами, минуя обмен токенами.
  if (url.pathname === "/upload" && req.method === "POST") {
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
    const sourceId = randomUUID() + ".src";
    const file = path.join(UPLOAD_DIR, sourceId);
    const out = fs.createWriteStream(file);
    let size = 0;
    let aborted = false;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES && !aborted) {
        aborted = true;
        out.destroy();
        fs.rmSync(file, { force: true });
        json(res, 413, { error: "upload too large" });
        req.destroy();
      }
    });
    req.pipe(out);
    out.on("finish", () => {
      if (aborted) return;
      json(res, 201, { source_id: sourceId, size });
    });
    out.on("error", (err) => {
      if (!aborted) json(res, 500, { error: err.message });
    });
    return;
  }

  // Рилс: заголовок поверх готовой видео-подложки.
  if (url.pathname === "/render/reel" && req.method === "POST") {
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
    try {
      const manifest = await readBody(req);
      const jobId = randomUUID();
      jobs.set(jobId, { status: "processing", token: randomUUID().replace(/-/g, "") });
      renderReel(jobId, manifest);
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
    // token не отдаём: он уже зашит в public_url, а сам по себе это ключ
    // к неаутентифицированной ссылке.
    const { token, ...safe } = job;
    return json(res, 200, { job_id: jobId, ...safe });
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`MARIA video worker listening on :${PORT}`);
});
