const dayjs = require("dayjs");
const {
  ActionRowBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
} = require("discord.js");
const db = require("../utils/db");
const time = require("../utils/time");
const embeds = require("../utils/embeds");
const roster = require("../utils/roster");
const panel = require("../utils/panel");
const config = require("../../config.json");
const { sendLog } = require("../utils/permissions");

// เก็บสถานะชั่วคราวระหว่างขั้นตอนหลายสเต็ป (เฉพาะ "เพิ่มสมาชิก" และ "แก้ไขตำแหน่ง" ที่ต้องเลือกตำแหน่งต่อจาก modal)
// key = discord user id ของแอดมินที่กำลังทำรายการ, จะถูกลบทิ้งทันทีที่ใช้เสร็จ
const pendingRegister = new Map(); // adminId -> { discordId, discordTag, gameName }
const pendingSetPosition = new Map(); // adminId -> discordId

// ---------- Helper: ตัวเลือกตำแหน่งแบบ select menu ----------
function positionSelectRow(customId) {
  const select = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder("เลือกตำแหน่ง");
  for (const pos of config.positions) {
    select.addOptions({ label: pos, value: pos });
  }
  return new ActionRowBuilder().addComponents(select);
}

function userSelectRow(customId, placeholder) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1)
  );
}

// ---------- ปุ่ม: ข้อมูล (ไม่ต้องขอข้อมูลเพิ่ม) ----------

async function handleOnDuty(interaction) {
  await interaction.deferReply();
  const openList = await db.getAllOpenDuty();
  if (openList.length === 0) {
    return interaction.editReply({
      embeds: [embeds.adminActionEmbed("🟢 คนเข้าเวรตอนนี้", "ไม่มีใครกำลังเข้าเวรอยู่")],
    });
  }
  const fields = openList.map((r) => ({ name: r.name, value: `เข้าเวรเมื่อ: ${time.displayDateTime(r.checkIn)}` }));
  await interaction.editReply({
    embeds: [embeds.adminActionEmbed("🟢 คนเข้าเวรตอนนี้", `รวม ${openList.length} คน`, fields)],
  });
}

async function handleSummary(interaction) {
  await interaction.deferReply();

  const allLogs = await db.getDutyLogs();
  const byMember = {};
  for (const log of allLogs) {
    if (!byMember[log.discordId]) byMember[log.discordId] = [];
    byMember[log.discordId].push(log);
  }

  const rows = [];
  for (const [discordId, logs] of Object.entries(byMember)) {
    const summary = time.summarizeLogs(logs);
    if (summary.hoursWeek === 0 && summary.dutyCount === 0) continue;
    const name = logs[0]?.name || discordId;

    await db.writeSummaryRow({
      discordId,
      name,
      hoursToday: summary.hoursToday,
      hoursWeek: summary.hoursWeek,
      hoursMonth: summary.hoursMonth,
      dutyCount: summary.dutyCount,
      updatedAt: time.nowIso(),
    });

    rows.push({ name, ...summary });
  }

  if (rows.length === 0) {
    return interaction.editReply({
      embeds: [embeds.adminActionEmbed("📊 สรุปสัปดาห์นี้", "ยังไม่มีข้อมูลการเข้าเวรในสัปดาห์นี้")],
    });
  }

  rows.sort((a, b) => b.hoursWeek - a.hoursWeek);
  const fields = rows.slice(0, 25).map((r) => ({
    name: r.name,
    value: `${r.hoursWeek} ชม. (${r.dutyCount} ครั้ง)`,
    inline: true,
  }));

  await interaction.editReply({
    embeds: [embeds.adminActionEmbed("📊 สรุปสัปดาห์นี้", `อัปเดตข้อมูลลงฐานข้อมูล Summary แล้ว (${rows.length} คน) — ระบบจะสรุปและรีเซ็ตยอดรายสัปดาห์อัตโนมัติทุกต้นสัปดาห์`, fields)],
  });
}

async function handleExport(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const { members, dutyLog, summary } = db.exportAllCsv();
  const files = [
    new AttachmentBuilder(Buffer.from(members, "utf-8"), { name: "members.csv" }),
    new AttachmentBuilder(Buffer.from(dutyLog, "utf-8"), { name: "duty_log.csv" }),
    new AttachmentBuilder(Buffer.from(summary, "utf-8"), { name: "summary.csv" }),
  ];
  await interaction.editReply({
    embeds: [embeds.successEmbed("ส่งออกข้อมูลทั้ง 3 ตารางเรียบร้อยแล้ว (แนบไฟล์ด้านล่าง)")],
    files,
  });
}

