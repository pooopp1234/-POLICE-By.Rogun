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

const CUSTOM_MODEL_VALUE = "__custom__";

// ค่าเก็บชั่วคราวระหว่างขั้นตอน เลือกประเภท -> เลือกรุ่นรถ -> เปิดฟอร์ม
const pendingRegistration = new Map();

function categorySelectRow() {
  const select = new StringSelectMenuBuilder()
    .setCustomId("plate_category_select")
    .setPlaceholder("เลือกประเภทพาหนะ")
    .addOptions(CATEGORY_OPTIONS);
  return new ActionRowBuilder().addComponents(select);
}

function modelSelectRow(prefillModel) {
  // รายชื่อรุ่นรถให้เลือกจาก config (แก้ไข/เพิ่มได้ที่ config.json -> vehicleModelOptions)
  const configuredModels = Array.isArray(config.vehicleModelOptions) ? config.vehicleModelOptions : [];
  const modelSet = new Set(configuredModels.filter(Boolean));
  if (prefillModel) modelSet.add(prefillModel); // ให้รุ่นรถประจำตำแหน่งของผู้ใช้ติดอยู่ในเมนูด้วยเสมอ

  // เมนูเลือกได้สูงสุด 25 ตัวเลือก เผื่อ 1 ช่องไว้ให้ "อื่นๆ (พิมพ์เอง)"
  const modelOptions = Array.from(modelSet)
    .slice(0, 24)
    .map((model) => ({ label: model, value: model, default: model === prefillModel }));

  modelOptions.push({ label: "อื่นๆ (พิมพ์เอง)", value: CUSTOM_MODEL_VALUE, emoji: "✏️" });

  const select = new StringSelectMenuBuilder()
    .setCustomId("plate_model_select")
    .setPlaceholder("เลือกรุ่นรถ")
    .addOptions(modelOptions);
  return new ActionRowBuilder().addComponents(select);
}

function plateRegisterModal(category, carModel) {
  const safeCategory = category || "รถ";
  const payload = encodeURIComponent(JSON.stringify({ category: safeCategory, carModel: carModel || undefined }));
  const modal = new ModalBuilder()
    .setCustomId(`plate_modal_register::${payload}`)
    .setTitle(`ลงทะเบียนป้ายทะเบียนรถ (${safeCategory})`);

  const plateInput = new TextInputBuilder()
    .setCustomId("plateNumber")
    .setLabel("เลขทะเบียน")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const rows = [new ActionRowBuilder().addComponents(plateInput)];

  // ถ้ายังไม่ได้เลือกรุ่นรถจากเมนู (เลือก "อื่นๆ") ให้มีช่องพิมพ์เองในฟอร์ม
  if (!carModel) {
    const modelInput = new TextInputBuilder()
      .setCustomId("carModel")
      .setLabel("ชื่อรุ่นรถ (เช่น Sultan RS)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    rows.push(new ActionRowBuilder().addComponents(modelInput));
  }

  modal.addComponents(...rows);
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

  // ประเภท (และรุ่นรถ ถ้าเลือกจากเมนู) ถูกแนบไว้ใน customId ของโมดัลแล้ว เช่น plate_modal_register::%7B...%7D
  const [, encodedPayload] = interaction.customId.split("::");
  let category = "รถ";
  let carModel = "";
  if (encodedPayload) {
    try {
      const payload = JSON.parse(decodeURIComponent(encodedPayload));
      category = payload.category || category;
      carModel = payload.carModel || "";
    } catch (err) {
      // เผื่อ payload เสียหาย ใช้ค่าเริ่มต้นแทน
    }
  }
  // ถ้าไม่ได้เลือกรุ่นรถจากเมนู (เลือก "อื่นๆ") จะมีช่องให้พิมพ์เองในฟอร์ม
  if (!carModel) {
    carModel = interaction.fields.getTextInputValue("carModel").trim();
  }

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
    // เก็บชื่อรุ่นรถที่จะ prefill ไว้ชั่วคราว รอจนกว่าจะเลือกประเภท+รุ่นรถเสร็จ
    pendingRegistration.set(interaction.user.id, { prefillModel });
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
    const pending = pendingRegistration.get(interaction.user.id) || {};
    pendingRegistration.set(interaction.user.id, { ...pending, category });
    return interaction.update({
      content: `🚘 ประเภท: **${category}** — ตอนนี้เลือกรุ่นรถ:`,
      components: [modelSelectRow(pending.prefillModel)],
    });
  }
  if (interaction.customId === "plate_model_select") {
    const selected = interaction.values[0];
    const pending = pendingRegistration.get(interaction.user.id) || {};
    pendingRegistration.delete(interaction.user.id);
    const carModel = selected === CUSTOM_MODEL_VALUE ? "" : selected;
    return interaction.showModal(plateRegisterModal(pending.category, carModel));
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
