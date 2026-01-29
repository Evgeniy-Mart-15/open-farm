import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** Загрузить пользователей из файла. Возвращает объект { [userId]: user }. */
export function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return data.users ?? {};
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Persistence load failed:', err?.message);
    return {};
  }
}

/** Сохранить пользователей в файл. usersObj = { [userId]: user }. */
export function save(usersObj) {
  try {
    ensureDataDir();
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ users: usersObj, updatedAt: new Date().toISOString() }, null, 0),
      'utf8'
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Persistence save failed:', err?.message);
  }
}