async function handlePostDutyPanel(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await panel.postPanel(interaction.channel);
  await interaction.editReply({
    embeds: [embeds.successEmbed("โพสต์แผงเข้าเวรในห้องนี้เรียบร้อยแล้ว")],
  });
}

async function handlePostRoster(interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    await roster.postRoster(interaction.channel);
  } catch (err) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed(`โพสต์รายชื่อไม่สำเร็จ: ${err.message || "ไม่ทราบสาเหตุ"}`)],
    });
  }
  await interaction.editReply({ embeds: [embeds.successEmbed("โพสต์รายชื่อในห้องนี้เรียบร้อยแล้ว")] });
}

// ---------- ปุ่ม: ต้องเลือกสมาชิกก่อน (เปิด user select menu) ----------

const USER_SELECT_META = {
  ap_addhours: { customId: "ap_select_addhours", placeholder: "เลือกสมาชิกที่จะเพิ่มชั่วโมง" },
  ap_subhours: { customId: "ap_select_subhours", placeholder: "เลือกสมาชิกที่จะลดชั่วโมง" },
  ap_edittime: { customId: "ap_select_edittime", placeholder: "เลือกสมาชิกที่จะแก้เวลา" },
  ap_clearduty: { customId: "ap_select_clearduty", placeholder: "เลือกสมาชิกที่จะล้างสถานะเวร" },
};

async function handleAskUser(interaction, buttonId) {
  const meta = USER_SELECT_META[buttonId];
  await interaction.reply({
    content: "เลือกสมาชิกจากเมนูด้านล่าง:",
    components: [userSelectRow(meta.customId, meta.placeholder)],
    ephemeral: true,
  });
}

// ---------- ปุ่ม: เปิด modal ทันที ----------

function registerModal() {
  const modal = new ModalBuilder().setCustomId("ap_modal_register").setTitle("เพิ่มสมาชิกใหม่");
  const idInput = new TextInputBuilder()
    .setCustomId("discordId")
    .setLabel("Discord ID (ตัวเลขล้วน 17-20 หลัก)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const nameInput = new TextInputBuilder()
    .setCustomId("gameName")
    .setLabel("ชื่อสมาชิก")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(idInput), new ActionRowBuilder().addComponents(nameInput));
  return modal;
}

function setPositionModal() {
  const modal = new ModalBuilder().setCustomId("ap_modal_setposition").setTitle("แก้ไขตำแหน่งสมาชิก");
  const idInput = new TextInputBuilder()
    .setCustomId("discordId")
    .setLabel("Discord ID ของสมาชิก (ตัวเลขล้วน)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(idInput));
  return modal;
}

// ---------- ปุ่มหลัก ----------

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === "ap_onduty") return handleOnDuty(interaction);
  if (id === "ap_summary") return handleSummary(interaction);
  if (id === "ap_export") return handleExport(interaction);
  if (id === "ap_postdutypanel") return handlePostDutyPanel(interaction);
  if (id === "ap_postroster") return handlePostRoster(interaction);
  if (id in USER_SELECT_META) return handleAskUser(interaction, id);
  if (id === "ap_register") return interaction.showModal(registerModal());
  if (id === "ap_setposition") return interaction.showModal(setPositionModal());
}

// ---------- User select menu (ขั้นตอนที่ 2 ของ เพิ่ม/ลดชั่วโมง, แก้เวลา, ล้างสถานะเวร) ----------

