const test = require("node:test");
const assert = require("node:assert/strict");

const {
  listFolder,
  isVideo,
  selectBackgrounds,
  cooldownSize,
  pickBackground,
  downloadUrl,
  resolveKnowledgeFiles,
  KNOWLEDGE_FILES,
} = require("../sources/drive");

function video(id, name = `${id}.mp4`) {
  return { id, name, mimeType: "video/mp4" };
}

/** Мини-заглушка Drive API: отдаёт страницы по очереди. */
function fakeDrive(pages) {
  let call = 0;
  const requests = [];

  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    const page = pages[call++];
    return {
      ok: true,
      json: async () => page,
      text: async () => JSON.stringify(page),
    };
  };

  return { fetchImpl, requests };
}

test("listFolder собирает все страницы, а не только первую", async () => {
  const { fetchImpl, requests } = fakeDrive([
    { files: [video("a"), video("b")], nextPageToken: "p2" },
    { files: [video("c")] },
  ]);

  const files = await listFolder("FOLDER", { accessToken: "T", fetchImpl });

  assert.deepEqual(files.map((f) => f.id), ["a", "b", "c"]);
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /pageToken=p2/);
});

test("listFolder фильтрует корзину и передаёт токен", async () => {
  const { fetchImpl, requests } = fakeDrive([{ files: [] }]);
  await listFolder("FOLDER", { accessToken: "SECRET", fetchImpl });

  // URLSearchParams кодирует пробел как "+", разворачиваем перед сверкой.
  const query = decodeURIComponent(requests[0].url).replace(/\+/g, " ");
  assert.match(query, /'FOLDER' in parents/);
  assert.match(query, /trashed = false/);
  assert.equal(requests[0].init.headers.Authorization, "Bearer SECRET");
});

test("listFolder требует токен", async () => {
  await assert.rejects(() => listFolder("F", {}), /accessToken is required/);
});

test("listFolder поднимает ошибку API, а не отдаёт пустой список", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    text: async () => "insufficient permissions",
  });

  await assert.rejects(
    () => listFolder("F", { accessToken: "T", fetchImpl }),
    /Drive API 403/
  );
});

test("selectBackgrounds выкидывает подпапку инструкций и документы", () => {
  const files = [
    video("v1"),
    { id: "sub", name: "инструкции", mimeType: "application/vnd.google-apps.folder" },
    { id: "doc", name: "заметка.txt", mimeType: "text/plain" },
    video("v2"),
  ];

  assert.deepEqual(selectBackgrounds(files).map((f) => f.id), ["v1", "v2"]);
});

test("isVideo не принимает Google Vids за видеофайл", () => {
  // Google Vids — формат редактора, скачать его как mp4 нельзя.
  assert.equal(isVideo({ mimeType: "application/vnd.google-apps.vid" }), false);
  assert.equal(isVideo({ mimeType: "video/mp4" }), true);
  assert.equal(isVideo({}), false);
});

test("cooldownSize держит в карантине половину коллекции", () => {
  assert.equal(cooldownSize(24), 12);
  assert.equal(cooldownSize(2), 1);
  assert.equal(cooldownSize(1), 0); // единственную подложку карантинить нельзя
  assert.equal(cooldownSize(0), 0);
});

test("pickBackground предпочитает ни разу не использованные", () => {
  const files = [video("old1"), video("old2"), video("fresh"), video("old3")];
  const usageLog = {
    old1: "2026-09-20T10:00:00Z",
    old2: "2026-09-20T11:00:00Z",
    old3: "2026-09-20T12:00:00Z",
  };

  // random=0 берёт первого кандидата — самого давно не использованного.
  assert.equal(pickBackground(files, usageLog, () => 0).id, "fresh");
});

test("pickBackground не возвращает недавно использованную подложку", () => {
  const files = [video("a"), video("b"), video("c"), video("d")];
  const usageLog = {
    a: "2026-09-21T10:00:00Z", // самая свежая
    b: "2026-09-21T09:00:00Z",
    c: "2026-09-20T10:00:00Z",
    d: "2026-09-19T10:00:00Z",
  };

  // При 4 файлах в карантине 2 самые свежие — a и b недоступны.
  const picked = new Set();
  for (const r of [0, 0.5, 0.99]) {
    picked.add(pickBackground(files, usageLog, () => r).id);
  }

  assert.ok(!picked.has("a"), "свежайшая подложка попала в выдачу");
  assert.ok(!picked.has("b"), "вторая свежая подложка попала в выдачу");
});

test("pickBackground всё же случаен внутри доступных", () => {
  const files = Array.from({ length: 24 }, (_, i) => video(`v${i}`));
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    seen.add(pickBackground(files, {}, () => i / 12).id);
  }
  assert.ok(seen.size > 1, "выбор оказался детерминированным");
});

test("pickBackground работает с единственной подложкой", () => {
  assert.equal(pickBackground([video("only")], {}, () => 0.7).id, "only");
});

test("pickBackground падает на пустой папке, а не возвращает undefined", () => {
  assert.throws(() => pickBackground([], {}), /No background videos/);
});

test("downloadUrl отдаёт прямую ссылку на файл, а не страницу просмотра", () => {
  const url = downloadUrl("abc123");
  assert.match(url, /alt=media/);
  assert.ok(!url.includes("/view"), "ссылка ведёт на HTML-страницу");
});

test("resolveKnowledgeFiles находит все базы знаний", () => {
  const files = Object.values(KNOWLEDGE_FILES).map((name, i) => ({
    id: `k${i}`,
    name,
    mimeType: "text/plain",
  }));

  const resolved = resolveKnowledgeFiles(files);
  assert.deepEqual(Object.keys(resolved).sort(), Object.keys(KNOWLEDGE_FILES).sort());
});

test("resolveKnowledgeFiles называет недостающие файлы", () => {
  const files = [{ id: "k", name: KNOWLEDGE_FILES.copywriter, mimeType: "text/plain" }];

  assert.throws(
    () => resolveKnowledgeFiles(files),
    /SKILL ИИ-переводчик\.md/
  );
});
