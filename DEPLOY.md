# Как задеплоить backend фермы

Пошаговая инструкция для деплоя на **Render.com** (бесплатный тариф). API будет доступен по адресу вида `https://farm-backend-xxx.onrender.com`.

---

## 1. Залей код на GitHub

1. Зайди на https://github.com и войди в аккаунт.
2. Нажми **New repository**. Название, например: `farm-backend`. **Create repository**.
3. На своём Mac открой терминал и выполни (подставь свой логин и имя репозитория):

```bash
cd /Users/evgenij/Documents/farm-backend
git init
git add .
git commit -m "Farm backend"
git branch -M main
git remote add origin https://github.com/ТВОЙ_ЛОГИН/farm-backend.git
git push -u origin main
```

Если `git` ещё не настроен, выполни один раз:
```bash
git config --global user.email "твой@email.com"
git config --global user.name "Твоё Имя"
```

---

## 2. Создай сервис на Render

1. Зайди на https://render.com и зарегистрируйся (можно через GitHub).
2. В панели нажми **New** → **Web Service**.
3. Подключи репозиторий **farm-backend** (если не виден — нажми **Configure account** и дай доступ к GitHub).
4. Выбери репозиторий `farm-backend`, нажми **Connect**.

---

## 3. Настройки сервиса

- **Name:** например `farm-backend`.
- **Region:** выбери ближайший (например Frankfurt).
- **Branch:** `main`.
- **Runtime:** `Node`.
- **Build Command:** оставь `npm install` (или пусто — Render сам поставит зависимости).
- **Start Command:** укажи `npm start` (или `node src/server.js`).

---

## 4. Переменные окружения (Environment)

В том же экране нажми **Advanced** и добавь переменные (**Add Environment Variable**):

| Key            | Value |
|----------------|--------|
| `BOT_TOKEN`    | Твой токен бота от @BotFather |
| `WEBAPP_ORIGIN`| `https://openfarmik.netlify.app` (или твой домен мини-аппа) |
| `MONGODB_URI`  | Строка подключения к MongoDB (например из Railway: `mongodb://user:password@host:port`) |
| `NODE_ENV`     | `production` (опционально) |

**PORT** указывать не нужно — Render сам задаёт порт. Бэкенд остаётся на Render; база — в переменной **MONGODB_URI** (поддерживаются также **MONGO_URI**, **MONGO_URL**, **MONGODB_URL**).

---

## 5. Создать сервис

Нажми **Create Web Service**. Render соберёт проект и запустит API. Подожди 1–2 минуты.

Когда статус станет **Live**, скопируй **URL сервиса** (например `https://farm-backend-xxxx.onrender.com`). Это адрес твоего backend в интернете.

---

## 6. Подключить мини-апп к этому backend

1. В папке **farm-miniapp** создай или открой файл **.env**.
2. Добавь строку (подставь свой URL с Render):

```
VITE_API_URL=https://farm-backend-xxxx.onrender.com
```

3. Собери и задеплой мини-апп заново:

```bash
cd /Users/evgenij/Documents/farm-miniapp
npm run build
```

4. Папку **dist** залей на Netlify (перетащи на https://app.netlify.com/drop или свой обычный деплой).

После этого мини-апп из Telegram будет сохранять прогресс и рефералов на твой backend на Render.

---

## 7. Бот

**API** теперь в облаке. **Бот** (ответ на /start, кнопка «Открыть мини‑апп») по-прежнему должен где-то работать. Варианты:

- **Запускать у себя на компе** (как сейчас):
  ```bash
  cd /Users/evgenij/Documents/farm-backend
  node src/bot.js
  ```
  Пока этот терминал открыт — бот онлайн.

- **Позже** можно вынести бота на тот же Render (отдельный Worker) или другой хостинг — тогда ничего локально держать не нужно.

---

## Важно

- На бесплатном тарире Render «засыпает» сервис после ~15 минут без запросов. Первый запрос после паузы может идти 30–60 секунд — это нормально.
- Без MongoDB данные хранятся в **data/users.json**; на Render при перезапуске они могут теряться (диск временный). Для постоянного хранения задай в **Environment** переменную с URL MongoDB. Бэкенд смотрит (в таком порядке): **MONGODB_URI**, **MONGO_URI**, **MONGO_URL**, **MONGODB_URL** — подставь ту, которую даёт твой хостинг или MongoDB Atlas.

Если что-то на каком-то шаге не получится — напиши, на каком шаге и что именно делаешь, подскажу по шагам.
