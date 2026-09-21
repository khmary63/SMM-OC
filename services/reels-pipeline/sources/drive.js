/**
 * Google Drive как хранилище исходников: видео-подложки и базы знаний.
 *
 * Инструкции копирайтера и переводчика намеренно НЕ копируются в репозиторий,
 * а читаются из Drive на лету: Мария правит документы у себя, пайплайн
 * подхватывает новую версию без деплоя, и расхождения между копиями не возникает.
 *
 * HTTP-клиент внедряется снаружи (fetchImpl), поэтому модуль тестируется
 * без сети и не зависит от способа авторизации.
 */

/** Папка «Рилсы (подложки)». Внутри лежит ещё и подпапка «инструкции». */
const BACKGROUNDS_FOLDER_ID = "1zErG865WJSfd1FZAeRqquXAXwhEXhnHc";

/** Папка «инструкции» — базы знаний копирайтера, переводчика, заголовков. */
const INSTRUCTIONS_FOLDER_ID = "1PfoWMmaH9bMq86QPlqedWYlsQcqqZ5Lj";

const API_BASE = "https://www.googleapis.com/drive/v3";

/**
 * Перечисляет содержимое папки Drive.
 *
 * Постранично: в папке подложек уже два десятка файлов, а Drive по умолчанию
 * отдаёт не всё за один ответ, и молча обрезанный список означал бы, что часть
 * подложек никогда не попадёт в ротацию.
 */
async function listFolder(folderId, { accessToken, fetchImpl = fetch } = {}) {
  if (!accessToken) throw new Error("accessToken is required");

  const files = [];
  let pageToken;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size)",
      pageSize: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetchImpl(`${API_BASE}/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Drive API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const data = await res.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

/** Видео-файл, а не папка и не документ. */
function isVideo(file) {
  return typeof file.mimeType === "string" && file.mimeType.startsWith("video/");
}

/**
 * Подложки из папки: только видео.
 *
 * Фильтр обязателен — внутри папки с подложками лежит подпапка «инструкции»,
 * и без него рендер однажды получил бы на вход папку или текстовый файл.
 */
function selectBackgrounds(files) {
  return files.filter(isVideo);
}

/**
 * Сколько недавно использованных подложек держать в карантине.
 * Половина коллекции: при 24 роликах и двух постах в день повтор вернётся
 * не раньше чем через неделю, но выбор всё ещё остаётся случайным.
 */
function cooldownSize(total) {
  return Math.min(Math.floor(total / 2), Math.max(total - 1, 0));
}

/**
 * Случайная подложка с защитой от близких повторов.
 *
 * ТЗ требует случайного выбора, но чистый random при двух постах в день
 * быстро даёт заметные повторы. Поэтому случайность берётся не по всей
 * коллекции, а по той части, что давно не использовалась.
 *
 * @param {Array} backgrounds список видео
 * @param {Object} usageLog   { fileId: ISO-дата последнего использования }
 * @param {Function} random   источник случайности, для тестов
 */
function pickBackground(backgrounds, usageLog = {}, random = Math.random) {
  if (backgrounds.length === 0) {
    throw new Error("No background videos found in the Drive folder");
  }

  const lastUsed = (file) => {
    const stamp = usageLog[file.id];
    return stamp ? new Date(stamp).getTime() : 0;
  };

  // Свежеиспользованные в конец, никогда не использованные — в начало.
  const byAge = [...backgrounds].sort((a, b) => lastUsed(a) - lastUsed(b));
  const quarantined = cooldownSize(backgrounds.length);
  const eligible = byAge.slice(0, backgrounds.length - quarantined);

  return eligible[Math.floor(random() * eligible.length)];
}

/**
 * Ссылка на скачивание файла Drive.
 *
 * Ссылка вида /file/d/<id>/view отдаёт HTML-страницу, а не файл, поэтому
 * ни ffmpeg, ни Instagram по ней ничего не получат — нужен именно alt=media.
 */
function downloadUrl(fileId) {
  return `${API_BASE}/files/${fileId}?alt=media`;
}

/** Базы знаний по именам файлов — то, что подставляется в промпты. */
const KNOWLEDGE_FILES = {
  copywriter: "ИИ копирайтер.txt",
  translator: "SKILL ИИ-переводчик.md",
  toneOfVoice: "Tone of voice.txt",
  headlines: "Мастер заголовков.txt",
  headlineExamples: "100 готовых заголовков на миллионы просмотров.txt",
};

/**
 * Сопоставляет содержимое папки «инструкции» с ключами баз знаний.
 * Отсутствующий файл — ошибка: без инструкции копирайтера пайплайн
 * сгенерирует текст «вообще», а не в голосе бренда.
 */
function resolveKnowledgeFiles(files) {
  const byName = new Map(files.map((f) => [f.name, f]));
  const resolved = {};
  const missing = [];

  for (const [key, name] of Object.entries(KNOWLEDGE_FILES)) {
    const file = byName.get(name);
    if (file) resolved[key] = file;
    else missing.push(name);
  }

  if (missing.length > 0) {
    throw new Error(`Knowledge files not found in Drive: ${missing.join(", ")}`);
  }

  return resolved;
}

/** Содержимое файла Drive как текст. */
async function readFileText(fileId, { accessToken, fetchImpl = fetch } = {}) {
  if (!accessToken) throw new Error("accessToken is required");

  const res = await fetchImpl(downloadUrl(fileId), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Drive API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  return res.text();
}

/**
 * Базы знаний из папки «инструкции» — готовые тексты под ключами KNOWLEDGE_FILES.
 * Это то, что generate.js подставляет в промпты.
 */
async function fetchKnowledge({ accessToken, fetchImpl = fetch } = {}) {
  const files = resolveKnowledgeFiles(
    await listFolder(INSTRUCTIONS_FOLDER_ID, { accessToken, fetchImpl })
  );

  const texts = await Promise.all(
    Object.entries(files).map(async ([key, file]) => [
      key,
      await readFileText(file.id, { accessToken, fetchImpl }),
    ])
  );

  return Object.fromEntries(texts);
}

module.exports = {
  BACKGROUNDS_FOLDER_ID,
  INSTRUCTIONS_FOLDER_ID,
  KNOWLEDGE_FILES,
  API_BASE,
  listFolder,
  isVideo,
  selectBackgrounds,
  cooldownSize,
  pickBackground,
  downloadUrl,
  resolveKnowledgeFiles,
  readFileText,
  fetchKnowledge,
};