function addHoursModal(targetId) {
  const modal = new ModalBuilder().setCustomId(`ap_modal_addhours:${targetId}`).setTitle("เพิ่มชั่วโมงเวร");
  const hoursInput = new TextInputBuilder()
    .setCustomId("hours")
    .setLabel("จำนวนชั่วโมงที่ต้องการเพิ่ม")
    .setPlaceholder("เช่น 2.5")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("เหตุผล (ถ้ามี)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(hoursInput), new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

function subHoursModal(targetId) {
  const modal = new ModalBuilder().setCustomId(`ap_modal_subhours:${targetId}`).setTitle("ลดชั่วโมงเวร");
  const hoursInput = new TextInputBuilder()
    .setCustomId("hours")
    .setLabel("จำนวนชั่วโมงที่ต้องการลด")
    .setPlaceholder("เช่น 1")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("เหตุผล (ถ้ามี)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(hoursInput), new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

function editTimeModal(targetId) {
  const modal = new ModalBuilder().setCustomId(`ap_modal_edittime:${targetId}`).setTitle("แก้เวลาเข้า/ออกเวร");
  const dateInput = new TextInputBuilder()
    .setCustomId("date")
    .setLabel("วันที่ของรายการเวร (YYYY-MM-DD)")
    .setPlaceholder("เช่น 2026-07-29")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const checkInInput = new TextInputBuilder()
    .setCustomId("checkIn")
    .setLabel("เวลาเข้าใหม่ (HH:mm)")
    .setPlaceholder("เช่น 20:00")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const checkOutInput = new TextInputBuilder()
    .setCustomId("checkOut")
    .setLabel("เวลาออกใหม่ (HH:mm) เว้นว่างได้ถ้ายังไม่ออกเวร")
    .setPlaceholder("เช่น 23:30")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  modal.addComponents(
    new ActionRowBuilder().addComponents(dateInput),
    new ActionRowBuilder().addComponents(checkInInput),
    new ActionRowBuilder().addComponents(checkOutInput)
  );
  return modal;
}

async function handleSelectClearDuty(interaction) {
  const targetId = interaction.values[0];
  await interaction.deferUpdate();

  const target = await interaction.client.users.fetch(targetId).catch(() => null);
  const cleared = await db.clearDutyStatus(targetId);

  if (!cleared) {
    return interaction.editReply({
      content: null,
      embeds: [embeds.errorEmbed(`${target?.tag || targetId} ไม่มีสถานะเข้าเวรค้างอยู่`)],
      components: [],
    });
  }

  const embed = embeds.adminActionEmbed("🧹 ล้างสถานะเข้าเวร", `ล้างสถานะเข้าเวรของ ${target?.tag || targetId} เรียบร้อย`, [
    { name: "ดำเนินการโดย", value: interaction.user.tag },
  ]);

  await interaction.editReply({ content: null, embeds: [embed], components: [] });
  await sendLog(interaction.client, "แอดมิน", embed);
  await panel.refreshPanel(interaction.client);
}

async function handleUserSelect(interaction) {
  const id = interaction.customId;
  const targetId = interaction.values[0];

  if (id === "ap_select_addhours") return interaction.showModal(addHoursModal(targetId));
  if (id === "ap_select_subhours") return interaction.showModal(subHoursModal(targetId));
  if (id === "ap_select_edittime") return interaction.showModal(editTimeModal(targetId));
  if (id === "ap_select_clearduty") return handleSelectClearDuty(interaction);
}

// ---------- String select menu (ขั้นตอนเลือกตำแหน่งของ "เพิ่มสมาชิก" / "แก้ไขตำแหน่ง") ----------

async function handleSelectRegPosition(interaction) {
  const pending = pendingRegister.get(interaction.user.id);
  if (!pending) {
    return interaction.update({ content: "หมดเวลาการเพิ่มสมาชิก กรุณากดปุ่ม \"เพิ่มสมาชิก\" ใหม่อีกครั้ง", components: [] });
  }
  pendingRegister.delete(interaction.user.id);
  const position = interaction.values[0];
  await interaction.deferUpdate();

  const data = {
    discordId: pending.discordId,
    discordName: pending.discordTag,
    gameName: pending.gameName,
    position,
    registeredAt: time.nowIso(),
  };

  await db.addMember(data);
  await roster.refreshRoster(interaction.client);

  await interaction.editReply({
    content: null,
    embeds: [embeds.successEmbed(`เพิ่มสมาชิก ${pending.discordTag} สำเร็จ! ตอนนี้สามารถกดปุ่ม "เข้าเวร" ได้แล้ว`)],
    components: [],
  });

  await sendLog(interaction.client, "สมัคร", embeds.registerEmbed({ ...data, addedBy: interaction.user.tag }));
}

async function handleSelectSetPosition(interaction) {
  const discordId = pendingSetPosition.get(interaction.user.id);
  if (!discordId) {
    return interaction.update({ content: "หมดเวลาการแก้ไขตำแหน่ง กรุณากดปุ่ม \"แก้ไขตำแหน่ง\" ใหม่อีกครั้ง", components: [] });
  }
  pendingSetPosition.delete(interaction.user.id);
  const position = interaction.values[0];
  await interaction.deferUpdate();

  const existing = await db.findMember(discordId);
  if (!existing) {
    return interaction.editReply({
      content: null,
      embeds: [embeds.errorEmbed("ไม่พบสมาชิกไอดีนี้ในระบบแล้ว (อาจถูกลบไปก่อนหน้านี้)")],
      components: [],
    });
  }

  await db.updateMemberPosition(discordId, position);
  await roster.refreshRoster(interaction.client);

  await interaction.editReply({
    content: null,
    embeds: [
      embeds.successEmbed(`เปลี่ยนตำแหน่งของ ${existing.gameName} (${existing.discordName}) เป็น "${position}" เรียบร้อยแล้ว`),
    ],
    components: [],
  });

  await sendLog(
    interaction.client,
    "แอดมิน",
    embeds.adminActionEmbed("🎖️ เปลี่ยนตำแหน่ง", `แอดมิน ${interaction.user.tag} เปลี่ยนตำแหน่งสมาชิก`, [
      { name: "สมาชิก", value: `${existing.gameName} (${existing.discordName})`, inline: true },
      { name: "ตำแหน่งใหม่", value: position, inline: true },
    ])
  );
}

async function handleStringSelect(interaction) {
  const id = interaction.customId;
  if (id === "ap_select_regposition") return handleSelectRegPosition(interaction);
  if (id === "ap_select_setposition") return handleSelectSetPosition(interaction);
}

// ---------- Modal submit ----------

async function handleModalAddHours(interaction, targetId) {
  await interaction.deferReply({ ephemeral: true });

  const amount = parseFloat(interaction.fields.getTextInputValue("hours"));
  const reason = interaction.fields.getTextInputValue("reason");

  if (!Number.isFinite(amount) || amount <= 0) {
    return interaction.editReply({ embeds: [embeds.errorEmbed("จำนวนชั่วโมงต้องเป็นตัวเลขมากกว่า 0")] });
  }

  const target = await interaction.client.users.fetch(targetId).catch(() => null);
  if (!target) {
    return interaction.editReply({ embeds: [embeds.errorEmbed("ไม่พบผู้ใช้ Discord รายนี้")] });
  }

  const member = await db.findMember(target.id);
  if (!member) {
    return interaction.editReply({ embeds: [embeds.errorEmbed(`${target.tag} ยังไม่ได้สมัครสมาชิกในระบบ`)] });
  }

  await db.addManualAdjustment(target.id, member.gameName, amount, reason, time.todayStr());

  const embed = embeds.adminActionEmbed("➕ เพิ่มชั่วโมงเวร", `เพิ่ม ${amount} ชั่วโมงให้ ${target.tag}`, [
    { name: "เหตุผล", value: reason || "-", inline: true },
    { name: "ดำเนินการโดย", value: interaction.user.tag, inline: true },
  ]);

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.client, "แอดมิน", embed);
}

async function handleModalSubHours(interaction, targetId) {
  await interaction.deferReply({ ephemeral: true });

  const amount = parseFloat(interaction.fields.getTextInputValue("hours"));
  const reason = interaction.fields.getTextInputValue("reason");

  if (!Number.isFinite(amount) || amount <= 0) {
    return interaction.editReply({ embeds: [embeds.errorEmbed("จำนวนชั่วโมงต้องเป็นตัวเลขมากกว่า 0")] });
  }

  const target = await interaction.client.users.fetch(targetId).catch(() => null);
  if (!target) {
    return interaction.editReply({ embeds: [embeds.errorEmbed("ไม่พบผู้ใช้ Discord รายนี้")] });
  }

  const member = await db.findMember(target.id);
  if (!member) {
    return interaction.editReply({ embeds: [embeds.errorEmbed(`${target.tag} ยังไม่ได้สมัครสมาชิกในระบบ`)] });
  }

  await db.addManualAdjustment(target.id, member.gameName, -amount, reason, time.todayStr());

  const embed = embeds.adminActionEmbed("➖ ลดชั่วโมงเวร", `ลด ${amount} ชั่วโมงจาก ${target.tag}`, [
    { name: "เหตุผล", value: reason || "-", inline: true },
    { name: "ดำเนินการโดย", value: interaction.user.tag, inline: true },
  ]);

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.client, "แอดมิน", embed);
}

async function handleModalEditTime(interaction, targetId) {
  await interaction.deferReply({ ephemeral: true });

  const dateStr = interaction.fields.getTextInputValue("date").trim();
  const checkInStr = interaction.fields.getTextInputValue("checkIn").trim();
  const checkOutStr = interaction.fields.getTextInputValue("checkOut").trim();

  if (!dayjs(dateStr, "YYYY-MM-DD", true).isValid()) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed("รูปแบบวันที่ไม่ถูกต้อง ใช้รูปแบบ YYYY-MM-DD เช่น 2026-07-29")],
    });
  }

  const target = await interaction.client.users.fetch(targetId).catch(() => null);
  if (!target) {
    return interaction.editReply({ embeds: [embeds.errorEmbed("ไม่พบผู้ใช้ Discord รายนี้")] });
  }

  const logs = await db.getDutyLogs(target.id);
  const matches = logs.filter((r) => r.date === dateStr);
  if (matches.length === 0) {
    return interaction.editReply({ embeds: [embeds.errorEmbed(`ไม่พบรายการเวรของ ${target.tag} ในวันที่ ${dateStr}`)] });
  }
  const targetRow = matches[matches.length - 1];

  const newCheckIn = dayjs.tz(`${dateStr} ${checkInStr}`, "YYYY-MM-DD HH:mm", time.TZ).toISOString();
  let newCheckOut = null;
  let hours = targetRow.hours;

  if (checkOutStr) {
    let checkOutDate = dayjs.tz(`${dateStr} ${checkOutStr}`, "YYYY-MM-DD HH:mm", time.TZ);
    if (checkOutDate.isBefore(dayjs(newCheckIn))) {
      checkOutDate = checkOutDate.add(1, "day");
    }
    newCheckOut = checkOutDate.toISOString();
    hours = time.hoursBetween(newCheckIn, newCheckOut);
  }

  await db.editDutyTime(targetRow._rowNumber, newCheckIn, newCheckOut, hours);

  const embed = embeds.adminActionEmbed("✏️ แก้ไขเวลาเวร", `แก้ไขรายการเวรของ ${target.tag} วันที่ ${dateStr}`, [
    { name: "เวลาเข้าใหม่", value: time.displayDateTime(newCheckIn), inline: true },
    { name: "เวลาออกใหม่", value: newCheckOut ? time.displayDateTime(newCheckOut) : "ไม่เปลี่ยนแปลง", inline: true },
    { name: "ดำเนินการโดย", value: interaction.user.tag },
  ]);

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.client, "แอดมิน", embed);
}

