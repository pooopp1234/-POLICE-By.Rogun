require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Collection } = require("discord.js");
const embeds = require("./utils/embeds");
const dutyActions = require("./utils/dutyActions");
const panel = require("./utils/panel");
const weeklyReset = require("./utils/weeklyReset");
const { sendLog } = require("./utils/permissions");
const adminPanelHandler = require("./handlers/adminPanelHandler");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.commands = new Collection();

function loadCommands(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommands(fullPath);
    } else if (entry.name.endsWith(".js")) {
      const command = require(fullPath);
      if (command?.data?.name) {
        client.commands.set(command.data.name, command);
      }
    }
  }
}

loadCommands(path.join(__dirname, "commands"));

client.once("ready", async () => {
  console.log(`บอทออนไลน์แล้วในชื่อ ${client.user.tag}`);
  console.log(`โหลดคำสั่งทั้งหมด ${client.commands.size} คำสั่ง`);
  await panel.refreshPanel(client); // ซิงก์แผงเข้าเวรที่ปักไว้ให้ตรงกับสถานะล่าสุดหลังบอทรีสตาร์ท
  weeklyReset.start(client); // เริ่มระบบสรุป + รีเซ็ตชั่วโมงเวรรายสัปดาห์อัตโนมัติ
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในคำสั่ง /${interaction.commandName}:`, err);
      const errorReply = { embeds: [embeds.errorEmbed("เกิดข้อผิดพลาดขณะประมวลผลคำสั่ง กรุณาลองใหม่อีกครั้ง")] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorReply).catch(() => {});
      } else {
        await interaction.reply({ ...errorReply, ephemeral: true }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === "duty_checkin" || interaction.customId === "duty_checkout") {
      try {
        await interaction.deferReply({ ephemeral: true });

        const result =
          interaction.customId === "duty_checkin"
            ? await dutyActions.checkIn(interaction.user)
            : await dutyActions.checkOut(interaction.user);

        if (result.ok) {
          const successMessage =
            interaction.customId === "duty_checkin" ? "เข้าเวรสำเร็จ" : "ออกเวรสำเร็จ";
          await interaction.editReply({ embeds: [embeds.successEmbed(successMessage)] });

          const logKey = interaction.customId === "duty_checkin" ? "เข้าเวร" : "ออกเวร";
          await sendLog(interaction.client, logKey, result.logEmbed);
          await panel.refreshPanel(interaction.client);
        } else {
          await interaction.editReply({ embeds: [result.embed] });
        }
      } catch (err) {
        console.error(`เกิดข้อผิดพลาดขณะกดปุ่ม ${interaction.customId}:`, err);
        const errorReply = { embeds: [embeds.errorEmbed("เกิดข้อผิดพลาดขณะประมวลผล กรุณาลองใหม่อีกครั้ง")] };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(errorReply).catch(() => {});
        } else {
          await interaction.reply({ ...errorReply, ephemeral: true }).catch(() => {});
        }
      }
      return;
    }

    if (interaction.customId.startsWith("ap_")) {
      try {
        await adminPanelHandler.handleButton(interaction);
      } catch (err) {
        console.error(`เกิดข้อผิดพลาดในแผงแอดมิน (ปุ่ม ${interaction.customId}):`, err);
        await safeErrorReply(interaction);
      }
    }
    return;
  }

  if (interaction.isUserSelectMenu() && interaction.customId.startsWith("ap_select_")) {
    try {
      await adminPanelHandler.handleUserSelect(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในแผงแอดมิน (user select ${interaction.customId}):`, err);
      await safeErrorReply(interaction);
    }
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("ap_select_")) {
    try {
      await adminPanelHandler.handleStringSelect(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในแผงแอดมิน (string select ${interaction.customId}):`, err);
      await safeErrorReply(interaction);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("ap_modal_")) {
    try {
      await adminPanelHandler.handleModalSubmit(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในแผงแอดมิน (modal ${interaction.customId}):`, err);
      await safeErrorReply(interaction);
    }
    return;
  }
});

async function safeErrorReply(interaction) {
  const errorReply = { embeds: [embeds.errorEmbed("เกิดข้อผิดพลาดขณะประมวลผล กรุณาลองใหม่อีกครั้ง")] };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(errorReply).catch(() => {});
  } else {
    await interaction.reply({ ...errorReply, ephemeral: true }).catch(() => {});
  }
}

client.login(process.env.DISCORD_TOKEN);
