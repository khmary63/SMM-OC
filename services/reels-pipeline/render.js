/**
 * Клиент к services/video-worker: надпись поверх подложки.
 *
 * Воркер асинхронный — отдаёт job_id и рендерит в фоне, поэтому здесь
 * постановка задачи, ожидание и скачивание готового MP4 в память.
 * В память, а не в файл: дальше видео уходит в Telegram прямой загрузкой,
 * и промежуточный файл на диске никому не нужен.
 */

const POLL_INTERVAL_MS = 2_000;

/** Рендер минутного ролика занимает секунды; минута — это уже «что-то сломалось». */
const TIMEOUT_MS = 180_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(baseUrl, path, { token, method = "GET", body, fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(
      `video-worker ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`
    );
  }

  return res;
}

/**
 * Ждёт завершения задачи.
 *
 * Воркер держит статус в памяти процесса: если он перезапустится посреди
 * рендера, job_id исчезнет и запрос вернёт 404. Это не «ещё не готово»,
 * а потеря задачи, поэтому ждать дальше бессмысленно — падаем сразу.
 */
async function waitForJob({ baseUrl, token, jobId, fetchImpl = fetch, timeoutMs = TIMEOUT_MS }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await call(baseUrl, `/render/${jobId}`, { token, fetchImpl });
    const job = await res.json();

    if (job.status === "succeeded") return job;
    if (job.status === "failed") {
      throw new Error(`Рендер не удался: ${job.error || "без причины"}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Рендер не уложился в ${Math.round(timeoutMs / 1000)} с`);
}

/**
 * Накладывает надпись на подложку и возвращает готовое видео.
 *
 * videoHeaders прокидываются воркеру и нужны для Google Drive: ссылка
 * alt=media отдаёт файл только с Authorization, без заголовка вернётся
 * HTML страницы входа, и ffmpeg споткнётся о него.
 */
async function renderReel({
  baseUrl,
  token,
  videoUrl,
  videoHeaders,
  headline,
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
}) {
  const submitted = await call(baseUrl, "/render", {
    token,
    method: "POST",
    body: { type: "reel", video_url: videoUrl, video_headers: videoHeaders, headline },
    fetchImpl,
  });

  const { job_id: jobId } = await submitted.json();
  const job = await waitForJob({ baseUrl, token, jobId, fetchImpl, timeoutMs });

  const file = await call(baseUrl, job.output, { token, fetchImpl });
  const video = Buffer.from(await file.arrayBuffer());

  return {
    video,
    jobId,
    lines: job.headline_lines,
    fontSize: job.font_size,
    overflow: Boolean(job.overflow),
  };
}

module.exports = { renderReel, waitForJob, POLL_INTERVAL_MS, TIMEOUT_MS };
