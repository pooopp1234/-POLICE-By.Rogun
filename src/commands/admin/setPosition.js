const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const embeds = require("../../utils/embeds");
const roster = require("../../utils/roster");
const config = require("../../../config.json");
const { isAdmin, sendLog } = require("../../utils/permissions");

// ถอดยศตำแหน่งเก่า + ใส่ยศตำแหน่งใหม่ ตาม config.positionRoleIds
// คืนค่า null ถ้าไม่ได้ตั้งค่า mapping ไว้เลย (ข้ามไปเงียบๆ)
async function swapPositionRole(interaction, discordId, oldPosition, newPosition) {
  const roleMap = config.positionRoleIds || {};
  if (Object.keys(roleMap).length === 0) return null;

  const oldRoleId = roleMap[oldPosition];
  const newRoleId = roleMap[newPosition];

  try {
    const guild = interaction.guild;
    if (!guild) return { ok: false, reason: "ไม่พบเซิร์ฟเวอร์ (ใช้นอกกิลด์)" };

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      return { ok: false, reason: "สมาชิกไม่ได้อยู่ในเซิร์ฟเวอร์แล้ว จึงเปลี่ยนยศไม่ได้" };
    }

    const removed = [];
    const added = [];
    const failed = [];

    // ถอดยศตำแหน่งเก่าออกก่อน (ถ้ามี mapping และสมาชิกถือยศนั้นอยู่จริง)
    if (oldRoleId && oldRoleId !== newRoleId && member.roles.cache.has(oldRoleId)) {
      try {
        await member.roles.remove(oldRoleId);
        removed.push(`<@&${oldRoleId}>`);
      } catch (err) {
        failed.push(`ถอด <@&${oldRoleId}> ไม่สำเร็จ (${err.message})`);
      }
    }

    // ใส่ยศตำแหน่งใหม่ (ถ้ามี mapping และยังไม่ถืออยู่)
    if (newRoleId && !member.roles.cache.has(newRoleId)) {
      try {
        const role = await guild.roles.fetch(newRoleId).catch(() => null);
        if (!role) {
          failed.push(`\`${newRoleId}\` (ไม่พบยศนี้)`);
        } else {
          await member.roles.add(role);
          added.push(`<@&${newRoleId}>`);
        }
      } catch (err) {
        // เกิดได้บ่อยตอนยศของบอทอยู่ต่ำกว่ายศเป้าหมาย หรือบอทไม่มีสิทธิ์ Manage Roles
        failed.push(`เพิ่ม <@&${newRoleId}> ไม่สำเร็จ (${err.message})`);
      }
    }

    return { ok: failed.length === 0, removed, added, failed };
  } catch (err) {
    console.error(`สลับยศตำแหน่งให้ ${discordId} ไม่สำเร็จ:`, err.message);
    return { ok: false, reason: err.message };
  }
}

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
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

    const roleResult = await swapPositionRole(interaction, discordId, existing.position, position);

    const resultLines = [
      `เปลี่ยนตำแหน่งของ ${existing.gameName} (${existing.discordName}) เป็น "${position}" เรียบร้อยแล้ว`,
    ];
    if (roleResult?.removed?.length || roleResult?.added?.length) {
      const parts = [];
      if (roleResult.removed.length) parts.push(`ถอด ${roleResult.removed.join(" ")}`);
      if (roleResult.added.length) parts.push(`ใส่ ${roleResult.added.join(" ")}`);
      resultLines.push(parts.join(" / "));
    }
    if (roleResult && !roleResult.ok) {
      resultLines.push(
        `⚠️ เปลี่ยนยศไม่สำเร็จบางส่วน/ทั้งหมด (${roleResult.reason || roleResult.failed?.join(", ")}) กรุณาแก้ยศด้วยตนเอง`
      );
    }

    await interaction.editReply({
      embeds: [embeds.successEmbed(resultLines.join("\n"))],
    });

    await sendLog(
      interaction.client,
      "แอดมิน",
      embeds.adminActionEmbed("🎖️ เปลี่ยนตำแหน่ง", `แอดมิน ${interaction.user.tag} เปลี่ยนตำแหน่งสมาชิก`, [
        { name: "สมาชิก", value: `${existing.gameName} (${existing.discordName})`, inline: true },
        { name: "ตำแหน่งเดิม", value: existing.position || "-", inline: true },
        { name: "ตำแหน่งใหม่", value: position, inline: true },
      ])
    );

    if (roleResult && !roleResult.ok) {
      await sendLog(
        interaction.client,
        "แอดมิน",
        embeds.errorEmbed(
          `เปลี่ยนยศอัตโนมัติให้ <@${discordId}> ตอนแก้ไขตำแหน่งไม่สำเร็จบางส่วน/ทั้งหมด กรุณาแก้ยศด้วยตนเอง (เหตุผล: ${
            roleResult.reason || roleResult.failed?.join(", ")
          })`
        )
      );
    }
  },
};
