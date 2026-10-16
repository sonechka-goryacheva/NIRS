# Справочник IT-команд

Веб-приложение: пользователь описывает задачу словами и получает команду, описание и 3 примера.
Поиск по датасету — BM25, ответ формирует LLM.

## Интерфейс на моках (без бэкенда)

    python3 web/serve.py

Открыть http://localhost:8080. Демо: `admin / admin123` (администратор), `demo / demo123` (пользователь).

## Полный запуск

    pip install -r requirements.txt
    cp .env.example .env
    uvicorn app.api:app --reload --port 8000

## Тесты и бенчмарк

    pytest tests/
    python benchmark/run.py

## Документация

- spec/product — продукт, роли, сценарии, интерфейс, дизайн, ошибки
- spec/tech — архитектура, API, авторизация, UI, RAG, развёртывание
