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
  'https://openfarmikc.netlify.app'
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
  res.json({ ok: true, version: '0.4.0', bot: !!BOT_TOKEN });
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

// Создание ссылки на оплату для mini-app
app.post('/api/payments/create-invoice', async (req, res) => {
  const { userId, packageId } = req.body || {};
  if (!userId || !packageId) {
    return res.status(400).json({ error: 'userId and packageId required' });
  }
  
  const GEM_PACKAGES = [
    { id: 'gems_10', gems: 10, stars: 1, title: '10 гемов', description: 'Маленький набор гемов' },
    { id: 'gems_50', gems: 50, stars: 5, title: '50 гемов', description: 'Средний набор гемов' },
    { id: 'gems_150', gems: 150, stars: 10, title: '150 гемов', description: 'Большой набор гемов' },
  ];
  
  const pkg = GEM_PACKAGES.find(p => p.id === packageId);
  if (!pkg) {
    return res.status(400).json({ error: 'Invalid packageId' });
  }
  
  if (!bot) {
    return res.status(500).json({ error: 'Bot not initialized' });
  }
  
  try {
    const invoiceLink = await bot.telegram.createInvoiceLink({
      title: pkg.title,
      description: pkg.description,
      payload: JSON.stringify({ oderId: Date.now(), pkgId: pkg.id, userId }),
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: pkg.title, amount: pkg.stars }],
    });
    return res.json({ ok: true, invoiceLink });
  } catch (err) {
    console.error('Create invoice error:', err);
    return res.status(500).json({ error: 'Failed to create invoice' });
  }
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

    const webAppUrl = WEBAPP_ORIGIN + '?v=' + Date.now();
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
    const webAppUrl = WEBAPP_ORIGIN + '?v=' + Date.now();
    const text = `Привет, ${user.first_name || 'фермер'}! 🌱\nОткрывай мини‑апп и играй в ферму.`;

    if (webAppUrl.startsWith('https://')) {
      await ctx.reply(text, Markup.inlineKeyboard([[Markup.button.webApp('Открыть mini-app', webAppUrl)]]));
    } else {
      await ctx.reply(`${text}\n\nЛокальный адрес: ${webAppUrl}`, Markup.inlineKeyboard([[Markup.button.url('Открыть mini-app', webAppUrl)]]));
    }
  });

  // ===== TELEGRAM STARS PAYMENTS =====

  // Пакеты гемов для покупки
  const GEM_PACKAGES = [
    { id: 'gems_10', gems: 10, stars: 1, title: '10 гемов', description: 'Маленький набор гемов' },
    { id: 'gems_50', gems: 50, stars: 5, title: '50 гемов', description: 'Средний набор гемов' },
    { id: 'gems_150', gems: 150, stars: 10, title: '150 гемов', description: 'Большой набор гемов' },
  ];

  // Команда /donate — показать варианты покупки
  bot.command('donate', async (ctx) => {
    const buttons = GEM_PACKAGES.map(pkg => 
      [Markup.button.callback(`${pkg.title} — ${pkg.stars} ⭐`, `buy_${pkg.id}`)]
    );
    await ctx.reply(
      '💎 Купи гемы за Telegram Stars!\n\nГемы помогают ускорять рост и получать бонусы.',
      Markup.inlineKeyboard(buttons)
    );
  });

  // Обработка нажатия на кнопку покупки
  GEM_PACKAGES.forEach(pkg => {
    bot.action(`buy_${pkg.id}`, async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.replyWithInvoice({
        title: pkg.title,
        description: pkg.description,
        payload: JSON.stringify({ oderId: Date.now(), pkgId: pkg.id, userId: ctx.from.id }),
        provider_token: '', // Пустой для Telegram Stars
        currency: 'XTR', // XTR = Telegram Stars
        prices: [{ label: pkg.title, amount: pkg.stars }],
      });
    });
  });

  // Подтверждение платежа (обязательно ответить за 10 секунд)
  bot.on('pre_checkout_query', async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  // Успешный платёж — начисляем гемы
  bot.on('message', async (ctx, next) => {
    if (ctx.message?.successful_payment) {
      const payment = ctx.message.successful_payment;
      try {
        const payload = JSON.parse(payment.invoice_payload);
        const pkg = GEM_PACKAGES.find(p => p.id === payload.pkgId);
        if (pkg && ctx.from?.id) {
          const userId = String(ctx.from.id);
          const user = getOrCreateUser(userId);
          updateUser(userId, {
            resources: { ...user.resources, gems: (user.resources?.gems ?? 0) + pkg.gems }
          });
          await ctx.reply(`✅ Спасибо за покупку!\n\n+${pkg.gems} 💎 гемов добавлено на твой счёт.`);
        }
      } catch (e) {
        console.error('Payment processing error:', e);
        await ctx.reply('Платёж получен! Гемы скоро будут начислены.');
      }
      return;
    }
    return next();
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
        { command: 'mini_app', description: 'Open mini-app / Открыть мини-апп' },
        { command: 'donate', description: 'Buy gems / Купить гемы' }
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
