const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

function registerEmbed({ discordName, gameName, position, addedBy }) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📋 เพิ่มสมาชิกสำเร็จ")
    .addFields(
      { name: "Discord", value: discordName, inline: true },
      { name: "ชื่อ", value: gameName, inline: true },
      { name: "ตำแหน่ง", value: position, inline: true }
    )
    .setTimestamp();

  if (addedBy) {
    embed.addFields({ name: "เพิ่มโดย", value: addedBy, inline: true });
  }

  return embed;
}

function checkInEmbed({ discordUser, gameName, position, time, via }) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("🟢 เข้าเวร")
    .setDescription(
      discordUser ? `<@${discordUser.id}> **(${gameName})** ได้เข้าเวรแล้ว ✅` : `**${gameName}** ได้เข้าเวรแล้ว ✅`
    )
    .addFields(
      { name: "ชื่อ", value: gameName, inline: true },
      { name: "ตำแหน่ง", value: position || "-", inline: true },
      { name: "เวลา", value: time, inline: true }
    )
    .setTimestamp();

  if (discordUser) {
    embed.setAuthor({ name: discordUser.tag, iconURL: discordUser.displayAvatarURL() });
  }
  if (via) {
    embed.setFooter({ text: `ผ่าน: ${via}` });
  }

  return embed;
}

function checkOutEmbed({ discordUser, gameName, position, checkIn, checkOut, hours, via }) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("🔴 ออกเวร")
    .setDescription(
      discordUser ? `<@${discordUser.id}> **(${gameName})** ได้ออกเวรแล้ว 🏁` : `**${gameName}** ได้ออกเวรแล้ว 🏁`
    )
    .addFields(
      { name: "ชื่อ", value: gameName, inline: true },
      { name: "ตำแหน่ง", value: position || "-", inline: true },
      { name: "เวลาเข้า", value: checkIn, inline: true },
      { name: "เวลาออก", value: checkOut, inline: true },
      { name: "รวม", value: `${hours} ชั่วโมง`, inline: false }
    )
    .setTimestamp();

  if (discordUser) {
    embed.setAuthor({ name: discordUser.tag, iconURL: discordUser.displayAvatarURL() });
  }
  if (via) {
    embed.setFooter({ text: `ผ่าน: ${via}` });
  }

  return embed;
}

// ---------- Log แบบเรียบร้อย สำหรับส่งเข้าห้อง log (สไตล์เดียวกับแผงเข้าเวร) ----------

function checkInLogEmbed({ discordUser, gameName, position, time }) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setDescription(`🟢 **${gameName}** เข้าเวรแล้ว${discordUser ? ` — <@${discordUser.id}>` : ""}`)
    .addFields(
      { name: "ตำแหน่ง", value: position || "-", inline: true },
      { name: "เวลาเข้าเวร", value: time, inline: true }
    )
    .setFooter({ text: "POLICE CASE SYSTEM • Duty System" })
    .setTimestamp();

  if (discordUser) embed.setThumbnail(discordUser.displayAvatarURL());

  return embed;
}

function checkOutLogEmbed({ discordUser, gameName, position, checkIn, checkOut, hours }) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setDescription(`🔴 **${gameName}** ออกเวรแล้ว${discordUser ? ` — <@${discordUser.id}>` : ""}`)
    .addFields(
      { name: "ตำแหน่ง", value: position || "-", inline: true },
      { name: "เวลาเข้า", value: checkIn, inline: true },
      { name: "เวลาออก", value: checkOut, inline: true },
      { name: "รวมชั่วโมง", value: `${hours} ชม.`, inline: true }
    )
    .setFooter({ text: "POLICE CASE SYSTEM • Duty System" })
    .setTimestamp();

  if (discordUser) embed.setThumbnail(discordUser.displayAvatarURL());

  return embed;
}

function hoursEmbed({ gameName, hoursToday, hoursWeek, hoursMonth, dutyCount }) {
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle(`⏱️ ชั่วโมงเข้าเวรของ ${gameName}`)
    .addFields(
      { name: "วันนี้", value: `${hoursToday} ชม.`, inline: true },
      { name: "สัปดาห์นี้", value: `${hoursWeek} ชม.`, inline: true },
      { name: "เดือนนี้", value: `${hoursMonth} ชม.`, inline: true },
      { name: "จำนวนครั้งที่เข้าเวร", value: `${dutyCount} ครั้ง`, inline: false }
    )
    .setTimestamp();
}

function adminActionEmbed(title, description, fields = []) {
  return new EmbedBuilder()
    .setColor(0xeb459e)
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setTimestamp();
}

