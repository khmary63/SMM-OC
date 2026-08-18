import "server-only";

export interface ExtractResult {
  text: string | null;
  status: "done" | "unsupported" | "failed" | "not_applicable";
}

/**
 * Извлечение текста из загруженного файла базы знаний бренда
 * (редакционный календарь, брендбук, логотип). Поддержаны только форматы,
 * для которых извлечение надёжно и не требует OCR/vision.
 * Изображения (логотипы и т.п.) хранятся как визуальный референс —
 * текст из них не извлекается, это ожидаемо, а не ошибка.
 */
export async function extractKnowledgeText(
  bytes: Buffer,
  mimeType: string
): Promise<ExtractResult> {
  if (mimeType.startsWith("image/")) {
    return { text: null, status: "not_applicable" };
  }
  try {
    if (mimeType === "text/plain" || mimeType === "text/markdown") {
      return { text: bytes.toString("utf-8").slice(0, 200_000), status: "done" };
    }
    if (mimeType === "application/pdf") {
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(bytes);
      return { text: parsed.text.slice(0, 200_000), status: "done" };
    }
    if (
      mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: bytes });
      return { text: result.value.slice(0, 200_000), status: "done" };
    }
    return { text: null, status: "unsupported" };
  } catch {
    return { text: null, status: "failed" };
  }
}
