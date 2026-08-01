const path = require("path");
const fs = require("fs");
const { createClient } = require("@libsql/client");

// ถ้าตั้งค่า TURSO_DATABASE_URL ไว้ (env var) จะต่อไปที่ฐานข้อมูล Turso บนคลาวด์ (ข้อมูลอยู่ถาวร ไม่หายตอน deploy/restart)
// ถ้าไม่ตั้งไว้ จะ fallback ไปใช้ไฟล์ SQLite ในเครื่อง (เหมาะกับตอนพัฒนา/ทดสอบในเครื่องตัวเอง)
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

const LOCAL_DB_PATH = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.resolve(process.cwd(), "data/duty.db");

if (!TURSO_URL) {
  fs.mkdirSync(path.dirname(LOCAL_DB_PATH), { recursive: true });
}

const client = TURSO_URL
  ? createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })
  : createClient({ url: `file:${LOCAL_DB_PATH}` });

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS members (
    discord_id TEXT PRIMARY KEY,
    discord_name TEXT,
    game_name TEXT,
    department TEXT,
    position TEXT,
    registered_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS duty_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT,
    name TEXT,
    date TEXT,
    check_in TEXT,
    check_out TEXT,
    hours REAL,
    status TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS summary (
    discord_id TEXT PRIMARY KEY,
    name TEXT,
    hours_today REAL,
    hours_week REAL,
    hours_month REAL,
    duty_count INTEGER,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS duty_panel (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    channel_id TEXT,
    message_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS roster_panel (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    channel_id TEXT,
    message_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS bot_state (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
];

const ready = (async () => {
  if (!TURSO_URL) {
    await client.execute("PRAGMA journal_mode = WAL;");
  }
  for (const stmt of SCHEMA_STATEMENTS) {
    await client.execute(stmt);
  }
  console.log(
    TURSO_URL
      ? "[db] เชื่อมต่อ Turso (คลาวด์) เรียบร้อย — ข้อมูลจะไม่หายตอน deploy/restart"
      : "[db] ใช้ไฟล์ SQLite ในเครื่อง (local) — ตั้ง TURSO_DATABASE_URL ถ้าต้องการเก็บถาวรบน Render"
  );
})();

// ---------- แปลงชื่อคอลัมน์ snake_case (ในฐานข้อมูล) <-> camelCase (ที่ไฟล์คำสั่งใช้อยู่เดิม) ----------

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
    _rowNumber: row.id,
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
  await ready;
  const { rows } = await client.execute({
    sql: "SELECT * FROM members WHERE discord_id = ?",
    args: [discordId],
  });
  return rowToMember(rows[0]);
}

async function addMember(data) {
  await ready;
  await client.execute({
    sql: `INSERT INTO members (discord_id, discord_name, game_name, department, position, registered_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      data.discordId,
      data.discordName,
      data.gameName,
      data.department ?? null,
      data.position,
      data.registeredAt,
    ],
  });
}

async function getAllMembers() {
  await ready;
  const { rows } = await client.execute("SELECT * FROM members ORDER BY game_name COLLATE NOCASE");
  return rows.map(rowToMember);
}

async function updateMemberPosition(discordId, position) {
  await ready;
  const result = await client.execute({
    sql: "UPDATE members SET position = ? WHERE discord_id = ?",
    args: [position, discordId],
  });
  return Number(result.rowsAffected) > 0;
}

// ---------- Duty Log ----------

async function getDutyLogs(discordId = null) {
  await ready;
  const { rows } = discordId
    ? await client.execute({ sql: "SELECT * FROM duty_log WHERE discord_id = ? ORDER BY id", args: [discordId] })
    : await client.execute("SELECT * FROM duty_log ORDER BY id");
  return rows.map(rowToDuty);
}

async function findOpenDuty(discordId) {
  await ready;
  const { rows } = await client.execute({
    sql: "SELECT * FROM duty_log WHERE discord_id = ? AND status = 'เข้าเวร' ORDER BY id DESC LIMIT 1",
    args: [discordId],
  });
  return rowToDuty(rows[0]);
}

async function getAllOpenDuty() {
  await ready;
  const { rows } = await client.execute("SELECT * FROM duty_log WHERE status = 'เข้าเวร' ORDER BY id");
  return rows.map(rowToDuty);
}

async function addCheckIn(data) {
  await ready;
  await client.execute({
    sql: `INSERT INTO duty_log (discord_id, name, date, check_in, check_out, hours, status)
          VALUES (?, ?, ?, ?, NULL, NULL, 'เข้าเวร')`,
    args: [data.discordId, data.name, data.date, data.checkIn],
  });
}

async function setCheckOut(rowNumber, checkOutIso, hours) {
  await ready;
  await client.execute({
    sql: "UPDATE duty_log SET check_out = ?, hours = ?, status = 'ออกเวร' WHERE id = ?",
    args: [checkOutIso, hours, rowNumber],
  });
}

async function clearDutyStatus(discordId) {
  await ready;
  const open = await findOpenDuty(discordId);
  if (!open) return false;
  await client.execute({
    sql: "UPDATE duty_log SET status = 'ล้างแล้ว (แอดมิน)' WHERE id = ?",
    args: [open._rowNumber],
  });
  return true;
}

async function editDutyTime(rowNumber, checkInIso, checkOutIso, hours) {
  await ready;
  if (checkOutIso) {
    await client.execute({
      sql: "UPDATE duty_log SET check_in = ?, check_out = ?, hours = ? WHERE id = ?",
      args: [checkInIso, checkOutIso, hours, rowNumber],
    });
  } else {
    await client.execute({
      sql: "UPDATE duty_log SET check_in = ? WHERE id = ?",
      args: [checkInIso, rowNumber],
    });
  }
}

async function addManualAdjustment(discordId, name, hoursDelta, note, dateStr) {
  await ready;
  await client.execute({
    sql: `INSERT INTO duty_log (discord_id, name, date, check_in, check_out, hours, status)
          VALUES (?, ?, ?, '-', '-', ?, ?)`,
    args: [
      discordId,
      name,
      dateStr,
      hoursDelta,
      hoursDelta >= 0 ? `ปรับเพิ่ม (${note || "-"})` : `ปรับลด (${note || "-"})`,
    ],
  });
}

// ---------- Summary ----------

async function writeSummaryRow(dataObj) {
  await ready;
  await client.execute({
    sql: `INSERT INTO summary (discord_id, name, hours_today, hours_week, hours_month, duty_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(discord_id) DO UPDATE SET
            name = excluded.name,
            hours_today = excluded.hours_today,
            hours_week = excluded.hours_week,
            hours_month = excluded.hours_month,
            duty_count = excluded.duty_count,
            updated_at = excluded.updated_at`,
    args: [
      dataObj.discordId,
      dataObj.name,
      dataObj.hoursToday,
      dataObj.hoursWeek,
      dataObj.hoursMonth,
      dataObj.dutyCount,
      dataObj.updatedAt,
    ],
  });
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

async function exportAllCsv() {
  await ready;
  const [membersRes, dutyLogRes, summaryRes] = await Promise.all([
    client.execute("SELECT * FROM members"),
    client.execute("SELECT * FROM duty_log"),
    client.execute("SELECT * FROM summary"),
  ]);

  return {
    members: toCsv(membersRes.rows, [
      "discord_id",
      "discord_name",
      "game_name",
      "department",
      "position",
      "registered_at",
    ]),
    dutyLog: toCsv(dutyLogRes.rows, [
      "id",
      "discord_id",
      "name",
      "date",
      "check_in",
      "check_out",
      "hours",
      "status",
    ]),
    summary: toCsv(summaryRes.rows, [
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
  await ready;
  const { rows } = await client.execute("SELECT channel_id, message_id FROM duty_panel WHERE id = 1");
  if (!rows[0]) return null;
  return { channelId: rows[0].channel_id, messageId: rows[0].message_id };
}

async function setPanelMessage(channelId, messageId) {
  await ready;
  await client.execute({
    sql: `INSERT INTO duty_panel (id, channel_id, message_id) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`,
    args: [channelId, messageId],
  });
}

// ---------- Roster Panel (ห้องรายชื่อ) ----------

async function getRosterPanel() {
  await ready;
  const { rows } = await client.execute("SELECT channel_id, message_id FROM roster_panel WHERE id = 1");
  if (!rows[0]) return null;
  return { channelId: rows[0].channel_id, messageId: rows[0].message_id };
}

async function setRosterPanel(channelId, messageId) {
  await ready;
  await client.execute({
    sql: `INSERT INTO roster_panel (id, channel_id, message_id) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`,
    args: [channelId, messageId],
  });
}

// ---------- Bot State ----------

async function getState(key) {
  await ready;
  const { rows } = await client.execute({ sql: "SELECT value FROM bot_state WHERE key = ?", args: [key] });
  return rows[0] ? rows[0].value : null;
}

async function setState(key, value) {
  await ready;
  await client.execute({
    sql: `INSERT INTO bot_state (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  });
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
