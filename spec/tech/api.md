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
| 401 | нет сессии / неверный логин, пароль или код восстановления |
| 403 | роль не admin в `/admin/*`; гость в `/my/*`, смене пароля, коде восстановления |
| 404 | нет объекта, или чат чужой |
| 409 | конфликт: логин занят, действие над собой, последний админ |

Тексты — spec/product/errors.md.

## Типы

    User       = {login, role: "guest"|"user"|"admin", created_at, last_login_at | null}
    AdminUser  = User + {chats_count}            # гости в /admin/users не попадают
    Category   = {key, label, count, personal?}  # personal: true — «Мои команды» (key "my")
    Command    = {id, category, name, command, description, examples: [3 строки], tags: [≥5 строк],
                  platform: "linux"|"mac"|"windows"|"unix"|"cross"}
    Reply      = {type: "found", commands: [Command], related: [Command ≤ 2]}
               | {type: "not_found", message, commands: [Command × 0–3]}
    Message    = {id, role: "user", text, created_at} | {id, role: "assistant", reply: Reply, created_at}
    ChatSummary= {id, title, created_at, updated_at, match?}
                 # match — только в ответе на поиск ?q=: фрагмент сообщения с совпадением, null — совпало название
    Chat       = ChatSummary + {messages: [Message]}

`Command.id` — непрозрачная строка. Для существующего корпуса: `<категория>-<индекс>` (`git-3`).
Личные команды: `category: "my"`, id начинается с `my-`; examples — 0–3 строки, tags — необязательны.

## Авторизация

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | /auth/register | {login, password} | 201 User + `recovery_code`, ставит cookie. role всегда user |
| POST | /auth/login | {login, password} | 200 User, ставит cookie; 401 при ошибке |
| POST | /auth/guest | — | 201 User с role guest, ставит сессионную cookie (без Max-Age) |
| POST | /auth/logout | — | 204, удаляет cookie; для гостя удаляет его и его чаты |
| GET | /auth/me | — | 200 User / 401 |
| POST | /auth/reset-password | {login, recovery_code, new_password} | 200 {recovery_code} — новый код; 401 неверный логин или код |
| POST | /auth/change-password | {new_password} | 204; нужна сессия user/admin (гостю 403), старый пароль не нужен |
| POST | /auth/recovery-code | — | 200 {recovery_code}; прежний код перестаёт действовать; гостю 403 |

Без сессии доступны register, login, guest, logout, reset-password.
Логин приводится к нижнему регистру: 3–32 символа без пробелов, не начинается с `guest-`. Пароль — от 6 символов.
Код восстановления: 12 символов из `A–Z` и `2–9` без похожих (0/O, 1/I/L), группы через дефис; сравнение без учёта
регистра и дефисов. Показывается только в ответе register / reset-password / recovery-code, хранится как хэш.
Вход, регистрация или гостевой вход из гостевой сессии удаляют прежнего гостя и его чаты.

## Датасет — guest, user, admin

| Метод | Путь | Ответ |
|---|---|---|
| GET | /categories | [Category]; для user/admin последней идёт `{key: "my", label: "Мои команды", personal: true}` |
| GET | /commands?category=git&q=текст | [Command]; оба параметра необязательны; `category=my` — свои команды (гостю 403) |
| GET | /commands/{id} | Command / 404 (чужая личная команда — тоже 404) |

## Свой датасет — user, admin (гостю 403)

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | /my/commands | — | [Command] |
| POST | /my/commands/import | {commands: [объект], mode: "append"\|"replace"} | 200 {added, skipped: [{index, reason}], total} |
| PUT | /my/commands/{id} | Command без id | 200 Command / 404 |
| DELETE | /my/commands/{id} | — | 204 / 404 |
| DELETE | /my/commands | — | 204, удаляет все свои команды |

Файл (JSON или CSV, до 1 МБ) читает браузер и отправляет массив объектов; сервер проверяет **каждую** команду:
name, command, description обязательны; examples — до 3 (строкой — через «|»), tags — до 20 (строкой — через «,»),
platform вне списка → cross. Неподходящие строки пропускаются с причиной в `skipped`; одинаковые name+command не дублируются.
Не больше 500 команд на пользователя. Если в режиме append ни одна команда не подошла — 400 с `field: "file"`.
Хранение — `data/my_commands/<login>.json`. В общий индекс BM25 не попадают: у каждого пользователя свой небольшой индекс,
результаты объединяются с общим поиском только в **его** чатах.

## Чаты — guest, user, admin, только свои

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | /chats?q=текст | — | [ChatSummary], новые сверху; с q — только совпавшие, с полем match |
| PATCH | /chats/{id} | {title} | 200 ChatSummary — переименование; title 1–100 символов / 404 |
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

`title` = первые 48 символов первого запроса, потом можно переименовать (PATCH). `message` — 1–2000 символов.
Поиск `q` (до 100 символов, без учёта регистра) — по названию чата, текстам запросов и названиям/командам в ответах.
Ответ ищется по общему датасету и своему датасету владельца чата.
Ответ строится по истории чата (уточняющие вопросы).

## Обучение — guest, user, admin (только свой прогресс)

    Topic    = {key, label, count, available, personal?, best: % | null, last: % | null, attempts, mistakes}
    Question = {id, type: "task"|"explain"|"name"|"example", prompt, subject | null, options: [4 строки]}

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | /learn/topics | — | [Topic]: категории справочника + «Мои команды» для user/admin (available — при ≥ 4 своих командах) |
| POST | /learn/quizzes | {topic, mode: "all"\|"mistakes", size: 10\|"all"} | 201 {id, topic, mode, total, questions: [Question]} — без правильных ответов |
| POST | /learn/quizzes/{id}/answers | {question_id, option} | 200 {correct, correct_option, command: Command}; 409 — ответ уже принят |
| POST | /learn/quizzes/{id}/finish | — | 200 {correct, total, answered, best, mistakes} |
| DELETE | /learn/topics/{key} | — | 204 — сбросить прогресс темы |

Вопросы строятся из команд темы (тема доступна, если в ней ≥ 4 команд), отвлекающие варианты — из той же темы:
`task` — по описанию (`subject`) выбрать команду; `explain` — по команде (`subject`) выбрать описание;
`name` — по команде выбрать её название; `example` — по названию выбрать пример применения.
`mode: "all"` — `size` команд темы (10 или все); первыми берутся команды, которые дольше всего не спрашивали
(или ни разу), поэтому подряд идущие тесты не повторяются; `"mistakes"` — все команды
из списка ошибок темы (400, если он пуст). Правильный ответ хранится только на сервере и приходит в ответ на `answers`.
Неверный ответ добавляет команду в ошибки темы, верный — убирает (закрепление). `best`/`last`/`attempts` обновляются
только за полностью пройденный тест в режиме `all`. Хранение — `data/learn/<login>.json`; у гостя удаляется вместе с ним.

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
