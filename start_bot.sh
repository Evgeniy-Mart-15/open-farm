#!/bin/bash
# Запуск бота Youdic_Bot для мини‑аппа фермы

cd /Users/evgenij/Documents/farm-backend

if [ ! -f .env ]; then
  echo "❌ Файл .env не найден. Скопируйте .env.example в .env и укажите BOT_TOKEN."
  exit 1
fi

if ! grep -q "BOT_TOKEN=.*[0-9]" .env; then
  echo "❌ В .env не задан BOT_TOKEN."
  exit 1
fi

echo "🤖 Запуск бота..."
echo "   Остановить: Ctrl+C"
echo ""

node src/bot.js
