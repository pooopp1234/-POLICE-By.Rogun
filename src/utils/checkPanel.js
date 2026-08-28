const { PermissionsBitField } = require("discord.js");
const db = require("./db");
const embeds = require("./embeds");

function assertCanSend(channel) {
  const me = channel.guild?.members?.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (
    perms &&
    (!perms.has(PermissionsBitField.Flags.ViewChannel) ||
      !perms.has(PermissionsBitField.Flags.SendMessages) ||
      !perms.has(PermissionsBitField.Flags.EmbedLinks))
  ) {
    throw new Error(
      "บอทไม่มีสิทธิ์ในห้องนี้ กรุณาให้สิทธิ์ View Channel, Send Messages และ Embed Links แก่บอทในห้องนี้"
    );
  }
}

// ---------- ห้องเมนูระบบตรวจสอบ (🔎・ระบบตรวจสอบ) — ตรวจสอบทะเบียนรถ / ตรวจสอบใบลาออก ----------

async function postCheckMenuPanel(channel) {
  assertCanSend(channel);
  const message = await channel.send({
    embeds: [embeds.checkMenuEmbed()],
    components: [embeds.checkMenuRow()],
  });
  await db.setCheckMenuPanel(channel.id, message.id);
  return message;
}

async function refreshCheckMenuPanel(client) {
  const panel = await db.getCheckMenuPanel();
  if (!panel) return;

  try {
    const channel = await client.channels.fetch(panel.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(panel.messageId);
    if (!message) return;

    await message.edit({
      embeds: [embeds.checkMenuEmbed()],
      components: [embeds.checkMenuRow()],
    });
  } catch (err) {
    console.error("ไม่สามารถอัปเดตแผงเมนูระบบตรวจสอบได้:", err.message);
  }
}

// ---------- ห้องตรวจสอบทะเบียน (🚗・ตรวจสอบทะเบียน) ----------

async function postPlateCheckPanel(channel) {
  assertCanSend(channel);
  const message = await channel.send({
    embeds: embeds.plateCheckPanelEmbeds(),
    components: [embeds.plateCheckRow()],
  });
  await db.setPlateCheckPanel(channel.id, message.id);
  return message;
}

async function refreshPlateCheckPanel(client) {
  const panel = await db.getPlateCheckPanel();
  if (!panel) return;

  try {
    const channel = await client.channels.fetch(panel.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(panel.messageId);
    if (!message) return;

    await message.edit({
      embeds: embeds.plateCheckPanelEmbeds(),
      components: [embeds.plateCheckRow()],
    });
  } catch (err) {
    console.error("ไม่สามารถอัปเดตห้องตรวจสอบทะเบียนได้:", err.message);
  }
}

module.exports = {
  postCheckMenuPanel,
  refreshCheckMenuPanel,
  postPlateCheckPanel,
  refreshPlateCheckPanel,
};
