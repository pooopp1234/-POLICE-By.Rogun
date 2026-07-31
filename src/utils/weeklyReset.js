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
 * แล้วโพสต์แจ้งอัตโนมัติในห้อง log หนึ่งครั้งต่อสัปดาห์ พร้อมกันบันทึกลงชีต Summary ไว้เป็นหลักฐาน
 */

async function checkAndRun(client) {
  try {
    const refDate = time.lastCompletedWeekRef(); // อ้างอิงสัปดาห์ล่าสุดที่จบไปแล้วเต็มสัปดาห์
    const weekKey = time.isoWeekKey(refDate);

    const lastRunWeekKey = await db.getState(STATE_KEY);
    if (lastRunWeekKey === weekKey) return; // สัปดาห์นี้สรุปไปแล้ว ยังไม่ต้องทำซ้ำ

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

      await db.writeSummaryRow({
        discordId,
        name,
        hoursToday: 0,
        hoursWeek: summary.hoursWeek,
        hoursMonth: 0,
        dutyCount: summary.dutyCount,
        updatedAt: time.nowIso(),
      });

      rows.push({ name, ...summary });
    }

    rows.sort((a, b) => b.hoursWeek - a.hoursWeek);

    const description =
      rows.length === 0
        ? "ไม่มีข้อมูลการเข้าเวรในสัปดาห์ที่ผ่านมา"
        : `สรุปชั่วโมงเวรของสัปดาห์ที่ผ่านมา (${weekKey}) — ตัวนับรายสัปดาห์เริ่มนับใหม่ตั้งแต่ตอนนี้ ข้อมูลเก่ายังเก็บไว้ครบในประวัติ`;

    const fields = rows.slice(0, 25).map((r) => ({
      name: r.name,
      value: `${r.hoursWeek} ชม. (${r.dutyCount} ครั้ง)`,
      inline: true,
    }));

    const embed = embeds.adminActionEmbed(`📅 สรุปรายสัปดาห์อัตโนมัติ (${weekKey})`, description, fields);

    if (client) {
      await sendLog(client, "สรุปสัปดาห์", embed);
    }

    await db.setState(STATE_KEY, weekKey);
    console.log(`[สรุป/รีเซ็ตรายสัปดาห์] ทำงานสำเร็จสำหรับสัปดาห์ ${weekKey}`);
  } catch (err) {
    console.error("[สรุป/รีเซ็ตรายสัปดาห์] เกิดข้อผิดพลาด:", err);
  }
}

function start(client) {
  checkAndRun(client); // เช็คทันทีตอนบอทเริ่มทำงาน เผื่อบอทออฟไลน์ตอนขึ้นสัปดาห์ใหม่พอดี
  setInterval(() => checkAndRun(client), CHECK_INTERVAL_MS);
}

module.exports = { start, checkAndRun };
