# API

Базовый путь `/api`, формат JSON, даты — ISO 8601 в UTC (`2026-10-15T09:00:00Z`).
Сессия — cookie `session` (httpOnly, Secure, SameSite=Lax), ставится при входе и регистрации.

Эталон поведения — мок-сервер `web/assets/js/mock/handlers.js`: те же пути, коды, проверки и тексты.
Клиент — `web/assets/js/api/index.js`. Меняем контракт → правим этот файл, клиент и мок вместе.

## Ошибки

Любой код ≥ 400 → `{"detail": "текст для пользователя", "field": "имя_поля" | null}`.

| Код | Когда |
|---|---|
| 400 | неверные данные (field — какое поле) |
| 401 | нет сессии / неверный логин или пароль |
| 403 | роль не admin в `/admin/*` |
| 404 | нет объекта, или чат чужой |
| 409 | конфликт: логин занят, действие над собой, последний админ |

Тексты — spec/product/errors.md.

## Типы

    User       = {login, role: "user"|"admin", created_at, last_login_at | null}
    AdminUser  = User + {chats_count}
    Category   = {key, label, count}
    Command    = {id, category, name, command, description, examples: [3 строки], tags: [≥5 строк],
                  platform: "linux"|"mac"|"windows"|"unix"|"cross"}
    Reply      = {type: "found", commands: [Command], related: [Command ≤ 2]}
               | {type: "not_found", message, commands: [Command × 0–3]}
    Message    = {id, role: "user", text, created_at} | {id, role: "assistant", reply: Reply, created_at}
    ChatSummary= {id, title, created_at, updated_at}
    Chat       = ChatSummary + {messages: [Message]}

`Command.id` — непрозрачная строка. Для существующего корпуса: `<категория>-<индекс>` (`git-3`).

## Авторизация — доступно гостю

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | /auth/register | {login, password} | 201 User, ставит cookie. role всегда user |
| POST | /auth/login | {login, password} | 200 User, ставит cookie; 401 при ошибке |
| POST | /auth/logout | — | 204, удаляет cookie |
| GET | /auth/me | — | 200 User / 401 |
| POST | /auth/change-password | {login, old_password, new_password} | 204; 401 при неверной паре |

Логин приводится к нижнему регистру: 3–32 символа без пробелов. Пароль — от 6 символов.

## Датасет — user, admin

| Метод | Путь | Ответ |
|---|---|---|
| GET | /categories | [Category] |
| GET | /commands?category=git&q=текст | [Command]; оба параметра необязательны |
| GET | /commands/{id} | Command / 404 |

## Чаты — user, admin, только свои

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | /chats | — | [ChatSummary], новые сверху |
| POST | /chats | {message} | 201 {chat: ChatSummary, messages: [Message user, Message assistant]} — новый чат |
| GET | /chats/{id} | — | Chat / 404 |
| POST | /chats/{id}/messages | {message} | 201 {chat, messages: [user, assistant]} — следующий вопрос |
| DELETE | /chats/{id} | — | 204 / 404 |

Правила ответа (`reply`):
- `found` — есть уверенное совпадение: лучшая команда целиком + до 2 похожих в `related`;
- `not_found` с командами — уверенного совпадения нет, но у 1–3 команд совпали значимые слова запроса (или их основы):
  `message` = «Подходящая команда не найдена. Возможно, подойдут указанные ниже варианты?»;
- `not_found` без команд — совпадений нет совсем (бессмыслица, тема не про IT, например «кракозябра»):
  `commands: []`, `message` = «Подходящая команда не найдена. Попробуйте описать задачу другими словами.»
  Случайные команды в этом случае не подставляются.
Порог «уверенно / отдалённо / ничего» выбирает поиск (BM25); в моке — простая оценка по словам, `mock/search.js`.

`title` = первые 48 символов первого запроса. `message` — 1–2000 символов.
Ответ строится по истории чата (уточняющие вопросы).

## Администратор — только admin (иначе 403)

### Команды

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | /admin/commands | Command без id | 201 Command |
| PUT | /admin/commands/{id} | Command без id | 200 Command / 404 |
| DELETE | /admin/commands/{id} | — | 204 / 404 |

Проверки: category из списка, name/command/description не пустые, examples ровно 3, tags ≥ 5, platform из списка.
Изменения сразу попадают в `data/corpus/<category>.json` и в индекс BM25.

### Пользователи

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | /admin/users?q=логин&role=admin | — | [AdminUser], по алфавиту |
| GET | /admin/users/{login} | — | AdminUser / 404 |
| POST | /admin/users | {login, password, role} | 201 AdminUser; 409 логин занят |
| PATCH | /admin/users/{login} | {role?, password?} | 200 AdminUser |
| DELETE | /admin/users/{login} | — | 204, удаляет и чаты пользователя |

409: изменить свою роль, удалить себя, понизить или удалить последнего admin.
Содержимое чужих чатов через API не отдаётся.
