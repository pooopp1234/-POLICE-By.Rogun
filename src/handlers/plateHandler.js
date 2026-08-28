const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../utils/db");
const time = require("../utils/time");
const embeds = require("../utils/embeds");
const platePanel = require("../utils/platePanel");
const config = require("../../config.json");
const { isAdmin, sendLog } = require("../utils/permissions");

// ตัวเลือกประเภทพาหนะ ให้เลือกจากเมนูแทนการพิมพ์เอง
const CATEGORY_OPTIONS = [
  { label: "รถ", value: "รถ", emoji: "🚗" },
  { label: "มอเตอร์ไซค์", value: "มอเตอร์ไซค์", emoji: "🏍️" },
  { label: "เฮลิคอปเตอร์ (ฮ)", value: "ฮ", emoji: "🚁" },
  { label: "เรือ", value: "เรือ", emoji: "🚤" },
];

// เก็บชื่อรุ่นรถที่จะ prefill ไว้ชั่วคราว ระหว่างขั้นตอนเลือกประเภท -> เปิดฟอร์ม
const pendingPrefillModel = new Map();

function categorySelectRow() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("plate_category_select")
    .setPlaceholder("เลือกประเภทพาหนะ")
    .addOptions(CATEGORY_OPTIONS);
  return new ActionRowBuilder().addComponents(select);
}

function plateRegisterModal(prefillModel, category) {
  const safeCategory = category || "รถ";
  // เก็บประเภทที่เลือกไว้ใน customId ของโมดัล เพื่อไม่ต้องให้ผู้ใช้พิมพ์ซ้ำ
  const modal = new ModalBuilder()
    .setCustomId(`plate_modal_register::${encodeURIComponent(safeCategory)}`)
    .setTitle(`ลงทะเบียนป้ายทะเบียนรถ (${safeCategory})`);

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
  if (prefillModel) modelInput.setValue(prefillModel);

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

  const newCategoryInput = new TextInputBuilder()
    .setCustomId("newCategory")
    .setLabel("ประเภทใหม่ (เว้นว่างถ้าไม่เปลี่ยน)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("รถ / ฮ / เรือ ฯลฯ")
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(oldPlateInput),
    new ActionRowBuilder().addComponents(newPlateInput),
    new ActionRowBuilder().addComponents(newModelInput),
    new ActionRowBuilder().addComponents(newCategoryInput)
  );
  return modal;
}

async function handleRegisterModal(interaction) {
  const plateNumber = interaction.fields.getTextInputValue("plateNumber").trim();
  const carModel = interaction.fields.getTextInputValue("carModel").trim();

  // ประเภทถูกเลือกไว้แล้วจากเมนู และแนบมากับ customId ของโมดัล เช่น plate_modal_register::รถ
  const [, encodedCategory] = interaction.customId.split("::");
  const category = (encodedCategory ? decodeURIComponent(encodedCategory) : "") || "รถ";

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
    category,
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
        `ลงทะเบียนป้ายทะเบียน \`${plateNumber}\` (${category} — รุ่นรถ: ${carModel} / เจ้าของ/ผู้ขับ: ${ownerName}) เรียบร้อยแล้ว`
      ),
    ],
  });

  await sendLog(
    interaction.client,
    "ทะเบียน",
    embeds.adminActionEmbed("🚘 ลงทะเบียนป้ายทะเบียนใหม่", `${interaction.user.tag} ลงทะเบียนป้ายทะเบียนรถ`, [
      { name: "เลขทะเบียน", value: plateNumber, inline: true },
      { name: "รุ่นรถ", value: carModel, inline: true },
      { name: "ประเภท", value: category, inline: true },
      { name: "เจ้าของ/ผู้ขับ", value: ownerName, inline: true },
    ])
  );
}

async function handleEditModal(interaction) {
  const oldPlateNumber = interaction.fields.getTextInputValue("oldPlateNumber").trim();
  const newPlateNumberRaw = interaction.fields.getTextInputValue("newPlateNumber").trim();
  const newCarModelRaw = interaction.fields.getTextInputValue("newCarModel").trim();
  const newCategoryRaw = interaction.fields.getTextInputValue("newCategory").trim();

  if (!oldPlateNumber) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("กรุณากรอกเลขทะเบียนเดิมที่ต้องการแก้ไข")],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!newPlateNumberRaw && !newCarModelRaw && !newCategoryRaw) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("กรุณากรอกเลขทะเบียนใหม่ ชื่อรุ่นรถใหม่ หรือประเภทใหม่ อย่างน้อย 1 อย่าง")],
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
    category: newCategoryRaw || undefined,
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
        } / ประเภท: ${result.plate.category || "-"}`
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
      { name: "ประเภท", value: result.plate.category || "-", inline: true },
    ])
  );
}

async function handleButton(interaction) {
  if (interaction.customId === "plate_register") {
    const member = await db.findMember(interaction.user.id);
    const prefillModel = member ? config.positionVehicleModels?.[member.position] : undefined;
    // เก็บชื่อรุ่นรถที่จะ prefill ไว้ชั่วคราว รอจนกว่าจะเลือกประเภทเสร็จ
    pendingPrefillModel.set(interaction.user.id, prefillModel);
    return interaction.reply({
      content: "🚘 กรุณาเลือกประเภทพาหนะที่จะลงทะเบียนก่อน:",
      components: [categorySelectRow()],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (interaction.customId === "plate_edit") {
    return interaction.showModal(plateEditModal());
  }
}

async function handleSelectMenu(interaction) {
  if (interaction.customId === "plate_category_select") {
    const category = interaction.values[0];
    const prefillModel = pendingPrefillModel.get(interaction.user.id);
    pendingPrefillModel.delete(interaction.user.id);
    return interaction.showModal(plateRegisterModal(prefillModel, category));
  }
}

async function handleModalSubmit(interaction) {
  if (interaction.customId.startsWith("plate_modal_register")) {
    return handleRegisterModal(interaction);
  }
  if (interaction.customId === "plate_modal_edit") {
    return handleEditModal(interaction);
  }
}

module.exports = { handleButton, handleSelectMenu, handleModalSubmit };
