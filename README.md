## Farm Backend – Telegram-бот и API для фермы

Этот проект — backend и бот для мини‑игры фермы, которая крутится во фронтенде (`farm-miniapp`).

### Что уже есть

- **Express-сервер** (`src/server.js`):
  - `GET /health` — проверка, что сервер жив.
  - `GET /api/farm?userId=...` — полное состояние фермы (уровень, ресурсы, грядки, животные).
  - `POST /api/farm/sync` — сохранить состояние фермы с фронта.
  - `POST /api/referral/bind` — привязать реферера при открытии по ссылке `ref_xxx`.
  - `GET /api/referral/stats?userId=...` — статистика рефералов и наград.
- **Telegram-бот** (`src/bot.js`): `/start`, `/mini_app`, кнопка «Открыть мини‑апп».
- **Хранилище**: состояние в памяти + файл `data/users.json` (переживает перезапуск).

### Настройка

1. Скопируй `.env.example` в `.env` и заполни:

```bash
cd farm-backend
cp .env.example .env
```

Открой `.env` и пропиши:

```bash
BOT_TOKEN=НОВЫЙ_ТОКЕН_ОТ_@BotFather_ДЛЯ_Youdic_Bot
PORT=4000
WEBAPP_ORIGIN=http://localhost:4173
```

> ВАЖНО: токен из чата лучше считать скомпрометированным и выдать новый через `@BotFather`.

2. Установи зависимости:

```bash
cd farm-backend
npm install
```

### Как запускать

1. Запустить backend API:

```bash
npm run dev
```

Сервер поднимется на `http://localhost:4000`.

2. Запустить Telegram-бота:

```bash
npm run bot
```

Бот начнёт принимать апдейты через long polling.

### Как связать с фронтендом и ботом

1. **Фронтенд (`farm-miniapp`)**
   - мини‑апп по адресу `http://localhost:4173` (или деплой),
   - при старте в Telegram WebApp ты можешь:
     - вытащить `user.id` и `start_param` в `telegram.ts`,
     - дернуть backend:
       - `GET /api/farm?userId=...` — загрузить ферму,
       - `POST /api/referral/bind` — если в `start_param` есть `ref_...`.

2. **Бот `@Youdic_Bot`**
   - токен лежит в `.env` как `BOT_TOKEN`,
   - в `@BotFather` настраиваешь для этого бота:
     - Web App URL = URL фронтенда (на этапе локалки — можно временно оставить, а для продакшена — указать деплой).

При `/start` бот:

- показывает приветствие (если есть `ref_...` — пишет, кто пригласил),
- даёт кнопку «Открыть ферму», которая открывает мини‑апп.

Дальше можно:

- расширять `src/server.js` под всю игровую экономику,
- добавить реальные реферальные награды и платежи (Stars / CryptoPay),
- перевести хранилище из памяти в реальную БД.

