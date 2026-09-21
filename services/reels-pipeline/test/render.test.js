const test = require("node:test");
const assert = require("node:assert/strict");

const { renderReel } = require("../render");

const BASE = {
  baseUrl: "http://worker.test",
  token: "render-token",
  videoUrl: "https://drive.test/files/bg1?alt=media",
  videoHeaders: { Authorization: "Bearer google-token" },
  headline: "I QUIT my job",
};

/**
 * Воркер-заглушка: отдаёт job_id, затем заданную последовательность
 * статусов, затем файл.
 */
function fakeWorker(statuses, { video = "mp4-bytes" } = {}) {
  const calls = [];
  let polled = 0;

  const fetchImpl = async (url, options) => {
    calls.push({ url, options });

    if (url.endsWith("/render")) {
      return { ok: true, json: async () => ({ job_id: "job-1", status: "processing" }) };
    }

    if (url.includes("/render/")) {
      const status = statuses[Math.min(polled++, statuses.length - 1)];
      return { ok: true, json: async () => status };
    }

    return { ok: true, arrayBuffer: async () => Buffer.from(video) };
  };

  return { calls, fetchImpl };
}

test("renderReel дожидается готовой задачи и забирает видео", async () => {
  const { calls, fetchImpl } = fakeWorker([
    { status: "processing" },
    { status: "succeeded", output: "/files/job-1/output.mp4", headline_lines: 2, font_size: 84 },
  ]);

  const result = await renderReel({ ...BASE, fetchImpl });

  assert.equal(result.video.toString(), "mp4-bytes");
  assert.equal(result.lines, 2);
  assert.equal(result.overflow, false);

  const submit = JSON.parse(calls[0].options.body);
  assert.equal(submit.type, "reel");
  assert.equal(submit.headline, "I QUIT my job");
  assert.deepEqual(submit.video_headers, { Authorization: "Bearer google-token" });
});

test("renderReel передаёт причину провала наверх", async () => {
  const { fetchImpl } = fakeWorker([{ status: "failed", error: "ffmpeg exited 1" }]);

  await assert.rejects(() => renderReel({ ...BASE, fetchImpl }), /ffmpeg exited 1/);
});

test("renderReel не ждёт вечно", async () => {
  const { fetchImpl } = fakeWorker([{ status: "processing" }]);

  await assert.rejects(
    () => renderReel({ ...BASE, fetchImpl, timeoutMs: 1 }),
    /не уложился/
  );
});

test("renderReel докладывает о переполнении надписи", async () => {
  const { fetchImpl } = fakeWorker([
    { status: "succeeded", output: "/files/job-1/output.mp4", overflow: true },
  ]);

  const result = await renderReel({ ...BASE, fetchImpl });

  assert.equal(result.overflow, true);
});

test("renderReel ходит к воркеру с авторизацией", async () => {
  const { calls, fetchImpl } = fakeWorker([
    { status: "succeeded", output: "/files/job-1/output.mp4" },
  ]);

  await renderReel({ ...BASE, fetchImpl });

  for (const call of calls) {
    assert.equal(call.options.headers.authorization, "Bearer render-token", call.url);
  }
});
