# Развёртывание

Один сервис: FastAPI отдаёт API по `/api/*` и статику `web/` по `/`.
Фронтенд и API на одном домене — не нужен CORS, cookie сессии работает без настроек.
Роутинг фронта на `#/...`, поэтому серверу не нужен fallback на index.html.

## Только интерфейс (на моках)

    python3 web/serve.py

Открыть http://localhost:8080. Демо: admin / admin123, demo / demo123.
Из файла (file://) не откроется — браузеры не грузят ES-модули с диска.

## Полный запуск

    pip install -r requirements.txt
    cp .env.example .env              # OPENAI_API_KEY, SESSION_SECRET
    uvicorn app.api:app --reload --port 8000

Перед этим — интеграция фронта: spec/tech/ui_tech.md, раздел «Интеграция».

## Раздача статики (app/api.py)

    app.include_router(api_router, prefix="/api")
    app.mount("/", StaticFiles(directory="web", html=True), name="web")   # после /api

## Кэширование на сервере
- `index.html` — `Cache-Control: no-cache` (браузер всегда сверяет страницу с сервером).
- Остальная статика — можно кэшировать надолго: в ссылках стоит `?v=<версия>`, при выпуске её меняет `python3 web/tools/bump_version.py`.
- Иконка вкладки встроена в `index.html`, поэтому после обновления сразу новая.

## Хостинг

- Команда запуска: `uvicorn app.api:app --host 0.0.0.0 --port $PORT`.
- Переменные: `OPENAI_API_KEY`, `USE_STUB`, `SESSION_SECRET`.
- Только HTTPS (cookie Secure, пароли в теле запросов).
- `data/users.json` и `data/chats.json` — на постоянном диске (volume).
- `.env` не коммитится, в `.env.example` только заглушки.
