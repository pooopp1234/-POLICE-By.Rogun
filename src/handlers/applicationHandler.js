const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require("discord.js");
const db = require("../utils/db");
const time = require("../utils/time");
const embeds = require("../utils/embeds");
const config = require("../../config.json");
const { isAdmin, sendLog } = require("../utils/permissions");

function applicationModal(department) {
  const modal = new ModalBuilder()
    .setCustomId(`form_modal_${department}`)
    .setTitle(`ใบสมัคร ${department}`.slice(0, 45));

  const gameNameInput = new TextInputBuilder()
    .setCustomId("gameName")
    .setLabel("ชื่อในเกม")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("เหตุผลที่อยากเข้าร่วมหน่วยงานนี้")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const experienceInput = new TextInputBuilder()
    .setCustomId("experience")
    .setLabel("ประสบการณ์ / ข้อมูลเพิ่มเติม (ถ้ามี)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(gameNameInput),
    new ActionRowBuilder().addComponents(reasonInput),
    new ActionRowBuilder().addComponents(experienceInput)
  );
  return modal;
}

async function handleButton(interaction) {
  if (interaction.customId.startsWith("form_apply_")) {
    const department = interaction.customId.slice("form_apply_".length);

    const existingMember = await db.findMember(interaction.user.id);
    if (existingMember) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คุณเป็นสมาชิกในระบบอยู่แล้ว ไม่จำเป็นต้องสมัครใหม่")],
        flags: MessageFlags.Ephemeral,
      });
    }

    const pending = await db.findPendingApplication(interaction.user.id);
    if (pending) {
      return interaction.reply({
        embeds: [embeds.errorEmbed(`คุณมีใบสมัคร #${pending.id} ที่ยังรอการตรวจสอบอยู่แล้ว`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.showModal(applicationModal(department));
  }

  if (interaction.customId.startsWith("form_approve_") || interaction.customId.startsWith("form_reject_")) {
    return handleDecision(interaction);
  }
}

async function handleModalSubmit(interaction) {
  if (!interaction.customId.startsWith("form_modal_")) return;

  const department = interaction.customId.slice("form_modal_".length);
  const gameName = interaction.fields.getTextInputValue("gameName").trim();
  const reason = interaction.fields.getTextInputValue("reason").trim();
  const experience = interaction.fields.getTextInputValue("experience")?.trim() || null;

  if (!gameName || !reason) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("กรุณากรอกข้อมูลให้ครบถ้วน")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const existingMember = await db.findMember(interaction.user.id);
  if (existingMember) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed("คุณเป็นสมาชิกในระบบอยู่แล้ว ไม่จำเป็นต้องสมัครใหม่")],
    });
  }

  const pending = await db.findPendingApplication(interaction.user.id);
  if (pending) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed(`คุณมีใบสมัคร #${pending.id} ที่ยังรอการตรวจสอบอยู่แล้ว`)],
    });
  }

  const application = await db.addApplication({
    discordId: interaction.user.id,
    discordName: interaction.user.tag,
    department,
    gameName,
    reason,
    experience,
    createdAt: time.nowIso(),
  });

  // เปลี่ยนชื่อเล่นในดิสคอร์ดเป็นชื่อในเกมทันทีที่ยื่นใบสมัคร (ถ้าเปลี่ยนไม่สำเร็จจะไม่ทำให้การสมัครล้มเหลว)
  const nicknameResult = await setNickname(interaction, interaction.user.id, gameName);

  const channelId = config.applicationChannelId;
  let posted = false;

  if (channelId && !channelId.startsWith("ใส่_")) {
    try {
      const reviewChannel = await interaction.client.channels.fetch(channelId);
      if (reviewChannel) {
        const message = await reviewChannel.send({
          embeds: [embeds.applicationReviewEmbed(application)],
          components: [embeds.applicationReviewRow(application.id)],
        });
        await db.setApplicationReviewMessage(application.id, reviewChannel.id, message.id);
        posted = true;
      }
    } catch (err) {
      console.error("ส่งใบสมัครเข้าห้องผู้อนุมัติไม่สำเร็จ:", err.message);
    }
  }

  await interaction.editReply({
    embeds: [
      embeds.successEmbed(
        posted
          ? `ส่งใบสมัคร #${application.id} เข้าหน่วยงาน ${department} เรียบร้อยแล้ว กรุณารอผลการพิจารณาจากผู้อนุมัติ`
          : `บันทึกใบสมัคร #${application.id} เรียบร้อยแล้ว แต่ยังไม่ได้ตั้งค่าห้องผู้อนุมัติ (applicationChannelId) กรุณาแจ้งแอดมิน`
      ),
    ],
  });

  await sendLog(
    interaction.client,
    "ใบสมัคร",
    embeds.adminActionEmbed("📝 ใบสมัครใหม่", `${interaction.user.tag} ส่งใบสมัครเข้าหน่วยงาน ${department}`, [
      { name: "ชื่อในเกม", value: gameName, inline: true },
      { name: "หน่วยงาน", value: department, inline: true },
    ])
  );

  // ถ้าเปลี่ยนชื่อเล่นไม่สำเร็จ แจ้งเตือนห้อง log แอดมิน
  if (!nicknameResult.ok) {
    await sendLog(
      interaction.client,
      "แอดมิน",
      embeds.errorEmbed(
        `เปลี่ยนชื่อเล่นให้ <@${interaction.user.id}> ตอนยื่นใบสมัคร #${application.id} ไม่สำเร็จ (เหตุผล: ${nicknameResult.reason})`
      )
    );
  }
}

