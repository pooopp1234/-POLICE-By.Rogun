const db = require("./db");
const time = require("./time");
const embeds = require("./embeds");
const { sendLog } = require("./permissions");

const STATE_KEY = "last_weekly_reset_week";
const CHECK_INTERVAL_MS = 60 * 1000; // เช็คทุก 1 นาที

/**
 * ระบบสรุป + รีเซ็ตชั่วโมงเวรรายสัปดาห์อัตโนมัติ
 *
 * หมายเหตุ: ตัวเลข "สัปดาห์นี้" (hoursWeek) คำนวณจาก isoWeek ของ dayjs อยู่แล้วทุกครั้งที่เรียกดู
 * (ดู time.isSameWeek / summarizeLogs) ดังนั้นเมื่อขึ้นสัปดาห์ใหม่ ตัวนับจะเริ่มนับจาก 0 ให้เองโดยอัตโนมัติ
 * โดยไม่ต้องลบข้อมูลเก่าทิ้ง -> ประวัติ (duty_log) ยังอยู่ครบ แค่ตัวนับรายสัปดาห์เริ่มใหม่
 *
 * สิ่งที่โมดูลนี้ทำเพิ่มคือ: ก่อนที่สัปดาห์จะเปลี่ยน (เมื่อขึ้นสัปดาห์ใหม่) ให้สรุปยอดของสัปดาห์ที่เพิ่งจบไป
 * แล้วโพสต์แจ้งอัตโนมัติในห้อง log หนึ่งครั้งต่อสัปดาห์ พร้อมทั้ง:
 *   - บันทึกลงตาราง Summary (ยอดล่าสุด ใช้เปิดดูแบบ live)
 *   - บันทึกลงตาราง weekly_summary_history แยกเป็นรายสัปดาห์ (ดูย้อนหลังได้ทุกสัปดาห์ ไม่ถูกเขียนทับ)
 */

// ---------- ฟังก์ชันหลัก: คำนวณสรุปของสัปดาห์ที่ระบุ (ไม่บันทึกอะไร แค่คำนวณ) ----------
async function buildWeeklySummary(refDate) {
  const weekKey = time.isoWeekKey(refDate);
  const allLogs = await db.getDutyLogs();
  const byMember = {};
  for (const log of allLogs) {
    if (!byMember[log.discordId]) byMember[log.discordId] = [];
    byMember[log.discordId].push(log);
  }

  const rows = [];
  for (const [discordId, logs] of Object.entries(byMember)) {
    const summary = time.summarizeLogsForWeek(logs, refDate);
    if (summary.hoursWeek === 0 && summary.dutyCount === 0) continue;
    const name = logs[0]?.name || discordId;
    rows.push({ discordId, name, ...summary });
  }

  rows.sort((a, b) => b.hoursWeek - a.hoursWeek);
  return { weekKey, rows };
}

// ---------- บันทึกผลลง Summary (live) + weekly_summary_history (ประวัติแยกรายสัปดาห์) ----------
async function persistWeeklySummary(weekKey, rows) {
  const updatedAt = time.nowIso();

  for (const row of rows) {
    await db.writeSummaryRow({
      discordId: row.discordId,
      name: row.name,
      hoursToday: 0,
      hoursWeek: row.hoursWeek,
      hoursMonth: 0,
      dutyCount: row.dutyCount,
      updatedAt,
    });
  }

  await db.saveWeeklyHistory(weekKey, rows, updatedAt);
}

