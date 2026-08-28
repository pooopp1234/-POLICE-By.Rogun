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

/**
 * โพสต์แผงยื่นใบลาออกใหม่ในห้องที่ระบุ และบันทึกตำแหน่งข้อความไว้ใน DB
 * เป็นข้อความปักหมุดค้างไว้ถาวร ใครก็กดปุ่มยื่นใบลาออกได้ตลอดเวลา
 */
async function postResignPanel(channel) {
  assertCanSend(channel);
  const message = await channel.send({
    embeds: embeds.resignSubmitPanelEmbeds(),
    components: [embeds.resignSubmitRow()],
  });
  await db.setResignSubmitPanel(channel.id, message.id);
  return message;
}

/**
 * อัปเดตแผงยื่นใบลาออกที่ปักไว้ (เผื่อแก้ข้อความในอนาคต)
 * ถ้าหาข้อความเดิมไม่เจอ (ถูกลบไปแล้ว) จะข้ามไปเงียบๆ ไม่ error
 */
async function refreshResignPanel(client) {
  const panel = await db.getResignSubmitPanel();
  if (!panel) return;

  try {
    const channel = await client.channels.fetch(panel.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(panel.messageId);
    if (!message) return;

    await message.edit({
      embeds: embeds.resignSubmitPanelEmbeds(),
      components: [embeds.resignSubmitRow()],
    });
  } catch (err) {
    console.error("ไม่สามารถอัปเดตแผงยื่นใบลาออกได้:", err.message);
  }
}

module.exports = { postResignPanel, refreshResignPanel };
