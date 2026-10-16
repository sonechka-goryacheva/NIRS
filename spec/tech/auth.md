# Авторизация

## Хранение
`data/users.json`: `{login: {salt, password_hash, role, created_at, last_login_at}}`.
Хеш — sha256(salt + password), соль — 16 hex-символов, своя у каждого пользователя.

## Правила
- Логин: 3–32 символа без пробелов, хранится в нижнем регистре, уникален.
- Пароль: от 6 символов.
- Регистрация создаёт только роль user. Роли назначает администратор (spec/product/roles.md).
- Первый администратор: `python -m app.auth admin <логин>`.
- Восстановления пароля нет. Сменить пароль может владелец (зная текущий) или администратор.

## Сессии
Вход или регистрация → cookie `session` (httpOnly, Secure, SameSite=Lax) с подписанным id,
`SESSION_SECRET` берётся из окружения. Роль **не** хранится в cookie: сервер читает её из users.json
на каждом запросе, поэтому смена роли или удаление действуют сразу.

## Проверка прав
Одна зависимость FastAPI на «вошёл» и одна на «admin» — подключаются к роутерам `/api/chats`, `/api/commands`, `/api/admin`.
Проверки «не над собой» и «последний admin» — в функциях `update_user` и `delete_user`.

## Функции app/auth.py

    register(login, password) -> User                      # всегда role="user"
    authenticate(login, password) -> User | None
    change_password(login, old, new) -> None
    list_users(q=None, role=None) -> list[User]
    create_user(login, password, role) -> User              # только из админки
    update_user(actor, login, role=None, password=None) -> User
    delete_user(actor, login) -> None                       # + удалить чаты

## Расхождения с текущим app/auth.py (исправить при интеграции)
- `register(..., role="user")` принимает роль — убрать параметр, иначе через API можно стать admin.
- Хеш без соли, хотя здесь описана соль.
- Нет проверок длины логина и пароля.
- Тексты ошибок отличаются от spec/product/errors.md.
