// Хранилище состояния фермы: память + сохранение в data/users.json

import { getInitialFarmState } from './initialState.js';
import * as persistence from './persistence.js';

const users = new Map();

function defaultUser(userId) {
  return {
    id: userId,
    referrerId: null,
    lastDailyAt: null,
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

export function saveFarmState(userId, state) {
  const user = getOrCreateUser(userId);
  const next = {
    ...user,
    level: state.level ?? user.level,
    resources: { ...user.resources, ...state.resources },
    crops: Array.isArray(state.crops) ? state.crops : user.crops,
    animals: Array.isArray(state.animals) ? state.animals : user.animals,
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
const DAILY_REWARD_COINS = 10;

/** Забрать ежедневную награду. Возвращает { claimed, reward, nextAt }. */
export function claimDaily(userId) {
  const user = getOrCreateUser(userId);
  const now = Date.now();
  const last = user.lastDailyAt ? new Date(user.lastDailyAt).getTime() : 0;
  if (now - last < DAILY_COOLDOWN_MS && last > 0) {
    return { claimed: false, reward: 0, nextAt: last + DAILY_COOLDOWN_MS };
  }
  const coins = (user.resources?.coins ?? 0) + DAILY_REWARD_COINS;
  updateUser(userId, {
    resources: { ...user.resources, coins },
    lastDailyAt: new Date(now).toISOString()
  });
  return { claimed: true, reward: DAILY_REWARD_COINS, nextAt: now + DAILY_COOLDOWN_MS };
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