// เปลี่ยนชื่อเล่น (Nickname) ในดิสคอร์ดให้ผู้สมัคร
// ใช้ทั้งตอนยื่นใบสมัคร (เปลี่ยนเป็นชื่อในเกมอย่างเดียว) และตอนอนุมัติ (เปลี่ยนเป็น "[ตำแหน่ง] ชื่อในเกม")
async function setNickname(interaction, discordId, nickname) {
  try {
    const guild = interaction.guild;
    if (!guild) return { ok: false, reason: "ไม่พบเซิร์ฟเวอร์ (ใช้นอกกิลด์)" };

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      return { ok: false, reason: "ผู้สมัครไม่ได้อยู่ในเซิร์ฟเวอร์แล้ว จึงเปลี่ยนชื่อไม่ได้" };
    }

    // Discord ห้ามบอทเปลี่ยนชื่อเล่นของเจ้าของเซิร์ฟเวอร์ (Server Owner) ไม่ว่ากรณีใด
    if (guild.ownerId === discordId) {
      return { ok: false, reason: "ไม่สามารถเปลี่ยนชื่อเล่นของเจ้าของเซิร์ฟเวอร์ได้ (ข้อจำกัดของ Discord)" };
    }

    const trimmed = nickname.slice(0, 32); // ดิสคอร์ดจำกัดชื่อเล่นไม่เกิน 32 ตัวอักษร
    await member.setNickname(trimmed);
    return { ok: true, nickname: trimmed };
  } catch (err) {
    // เกิดได้บ่อยตอนยศของบอทอยู่ต่ำกว่ายศสูงสุดของสมาชิกคนนั้น หรือบอทไม่มีสิทธิ์ Manage Nicknames
    console.error(`เปลี่ยนชื่อเล่นให้ ${discordId} ไม่สำเร็จ:`, err.message);
    return { ok: false, reason: err.message };
  }
}

