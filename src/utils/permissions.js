const config = require("../../config.json");

function isAdmin(interaction) {
  const memberRoles = interaction.member?.roles?.cache;
  if (!memberRoles) return false;
  return config.adminRoleIds.some((roleId) => memberRoles.has(roleId));
}

/**
 * ผู้อนุมัติ (สิทธิ์อนุมัติ/ไม่อนุมัติใบลาออก) — กำหนดด้วย approverRoleIds ใน config
 * แอดมิน (adminRoleIds) นับเป็นผู้อนุมัติได้เสมอ แม้จะไม่มีใน approverRoleIds
 */
function isApprover(interaction) {
  if (isAdmin(interaction)) return true;
  const memberRoles = interaction.member?.roles?.cache;
  if (!memberRoles) return false;
  const approverRoleIds = Array.isArray(config.approverRoleIds) ? config.approverRoleIds : [];
  return approverRoleIds.some((roleId) => memberRoles.has(roleId));
}

async function sendLog(client, channelKey, embed) {
  const channelId = config.logChannels[channelKey];
  if (!channelId || channelId.startsWith("ใส่_")) return; // ยังไม่ได้ตั้งค่า ข้ามไป
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`ส่ง log ไปห้อง ${channelKey} ไม่สำเร็จ:`, err.message);
  }
}

module.exports = { isAdmin, isApprover, sendLog };
