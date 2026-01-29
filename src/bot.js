import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_ORIGIN = process.env.WEBAPP_ORIGIN || 'http://localhost:4173';

if (!BOT_TOKEN) {
  // eslint-disable-next-line no-console
  console.error('BOT_TOKEN is not set in environment');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  const user = ctx.from;
  const startParam = ctx.startPayload; // здесь может быть ref_xxx

  let refInfo = '';
  if (startParam && startParam.startsWith('ref_')) {
    const referrerId = startParam.slice('ref_'.length);
    refInfo = `\nТебя пригласил пользователь с id: ${referrerId}`;
    // Здесь можно дернуть backend /api/referral/bind
  }

  const webAppUrl = WEBAPP_ORIGIN;

  const text =
    `Привет, ${user.first_name || 'фермер'}! 🌱\n` +
    'Это мини‑игра‑ферма. Открывай мини‑апп и выращивай помидоры, огурцы, коров и кур.\n' +
    refInfo;

  // Telegram требует только HTTPS для WebApp-кнопок.
  // Для локальной разработки (http://localhost:4173) даём обычную URL‑кнопку.
  if (webAppUrl.startsWith('https://')) {
    await ctx.reply(
      text,
      Markup.inlineKeyboard([[Markup.button.webApp('Открыть мини‑апп', webAppUrl)]])
    );
  } else {
    await ctx.reply(
      `${text}\n\nЛокальный адрес мини‑аппа: ${webAppUrl}`,
      Markup.inlineKeyboard([[Markup.button.url('Открыть в браузере', webAppUrl)]])
    );
  }
});

async function sendMiniApp(ctx) {
  const user = ctx.from;
  const webAppUrl = WEBAPP_ORIGIN;
  const text =
    `Привет, ${user.first_name || 'фермер'}! 🌱\n` +
    'Открывай мини‑апп и играй в ферму.';

  if (webAppUrl.startsWith('https://')) {
    await ctx.reply(
      text,
      Markup.inlineKeyboard([[Markup.button.webApp('Открыть mini-app', webAppUrl)]])
    );
  } else {
    await ctx.reply(
      `${text}\n\nЛокальный адрес: ${webAppUrl}`,
      Markup.inlineKeyboard([[Markup.button.url('Открыть mini-app', webAppUrl)]])
    );
  }
}

bot.command('mini_app', sendMiniApp);

bot.launch().then(async () => {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Start / Начать' },
    { command: 'mini_app', description: 'Open mini-app / Открыть мини-апп' }
  ]);
  // eslint-disable-next-line no-console
  console.log('Telegram bot started');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

