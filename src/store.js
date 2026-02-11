// Хранилище состояния фермы: память + сохранение в data/users.json

import { getInitialFarmState } from './initialState.js';
import * as persistence from './persistence.js';

const users = new Map();

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

function loadFromFile() {
  const data = persistence.load();
  users.clear();
  for (const [id, u] of Object.entries(data)) {
    if (u && u.id) users.set(id, u);
  }
}

function saveToFile() {
  persistence.save(Object.fromEntries(users));
}

let loaded = false;
function ensureLoaded() {
  if (!loaded) {
    loadFromFile();
    loaded = true;
  }
}

export function getOrCreateUser(userId) {
  ensureLoaded();
  if (!users.has(userId)) {
    users.set(userId, defaultUser(userId));
    saveToFile();
  }
  return users.get(userId);
}

export function updateUser(userId, patch) {
  const user = getOrCreateUser(userId);
  const next = {
    ...user,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  if (patch.resources) {
    next.resources = { ...user.resources, ...patch.resources };
  }
  if (patch.crops) next.crops = patch.crops;
  if (patch.animals) next.animals = patch.animals;
  users.set(userId, next);
  saveToFile();
  return next;
}

/** Начислить гемы пользователю (атомарно для оплаты). */
export function addGems(userId, amount) {
  const user = getOrCreateUser(userId);
  const current = user.resources?.gems ?? 0;
  const nextGems = current + Math.max(0, Math.floor(Number(amount)));
  return updateUser(userId, {
    resources: { ...(user.resources || {}), gems: nextGems }
  });
}

export function saveFarmState(userId, state, username) {
  const user = getOrCreateUser(userId);
  const serverRevision = typeof user.revision === 'number' ? user.revision : 0;
  const clientRevision = typeof state.revision === 'number' ? state.revision : 0;
  // Если на сервере уже есть более новая ревизия, а клиент шлёт старую (или 0),
  // игнорируем такой sync, чтобы старый клиент не откатил прогресс.
  if (serverRevision > 0 && (clientRevision === 0 || clientRevision < serverRevision)) {
    return user;
  }
  // Для монет и прогресса слотов источником истины считаем клиент.
  // Для гемов берём максимум из серверного и клиентского значения, чтобы не потерять уже начисленные оплаты.
  const serverGems = user.resources?.gems ?? 0;
  const clientGems = state.resources?.gems ?? 0;
  const merged = { ...user.resources, ...state.resources };
  const resources = { ...merged, gems: Math.max(serverGems, clientGems) };
  const next = {
    ...user,
    level: state.level ?? user.level,
    resources,
    crops: Array.isArray(state.crops) ? state.crops : user.crops,
    animals: Array.isArray(state.animals) ? state.animals : user.animals,
    revision: clientRevision > 0 ? clientRevision : (serverRevision > 0 ? serverRevision : 0) + 1,
    ...(username !== undefined && username !== null && { username: String(username) }),
    updatedAt: new Date().toISOString()
  };
  users.set(userId, next);
  saveToFile();
  return next;
}

const REFERRAL_REWARD_GEMS = 5;

export function bindReferrer(userId, referrerId) {
  const user = getOrCreateUser(userId);
  if (user.referrerId || userId === referrerId) {
    return user;
  }
  updateUser(userId, { referrerId });
  const referrer = getOrCreateUser(referrerId);
  const currentGems = referrer.resources?.gems ?? 0;
  updateUser(referrerId, {
    resources: { ...referrer.resources, gems: currentGems + REFERRAL_REWARD_GEMS }
  });
  return getOrCreateUser(userId);
}

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Марафон 5 дней: день 1 — 20 монет + 5 корма, 2 — 30+5, 3 — 40+5, 4 — 50+5, 5 — 100 гемов + 20 корма. */
const DAILY_MARATHON = [
  { coins: 20, gems: 0, feed: 5 },
  { coins: 30, gems: 0, feed: 5 },
  { coins: 40, gems: 0, feed: 5 },
  { coins: 50, gems: 0, feed: 5 },
  { coins: 0, gems: 100, feed: 20 }
];

/** Забрать ежедневную награду (марафон 1–5 дней). Возвращает { claimed, reward: { coins, gems, feed }, streak, nextAt }. */
export function claimDaily(userId) {
  const user = getOrCreateUser(userId);
  const now = Date.now();
  const last = user.lastDailyAt ? new Date(user.lastDailyAt).getTime() : 0;
  const streakDay = Math.min(5, Math.max(1, (user.dailyStreakDay ?? 1)));
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
  updateUser(userId, {
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

/** Статистика рефералов: сколько приглашено и сколько гемов начислено */
export function getReferralStats(userId) {
  ensureLoaded();
  let referredCount = 0;
  for (const u of users.values()) {
    if (u.referrerId === userId) referredCount++;
  }
  return {
    referredCount,
    rewardsGems: referredCount * REFERRAL_REWARD_GEMS
  };
}

/** Глобальная статистика для аналитики */
export function getGlobalStats() {
  ensureLoaded();
  
  let totalUsers = 0;
  let totalReferrals = 0;
  let totalCoins = 0;
  let totalGems = 0;
  let activeToday = 0;
  
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  
  for (const u of users.values()) {
    totalUsers++;
    if (u.referrerId) totalReferrals++;
    totalCoins += u.resources?.coins ?? 0;
    totalGems += u.resources?.gems ?? 0;
    
    // Активен сегодня (обновлял данные за последние 24ч)
    if (u.updatedAt) {
      const updated = new Date(u.updatedAt).getTime();
      if (now - updated < dayMs) activeToday++;
    }
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

/** Фабрика для использования в server: один интерфейс (все методы возвращают Promise). */
export function createFileStore() {
  return {
    getOrCreateUser: (userId) => Promise.resolve(getOrCreateUser(userId)),
    updateUser: (userId, patch) => Promise.resolve(updateUser(userId, patch)),
    addGems: (userId, amount) => Promise.resolve(addGems(userId, amount)),
    saveFarmState: (userId, state, username) => Promise.resolve(saveFarmState(userId, state, username)),
    bindReferrer: (userId, referrerId) => Promise.resolve(bindReferrer(userId, referrerId)),
    claimDaily: (userId) => Promise.resolve(claimDaily(userId)),
    getReferralStats: (userId) => Promise.resolve(getReferralStats(userId)),
    getGlobalStats: () => Promise.resolve(getGlobalStats())
  };
}