// ---------- แผงเข้าเวร (ปุ่มเข้าเวร/ออกเวรแบบข้อความปักหมุด) ----------

function dutyPanelEmbeds(onDutyList = []) {
  const count = onDutyList.length;
  const statusColor = count > 0 ? 0x57f287 : 0x3b3f47;
  const statusDot = count > 0 ? "🟢" : "⚪";

  const headerEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🚓 ระบบลงเวลาเข้าเวร");

  const infoEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription("กดปุ่มด้านล่างเพื่อเข้า/ออกเวร");

  const listText =
    count > 0
      ? onDutyList.map((d) => `\`${d.name}\``).join("\n")
      : "ไม่มีใครเข้าเวรในขณะนี้";

  const statusEmbed = new EmbedBuilder()
    .setColor(statusColor)
    .setDescription(`${statusDot} **กำลังเข้าเวร (${count} คน)**\n${listText}`)
    .setFooter({ text: "POLICE CASE SYSTEM • Duty System" })
    .setTimestamp();

  return [headerEmbed, infoEmbed, statusEmbed];
}

function dutyPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("duty_checkin")
      .setLabel("เข้าเวร")
      .setEmoji("🟢")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("duty_checkout")
      .setLabel("ออกเวร")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger)
  );
}

// ---------- ห้องรายชื่อ (รายชื่อสมาชิกแยกตามตำแหน่ง) ----------

const ROSTER_DIVIDER = "> ══════════════════════";
const ROSTER_CHUNK_LIMIT = 3800; // เผื่อพื้นที่ไว้ไม่ให้ชนลิมิต 4096 ตัวอักษรของ embed description

function rosterEmbeds(members, positions, title, updatedAtText) {
  const grouped = new Map(positions.map((pos) => [pos, []]));
  const others = [];

  for (const m of members) {
    if (grouped.has(m.position)) {
      grouped.get(m.position).push(m.gameName);
    } else {
      others.push(m.gameName);
    }
  }

  // สร้างเป็นรายบรรทัด (ไม่ใช่รายท่อน) เพื่อให้แบ่ง chunk ได้แม้แต่ตำแหน่งเดียวจะมีคนเยอะมากจนเกินลิมิตของ 1 embed
  const lines = [];
  for (const pos of positions) {
    lines.push(`## ${pos}`);
    const names = grouped.get(pos);
    if (names.length === 0) {
      lines.push("`-`");
    } else {
      names.forEach((n) => lines.push(`\`${n}\``));
    }
  }
  if (others.length > 0) {
    lines.push("## อื่นๆ");
    others.forEach((n) => lines.push(`\`${n}\``));
  }

  const header = `# ${title}\n${ROSTER_DIVIDER}`;
  const footer = `${ROSTER_DIVIDER}\n> อัปเดตล่าสุด : ${updatedAtText} | จำนวนทั้งหมด ${members.length} คน`;

  // แบ่งเป็นหลาย embed ถ้าเนื้อหายาวเกินไป (รองรับได้สูงสุด 10 embeds ต่อข้อความ)
  const chunks = [];
  let current = header;

  for (const line of lines) {
    const candidate = `${current}\n${line}`;
    if (candidate.length > ROSTER_CHUNK_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  chunks.push(current);

  // เติมบรรทัดอัปเดตล่าสุดต่อท้าย embed สุดท้าย (แยก embed ใหม่ถ้าไม่พอที่)
  const lastIndex = chunks.length - 1;
  if (chunks[lastIndex].length + footer.length + 1 <= ROSTER_CHUNK_LIMIT) {
    chunks[lastIndex] += `\n${footer}`;
  } else {
    chunks.push(footer);
  }

  return chunks
    .slice(0, 10) // Discord จำกัดสูงสุด 10 embeds ต่อข้อความ
    .map((desc) => new EmbedBuilder().setColor(0x5865f2).setDescription(desc));
}

function errorEmbed(message) {
  return new EmbedBuilder().setColor(0xed4245).setDescription(`❌ ${message}`);
}

function successEmbed(message) {
  return new EmbedBuilder().setColor(0x57f287).setDescription(`✅ ${message}`);
}

module.exports = {
  registerEmbed,
  checkInEmbed,
  checkOutEmbed,
  checkInLogEmbed,
  checkOutLogEmbed,
  hoursEmbed,
  adminActionEmbed,
  errorEmbed,
  successEmbed,
  dutyPanelEmbeds,
  dutyPanelRow,
  rosterEmbeds,
};
