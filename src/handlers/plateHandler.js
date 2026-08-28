const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require("discord.js");
const db = require("../utils/db");
const time = require("../utils/time");
const embeds = require("../utils/embeds");
const platePanel = require("../utils/platePanel");
const { isAdmin, sendLog } = require("../utils/permissions");

function plateRegisterModal() {
  const modal = new ModalBuilder().setCustomId("plate_modal_register").setTitle("ลงทะเบียนป้ายทะเบียนรถ");

  const plateInput = new TextInputBuilder()
    .setCustomId("plateNumber")
    .setLabel("เลขทะเบียน")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const modelInput = new TextInputBuilder()
    .setCustomId("carModel")
    .setLabel("ชื่อรุ่นรถ (เช่น Sultan RS)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(plateInput),
    new ActionRowBuilder().addComponents(modelInput)
  );
  return modal;
}

function plateEditModal() {
  const modal = new ModalBuilder().setCustomId("plate_modal_edit").setTitle("แก้ไขป้ายทะเบียนรถ");

  const oldPlateInput = new TextInputBuilder()
    .setCustomId("oldPlateNumber")
    .setLabel("เลขทะเบียนเดิม (ที่ลงไว้แล้ว)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const newPlateInput = new TextInputBuilder()
    .setCustomId("newPlateNumber")
    .setLabel("เลขทะเบียนใหม่ (เว้นว่างถ้าไม่เปลี่ยน)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const newModelInput = new TextInputBuilder()
    .setCustomId("newCarModel")
    .setLabel("ชื่อรุ่นรถใหม่ (เว้นว่างถ้าไม่เปลี่ยน)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(oldPlateInput),
    new ActionRowBuilder().addComponents(newPlateInput),
    new ActionRowBuilder().addComponents(newModelInput)
  );
  return modal;
}

async function handleRegisterModal(interaction) {
  const plateNumber = interaction.fields.getTextInputValue("plateNumber").trim();
  const carModel = interaction.fields.getTextInputValue("carModel").trim();

  if (!plateNumber || !carModel) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("กรุณากรอกเลขทะเบียนและชื่อรุ่นรถให้ครบ")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const member = await db.findMember(interaction.user.id);
  if (!member) {
    return interaction.editReply({
      embeds: [
        embeds.errorEmbed("คุณยังไม่ได้เป็นสมาชิกในระบบ กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อคุณก่อนลงทะเบียนป้ายทะเบียน"),
      ],
    });
  }

  const ownerName = member.gameName;

  const nowIso = time.nowIso();
  const created = await db.addPlate({
    plateNumber,
    carModel,
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
    embeds: [
      embeds.successEmbed(
        `ลงทะเบียนป้ายทะเบียน \`${plateNumber}\` (รุ่นรถ: ${carModel} / เจ้าของ/ผู้ขับ: ${ownerName}) เรียบร้อยแล้ว`
      ),
    ],
  });

  await sendLog(
    interaction.client,
    "ทะเบียน",
    embeds.adminActionEmbed("🚘 ลงทะเบียนป้ายทะเบียนใหม่", `${interaction.user.tag} ลงทะเบียนป้ายทะเบียนรถ`, [
      { name: "เลขทะเบียน", value: plateNumber, inline: true },
      { name: "รุ่นรถ", value: carModel, inline: true },
      { name: "เจ้าของ/ผู้ขับ", value: ownerName, inline: true },
    ])
  );
}

async function handleEditModal(interaction) {
  const oldPlateNumber = interaction.fields.getTextInputValue("oldPlateNumber").trim();
  const newPlateNumberRaw = interaction.fields.getTextInputValue("newPlateNumber").trim();
  const newCarModelRaw = interaction.fields.getTextInputValue("newCarModel").trim();

  if (!oldPlateNumber) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("กรุณากรอกเลขทะเบียนเดิมที่ต้องการแก้ไข")],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!newPlateNumberRaw && !newCarModelRaw) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("กรุณากรอกเลขทะเบียนใหม่ หรือชื่อรุ่นรถใหม่ อย่างน้อย 1 อย่าง")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const existing = await db.findPlateByNumber(oldPlateNumber);
  if (!existing) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed(`ไม่พบเลขทะเบียน \`${oldPlateNumber}\` ในระบบ`)],
    });
  }

  // อนุญาตให้แก้ไขได้เฉพาะเจ้าของที่ลงทะเบียนไว้ หรือแอดมินเท่านั้น
  if (existing.registeredBy !== interaction.user.id && !isAdmin(interaction)) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed("คุณไม่มีสิทธิ์แก้ไขป้ายทะเบียนคันนี้ (ไม่ใช่ผู้ลงทะเบียนไว้ และไม่ใช่แอดมิน)")],
    });
  }

  const nowIso = time.nowIso();
  const result = await db.updatePlate(oldPlateNumber, {
    plateNumber: newPlateNumberRaw || undefined,
    carModel: newCarModelRaw || undefined,
    updatedAt: nowIso,
  });

  if (!result.ok) {
    const reason =
      result.reason === "duplicate"
        ? `เลขทะเบียน \`${newPlateNumberRaw}\` มีคนอื่นลงทะเบียนไว้แล้ว`
        : `ไม่พบเลขทะเบียน \`${oldPlateNumber}\` ในระบบ`;
    return interaction.editReply({ embeds: [embeds.errorEmbed(reason)] });
  }

  await platePanel.refreshPlateList(interaction.client);

  await interaction.editReply({
    embeds: [
      embeds.successEmbed(
        `แก้ไขป้ายทะเบียน \`${oldPlateNumber}\` เรียบร้อยแล้ว → เลขทะเบียน: \`${result.plate.plateNumber}\` / รุ่นรถ: ${
          result.plate.carModel || "-"
        }`
      ),
    ],
  });

  await sendLog(
    interaction.client,
    "ทะเบียน",
    embeds.adminActionEmbed("✏️ แก้ไขป้ายทะเบียนรถ", `${interaction.user.tag} แก้ไขป้ายทะเบียนรถ`, [
      { name: "เลขทะเบียนเดิม", value: oldPlateNumber, inline: true },
      { name: "เลขทะเบียนใหม่", value: result.plate.plateNumber, inline: true },
      { name: "รุ่นรถ", value: result.plate.carModel || "-", inline: true },
    ])
  );
}

async function handleButton(interaction) {
  if (interaction.customId === "plate_register") {
    return interaction.showModal(plateRegisterModal());
  }
  if (interaction.customId === "plate_edit") {
    return interaction.showModal(plateEditModal());
  }
}

async function handleModalSubmit(interaction) {
  if (interaction.customId === "plate_modal_register") {
    return handleRegisterModal(interaction);
  }
  if (interaction.customId === "plate_modal_edit") {
    return handleEditModal(interaction);
  }
}

module.exports = { handleButton, handleModalSubmit };
