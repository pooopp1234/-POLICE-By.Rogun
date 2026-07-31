const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite"); // มากับ Node.js เอง (Node 22.5+) ไม่ต้องคอมไพล์ native module

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.resolve(process.cwd(), "data/duty.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS members (
  discord_id TEXT PRIMARY KEY,
  discord_name TEXT,
  game_name TEXT,
  department TEXT,
  position TEXT,
  registered_at TEXT
);

CREATE TABLE IF NOT EXISTS duty_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT,
  name TEXT,
  date TEXT,
  check_in TEXT,
  check_out TEXT,
  hours REAL,
  status TEXT
);

CREATE TABLE IF NOT EXISTS summary (
  discord_id TEXT PRIMARY KEY,
  name TEXT,
  hours_today REAL,
  hours_week REAL,
  hours_month REAL,
  duty_count INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS duty_panel (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  channel_id TEXT,
  message_id TEXT
);

CREATE TABLE IF NOT EXISTS roster_panel (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  channel_id TEXT,
  message_id TEXT
);

CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// ---------- แปลงชื่อคอลัมน์ snake_case (ในฐานข้อมูล) <-> camelCase (ที่ไฟล์คำสั่งใช้อยู่เดิม) ----------
// ทำแบบนี้เพื่อให้ src/commands/**/*.js ทุกไฟล์เรียกใช้ฟังก์ชันด้วยชื่อ field เดิมทุกตัว
// ไม่ต้องแก้ logic ในไฟล์คำสั่งเลย นอกจากเปลี่ยน require จาก "../utils/sheets" เป็น "../utils/db"

function rowToMember(row) {
  if (!row) return null;
  return {
    discordId: row.discord_id,
    discordName: row.discord_name,
    gameName: row.game_name,
    department: row.department,
    position: row.position,
    registeredAt: row.registered_at,
  };
}

function rowToDuty(row) {
  if (!row) return null;
  return {
    _rowNumber: row.id, // ใช้ id ของ SQLite แทนเลขแถวใน Google Sheets
    discordId: row.discord_id,
    name: row.name,
    date: row.date,
    checkIn: row.check_in,
    checkOut: row.check_out ?? "-",
    hours: row.hours ?? "",
    status: row.status,
  };
}

// ---------- Members ----------

async function findMember(discordId) {
  const row = db.prepare("SELECT * FROM members WHERE discord_id = ?").get(discordId);
  return rowToMember(row);
}

async function addMember(data) {
  db.prepare(
    `INSERT INTO members (discord_id, discord_name, game_name, department, position, registered_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    data.discordId,
    data.discordName,
    data.gameName,
    data.department ?? null,
    data.position,
    data.registeredAt
  );
}

async function getAllMembers() {
  const rows = db.prepare("SELECT * FROM members ORDER BY game_name COLLATE NOCASE").all();
  return rows.map(rowToMember);
}

async function updateMemberPosition(discordId, position) {
  const result = db.prepare("UPDATE members SET position = ? WHERE discord_id = ?").run(position, discordId);
  return result.changes > 0;
}

// ---------- Duty Log ----------

async function getDutyLogs(discordId = null) {
  const rows = discordId
    ? db.prepare("SELECT * FROM duty_log WHERE discord_id = ? ORDER BY id").all(discordId)
    : db.prepare("SELECT * FROM duty_log ORDER BY id").all();
  return rows.map(rowToDuty);
}

async function findOpenDuty(discordId) {
  const row = db
    .prepare("SELECT * FROM duty_log WHERE discord_id = ? AND status = 'เข้าเวร' ORDER BY id DESC LIMIT 1")
    .get(discordId);
  return rowToDuty(row);
}

async function getAllOpenDuty() {
  const rows = db.prepare("SELECT * FROM duty_log WHERE status = 'เข้าเวร' ORDER BY id").all();
  return rows.map(rowToDuty);
}

async function addCheckIn(data) {
  db.prepare(
    `INSERT INTO duty_log (discord_id, name, date, check_in, check_out, hours, status)
     VALUES (?, ?, ?, ?, NULL, NULL, 'เข้าเวร')`
  ).run(data.discordId, data.name, data.date, data.checkIn);
}

async function setCheckOut(rowNumber, checkOutIso, hours) {
  db.prepare("UPDATE duty_log SET check_out = ?, hours = ?, status = 'ออกเวร' WHERE id = ?").run(
    checkOutIso,
    hours,
    rowNumber
  );
}

async function clearDutyStatus(discordId) {
  const open = await findOpenDuty(discordId);
  if (!open) return false;
  db.prepare("UPDATE duty_log SET status = 'ล้างแล้ว (แอดมิน)' WHERE id = ?").run(open._rowNumber);
  return true;
}

async function editDutyTime(rowNumber, checkInIso, checkOutIso, hours) {
  if (checkOutIso) {
    db.prepare("UPDATE duty_log SET check_in = ?, check_out = ?, hours = ? WHERE id = ?").run(
      checkInIso,
      checkOutIso,
      hours,
      rowNumber
    );
  } else {
    db.prepare("UPDATE duty_log SET check_in = ? WHERE id = ?").run(checkInIso, rowNumber);
  }
}

async function addManualAdjustment(discordId, name, hoursDelta, note, dateStr) {
  // บันทึกเป็นแถวพิเศษใน duty_log เพื่อให้นับรวมชั่วโมงอัตโนมัติโดยไม่ต้องแก้ยอดตรงๆ
  db.prepare(
    `INSERT INTO duty_log (discord_id, name, date, check_in, check_out, hours, status)
     VALUES (?, ?, ?, '-', '-', ?, ?)`
  ).run(
    discordId,
    name,
    dateStr,
    hoursDelta,
    hoursDelta >= 0 ? `ปรับเพิ่ม (${note || "-"})` : `ปรับลด (${note || "-"})`
  );
}

// ---------- Summary ----------

async function writeSummaryRow(dataObj) {
  db.prepare(
    `INSERT INTO summary (discord_id, name, hours_today, hours_week, hours_month, duty_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET
       name = excluded.name,
       hours_today = excluded.hours_today,
       hours_week = excluded.hours_week,
       hours_month = excluded.hours_month,
       duty_count = excluded.duty_count,
       updated_at = excluded.updated_at`
  ).run(
    dataObj.discordId,
    dataObj.name,
    dataObj.hoursToday,
    dataObj.hoursWeek,
    dataObj.hoursMonth,
    dataObj.dutyCount,
    dataObj.updatedAt
  );
}

// ---------- Export (ใช้โดยคำสั่ง /ส่งออกข้อมูล แทนการเปิดดู Google Sheets) ----------

function toCsv(rows, columns) {
  const escape = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.join(",");
  const lines = rows.map((r) => columns.map((c) => escape(r[c])).join(","));
  return [header, ...lines].join("\n");
}

function exportAllCsv() {
  const members = db.prepare("SELECT * FROM members").all();
  const dutyLog = db.prepare("SELECT * FROM duty_log").all();
  const summary = db.prepare("SELECT * FROM summary").all();

  return {
    members: toCsv(members, [
      "discord_id",
      "discord_name",
      "game_name",
      "department",
      "position",
      "registered_at",
    ]),
    dutyLog: toCsv(dutyLog, [
      "id",
      "discord_id",
      "name",
      "date",
      "check_in",
      "check_out",
      "hours",
      "status",
    ]),
    summary: toCsv(summary, [
      "discord_id",
      "name",
      "hours_today",
      "hours_week",
      "hours_month",
      "duty_count",
      "updated_at",
    ]),
  };
}

// ---------- Duty Panel (ปุ่มเข้าเวร/ออกเวรแบบข้อความปักหมุด) ----------

async function getPanelMessage() {
  const row = db.prepare("SELECT channel_id, message_id FROM duty_panel WHERE id = 1").get();
  if (!row) return null;
  return { channelId: row.channel_id, messageId: row.message_id };
}

async function setPanelMessage(channelId, messageId) {
  db.prepare(
    `INSERT INTO duty_panel (id, channel_id, message_id) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`
  ).run(channelId, messageId);
}

// ---------- Roster Panel (ห้องรายชื่อ) ----------

async function getRosterPanel() {
  const row = db.prepare("SELECT channel_id, message_id FROM roster_panel WHERE id = 1").get();
  if (!row) return null;
  return { channelId: row.channel_id, messageId: row.message_id };
}

async function setRosterPanel(channelId, messageId) {
  db.prepare(
    `INSERT INTO roster_panel (id, channel_id, message_id) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`
  ).run(channelId, messageId);
}

// ---------- Bot State (เก็บค่า key-value เล็กๆ เช่น สัปดาห์ล่าสุดที่ระบบสรุป/รีเซ็ตรายสัปดาห์ทำงานไปแล้ว) ----------

async function getState(key) {
  const row = db.prepare("SELECT value FROM bot_state WHERE key = ?").get(key);
  return row ? row.value : null;
}

async function setState(key, value) {
  db.prepare(
    `INSERT INTO bot_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

module.exports = {
  findMember,
  addMember,
  getAllMembers,
  updateMemberPosition,
  getDutyLogs,
  findOpenDuty,
  getAllOpenDuty,
  addCheckIn,
  setCheckOut,
  clearDutyStatus,
  editDutyTime,
  addManualAdjustment,
  writeSummaryRow,
  exportAllCsv,
  getPanelMessage,
  setPanelMessage,
  getRosterPanel,
  setRosterPanel,
  getState,
  setState,
};
