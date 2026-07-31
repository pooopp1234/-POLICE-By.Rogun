const { SlashCommandBuilder } = require("discord.js");
const db = require("../../utils/db");
const time = require("../../utils/time");
const embeds = require("../../utils/embeds");
const roster = require("../../utils/roster");
const config = require("../../../config.json");
const { isAdmin, sendLog } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("สมัคร")
    .setDescription("[แอดมิน] เพิ่มสมาชิกเข้าระบบเข้าเวร")
    .addStringOption((opt) =>
      opt
        .setName("ไอดีดิสคอร์ด")
        .setDescription("Discord ID ของสมาชิกที่ต้องการเพิ่ม (ตัวเลขล้วน)")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("ชื่อ").setDescription("ชื่อของสมาชิก").setRequired(true)
    )
    .addStringOption((opt) => {
      opt.setName("ตำแหน่ง").setDescription("ตำแหน่งของสมาชิก").setRequired(true);
      for (const pos of config.positions) {
        opt.addChoices({ name: pos, value: pos });
      }
      return opt;
    }),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const discordId = interaction.options.getString("ไอดีดิสคอร์ด").trim();
    const gameName = interaction.options.getString("ชื่อ");
    const position = interaction.options.getString("ตำแหน่ง");

    if (!/^\d{17,20}$/.test(discordId)) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ไอดีดิสคอร์ดไม่ถูกต้อง กรุณาใส่เฉพาะตัวเลข (17-20 หลัก)")],
      });
    }

    let target;
    try {
      target = await interaction.client.users.fetch(discordId);
    } catch {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ไม่พบผู้ใช้ Discord ที่ไอดีนี้ กรุณาตรวจสอบไอดีอีกครั้ง")],
      });
    }

    const existing = await db.findMember(target.id);
    if (existing) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed(`${target.tag} มีอยู่ในระบบแล้ว ไม่สามารถเพิ่มซ้ำได้`)],
      });
    }

    const data = {
      discordId: target.id,
      discordName: target.tag,
      gameName,
      position,
      registeredAt: time.nowIso(),
    };

    await db.addMember(data);
    await roster.refreshRoster(interaction.client);

    await interaction.editReply({
      embeds: [
        embeds.successEmbed(`เพิ่มสมาชิก ${target.tag} สำเร็จ! ตอนนี้สามารถใช้คำสั่ง /เข้าเวร ได้แล้ว`),
      ],
    });

    await sendLog(
      interaction.client,
      "สมัคร",
      embeds.registerEmbed({ ...data, addedBy: interaction.user.tag })
    );
  },
};
