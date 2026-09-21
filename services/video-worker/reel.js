/**
 * Рендер вертикального Reels-ролика: видео-подложка + заголовок поверх кадра.
 *
 * Заголовок держится всю длительность ролика, переносится по словам и
 * автоматически подбирает кегль так, чтобы уместиться в безопасную зону
 * (в Instagram сверху висит шапка, снизу — подпись и кнопки).
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

/** Ширина глифа в долях кегля для DejaVu Sans Bold, усреднённая по латинице. */
const GLYPH_WIDTH_RATIO = 0.66;

const DEFAULTS = {
  width: 1080,
  height: 1920,
  fps: 30,
  maxDuration: 60,
  sideMargin: 72,
  // Четыре строки — предел читаемости в ленте; пятая уже не помещается
  // в безопасную зону и вынуждает мельчить шрифт.
  maxLines: 4,
  headlineTop: 0.2,
  fontSizes: [104, 96, 88, 80, 72, 64, 58, 52],
};

/**
 * Переносит текст по словам так, чтобы каждая строка влезала в maxChars.
 * Слово длиннее строки не режется — оно просто занимает свою строку целиком,
 * подбор кегля уровнем выше всё равно приведёт раскладку в норму.
 */
function wrapText(text, maxChars) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
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
 * Подбирает самый крупный кегль, при котором заголовок укладывается
 * в maxLines строк и не вылезает за поля.
 */
function fitHeadline(text, opts) {
  const usableWidth = opts.width - opts.sideMargin * 2;

  for (const fontSize of opts.fontSizes) {
    const maxChars = Math.floor(usableWidth / (fontSize * GLYPH_WIDTH_RATIO));
    if (maxChars < 6) continue;

    const lines = wrapText(text, maxChars);
    const tooWide = lines.some(
      (l) => l.length * fontSize * GLYPH_WIDTH_RATIO > usableWidth
    );

    if (lines.length <= opts.maxLines && !tooWide) {
      return { fontSize, lines };
    }
  }

  // Заголовок аномально длинный. Режем его нельзя — потерянные слова меняют смысл,
  // поэтому берём минимальный кегль и отдаём столько строк, сколько получится.
  const fontSize = opts.fontSizes[opts.fontSizes.length - 1];
  const maxChars = Math.floor(usableWidth / (fontSize * GLYPH_WIDTH_RATIO));
  const lines = wrapText(text, maxChars);
  return { fontSize, lines, overflow: true };
}

/** Экранирует путь для подстановки в граф фильтров ffmpeg. */
function escapeFilterPath(value) {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Собирает аргументы ffmpeg для рендера рилса.
 *
 * Подложка масштабируется с обрезкой (force_original_aspect_ratio=increase + crop),
 * чтобы заполнить кадр 9:16 без чёрных полей. Текст подаётся через textfile
 * с expansion=none — так в заголовке безопасны любые кавычки, двоеточия и проценты.
 */
function buildReelArgs({ input, output, textFile, fontFile, fontSize, lineCount, opts }) {
  const { width, height, fps, maxDuration } = opts;

  const lineSpacing = Math.round(fontSize * 0.22);
  const blockHeight = lineCount * fontSize + (lineCount - 1) * lineSpacing;
  const topSafe = Math.round(height * opts.headlineTop);
  const bottomSafe = Math.round(height * 0.72);

  // Если заголовок высокий, поднимаем его, но не выше верхней безопасной зоны.
  const y = Math.max(
    Math.round(height * 0.12),
    Math.min(topSafe, bottomSafe - blockHeight)
  );

  const drawtext = [
    `fontfile=${escapeFilterPath(fontFile)}`,
    `textfile=${escapeFilterPath(textFile)}`,
    "expansion=none",
    "fontcolor=white",
    `fontsize=${fontSize}`,
    "borderw=4",
    "bordercolor=black@0.9",
    "box=1",
    "boxcolor=black@0.45",
    `boxborderw=${Math.round(fontSize * 0.32)}`,
    `line_spacing=${lineSpacing}`,
    "text_align=C",
    "x=(w-text_w)/2",
    `y=${y}`,
  ].join(":");

  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `drawtext=${drawtext}`,
  ].join(",");

  return [
    "-y",
    "-i", input,
    "-vf", filter,
    "-t", String(maxDuration),
    "-r", String(fps),
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-profile:v", "high",
    "-level", "4.1",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-movflags", "+faststart",
    output,
  ];
}

/**
 * Готовит всё необходимое для рендера: раскладывает заголовок, пишет textfile
 * и возвращает аргументы ffmpeg вместе с выбранной раскладкой.
 */
function prepareReel({ dir, input, output, headline, manifest = {} }) {
  const opts = {
    ...DEFAULTS,
    width: Number(manifest.width || DEFAULTS.width),
    height: Number(manifest.height || DEFAULTS.height),
    fps: Number(manifest.fps || DEFAULTS.fps),
    maxDuration: Number(manifest.max_duration || DEFAULTS.maxDuration),
    maxLines: Number(manifest.max_lines || DEFAULTS.maxLines),
    headlineTop: Number(manifest.headline_top || DEFAULTS.headlineTop),
  };

  const fontFile = manifest.font_file || DEFAULT_FONT;
  if (!fs.existsSync(fontFile)) {
    throw new Error(`Font not found: ${fontFile}`);
  }

  const { fontSize, lines, overflow } = fitHeadline(headline, opts);
  const textFile = path.join(dir, "headline.txt");
  fs.writeFileSync(textFile, lines.join("\n"), "utf8");

  const args = buildReelArgs({
    input,
    output,
    textFile,
    fontFile,
    fontSize,
    lineCount: lines.length,
    opts,
  });

  return { args, fontSize, lines, overflow: Boolean(overflow), opts };
}

module.exports = { wrapText, fitHeadline, prepareReel, buildReelArgs, DEFAULTS };
