const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require("discord.js");
const db = require("../utils/db");
const time = require("../utils/time");
const embeds = require("../utils/embeds");
const platePanel = require("../utils/platePanel");
const { sendLog } = require("../utils/permissions");

function plateRegisterModal() {
  const modal = new ModalBuilder().setCustomId("plate_modal_register").setTitle("ลงทะเบียนป้ายทะเบียนรถ");

  const plateInput = new TextInputBuilder()
    .setCustomId("plateNumber")
    .setLabel("เลขทะเบียน")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const ownerInput = new TextInputBuilder()
    .setCustomId("ownerName")
    .setLabel("ชื่อเจ้าของ/ผู้ขับ")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(plateInput),
    new ActionRowBuilder().addComponents(ownerInput)
  );
  return modal;
}

async function handleRegisterModal(interaction) {
  const plateNumber = interaction.fields.getTextInputValue("plateNumber").trim();
  const ownerName = interaction.fields.getTextInputValue("ownerName").trim();

  if (!plateNumber || !ownerName) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("กรุณากรอกเลขทะเบียนและชื่อเจ้าของ/ผู้ขับให้ครบ")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const nowIso = time.nowIso();
  const created = await db.addPlate({
    plateNumber,
    ownerName,
    registeredBy: interaction.user.id,
    registeredByName: interaction.user.tag,
    createdAt: nowIso,
  });

  if (!created) {
    const existing = await db.findPlateByNumber(plateNumber);
    return interaction.editReply({
      embeds: [
        embeds.errorEmbed(
          `เลขทะเบียน \`${plateNumber}\` ถูกลงทะเบียนไว้แล้ว (เจ้าของ/ผู้ขับ: ${existing?.ownerName || "-"})`
        ),
      ],
    });
  }

  await platePanel.refreshPlateList(interaction.client);

  await interaction.editReply({
    embeds: [embeds.successEmbed(`ลงทะเบียนป้ายทะเบียน \`${plateNumber}\` (เจ้าของ/ผู้ขับ: ${ownerName}) เรียบร้อยแล้ว`)],
  });

  await sendLog(
    interaction.client,
    "ทะเบียน",
    embeds.adminActionEmbed("🚘 ลงทะเบียนป้ายทะเบียนใหม่", `${interaction.user.tag} ลงทะเบียนป้ายทะเบียนรถ`, [
      { name: "เลขทะเบียน", value: plateNumber, inline: true },
      { name: "เจ้าของ/ผู้ขับ", value: ownerName, inline: true },
    ])
  );
}

async function handleButton(interaction) {
  if (interaction.customId === "plate_register") {
    return interaction.showModal(plateRegisterModal());
  }
}

async function handleModalSubmit(interaction) {
  if (interaction.customId === "plate_modal_register") {
    return handleRegisterModal(interaction);
  }
}

module.exports = { handleButton, handleModalSubmit };
