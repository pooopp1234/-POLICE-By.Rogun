const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const checkPanel = require("../../utils/checkPanel");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("แผงตรวจสอบ")
    .setDescription("[แอดมิน] โพสต์แผงเมนูระบบตรวจสอบ (ตรวจสอบทะเบียนรถ / ตรวจสอบใบลาออก) ค้างไว้ถาวรในห้อง")
    .addChannelOption((opt) =>
      opt
        .setName("ห้อง")
        .setDescription("ห้องที่จะโพสต์แผง (ค่าเริ่มต้น: ห้องนี้) — ควรเป็นห้อง 🔎・ระบบตรวจสอบ")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้สำหรับแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetChannel = interaction.options.getChannel("ห้อง") || interaction.channel;

    try {
      await checkPanel.postCheckMenuPanel(targetChannel);
    } catch (err) {
      console.error("โพสต์แผงเมนูระบบตรวจสอบไม่สำเร็จ:", err);
      return interaction.editReply({
        embeds: [embeds.errorEmbed(`โพสต์แผงไม่สำเร็จ: ${err.message || "ไม่ทราบสาเหตุ"}`)],
      });
    }

    await interaction.editReply({
      embeds: [embeds.successEmbed(`โพสต์แผงเมนูระบบตรวจสอบในห้อง <#${targetChannel.id}> เรียบร้อยแล้ว`)],
    });
  },
};
