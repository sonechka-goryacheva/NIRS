# Авторизация

## Хранение

data/users.json, пароли — sha256.

## Функции

- register(login, password, role)
- login(login, password) → (успех, сообщение, роль)
- change_password(login, old, new)
- list_users()

## Роли

- user — обычный пользователь
- admin — может смотреть список пользователей
