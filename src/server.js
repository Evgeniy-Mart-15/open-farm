import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { getOrCreateUser, saveFarmState, updateUser, bindReferrer, getReferralStats, claimDaily } from './store.js';

const app = express();
const PORT = process.env.PORT || 4000;
const WEBAPP_ORIGIN = process.env.WEBAPP_ORIGIN || 'http://localhost:4173';

const corsOrigins = [WEBAPP_ORIGIN, 'http://localhost:4173', 'https://openfarmik.netlify.app'].filter(Boolean);
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

app.get('/health', (req, res) => {
  res.json({ ok: true, version: '0.2.0' });
});

/** Получить полное состояние фермы для мини-аппа */
app.get('/api/farm', (req, res) => {
  const userId = String(req.query.userId || '');
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
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

/** Синхронизация состояния фермы (фронт присылает полный state после действий) */
app.post('/api/farm/sync', (req, res) => {
  const { userId, state } = req.body || {};
  if (!userId || !state) {
    return res.status(400).json({ error: 'userId and state are required' });
  }
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

/** Привязка реферера (при открытии по ссылке ref_xxx). Рефереру начисляются гемы. */
app.post('/api/referral/bind', (req, res) => {
  const { userId, referrerId } = req.body || {};
  if (!userId || !referrerId) {
    return res.status(400).json({ error: 'userId and referrerId are required' });
  }
  const user = bindReferrer(userId, referrerId);
  return res.json({ ok: true, referrerId: user.referrerId });
});

/** Статистика рефералов: приглашённые и награды в гемах */
app.get('/api/referral/stats', (req, res) => {
  const userId = String(req.query.userId || '');
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  const stats = getReferralStats(userId);
  return res.json(stats);
});

/** Ежедневная награда (раз в 24 ч) */
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

/** Начислить гемы (вызов после оплаты через Stars/CryptoPay или для теста) */
app.post('/api/payments/add-gems', (req, res) => {
  const { userId, gems, paymentId } = req.body || {};
  if (!userId || !gems || gems < 1) {
    return res.status(400).json({ error: 'userId and gems (>= 1) required' });
  }
  const user = getOrCreateUser(userId);
  const add = Math.floor(Number(gems));
  const updated = updateUser(userId, {
    resources: { ...user.resources, gems: (user.resources?.gems ?? 0) + add }
  });
  return res.json({ ok: true, gems: updated.resources.gems, paymentId: paymentId ?? null });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Farm backend listening on http://localhost:${PORT}`);
});
