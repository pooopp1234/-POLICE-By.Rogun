const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require("discord.js");
const db = require("../utils/db");
const time = require("../utils/time");
const embeds = require("../utils/embeds");
const config = require("../../config.json");
const { isApprover, sendLog } = require("../utils/permissions");
const { removeRoles } = require("../utils/discordSync");
const roster = require("../utils/roster");
const platePanel = require("../utils/platePanel");

function resignSubmitModal() {
  const modal = new ModalBuilder().setCustomId("resign_modal_submit").setTitle("ยื่นใบลาออก");

  const noteInput = new TextInputBuilder()
    .setCustomId("note")
    .setLabel("หมายเหตุ / เหตุผลการลาออก")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
  return modal;
}

function resignRejectModal(id) {
  const modal = new ModalBuilder().setCustomId(`resign_modal_reject_${id}`).setTitle("เหตุผลที่ไม่อนุมัติ");

  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("เหตุผลที่ไม่อนุมัติ")
    .setPlaceholder("กรุณาระบุเหตุผลที่ไม่อนุมัติ")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

async function handleButton(interaction) {
  if (interaction.customId === "resign_apply") {
    const member = await db.findMember(interaction.user.id);
    if (!member) {
      return interaction.reply({
        embeds: [
          embeds.errorEmbed("ไม่พบชื่อของคุณในฐานข้อมูลสมาชิก กรุณาติดต่อแอดมินก่อนยื่นใบลาออก"),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const pending = await db.findPendingResignation(interaction.user.id);
    if (pending) {
      return interaction.reply({
        embeds: [embeds.errorEmbed(`⚠️ คุณมีใบลาออกที่กำลังรอการตรวจสอบอยู่แล้ว (${pending.requestId})`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.showModal(resignSubmitModal());
  }

  if (interaction.customId.startsWith("resign_approve_") || interaction.customId.startsWith("resign_reject_")) {
    return handleDecisionButton(interaction);
  }
}

async function handleDecisionButton(interaction) {
  if (!isApprover(interaction)) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("เฉพาะผู้อนุมัติเท่านั้นที่กดปุ่มนี้ได้")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const approve = interaction.customId.startsWith("resign_approve_");
  const id = Number(interaction.customId.slice(approve ? "resign_approve_".length : "resign_reject_".length));

  if (!approve) {
    // ไม่อนุมัติ ต้องกรอกเหตุผลก่อน ผ่าน Modal
    return interaction.showModal(resignRejectModal(id));
  }

  await interaction.deferUpdate();
  await finalizeDecision(interaction, id, true, null);
}

async function handleModalSubmit(interaction) {
  if (interaction.customId === "resign_modal_submit") {
    return handleSubmit(interaction);
  }
  if (interaction.customId.startsWith("resign_modal_reject_")) {
    const id = Number(interaction.customId.slice("resign_modal_reject_".length));
    return handleRejectSubmit(interaction, id);
  }
}

async function handleSubmit(interaction) {
  const note = interaction.fields.getTextInputValue("note").trim();

  if (!note) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("กรุณากรอกหมายเหตุ/เหตุผลการลาออก")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // ดึงชื่อจากฐานข้อมูลสมาชิกโดยตรง (ไม่ให้ผู้ยื่นพิมพ์เอง กันชื่อผิด/ไม่ตรงกับระบบ)
  const member = await db.findMember(interaction.user.id);
  if (!member) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed("ไม่พบชื่อของคุณในฐานข้อมูลสมาชิก กรุณาติดต่อแอดมินก่อนยื่นใบลาออก")],
    });
  }
  const fullName = member.gameName;

  // กันยื่นซ้ำอีกครั้ง เผื่อกดปุ่มพร้อมกันหลายครั้งก่อนโมดัลแรกถูกส่ง
  const pending = await db.findPendingResignation(interaction.user.id);
  if (pending) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed(`⚠️ คุณมีใบลาออกที่กำลังรอการตรวจสอบอยู่แล้ว (${pending.requestId})`)],
    });
  }

  // ตรวจทะเบียนรถของผู้ยื่นอัตโนมัติ แล้วแนบไว้กับใบลาออก (snapshot ตอนยื่น)
  const plates = await db.getPlatesForDiscordId(interaction.user.id);

  const resignation = await db.addResignation({
    discordId: interaction.user.id,
    discordName: interaction.user.tag,
    fullName,
    note,
    plates,
    createdAt: time.nowIso(),
  });

  const channelId = config.logChannels["ลาออก"];
  let posted = false;

  if (channelId && !channelId.startsWith("ใส่_")) {
    try {
      const logChannel = await interaction.client.channels.fetch(channelId);
      if (logChannel) {
        const message = await logChannel.send({
          embeds: [embeds.resignReviewEmbed(resignation)],
          components: [embeds.resignReviewRow(resignation.id)],
        });
        await db.setResignationReviewMessage(resignation.id, logChannel.id, message.id);
        posted = true;
      }
    } catch (err) {
      console.error("ส่งใบลาออกเข้าห้อง log-ลาออก ไม่สำเร็จ:", err.message);
    }
  }

  await interaction.editReply({
    embeds: [
      embeds.successEmbed(
        posted
          ? `ยื่นใบลาออก ${resignation.requestId} เรียบร้อยแล้ว กรุณารอผลการพิจารณาจากผู้อนุมัติ`
          : `บันทึกใบลาออก ${resignation.requestId} เรียบร้อยแล้ว แต่ยังไม่ได้ตั้งค่าห้อง log-ลาออก (logChannels.ลาออก) กรุณาแจ้งแอดมิน`
      ),
    ],
  });

  await sendLog(
    interaction.client,
    "แอดมิน",
    embeds.adminActionEmbed(
      "📝 ใบลาออกใหม่",
      `${interaction.user.tag} ยื่นใบลาออก ${resignation.requestId} | ${time.displayDateTime(resignation.createdAt)}`,
      [
        { name: "ชื่อ", value: fullName, inline: true },
        { name: "ทะเบียนรถ", value: plates.length ? plates.map((p) => p.plateNumber).join(", ") : "-", inline: true },
      ]
    )
  );
}

async function handleRejectSubmit(interaction, id) {
  if (!isApprover(interaction)) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("เฉพาะผู้อนุมัติเท่านั้นที่ดำเนินการนี้ได้")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const reason = interaction.fields.getTextInputValue("reason").trim();
  if (!reason) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("กรุณาระบุเหตุผลที่ไม่อนุมัติ")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();
  await finalizeDecision(interaction, id, false, reason);
}

// เมื่อใบลาออกได้รับการอนุมัติ: ลบชื่อออกจากรายชื่อสมาชิก, ถอดยศ/ตำแหน่งทั้งหมด,
// และลบป้ายทะเบียนรถที่ผูกกับสมาชิกคนนั้นออกจากระบบ
async function offboardMember(interaction, resignation) {
  const discordId = resignation.discordId;
  const result = { memberRemoved: false, platesRemoved: [], roleResult: null };

  // ดึงป้ายทะเบียนปัจจุบันของสมาชิกไว้ก่อน (ฟังก์ชันนี้อ้างอิงชื่อในเกมจากตาราง members
  // ซึ่งจะหายไปทันทีที่ลบสมาชิก จึงต้องดึงมาเก็บไว้ก่อนลบ)
  const currentPlates = await db.getPlatesForDiscordId(discordId);

  // ลบชื่อออกจากรายชื่อสมาชิก
  result.memberRemoved = await db.removeMember(discordId);

  // ลบป้ายทะเบียนรถทั้งหมดที่ผูกกับสมาชิกคนนี้
  for (const plate of currentPlates) {
    const removed = await db.removePlate(plate.plateNumber);
    if (removed) result.platesRemoved.push(plate.plateNumber);
  }

  // ถอดยศ/ตำแหน่งทั้งหมด (ยศอัตโนมัติตอนสมัคร + ยศตำแหน่งทุกระดับใน config)
  const allRoleIds = [...(config.autoRoleIds || []), ...Object.values(config.positionRoleIds || {})];
  result.roleResult = await removeRoles(interaction, discordId, allRoleIds);

  // อัปเดตแผงรายชื่อ/แผงทะเบียนให้ตรงกับข้อมูลล่าสุด
  try {
    await roster.refreshRoster(interaction.client);
  } catch (err) {
    console.error("อัปเดตแผงรายชื่อหลังลาออกไม่สำเร็จ:", err.message);
  }
  try {
    await platePanel.refreshPlateList(interaction.client);
  } catch (err) {
    console.error("อัปเดตแผงทะเบียนหลังลาออกไม่สำเร็จ:", err.message);
  }

  return result;
}

async function finalizeDecision(interaction, id, approve, reason) {
  const status = approve ? db.RESIGN_STATUS_APPROVED : db.RESIGN_STATUS_REJECTED;

  // ใช้ชื่อในเกมของผู้ดำเนินการจากฐานข้อมูลสมาชิก (ถ้ามี) แทน Discord username ดิบๆ
  const reviewerMember = await db.findMember(interaction.user.id);
  const reviewerName = reviewerMember?.gameName || interaction.user.tag;

  const resignation = await db.decideResignation(id, status, interaction.user.id, reviewerName, time.nowIso(), reason);

  if (!resignation) {
    return interaction.followUp({
      embeds: [embeds.errorEmbed("ใบลาออกนี้ถูกดำเนินการไปแล้ว หรือไม่พบข้อมูล")],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ถ้าอนุมัติ: ลบชื่อออกจากรายชื่อ + ถอดยศทั้งหมด + ลบป้ายทะเบียนรถ
  const offboarding = approve ? await offboardMember(interaction, resignation) : null;

  // อัปเดตข้อความใน log-ลาออก ปิดปุ่มทั้งหมดกันกดซ้ำ
  try {
    await interaction.editReply({
      embeds: [embeds.resignReviewEmbed(resignation)],
      components: [embeds.resignReviewRow(resignation.id, true)],
    });
  } catch (err) {
    console.error(`อัปเดตข้อความใบลาออก ${resignation.requestId} ไม่สำเร็จ:`, err.message);
  }

  // ส่ง DM แจ้งผลให้ผู้ยื่น (ถ้าปิดรับ DM จะไม่ทำให้การดำเนินการล้มเหลว)
  try {
    const applicant = await interaction.client.users.fetch(resignation.discordId);
    await applicant.send({ embeds: [embeds.resignResultEmbed(resignation)] });
  } catch (err) {
    console.error(`ส่ง DM แจ้งผลใบลาออก ${resignation.requestId} ไม่สำเร็จ (อาจปิดรับ DM):`, err.message);
  }

  const logFields = reason ? [{ name: "เหตุผล", value: reason, inline: false }] : [];

  if (approve && offboarding) {
    logFields.push(
      { name: "ลบออกจากรายชื่อ", value: offboarding.memberRemoved ? "✅ สำเร็จ" : "⚠️ ไม่พบ/ลบไม่สำเร็จ", inline: true },
      {
        name: "ถอดยศ/ตำแหน่ง",
        value: offboarding.roleResult
          ? offboarding.roleResult.ok || offboarding.roleResult.removed?.length
            ? `ถอดแล้ว: ${offboarding.roleResult.removed?.length ? offboarding.roleResult.removed.join(", ") : "-"}${
                offboarding.roleResult.failed?.length ? `\nถอดไม่สำเร็จ: ${offboarding.roleResult.failed.join(", ")}` : ""
              }`
            : `⚠️ ${offboarding.roleResult.reason || "ถอดยศไม่สำเร็จ"}`
          : "-",
        inline: false,
      },
      {
        name: "ป้ายทะเบียนที่ลบ",
        value: offboarding.platesRemoved.length ? offboarding.platesRemoved.join(", ") : "- (ไม่มีป้ายทะเบียนผูกอยู่)",
        inline: false,
      }
    );
  }

  await sendLog(
    interaction.client,
    "แอดมิน",
    embeds.adminActionEmbed(
      approve ? "✅ อนุมัติใบลาออก" : "❌ ไม่อนุมัติใบลาออก",
      `${interaction.user.tag} ${approve ? "อนุมัติ" : "ไม่อนุมัติ"} ใบลาออก ${resignation.requestId} ของ <@${resignation.discordId}>`,
      logFields
    )
  );
}

module.exports = { handleButton, handleModalSubmit };
