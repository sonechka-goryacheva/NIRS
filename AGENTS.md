# Правила для ИИ-агента

1. Не менять бизнес-логику без обновления spec/product/.
2. Не менять технические решения без обновления spec/tech/.
3. Любое изменение фиксировать в CHANGE_HISTORY.md.
4. Модули: app/search.py, app/llm.py, app/auth.py, app/api.py, web/.
5. Данные хранить только в data/ в формате JSON.
6. Фронтенд и бэкенд общаются только по spec/tech/api.md. Новая ручка = api.md + web/assets/js/api/index.js + мок.
7. Права проверяет сервер (spec/product/roles.md); скрытие кнопок в интерфейсе — не защита.
8. Интерфейс: HTML/CSS/JS без фреймворков, цвета и размеры — токены из web/assets/css/theme.css.
