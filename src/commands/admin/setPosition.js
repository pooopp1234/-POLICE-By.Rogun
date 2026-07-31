const { SlashCommandBuilder } = require("discord.js");
const db = require("../../utils/db");
const embeds = require("../../utils/embeds");
const roster = require("../../utils/roster");
const config = require("../../../config.json");
const { isAdmin, sendLog } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("แก้ไขตำแหน่ง")
    .setDescription("[แอดมิน] เปลี่ยนตำแหน่งของสมาชิกที่มีอยู่ในระบบ")
    .addStringOption((opt) =>
      opt
        .setName("ไอดีดิสคอร์ด")
        .setDescription("Discord ID ของสมาชิกที่ต้องการแก้ไขตำแหน่ง (ตัวเลขล้วน)")
        .setRequired(true)
    )
    .addStringOption((opt) => {
      opt.setName("ตำแหน่ง").setDescription("ตำแหน่งใหม่").setRequired(true);
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
    const position = interaction.options.getString("ตำแหน่ง");

    if (!/^\d{17,20}$/.test(discordId)) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ไอดีดิสคอร์ดไม่ถูกต้อง กรุณาใส่เฉพาะตัวเลข (17-20 หลัก)")],
      });
    }

    const existing = await db.findMember(discordId);
    if (!existing) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ไม่พบสมาชิกไอดีนี้ในระบบ กรุณาเพิ่มสมาชิกด้วยคำสั่ง /สมัคร ก่อน")],
      });
    }

    await db.updateMemberPosition(discordId, position);
    await roster.refreshRoster(interaction.client);

    await interaction.editReply({
      embeds: [
        embeds.successEmbed(
          `เปลี่ยนตำแหน่งของ ${existing.gameName} (${existing.discordName}) เป็น "${position}" เรียบร้อยแล้ว`
        ),
      ],
    });

    await sendLog(
      interaction.client,
      "แอดมิน",
      embeds.adminActionEmbed("🎖️ เปลี่ยนตำแหน่ง", `แอดมิน ${interaction.user.tag} เปลี่ยนตำแหน่งสมาชิก`, [
        { name: "สมาชิก", value: `${existing.gameName} (${existing.discordName})`, inline: true },
        { name: "ตำแหน่งใหม่", value: position, inline: true },
      ])
    );
  },
};