function buildSummaryEmbed(weekKey, rows, { auto = false } = {}) {
  const rangeText = time.weekRangeThaiFromKey(weekKey);
  const description =
    rows.length === 0
      ? "ไม่มีข้อมูลการเข้าเวรในสัปดาห์ที่ผ่านมา"
      : auto
      ? `สรุปชั่วโมงเวรของสัปดาห์ที่ผ่านมา (${rangeText}) — ตัวนับรายสัปดาห์เริ่มนับใหม่ตั้งแต่ตอนนี้ ข้อมูลเก่ายังเก็บไว้ครบในประวัติ`
      : `สรุปชั่วโมงเวรของสัปดาห์ (${rangeText}) — สั่งรันด้วยตนเอง บันทึกลงประวัติเรียบร้อยแล้ว`;

  const fields = rows.slice(0, 25).map((r) => ({
    name: r.name,
    value: `${time.formatDurationThai(r.hoursWeek)} (${r.dutyCount} ครั้ง)`,
    inline: true,
  }));

  return embeds.adminActionEmbed(
    auto ? `📅 สรุปรายสัปดาห์อัตโนมัติ (${rangeText})` : `📅 สรุปรายสัปดาห์ (${rangeText})`,
    description,
    fields
  );
}

// ---------- เช็คอัตโนมัติทุก 1 นาที: ทำงานแค่ครั้งเดียวเมื่อขึ้นสัปดาห์ใหม่ ----------
async function checkAndRun(client) {
  try {
    const refDate = time.lastCompletedWeekRef(); // อ้างอิงสัปดาห์ล่าสุดที่จบไปแล้วเต็มสัปดาห์
    const weekKey = time.isoWeekKey(refDate);

    const lastRunWeekKey = await db.getState(STATE_KEY);
    if (lastRunWeekKey === weekKey) return; // สัปดาห์นี้สรุปไปแล้ว ยังไม่ต้องทำซ้ำ

    const { rows } = await buildWeeklySummary(refDate);
    await persistWeeklySummary(weekKey, rows);

    const embed = buildSummaryEmbed(weekKey, rows, { auto: true });
    if (client) {
      await sendLog(client, "สรุปสัปดาห์", embed);
    }

    await db.setState(STATE_KEY, weekKey);
    console.log(`[สรุป/รีเซ็ตรายสัปดาห์] ทำงานสำเร็จสำหรับสัปดาห์ ${weekKey}`);
  } catch (err) {
    console.error("[สรุป/รีเซ็ตรายสัปดาห์] เกิดข้อผิดพลาด:", err);
  }
}

/**
 * ให้แอดมินสั่งให้ระบบสรุปรายสัปดาห์ทำงาน "ทันที" ได้เอง โดยไม่ต้องรอรอบเช็คอัตโนมัติ (ทุก 1 นาที)
 * หรือรอบอทรีสตาร์ท — เผื่อกรณีบอทออฟไลน์ตอนขึ้นสัปดาห์ใหม่พอดี หรือแอดมินต้องการดู/บันทึกผลตอนนี้เลย
 * ใช้ข้อมูลสัปดาห์เดียวกับที่ระบบอัตโนมัติจะสรุปอยู่แล้ว (สัปดาห์ล่าสุดที่จบไปแล้วเต็มสัปดาห์)
 * เรียกซ้ำได้อย่างปลอดภัย ข้อมูลจะถูกคำนวณใหม่และเขียนทับด้วยยอดล่าสุดเสมอ (ไม่สร้างข้อมูลซ้ำซ้อนในประวัติ)
 */
async function runNow(client) {
  const refDate = time.lastCompletedWeekRef();
  const { weekKey, rows } = await buildWeeklySummary(refDate);

  await persistWeeklySummary(weekKey, rows);
  await db.setState(STATE_KEY, weekKey);

  const embed = buildSummaryEmbed(weekKey, rows, { auto: false });
  if (client) {
    await sendLog(client, "สรุปสัปดาห์", embed);
  }

  console.log(`[สรุปรายสัปดาห์] แอดมินสั่งรันด้วยตนเองสำเร็จสำหรับสัปดาห์ ${weekKey}`);
  return { weekKey, rows, embed };
}

function start(client) {
  checkAndRun(client); // เช็คทันทีตอนบอทเริ่มทำงาน เผื่อบอทออฟไลน์ตอนขึ้นสัปดาห์ใหม่พอดี
  setInterval(() => checkAndRun(client), CHECK_INTERVAL_MS);
}

module.exports = { start, checkAndRun, runNow, buildWeeklySummary };
