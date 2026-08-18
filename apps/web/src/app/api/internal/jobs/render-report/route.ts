import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/internal/jobs/render-report — вызывается n8n (WF-REPORT-001).
 * Собирает агрегаты за период напрямую из аналитических витрин (§10
 * архитектуры: SQL-слой считает, LLM не пересчитывает), рендерит PDF через
 * pdfkit (без headless Chrome — см. решение в плане Phase 5), загружает в
 * Storage и обновляет monthly_reports. Недоступные значения явно помечаются
 * «—», не 0 (§16.6).
 */
export async function POST(request: Request) {
  const token = process.env.N8N_WEBHOOK_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Не настроен" }, { status: 503 });
  }

  const rawBody = await request.text();
  const provided = request.headers.get("x-smm-signature") ?? "";
  const expected = createHmac("sha256", token).update(rawBody).digest("hex");

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Неверная подпись" }, { status: 401 });
  }

  let body: { report_id?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Невалидный JSON" }, { status: 400 });
  }
  if (!body.report_id) {
    return NextResponse.json({ error: "report_id обязателен" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: report, error: reportError } = await admin
    .from("monthly_reports")
    .select("id, workspace_id, brand_id, report_month, period_start, period_end, brands(name)")
    .eq("id", body.report_id)
    .single();
  if (reportError || !report) {
    return NextResponse.json({ error: "Отчёт не найден" }, { status: 404 });
  }
  const brandName = (report.brands as unknown as { name: string } | null)?.name ?? "Бренд";

  const { data: performance } = await admin
    .from("v_content_performance")
    .select("*")
    .eq("workspace_id", report.workspace_id)
    .eq("brand_id", report.brand_id)
    .gte("published_at", report.period_start)
    .lte("published_at", report.period_end);
  const rows = performance ?? [];

  const { data: channels } = await admin
    .from("channels")
    .select("id, platform")
    .eq("brand_id", report.brand_id);

  const { data: growth } = await admin
    .from("v_channel_daily_growth")
    .select("*")
    .in("channel_id", (channels ?? []).map((c) => c.id))
    .gte("local_date", report.period_start)
    .lte("local_date", report.period_end)
    .order("local_date", { ascending: true });

  const { data: insight } = await admin
    .from("insights")
    .select("title, body, confidence")
    .eq("brand_id", report.brand_id)
    .eq("period_start", report.period_start)
    .eq("period_end", report.period_end)
    .order("created_at", { ascending: false })
    .maybeSingle();

  const { data: recommendations } = await admin
    .from("recommendations")
    .select("action, reason, confidence")
    .eq("brand_id", report.brand_id)
    .gte("created_at", report.period_start)
    .order("created_at", { ascending: false })
    .limit(10);

  function fmt(n: number | null | undefined): string {
    return n === null || n === undefined ? "—" : String(n);
  }
  function fmtPct(n: number | null | undefined): string {
    return n === null || n === undefined ? "—" : `${n}%`;
  }

  const platformLabels: Record<string, string> = {
    vk: "VK",
    telegram: "Telegram",
    max: "MAX",
    vcru: "VC.ru",
    youtube: "YouTube",
  };

  // --- PDF ---
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk as Buffer));
  const pdfDone = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const monthLabel = new Date(report.report_month).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });

  doc.fontSize(20).text(`Месячный отчёт — ${brandName}`, { align: "left" });
  doc.fontSize(12).fillColor("#666").text(`${monthLabel} (${report.period_start} — ${report.period_end})`);
  doc.moveDown(1.5);

  doc.fillColor("#000").fontSize(14).text("Каналы: рост подписчиков", { underline: true });
  doc.moveDown(0.5);
  const channelsById = new Map((channels ?? []).map((c) => [c.id, c.platform]));
  const byChannel = new Map<string, { first: number | null; last: number | null }>();
  for (const g of growth ?? []) {
    const cur = byChannel.get(g.channel_id) ?? { first: null, last: null };
    if (cur.first === null) cur.first = g.followers;
    cur.last = g.followers;
    byChannel.set(g.channel_id, cur);
  }
  if (byChannel.size === 0) {
    doc.fontSize(10).fillColor("#666").text("Снимков метрик за период нет.");
  } else {
    doc.fontSize(10).fillColor("#000");
    for (const [channelId, v] of byChannel) {
      const platform = platformLabels[channelsById.get(channelId) ?? ""] ?? channelsById.get(channelId);
      const delta = v.first !== null && v.last !== null ? v.last - v.first : null;
      doc.text(
        `${platform}: ${fmt(v.first)} → ${fmt(v.last)} подписчиков (${delta === null ? "—" : delta >= 0 ? `+${delta}` : delta})`
      );
    }
  }
  doc.moveDown(1);

  doc.fontSize(14).text("Контент за период", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Опубликовано материалов: ${rows.length}`);
  if (rows.length > 0) {
    const withEr = rows.filter((r) => r.engagement_rate !== null);
    const avgEr =
      withEr.length > 0
        ? +(withEr.reduce((s, r) => s + Number(r.engagement_rate), 0) / withEr.length).toFixed(2)
        : null;
    doc.text(`Средний engagement rate: ${fmtPct(avgEr)}`);
    doc.moveDown(0.5);
    doc.fontSize(11).text("Топ материалы по ER:", { underline: true });
    const sorted = [...rows].sort((x, y) => (Number(y.engagement_rate) || -1) - (Number(x.engagement_rate) || -1));
    doc.fontSize(9);
    for (const r of sorted.slice(0, 5)) {
      doc.text(`• ${r.title ?? "Без названия"} — ER ${fmtPct(r.engagement_rate)}, охват ${fmt(r.reach)}`);
    }
  }
  doc.moveDown(1);

  doc.fontSize(14).text("Выводы", { underline: true });
  doc.moveDown(0.5);
  if (insight) {
    doc.fontSize(10).fillColor("#000").text(insight.body);
    doc.fontSize(8).fillColor("#888").text(`Уверенность: ${insight.confidence}`);
  } else {
    doc.fontSize(10).fillColor("#666").text("Аналитические выводы за этот период ещё не сформированы.");
  }
  doc.moveDown(1);

  doc.fillColor("#000").fontSize(14).text("Рекомендации", { underline: true });
  doc.moveDown(0.5);
  if (recommendations && recommendations.length > 0) {
    doc.fontSize(9);
    for (const r of recommendations) {
      doc.text(`• ${r.action} (${r.confidence})`);
      doc.fontSize(8).fillColor("#666").text(`  ${r.reason}`);
      doc.fontSize(9).fillColor("#000");
    }
  } else {
    doc.fontSize(10).fillColor("#666").text("Рекомендаций за этот период нет.");
  }

  doc.end();
  const pdfBuffer = await pdfDone;

  const assetId = randomUUID();
  const storagePath = `${report.workspace_id}/${report.brand_id}/${assetId}/report-${report.report_month}.pdf`;
  const { error: uploadError } = await admin.storage
    .from("smm-assets")
    .upload(storagePath, pdfBuffer, { contentType: "application/pdf" });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const checksum = createHash("sha256").update(pdfBuffer).digest("hex");
  const { error: assetError } = await admin.from("assets").insert({
    id: assetId,
    workspace_id: report.workspace_id,
    brand_id: report.brand_id,
    type: "document",
    storage_bucket: "smm-assets",
    storage_path: storagePath,
    file_name: `report-${report.report_month}.pdf`,
    mime_type: "application/pdf",
    size_bytes: pdfBuffer.length,
    checksum_sha256: checksum,
  });
  if (assetError) {
    return NextResponse.json({ error: assetError.message }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from("monthly_reports")
    .update({
      status: "succeeded",
      report_asset_id: assetId,
      generated_at: new Date().toISOString(),
      summary_json: {
        posts: rows.length,
        channels: [...byChannel.keys()].length,
        has_insight: Boolean(insight),
        recommendation_count: recommendations?.length ?? 0,
      },
    })
    .eq("id", report.id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ report_asset_id: assetId });
}
