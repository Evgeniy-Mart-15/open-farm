import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Telegraf, Markup } from 'telegraf';

const app = express();
const PORT = process.env.PORT || 4000;
const WEBAPP_ORIGIN = process.env.WEBAPP_ORIGIN || 'http://localhost:4173';
const BOT_TOKEN = process.env.BOT_TOKEN;
// Telegram ID администратора, который может выдавать награды (гемы/монеты) через админский mini-app
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '';

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

// ===== API (маршруты регистрируются в main() с store) =====

app.get('/health', (req, res) => {
  res.json({ ok: true, version: '0.4.0', bot: !!BOT_TOKEN });
});

// Пакеты гемов — ЕДИНСТВЕННОЕ место, где задаются цены и количество. Меняй здесь — фронт подхватит через GET /api/payments/packages.
// id должен совпадать с тем, что шлёт мини-апп (createInvoice/confirm-paid). Если меняешь пакеты — меняй только этот массив.
const GEM_PACKAGES_PAYMENTS = [
  { id: 'gems_50', gems: 50, stars: 10, title: '50 гемов', description: '50 гемов за 10 ⭐' },
  { id: 'gems_100', gems: 100, stars: 20, title: '100 гемов', description: '100 гемов за 20 ⭐' },
  { id: 'gems_200', gems: 200, stars: 25, title: '200 гемов', description: '200 гемов за 25 ⭐' },
];

/** Регистрирует маршруты, зависящие от store (файл или MongoDB). */
function registerRoutes(store) {
  // Единственный источник истины для game state (гемы, монеты, слоты). Mini App обязан запрашивать после оплаты.
  app.get('/api/me', async (req, res) => {
    const userId = String(req.query.userId || '');
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const user = await store.getOrCreateUser(userId);
    let referrerUsername = null;
    if (user.referrerId) {
      try {
        const referrer = await store.getOrCreateUser(user.referrerId);
        referrerUsername = referrer.username ?? null;
      } catch {
        // ignore
      }
    }
    return res.json({
      id: userId,
      level: user.level,
      resources: user.resources,
      crops: user.crops,
      animals: user.animals,
      revision: user.revision ?? 0,
      referrerId: user.referrerId ?? null,
      referrerUsername,
      username: user.username ?? null
    });
  });

  app.get('/api/farm', async (req, res) => {
    const userId = String(req.query.userId || '');
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const user = await store.getOrCreateUser(userId);
    let referrerUsername = null;
    if (user.referrerId) {
      try {
        const referrer = await store.getOrCreateUser(user.referrerId);
        referrerUsername = referrer.username ?? null;
      } catch {
        // ignore
      }
    }
    const state = {
      level: user.level,
      resources: user.resources,
      crops: user.crops,
      animals: user.animals,
      revision: user.revision ?? 0,
      referrerId: user.referrerId ?? null,
      referrerUsername,
      username: user.username ?? null
    };
    return res.json({ state });
  });

  app.post('/api/farm/sync', async (req, res) => {
    const { userId, state, username } = req.body || {};
    if (!userId || !state) return res.status(400).json({ error: 'userId and state are required' });
    const updated = await store.saveFarmState(userId, state, username);
    return res.json({
      state: {
        level: updated.level,
        resources: updated.resources,
        crops: updated.crops,
        animals: updated.animals,
        revision: updated.revision ?? 0
      }
    });
  });

  app.post('/api/referral/bind', async (req, res) => {
    const { userId, referrerId } = req.body || {};
    if (!userId || !referrerId) return res.status(400).json({ error: 'userId and referrerId are required' });
    const user = await store.bindReferrer(userId, referrerId);
    return res.json({ ok: true, referrerId: user.referrerId });
  });

  app.get('/api/referral/stats', async (req, res) => {
    const userId = String(req.query.userId || '');
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const stats = await store.getReferralStats(userId);
    return res.json(stats);
  });

  app.post('/api/daily/claim', async (req, res) => {
    const userId = String(req.body?.userId ?? req.query?.userId ?? '');
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const result = await store.claimDaily(userId);
    return res.json(result);
  });

  app.get('/api/stats', async (req, res) => {
    const stats = await store.getGlobalStats();
    return res.json(stats);
  });

  app.post('/api/payments/add-gems', async (req, res) => {
    const { userId, gems, paymentId } = req.body || {};
    if (!userId || !gems || gems < 1) return res.status(400).json({ error: 'userId and gems (>= 1) required' });
    const user = await store.getOrCreateUser(userId);
    const add = Math.floor(Number(gems));
    const updated = await store.updateUser(userId, {
      resources: { ...user.resources, gems: (user.resources?.gems ?? 0) + add }
    });
    return res.json({ ok: true, gems: updated.resources.gems, paymentId: paymentId ?? null });
  });

  // Подтверждение оплаты из мини-аппа: только addGems. Оплата = только gems, ничего больше.
  app.post('/api/payments/confirm-paid', async (req, res) => {
    const { userId, packageId, gems: gemsFromBody } = req.body || {};
    const uid = userId != null ? String(userId) : '';
    if (!uid) {
      return res.status(400).json({ error: 'userId required' });
    }
    let gemsToAdd = 0;
    if (packageId) {
      const pkg = GEM_PACKAGES_PAYMENTS.find(p => p.id === packageId);
      if (pkg) gemsToAdd = pkg.gems;
    } else if (gemsFromBody != null) {
      gemsToAdd = Math.max(0, Math.floor(Number(gemsFromBody)));
    }
    if (gemsToAdd <= 0) {
      return res.status(400).json({ error: 'packageId or gems required' });
    }
    try {
      const updated = await store.addGems(uid, gemsToAdd);
      const newTotal = updated?.resources?.gems ?? 0;
      console.log(`Confirm-paid: credited ${gemsToAdd} gems to ${uid}, new total ${newTotal}`);
      return res.json({ ok: true, gems: newTotal });
    } catch (e) {
      console.error('Confirm-paid error:', e);
      return res.status(500).json({ error: 'Failed to add gems' });
    }
  });

  // Admin: начислить награду любому пользователю (гемы или монеты) — только для владельца бота.
  app.post('/api/admin/reward', async (req, res) => {
    try {
      const { adminId, targetUserId, resource, amount } = req.body || {};
      const admin = String(adminId || '');
      const targetId = String(targetUserId || '');
      const kind = resource === 'gems' || resource === 'coins' ? resource : null;
      const num = Math.floor(Number(amount || 0));

      if (!ADMIN_TG_ID) {
        return res.status(403).json({ error: 'Admin rewards are disabled (no ADMIN_TG_ID)' });
      }
      if (!admin || admin !== ADMIN_TG_ID) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (!targetId || !kind || !num || num <= 0) {
        return res.status(400).json({ error: 'targetUserId, resource and positive amount are required' });
      }

      const user = await store.getOrCreateUser(targetId);
      const resources = user.resources || { coins: 0, gems: 0, feed: 0 };
      const current = resources[kind] ?? 0;
      const updated = await store.updateUser(targetId, {
        resources: { ...resources, [kind]: current + num }
      });

      return res.json({ ok: true, resources: updated.resources });
    } catch (err) {
      console.error('Admin reward error:', err);
      return res.status(500).json({ error: 'Failed to apply admin reward' });
    }
  });
}

