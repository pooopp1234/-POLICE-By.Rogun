const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const weeklyReset = require("../../utils/weeklyReset");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("สรุปสัปดาห์ทันที")
    .setDescription("[แอดมิน] สั่งให้ระบบสรุปรายสัปดาห์ทำงานทันที ไม่ต้องรอรอบอัตโนมัติ (บันทึกลงประวัติ)"),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { weekKey, rows, embed } = await weeklyReset.runNow(interaction.client);

    await interaction.editReply({
      embeds: [
        embeds.successEmbed(
          `สั่งสรุปสัปดาห์ ${weekKey} ทันทีเรียบร้อยแล้ว (${rows.length} คนมีข้อมูล) — บันทึกลงประวัติแล้ว`
        ),
        embed,
      ],
    });
  },
};
