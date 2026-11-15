# Авторизация

## Хранение
`data/users.json`: `{login: {salt, password_hash, recovery_hash, role, created_at, last_login_at}}`.
Хеш — sha256(salt + password), соль — 16 hex-символов, своя у каждого пользователя.
`recovery_hash` — sha256(salt + код восстановления без дефисов, в верхнем регистре). Сам код не хранится.
Гости (`role: "guest"`, логин `guest-xxxxxx`) живут в памяти сервера или в `data/guests.json` с `last_active_at`;
фоновая задача удаляет гостей без активности дольше 24 часов вместе с их чатами.

## Правила
- Логин: 3–32 символа без пробелов, хранится в нижнем регистре, уникален.
- Пароль: от 6 символов.
- Регистрация создаёт только роль user. Роли назначает администратор (spec/product/roles.md).
- Первый администратор: `python -m app.auth admin <логин>`.
- Восстановление пароля — по коду восстановления (выдаётся при регистрации, одноразовый: после сброса выдаётся новый).
  Вошедший пользователь меняет пароль в профиле без старого. Код потерян — пароль задаёт администратор.
- Перебор кодов: не больше 5 неудачных попыток сброса на логин за 15 минут (на сервере; в моке не проверяется).

## Сессии
Вход или регистрация → cookie `session` (httpOnly, Secure, SameSite=Lax) с подписанным id;
гостевой вход → такая же cookie без Max-Age (живёт до закрытия браузера),
`SESSION_SECRET` берётся из окружения. Роль **не** хранится в cookie: сервер читает её из users.json
на каждом запросе, поэтому смена роли или удаление действуют сразу.

## Проверка прав
Зависимости FastAPI: «вошёл» (в т.ч. гость), «зарегистрирован» (не guest) и «admin» — подключаются к роутерам
`/api/chats`, `/api/commands` (вошёл), `/api/my`, смене пароля и коду восстановления (зарегистрирован), `/api/admin` (admin).
Проверки «не над собой» и «последний admin» — в функциях `update_user` и `delete_user`.

## Функции app/auth.py

    register(login, password) -> (User, recovery_code)     # всегда role="user"
    authenticate(login, password) -> User | None
    create_guest() -> User                                  # role="guest", логин guest-xxxxxx
    drop_guest(login) -> None                               # + удалить чаты гостя
    reset_password(login, recovery_code, new) -> recovery_code   # новый код
    change_password(login, new) -> None                     # из профиля, сессия уже проверена
    new_recovery_code(login) -> recovery_code
    list_users(q=None, role=None) -> list[User]
    create_user(login, password, role) -> User              # только из админки
    update_user(actor, login, role=None, password=None) -> User
    delete_user(actor, login) -> None                       # + удалить чаты

## Расхождения с текущим app/auth.py (исправить при интеграции)
- `register(..., role="user")` принимает роль — убрать параметр, иначе через API можно стать admin.
- Хеш без соли, хотя здесь описана соль.
- Нет проверок длины логина и пароля.
- Тексты ошибок отличаются от spec/product/errors.md.
