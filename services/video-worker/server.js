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