// แจกยศ (Role) ในดิสคอร์ดให้ผู้สมัครทันทีที่ได้รับการอนุมัติ
// อ่านรายชื่อยศจาก config.autoRoleIds (ตั้งได้กี่ยศก็ได้ ไม่จำกัดแค่ 2)
async function assignAutoRoles(interaction, discordId) {
  const roleIds = (config.autoRoleIds || []).filter((id) => id && !id.startsWith("ใส่_"));
  if (roleIds.length === 0) return null; // ยังไม่ได้ตั้งค่า ข้ามไปเงียบๆ

  try {
    const guild = interaction.guild;
    if (!guild) return { ok: false, reason: "ไม่พบเซิร์ฟเวอร์ (ใช้นอกกิลด์)" };

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      return { ok: false, reason: "ผู้สมัครไม่ได้อยู่ในเซิร์ฟเวอร์แล้ว จึงแจกยศไม่ได้" };
    }

    const added = [];
    const failed = [];

    for (const roleId of roleIds) {
      try {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          failed.push(`\`${roleId}\` (ไม่พบยศนี้)`);
          continue;
        }
        await member.roles.add(role);
        added.push(`<@&${roleId}>`);
      } catch (err) {
        // เกิดได้บ่อยตอนยศของบอทอยู่ต่ำกว่ายศเป้าหมาย หรือบอทไม่มีสิทธิ์ Manage Roles
        failed.push(`<@&${roleId}> (${err.message})`);
      }
    }

    return { ok: failed.length === 0, added, failed };
  } catch (err) {
    console.error(`แจกยศอัตโนมัติให้ ${discordId} ไม่สำเร็จ:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function handleDecision(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("เฉพาะผู้อนุมัติ (แอดมิน) เท่านั้นที่กดปุ่มนี้ได้")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const approve = interaction.customId.startsWith("form_approve_");
  const id = Number(interaction.customId.slice(approve ? "form_approve_".length : "form_reject_".length));

  await interaction.deferUpdate();

  const status = approve ? "อนุมัติ" : "ปฏิเสธ";
  const application = await db.decideApplication(id, status, interaction.user.id, time.nowIso());

  if (!application) {
    return interaction.followUp({
      embeds: [embeds.errorEmbed("ใบสมัครนี้ถูกตัดสินไปแล้ว หรือไม่พบข้อมูล")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.editReply({
    embeds: [embeds.applicationReviewEmbed(application, `<@${interaction.user.id}>`)],
    components: [embeds.applicationReviewRow(application.id, true)],
  });

  let roleResult = null; // null = ไม่ได้พยายามแจกยศ (ไม่ใช่การอนุมัติครั้งแรก หรือไม่ได้ตั้งค่า)
  let approveNicknameResult = null;

  if (approve) {
    const alreadyMember = await db.findMember(application.discordId);
    if (!alreadyMember) {
      const defaultPosition = config.positions?.[config.positions.length - 1] || "สมาชิกใหม่";
      await db.addMember({
        discordId: application.discordId,
        discordName: application.discordName,
        gameName: application.gameName,
        department: application.department,
        position: defaultPosition,
        registeredAt: time.nowIso(),
      });

      try {
        const roster = require("../utils/roster");
        await roster.refreshRoster(interaction.client);
      } catch (err) {
        console.error("อัปเดตห้องรายชื่อหลังอนุมัติใบสมัครไม่สำเร็จ:", err.message);
      }

      roleResult = await assignAutoRoles(interaction, application.discordId);

      // เปลี่ยนชื่อเล่นเป็นรูปแบบสมาชิกจริง: "[ตำแหน่ง] ชื่อในเกม"
      approveNicknameResult = await setNickname(
        interaction,
        application.discordId,
        `[${defaultPosition}] ${application.gameName}`
      );
    }
  }

  try {
    const applicant = await interaction.client.users.fetch(application.discordId);
    await applicant.send({ embeds: [embeds.applicationResultEmbed(application)] });
  } catch (err) {
    console.error(`ส่ง DM แจ้งผลใบสมัคร #${application.id} ไม่สำเร็จ (อาจปิดรับ DM):`, err.message);
  }

  const logFields = [
    { name: "หน่วยงาน", value: application.department, inline: true },
    { name: "ชื่อในเกม", value: application.gameName, inline: true },
  ];

  if (roleResult) {
    if (roleResult.added?.length) {
      logFields.push({ name: "แจกยศสำเร็จ", value: roleResult.added.join(" "), inline: false });
    }
    if (roleResult.failed?.length) {
      logFields.push({ name: "แจกยศไม่สำเร็จ", value: roleResult.failed.join("\n"), inline: false });
    }
    if (roleResult.reason) {
      logFields.push({ name: "แจกยศไม่สำเร็จ", value: roleResult.reason, inline: false });
    }
  }

  if (approveNicknameResult?.ok) {
    logFields.push({ name: "เปลี่ยนชื่อเล่นสำเร็จ", value: approveNicknameResult.nickname, inline: false });
  }

  await sendLog(
    interaction.client,
    "ใบสมัคร",
    embeds.adminActionEmbed(
      approve ? "✅ อนุมัติใบสมัคร" : "❌ ปฏิเสธใบสมัคร",
      `<@${interaction.user.id}> ${approve ? "อนุมัติ" : "ปฏิเสธ"} ใบสมัคร #${application.id} ของ <@${application.discordId}>`,
      logFields
    )
  );

  // ถ้าแจกยศไม่สำเร็จ ให้แจ้งเตือนเข้าห้อง log แอดมินด้วย เพื่อให้แก้ไขให้ทันที
  if (roleResult && !roleResult.ok) {
    await sendLog(
      interaction.client,
      "แอดมิน",
      embeds.errorEmbed(
        `แจกยศอัตโนมัติให้ <@${application.discordId}> ไม่สำเร็จบางส่วน/ทั้งหมด กรุณาแจกยศด้วยตนเอง (เหตุผล: ${
          roleResult.reason || roleResult.failed?.join(", ")
        })`
      )
    );
  }

  // ถ้าเปลี่ยนชื่อเล่นตอนอนุมัติไม่สำเร็จ ให้แจ้งเตือนห้อง log แอดมินเช่นกัน
  if (approveNicknameResult && !approveNicknameResult.ok) {
    await sendLog(
      interaction.client,
      "แอดมิน",
      embeds.errorEmbed(
        `เปลี่ยนชื่อเล่นให้ <@${application.discordId}> ตอนอนุมัติไม่สำเร็จ กรุณาเปลี่ยนด้วยตนเอง (เหตุผล: ${approveNicknameResult.reason})`
      )
    );
  }
}

module.exports = { handleButton, handleModalSubmit };
