# Развёртывание

## Локальный запуск

python -m app.main

## Зависимости

pip install -r requirements.txt

## Переменные окружения

Скопировать .env.example в .env и указать OPENAI_API_KEY.

## Сборка

pyinstaller --onefile app/main.py
