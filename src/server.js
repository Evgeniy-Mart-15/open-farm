import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Telegraf, Markup } from 'telegraf';
import { getOrCreateUser, saveFarmState, updateUser, bindReferrer, getReferralStats, claimDaily } from './store.js';

const app = express();
const PORT = process.env.PORT || 4000;
const WEBAPP_ORIGIN = process.env.WEBAPP_ORIGIN || 'http://localhost:4173';
const BOT_TOKEN = process.env.BOT_TOKEN;

// Render даёт URL сервиса через RENDER_EXTERNAL_URL
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL || '';

const corsOrigins = [
  WEBAPP_ORIGIN,
  'http://localhost:4173',
  'https://openfarmiks.netlify.app'
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, true);
    },
    credentials: true
  })
);
app.use(express.json());

// ===== API =====

app.get('/health', (req, res) => {
  res.json({ ok: true, version: '0.3.0', bot: !!BOT_TOKEN });
});

app.get('/api/farm', (req, res) => {
  const userId = String(req.query.userId || '');
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const user = getOrCreateUser(userId);
  const state = {
    level: user.level,
    resources: user.resources,
    crops: user.crops,
    animals: user.animals,
    referrerId: user.referrerId ?? null
  };
  return res.json({ state });
});

app.post('/api/farm/sync', (req, res) => {
  const { userId, state } = req.body || {};
  if (!userId || !state) return res.status(400).json({ error: 'userId and state are required' });
  const updated = saveFarmState(userId, state);
  return res.json({
    state: {
      level: updated.level,
      resources: updated.resources,
      crops: updated.crops,
      animals: updated.animals
    }
  });
});

app.post('/api/referral/bind', (req, res) => {
  const { userId, referrerId } = req.body || {};
  if (!userId || !referrerId) return res.status(400).json({ error: 'userId and referrerId are required' });
  const user = bindReferrer(userId, referrerId);
  return res.json({ ok: true, referrerId: user.referrerId });
});

app.get('/api/referral/stats', (req, res) => {
  const userId = String(req.query.userId || '');
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const stats = getReferralStats(userId);
  return res.json(stats);
});

app.post('/api/daily/claim', (req, res) => {
  const userId = String(req.body?.userId ?? req.query?.userId ?? '');
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const result = claimDaily(userId);
  if (result.claimed) {
    const user = getOrCreateUser(userId);
    return res.json({ ...result, coins: user.resources.coins });
  }
  return res.json(result);
});

app.post('/api/payments/add-gems', (req, res) => {
  const { userId, gems, paymentId } = req.body || {};
  if (!userId || !gems || gems < 1) return res.status(400).json({ error: 'userId and gems (>= 1) required' });
  const user = getOrCreateUser(userId);
  const add = Math.floor(Number(gems));
  const updated = updateUser(userId, {
    resources: { ...user.resources, gems: (user.resources?.gems ?? 0) + add }
  });
  return res.json({ ok: true, gems: updated.resources.gems, paymentId: paymentId ?? null });
});

// ===== TELEGRAM BOT (webhook) =====

let bot = null;

if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN);

  bot.start(async (ctx) => {
    const user = ctx.from;
    const startParam = ctx.startPayload;

    let refInfo = '';
    if (startParam && startParam.startsWith('ref_')) {
      const referrerId = startParam.slice('ref_'.length);
      refInfo = `\nТебя пригласил пользователь с id: ${referrerId}`;
      // Привязываем реферера
      if (user?.id) {
        bindReferrer(String(user.id), referrerId);
      }
    }

    const webAppUrl = WEBAPP_ORIGIN;
    const text =
      `Привет, ${user.first_name || 'фермер'}! 🌱\n` +
      'Это мини‑игра‑ферма. Открывай мини‑апп и выращивай помидоры, огурцы, коров и кур.\n' +
      refInfo;

    if (webAppUrl.startsWith('https://')) {
      await ctx.reply(text, Markup.inlineKeyboard([[Markup.button.webApp('Открыть мини‑апп', webAppUrl)]]));
    } else {
      await ctx.reply(`${text}\n\nЛокальный адрес: ${webAppUrl}`, Markup.inlineKeyboard([[Markup.button.url('Открыть в браузере', webAppUrl)]]));
    }
  });

  bot.command('mini_app', async (ctx) => {
    const user = ctx.from;
    const webAppUrl = WEBAPP_ORIGIN;
    const text = `Привет, ${user.first_name || 'фермер'}! 🌱\nОткрывай мини‑апп и играй в ферму.`;

    if (webAppUrl.startsWith('https://')) {
      await ctx.reply(text, Markup.inlineKeyboard([[Markup.button.webApp('Открыть mini-app', webAppUrl)]]));
    } else {
      await ctx.reply(`${text}\n\nЛокальный адрес: ${webAppUrl}`, Markup.inlineKeyboard([[Markup.button.url('Открыть mini-app', webAppUrl)]]));
    }
  });

  // Webhook endpoint
  app.use(bot.webhookCallback('/webhook'));
}

// ===== START =====

app.listen(PORT, async () => {
  console.log(`Farm backend listening on http://localhost:${PORT}`);

  if (bot && RENDER_URL) {
    try {
      const webhookUrl = `${RENDER_URL}/webhook`;
      await bot.telegram.setWebhook(webhookUrl);
      await bot.telegram.setMyCommands([
        { command: 'start', description: 'Start / Начать' },
        { command: 'mini_app', description: 'Open mini-app / Открыть мини-апп' }
      ]);
      console.log(`Telegram bot webhook set to ${webhookUrl}`);
    } catch (err) {
      console.error('Failed to set webhook:', err.message);
    }
  } else if (bot) {
    console.log('Bot token found but no RENDER_URL/WEBHOOK_URL — run bot.js separately for long polling');
  }
});

process.once('SIGINT', () => { if (bot) bot.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', () => { if (bot) bot.stop('SIGTERM'); process.exit(0); });
