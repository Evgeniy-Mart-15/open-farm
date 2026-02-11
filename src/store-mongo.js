// Хранилище состояния фермы в MongoDB (при MONGODB_URI)

import { MongoClient } from 'mongodb';
import { getInitialFarmState } from './initialState.js';

const COLLECTION = 'users';
const REFERRAL_REWARD_GEMS = 5;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAILY_MARATHON = [
  { coins: 20, gems: 0, feed: 5 },
  { coins: 30, gems: 0, feed: 5 },
  { coins: 40, gems: 0, feed: 5 },
  { coins: 50, gems: 0, feed: 5 },
  { coins: 0, gems: 100, feed: 20 }
];

function defaultUser(userId) {
  return {
    id: userId,
    referrerId: null,
    username: null,
    lastDailyAt: null,
    dailyStreakDay: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...getInitialFarmState()
  };
}

/**
 * Создаёт store с подключением к MongoDB. Все методы возвращают Promise.
 * @param {string} uri MONGODB_URI
 * @returns {Promise<{ getOrCreateUser, updateUser, saveFarmState, bindReferrer, claimDaily, getReferralStats, getGlobalStats }>}
 */
export async function createStore(uri) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    socketTimeoutMS: 30000,
    retryWrites: true,
    retryReads: true
  });

  // Повторные попытки подключения (до 5 раз с задержкой)
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await client.connect();
      console.log(`MongoDB connected (attempt ${attempt})`);
      break;
    } catch (err) {
      console.error(`MongoDB connect attempt ${attempt}/5 failed:`, err.message);
      if (attempt === 5) throw err;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }

  const db = client.db();
  const col = db.collection(COLLECTION);

  await col.createIndex({ id: 1 }, { unique: true }).catch(() => {});

  async function getOrCreateUser(userId) {
    const id = String(userId);
    let doc = await col.findOne({ id });
    if (doc) {
      delete doc._id;
      return doc;
    }
    const user = defaultUser(id);
    await col.insertOne({ ...user, _id: id });
    return user;
  }

  async function updateUser(userId, patch) {
    const user = await getOrCreateUser(userId);
    const next = {
      ...user,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    if (patch.resources) {
      next.resources = { ...user.resources, ...patch.resources };
    }
    if (patch.crops !== undefined) next.crops = patch.crops;
    if (patch.animals !== undefined) next.animals = patch.animals;
    await col.replaceOne({ id: String(userId) }, next, { upsert: true });
    return next;
  }

  /** Начислить гемы (атомарно $inc), чтобы оплата не терялась при гонках с sync. */
  async function addGems(userId, amount) {
    const num = Math.max(0, Math.floor(Number(amount)));
    if (num === 0) return getOrCreateUser(userId);
    await getOrCreateUser(userId);
    await col.updateOne(
      { id: String(userId) },
      { $inc: { 'resources.gems': num }, $set: { updatedAt: new Date().toISOString() } }
    );
    return getOrCreateUser(userId);
  }

  async function saveFarmState(userId, state, username) {
    const user = await getOrCreateUser(userId);
    const serverRevision = typeof user.revision === 'number' ? user.revision : 0;
    const clientRevision = typeof state.revision === 'number' ? state.revision : 0;
    // Если на сервере уже есть более новая ревизия, а клиент шлёт старую (или 0),
    // игнорируем такой sync, чтобы старый клиент не откатил прогресс.
    if (serverRevision > 0 && (clientRevision === 0 || clientRevision < serverRevision)) {
      return user;
    }
    // Для монет и прогресса слотов источником истины считается клиент.
    // Для гемов берём максимум из серверного и клиентского значения, чтобы не потерять уже начисленные оплаты.
    const serverGems = user.resources?.gems ?? 0;
    const clientGems = state.resources?.gems ?? 0;
    const merged = { ...user.resources, ...state.resources };
    const resources = { ...merged, gems: Math.max(serverGems, clientGems) };
    const nextRevision =
      clientRevision > 0 ? clientRevision : (serverRevision > 0 ? serverRevision : 0) + 1;
    const next = {
      ...user,
      level: state.level ?? user.level,
      resources,
      crops: Array.isArray(state.crops) ? state.crops : user.crops,
      animals: Array.isArray(state.animals) ? state.animals : user.animals,
      revision: nextRevision,
      ...(username !== undefined && username !== null && { username: String(username) }),
      updatedAt: new Date().toISOString()
    };
    await col.replaceOne({ id: String(userId) }, next, { upsert: true });
    return next;
  }

  async function bindReferrer(userId, referrerId) {
    const user = await getOrCreateUser(userId);
    if (user.referrerId || userId === referrerId) return user;
    await updateUser(userId, { referrerId });
    const referrer = await getOrCreateUser(referrerId);
    const currentGems = referrer.resources?.gems ?? 0;
    await updateUser(referrerId, {
      resources: { ...referrer.resources, gems: currentGems + REFERRAL_REWARD_GEMS }
    });
    return getOrCreateUser(userId);
  }

  async function claimDaily(userId) {
    const user = await getOrCreateUser(userId);
    const now = Date.now();
    const last = user.lastDailyAt ? new Date(user.lastDailyAt).getTime() : 0;
    const streakDay = Math.min(5, Math.max(1, user.dailyStreakDay ?? 1));
    if (now - last < DAILY_COOLDOWN_MS && last > 0) {
      return { claimed: false, reward: null, streak: streakDay, nextAt: last + DAILY_COOLDOWN_MS };
    }
    const missedDay = last > 0 && (now - last) >= 2 * DAILY_COOLDOWN_MS;
    const dayIndex = missedDay ? 0 : streakDay - 1;
    const reward = DAILY_MARATHON[dayIndex];
    const nextStreak = missedDay ? 1 : ((streakDay % 5) + 1);
    const coins = (user.resources?.coins ?? 0) + reward.coins;
    const gems = (user.resources?.gems ?? 0) + reward.gems;
    const feed = (user.resources?.feed ?? 5) + reward.feed;
    await updateUser(userId, {
      resources: { ...user.resources, coins, gems, feed },
      lastDailyAt: new Date(now).toISOString(),
      dailyStreakDay: nextStreak
    });
    const currentStreak = missedDay ? 1 : streakDay;
    return {
      claimed: true,
      reward: { coins: reward.coins, gems: reward.gems, feed: reward.feed },
      streak: currentStreak,
      nextAt: now + DAILY_COOLDOWN_MS,
      resources: { coins, gems, feed }
    };
  }

  async function getReferralStats(userId) {
    const referredCount = await col.countDocuments({ referrerId: String(userId) });
    return {
      referredCount,
      rewardsGems: referredCount * REFERRAL_REWARD_GEMS
    };
  }

  async function getGlobalStats() {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const cursor = col.find({});
    let totalUsers = 0;
    let totalReferrals = 0;
    let totalCoins = 0;
    let totalGems = 0;
    let activeToday = 0;
    for await (const u of cursor) {
      totalUsers++;
      if (u.referrerId) totalReferrals++;
      totalCoins += u.resources?.coins ?? 0;
      totalGems += u.resources?.gems ?? 0;
      if (u.updatedAt && now - new Date(u.updatedAt).getTime() < dayMs) activeToday++;
    }
    return {
      totalUsers,
      totalReferrals,
      totalCoins,
      totalGems,
      activeToday,
      updatedAt: new Date().toISOString()
    };
  }

  return {
    getOrCreateUser,
    updateUser,
    addGems,
    saveFarmState,
    bindReferrer,
    claimDaily,
    getReferralStats,
    getGlobalStats,
    _client: client
  };
}
