const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const isoWeek = require("dayjs/plugin/isoWeek");

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

const TZ = "Asia/Bangkok";

function now() {
  return dayjs().tz(TZ);
}

function nowIso() {
  return now().toISOString();
}

function todayStr() {
  return now().format("YYYY-MM-DD");
}

function displayDateTime(iso) {
  if (!iso || iso === "-") return "-";
  return dayjs(iso).tz(TZ).format("DD/MM/YYYY HH:mm");
}

// เหมือน displayDateTime แต่ใช้ พ.ศ. และมีวินาที ใช้กับข้อความรายชื่อ/ป้ายอัปเดตล่าสุด
function displayThaiDateTime(iso) {
  const d = iso ? dayjs(iso).tz(TZ) : now();
  const buddhistYear = d.year() + 543;
  return `${d.format("DD/MM")}/${buddhistYear} ${d.format("HH:mm:ss")}`;
}

// รองรับการเข้าเวรข้ามวัน: คำนวณจาก timestamp เต็ม ไม่ใช่แค่เวลา
function hoursBetween(checkInIso, checkOutIso) {
  const diffMs = dayjs(checkOutIso).diff(dayjs(checkInIso));
  const hours = diffMs / (1000 * 60 * 60);
  return Math.round(hours * 100) / 100;
}

function isSameDay(iso, dateStr) {
  return dayjs(iso).tz(TZ).format("YYYY-MM-DD") === dateStr;
}

function isSameWeek(iso) {
  return dayjs(iso).tz(TZ).isSame(now(), "isoWeek");
}

function isSameMonth(iso) {
  return dayjs(iso).tz(TZ).isSame(now(), "month");
}

// เทียบว่า iso อยู่ในสัปดาห์ (ISO week) เดียวกับ referenceDate (dayjs object) หรือไม่
// ใช้กับระบบสรุป/รีเซ็ตรายสัปดาห์ เพื่อดึงข้อมูลของ "สัปดาห์ที่ผ่านมา" ได้ ไม่ใช่แค่สัปดาห์ปัจจุบัน
function isSameIsoWeekAs(iso, referenceDate) {
  return dayjs(iso).tz(TZ).isSame(referenceDate, "isoWeek");
}

// รหัสสัปดาห์ เช่น "2026-W31" ใช้เป็น key กันการรันซ้ำของระบบรีเซ็ตรายสัปดาห์
function isoWeekKey(referenceDate) {
  const d = referenceDate.tz ? referenceDate.tz(TZ) : dayjs(referenceDate).tz(TZ);
  return `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2, "0")}`;
}

// วันที่อ้างอิงของ "สัปดาห์ล่าสุดที่จบไปแล้วเต็มสัปดาห์" (สัปดาห์ก่อนสัปดาห์ปัจจุบัน)
// ใช้เช็คว่าถึงเวลาต้องสรุป+รีเซ็ตรายสัปดาห์ใหม่หรือยัง
function lastCompletedWeekRef() {
  return now().startOf("isoWeek").subtract(1, "day");
}

/**
 * รวมชั่วโมงเฉพาะของสัปดาห์ที่ระบุ (ใช้กับระบบสรุป/รีเซ็ตรายสัปดาห์อัตโนมัติ)
 * ต่างจาก summarizeLogs ตรงที่ดูเฉพาะยอดสัปดาห์ ไม่ใช่วันนี้/เดือนนี้
 */
function summarizeLogsForWeek(logs, referenceDate) {
  let week = 0;
  let dutyCount = 0;

  for (const log of logs) {
    const hours = parseFloat(log.hours) || 0;
    if (log.status === "ออกเวร" || log.status.startsWith("ปรับเพิ่ม") || log.status.startsWith("ปรับลด")) {
      const refIso = log.checkIn !== "-" ? log.checkIn : log.date;
      if (isSameIsoWeekAs(refIso, referenceDate)) {
        week += hours;
        if (log.status === "ออกเวร") dutyCount += 1;
      }
    }
  }

  return {
    hoursWeek: Math.round(week * 100) / 100,
    dutyCount,
  };
}

/**
 * รวมชั่วโมงจากรายการ Duty Log (เฉพาะแถวที่ออกเวรแล้ว หรือแถวปรับเพิ่ม/ลด)
 * ใช้เวลา checkIn เป็นตัวอ้างอิงวัน/สัปดาห์/เดือน
 */
function summarizeLogs(logs) {
  let today = 0;
  let week = 0;
  let month = 0;
  let dutyCount = 0;

  for (const log of logs) {
    const hours = parseFloat(log.hours) || 0;
    if (log.status === "ออกเวร" || log.status.startsWith("ปรับเพิ่ม") || log.status.startsWith("ปรับลด")) {
      const refIso = log.checkIn !== "-" ? log.checkIn : log.date;
      if (isSameDay(refIso, todayStr())) today += hours;
      if (isSameWeek(refIso)) week += hours;
      if (isSameMonth(refIso)) month += hours;
      if (log.status === "ออกเวร") dutyCount += 1;
    }
  }

  return {
    hoursToday: Math.round(today * 100) / 100,
    hoursWeek: Math.round(week * 100) / 100,
    hoursMonth: Math.round(month * 100) / 100,
    dutyCount,
  };
}

module.exports = {
  TZ,
  now,
  nowIso,
  todayStr,
  displayDateTime,
  displayThaiDateTime,
  hoursBetween,
  isSameDay,
  isSameWeek,
  isSameMonth,
  isSameIsoWeekAs,
  isoWeekKey,
  lastCompletedWeekRef,
  summarizeLogs,
  summarizeLogsForWeek,
};