app.get('/api/payments/packages', (req, res) => {
  return res.json({ packages: GEM_PACKAGES_PAYMENTS });
});

// Создание ссылки на оплату для mini-app
app.post('/api/payments/create-invoice', async (req, res) => {
  const { userId, packageId } = req.body || {};
  if (!userId || !packageId) {
    return res.status(400).json({ error: 'userId and packageId required' });
  }
  
  const pkg = GEM_PACKAGES_PAYMENTS.find(p => p.id === packageId);
  if (!pkg) {
    return res.status(400).json({ error: 'Invalid packageId' });
  }
  
  if (!bot) {
    return res.status(500).json({ error: 'Bot not initialized' });
  }
  
  try {
    // amount в XTR = количество звёзд (10, 20 или 25)
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

// Кастомный платёж: пользователь сам выбирает количество гемов
// Курс: 1 звезда = 5 гемов (округление вверх)
app.post('/api/payments/create-custom-invoice', async (req, res) => {
  const { userId, gems } = req.body || {};
  const gemsInt = Number(gems);
  if (!userId || !gemsInt || gemsInt <= 0) {
    return res.status(400).json({ error: 'userId and positive gems required' });
  }

  if (!bot) {
    return res.status(500).json({ error: 'Bot not initialized' });
  }

  try {
    const stars = Math.max(1, Math.ceil(gemsInt / 5));

    const title = `${gemsInt} гемов`;
    const description = `${gemsInt} 💎 за ${stars} ⭐`;

    const invoiceLink = await bot.telegram.createInvoiceLink({
      title,
      description,
      payload: JSON.stringify({ oderId: Date.now(), customGems: gemsInt, customStars: stars, userId }),
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: title, amount: stars }],
    });

    return res.json({ ok: true, invoiceLink });
  } catch (err) {
    console.error('Create custom invoice error:', err);
    return res.status(500).json({ error: 'Failed to create custom invoice' });
  }
});

// ===== TELEGRAM BOT (webhook) — создаётся в main() с доступом к store =====

let bot = null;

function getMongoUri() {
  return process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL || process.env.MONGODB_URL || '';
}

async function main() {
  const mongoUri = getMongoUri();
  let store;
  if (mongoUri) {
    try {
      store = await (await import('./store-mongo.js')).createStore(mongoUri);
      console.log('Store: MongoDB');
    } catch (err) {
      console.error('MongoDB connection failed after retries, falling back to JSON file store:', err.message);
      store = (await import('./store.js')).createFileStore();
      console.log('Store: JSON file (fallback)');
    }
  } else {
    store = (await import('./store.js')).createFileStore();
    console.log('Store: JSON file (data/users.json)');
  }
  registerRoutes(store);

  if (BOT_TOKEN) {
    bot = new Telegraf(BOT_TOKEN);

    // Устанавливаем меню-кнопку (и кнопку на обложке чата) с uid, чтобы открывалась настоящая версия
    async function setMenuButtonWithUid(chatId, userId) {
      if (!chatId || !userId || !WEBAPP_ORIGIN.startsWith('https://')) return;
      try {
        await bot.telegram.callApi('setChatMenuButton', {
          chat_id: chatId,
          menu_button: {
            type: 'web_app',
            text: 'Open Farm',
            web_app: { url: WEBAPP_ORIGIN + `?uid=${userId}` }
          }
        });
      } catch (_) { /* игнорируем ошибки API */ }
    }

    bot.use(async (ctx, next) => {
      if (ctx.chat?.type === 'private' && ctx.from?.id) {
        await setMenuButtonWithUid(ctx.chat.id, ctx.from.id);
      }
      return next();
    });

    bot.start(async (ctx) => {
      const user = ctx.from;
      await setMenuButtonWithUid(ctx.chat?.id, user?.id);
      const startParam = ctx.startPayload;

      let refInfo = '';
      if (startParam && startParam.startsWith('ref_')) {
        const referrerId = startParam.slice('ref_'.length);
        refInfo = `\nТебя пригласил пользователь с id: ${referrerId}`;
        if (user?.id) {
          await store.bindReferrer(String(user.id), referrerId);
        }
      }

    const webAppUrl = WEBAPP_ORIGIN + `?uid=${user.id}&v=` + Date.now();
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
    const webAppUrl = WEBAPP_ORIGIN + `?uid=${user.id}&v=` + Date.now();
    const text = `Привет, ${user.first_name || 'фермер'}! 🌱\nОткрывай мини‑апп и играй в ферму.`;

    if (webAppUrl.startsWith('https://')) {
      await ctx.reply(text, Markup.inlineKeyboard([[Markup.button.webApp('Открыть mini-app', webAppUrl)]]));
    } else {
      await ctx.reply(`${text}\n\nЛокальный адрес: ${webAppUrl}`, Markup.inlineKeyboard([[Markup.button.url('Открыть mini-app', webAppUrl)]]));
    }
  });

  // Админ-версия mini-app с параметром ?admin=1 для диагностики (только для тебя)
  bot.command('admin', async (ctx) => {
    const user = ctx.from;
    const webAppUrl = WEBAPP_ORIGIN + `?admin=1&uid=${user.id}&v=` + Date.now();
    const text = `Привет, ${user.first_name || 'фермер'}! 🌱\nАдмин-режим: открой мини-апп для диагностики.`;

    if (webAppUrl.startsWith('https://')) {
      await ctx.reply(text, Markup.inlineKeyboard([[Markup.button.webApp('Открыть mini-app (admin)', webAppUrl)]]));
    } else {
      await ctx.reply(`${text}\n\nЛокальный адрес: ${webAppUrl}`, Markup.inlineKeyboard([[Markup.button.url('Открыть mini-app (admin)', webAppUrl)]]));
    }
  });

  // ===== TELEGRAM STARS PAYMENTS =====
  // Используем общий список пакетов (amount в invoice = pkg.stars — 10, 20 или 25 звёзд)

  // Команда /donate — показать варианты покупки
  bot.command('donate', async (ctx) => {
    const buttons = GEM_PACKAGES_PAYMENTS.map(pkg => 
      [Markup.button.callback(`${pkg.title} — ${pkg.stars} ⭐`, `buy_${pkg.id}`)]
    );
    await ctx.reply(
      '💎 Купи гемы за Telegram Stars!\n\nГемы помогают ускорять рост и получать бонусы.',
      Markup.inlineKeyboard(buttons)
    );
  });

  // Обработка нажатия на кнопку покупки (amount = pkg.stars — 10, 20 или 25)
  GEM_PACKAGES_PAYMENTS.forEach(pkg => {
    bot.action(`buy_${pkg.id}`, async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.replyWithInvoice({
        title: pkg.title,
        description: pkg.description,
        payload: JSON.stringify({ oderId: Date.now(), pkgId: pkg.id, userId: ctx.from.id }),
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: pkg.title, amount: pkg.stars }],
      });
    });
  });

  // Подтверждение платежа (обязательно ответить за 10 секунд)
  bot.on('pre_checkout_query', async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (e) {
      console.error('pre_checkout_query error:', e);
      try {
        await ctx.answerPreCheckoutQuery(false, 'Временная ошибка. Попробуйте ещё раз.');
      } catch (_) {}
    }
  });

  // ОПЛАТА НАПРЯМУЮ СВЯЗАНА С GEMS. Успешный платёж → только addGems. Никаких coins, items, условий.
  bot.on('message', async (ctx, next) => {
    if (!ctx.message?.successful_payment) return next();
    const payment = ctx.message.successful_payment;
    let payload = {};
    try {
      if (typeof payment.invoice_payload === 'string') {
        payload = JSON.parse(payment.invoice_payload);
      }
    } catch (e) {
      console.error('Payment payload parse error:', e);
    }
    const userId = (ctx.from?.id != null ? String(ctx.from.id) : null) || (payload.userId != null ? String(payload.userId) : null);
    if (!userId) {
      console.error('Payment: no userId', { payload, from: ctx.from?.id });
      try {
        await ctx.reply('Платёж получен. Ошибка: не определён пользователь.');
      } catch (_) {}
      return;
    }
    let gemsAmount = 0;
    const pkg = payload.pkgId ? GEM_PACKAGES_PAYMENTS.find(p => p.id === payload.pkgId) : null;
    if (pkg) {
      gemsAmount = pkg.gems;
    } else if (payload.customGems != null) {
      gemsAmount = Math.floor(Number(payload.customGems)) || 0;
    }
    if (gemsAmount <= 0) {
      console.error('Payment: no gemsAmount', { payload, userId });
      try {
        await ctx.reply('Платёж получен! Спасибо.');
      } catch (_) {}
      return;
    }
    try {
      const updated = await store.addGems(userId, gemsAmount);
      const newTotal = updated?.resources?.gems ?? 0;
      console.log(`Payment: credited ${gemsAmount} gems to user ${userId}, new total ${newTotal}`);
      await setMenuButtonWithUid(ctx.chat?.id, userId);
      await ctx.reply(`✅ Спасибо за покупку!\n\n+${gemsAmount} 💎 гемов добавлено на твой счёт.`);
    } catch (e) {
      console.error('Payment processing error:', e);
      try {
        await ctx.reply('Платёж получен! Гемы скоро будут начислены. Если баланс не обновился — открой мини-приложение и зайди в Магазин.');
      } catch (_) {}
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
          { command: 'mini_app', description: 'Open mini-app / Открыть мини-апп' },
          { command: 'donate', description: 'Buy gems / Купить гемы' }
        ]);

        // Глобальная меню-кнопка без uid (для тех, кто ещё ни разу не писал боту); при первом сообщении ставим per-chat с uid
        await bot.telegram.callApi('setChatMenuButton', {
          menu_button: {
            type: 'web_app',
            text: 'Open Farm',
            web_app: { url: WEBAPP_ORIGIN + '?v=7' }
          }
        });
        console.log(`Telegram bot webhook set to ${webhookUrl}`);
      } catch (err) {
        console.error('Failed to set webhook:', err.message);
      }
    } else if (bot) {
      console.log('Bot token found but no RENDER_URL/WEBHOOK_URL — run bot.js separately for long polling');
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.once('SIGINT', () => { if (bot) bot.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', () => { if (bot) bot.stop('SIGTERM'); process.exit(0); });
