const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require("discord.js");
const db = require("../utils/db");
const embeds = require("../utils/embeds");
const { sendLog } = require("../utils/permissions");

function extractDiscordId(raw) {
  const mentionMatch = /^<@!?(\d+)>$/.exec(raw);
  if (mentionMatch) return mentionMatch[1];
  if (/^\d{15,20}$/.test(raw)) return raw;
  return null;
}

function plateCheckModal() {
  const modal = new ModalBuilder().setCustomId("check_modal_plate").setTitle("ตรวจสอบทะเบียนรถ");
  const queryInput = new TextInputBuilder()
    .setCustomId("query")
    .setLabel("ชื่อสมาชิก / Discord ID / ทะเบียนรถ")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
  return modal;
}

function resignCheckModal() {
  const modal = new ModalBuilder().setCustomId("check_modal_resign").setTitle("ตรวจสอบใบลาออก");
  const queryInput = new TextInputBuilder()
    .setCustomId("query")
    .setLabel("เลขที่ใบลาออก / ชื่อ / Discord ID")
    .setPlaceholder("เช่น RESIGN-00001")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
  return modal;
}

async function handleButton(interaction) {
  if (interaction.customId === "check_plate") {
    return interaction.showModal(plateCheckModal());
  }
  if (interaction.customId === "check_resign") {
    return interaction.showModal(resignCheckModal());
  }
}

async function searchPlates(query) {
  const discordId = extractDiscordId(query);
  if (discordId) {
    const byOwner = await db.getPlatesForDiscordId(discordId);
    const all = await db.getAllPlates();
    const byRegisteredBy = all.filter((p) => p.registeredBy === discordId);
    const merged = new Map();
    for (const p of [...byOwner, ...byRegisteredBy]) merged.set(p.id, p);
    return Array.from(merged.values());
  }

  const q = query.trim().toLowerCase();
  const all = await db.getAllPlates();
  return all.filter(
    (p) => p.plateNumber.toLowerCase().includes(q) || (p.ownerName || "").toLowerCase().includes(q)
  );
}

async function searchResignations(query) {
  const trimmed = query.trim();

  // ค้นด้วยเลขที่ใบลาออก เช่น RESIGN-00001 หรือแค่ตัวเลข
  const idMatch = /^(?:RESIGN-)?0*(\d+)$/i.exec(trimmed);
  if (idMatch) {
    const found = await db.getResignation(Number(idMatch[1]));
    if (found) return [found];
  }

  const discordId = extractDiscordId(trimmed);
  const all = await db.getAllResignations();

  if (discordId) {
    return all.filter((r) => r.discordId === discordId);
  }

  const q = trimmed.toLowerCase();
  return all.filter(
    (r) => (r.fullName || "").toLowerCase().includes(q) || (r.discordName || "").toLowerCase().includes(q)
  );
}

async function handleModalSubmit(interaction) {
  if (interaction.customId === "check_modal_plate") {
    const query = interaction.fields.getTextInputValue("query").trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const plates = await searchPlates(query);
    await interaction.editReply({ embeds: [embeds.plateCheckResultEmbed(query, plates)] });

    // บันทึกผู้ที่ทำการตรวจสอบและคำค้นหา (log การตรวจสอบทะเบียน)
    await sendLog(
      interaction.client,
      "ทะเบียน",
      embeds.adminActionEmbed("🔎 ตรวจสอบทะเบียนรถ", `${interaction.user.tag} ค้นหาทะเบียนรถ`, [
        { name: "คำค้นหา", value: query, inline: true },
        { name: "พบ", value: `${plates.length} คัน`, inline: true },
      ])
    );
    return;
  }

  if (interaction.customId === "check_modal_resign") {
    const query = interaction.fields.getTextInputValue("query").trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const resignations = await searchResignations(query);
    await interaction.editReply({ embeds: [embeds.resignCheckResultEmbed(query, resignations)] });
    return;
  }
}

module.exports = { handleButton, handleModalSubmit };