async function handleModalRegister(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const discordId = interaction.fields.getTextInputValue("discordId").trim();
  const gameName = interaction.fields.getTextInputValue("gameName").trim();

  if (!/^\d{17,20}$/.test(discordId)) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed("ไอดีดิสคอร์ดไม่ถูกต้อง กรุณาใส่เฉพาะตัวเลข (17-20 หลัก)")],
    });
  }

  let target;
  try {
    target = await interaction.client.users.fetch(discordId);
  } catch {
    return interaction.editReply({ embeds: [embeds.errorEmbed("ไม่พบผู้ใช้ Discord ที่ไอดีนี้ กรุณาตรวจสอบไอดีอีกครั้ง")] });
  }

  const existing = await db.findMember(target.id);
  if (existing) {
    return interaction.editReply({ embeds: [embeds.errorEmbed(`${target.tag} มีอยู่ในระบบแล้ว ไม่สามารถเพิ่มซ้ำได้`)] });
  }

  pendingRegister.set(interaction.user.id, { discordId: target.id, discordTag: target.tag, gameName });

  await interaction.editReply({
    content: `เลือกตำแหน่งของ **${gameName}** (${target.tag}):`,
    components: [positionSelectRow("ap_select_regposition")],
  });
}

async function handleModalSetPosition(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const discordId = interaction.fields.getTextInputValue("discordId").trim();

  if (!/^\d{17,20}$/.test(discordId)) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed("ไอดีดิสคอร์ดไม่ถูกต้อง กรุณาใส่เฉพาะตัวเลข (17-20 หลัก)")],
    });
  }

  const existing = await db.findMember(discordId);
  if (!existing) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed("ไม่พบสมาชิกไอดีนี้ในระบบ กรุณาเพิ่มสมาชิกด้วยปุ่ม \"เพิ่มสมาชิก\" ก่อน")],
    });
  }

  pendingSetPosition.set(interaction.user.id, discordId);

  await interaction.editReply({
    content: `เลือกตำแหน่งใหม่ของ **${existing.gameName}** (${existing.discordName}):`,
    components: [positionSelectRow("ap_select_setposition")],
  });
}

async function handleModalSubmit(interaction) {
  const [action, targetId] = interaction.customId.split(":");

  if (action === "ap_modal_addhours") return handleModalAddHours(interaction, targetId);
  if (action === "ap_modal_subhours") return handleModalSubHours(interaction, targetId);
  if (action === "ap_modal_edittime") return handleModalEditTime(interaction, targetId);
  if (action === "ap_modal_register") return handleModalRegister(interaction);
  if (action === "ap_modal_setposition") return handleModalSetPosition(interaction);
}

module.exports = {
  handleButton,
  handleUserSelect,
  handleStringSelect,
  handleModalSubmit,
};
