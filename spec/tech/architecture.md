# Архитектура

## Схема

    Браузер (web/, SPA) ──HTTP /api──▶ FastAPI (app/api.py) ──▶ app/search.py ──▶ rag/ (BM25) ──▶ llm ──▶ ответ
                                           │
                                           └─▶ auth, data/*.json

## Модули

- web/ — интерфейс: одна страница, hash-роутер, клиент API, мок-сервер (spec/tech/ui_tech.md)
- app/api.py — HTTP API (spec/tech/api.md) и раздача web/
- app/auth.py — пользователи, пароли, проверки прав
- rag/ — поиск: предобработка, собственный обратный индекс и BM25, оценка качества (spec/tech/rag.md, rag/README.md)
- app/search.py — обёртка над rag/ для приложения
- app/llm.py — формирование ответа LLM
- app/ui.py — консольный интерфейс для отладки поиска
- app/main.py — запуск сервера

## Данные

- data/corpus/*.json — корпус команд (в git)
- data/users.json — пользователи (не в git)
- data/chats.json — чаты с владельцем (не в git)
