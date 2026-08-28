const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require("discord.js");
const db = require("../utils/db");
const time = require("../utils/time");
const embeds = require("../utils/embeds");
const config = require("../../config.json");
const { isApprover, sendLog } = require("../utils/permissions");

function resignSubmitModal() {
  const modal = new ModalBuilder().setCustomId("resign_modal_submit").setTitle("ยื่นใบลาออก");

  const nameInput = new TextInputBuilder()
    .setCustomId("fullName")
    .setLabel("ชื่อ-นามสกุล")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const noteInput = new TextInputBuilder()
    .setCustomId("note")
    .setLabel("หมายเหตุ / เหตุผลการลาออก")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(noteInput)
  );
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
  const fullName = interaction.fields.getTextInputValue("fullName").trim();
  const note = interaction.fields.getTextInputValue("note").trim();

  if (!fullName || !note) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("กรุณากรอกข้อมูลให้ครบถ้วน")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

async function finalizeDecision(interaction, id, approve, reason) {
  const status = approve ? db.RESIGN_STATUS_APPROVED : db.RESIGN_STATUS_REJECTED;
  const resignation = await db.decideResignation(id, status, interaction.user.id, interaction.user.tag, time.nowIso(), reason);

  if (!resignation) {
    return interaction.followUp({
      embeds: [embeds.errorEmbed("ใบลาออกนี้ถูกดำเนินการไปแล้ว หรือไม่พบข้อมูล")],
      flags: MessageFlags.Ephemeral,
    });
  }

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

  await sendLog(
    interaction.client,
    "แอดมิน",
    embeds.adminActionEmbed(
      approve ? "✅ อนุมัติใบลาออก" : "❌ ไม่อนุมัติใบลาออก",
      `${interaction.user.tag} ${approve ? "อนุมัติ" : "ไม่อนุมัติ"} ใบลาออก ${resignation.requestId} ของ <@${resignation.discordId}>`,
      reason ? [{ name: "เหตุผล", value: reason, inline: false }] : []
    )
  );
}

module.exports = { handleButton, handleModalSubmit };
