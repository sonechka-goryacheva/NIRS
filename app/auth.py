"""
app/auth.py

Простая авторизация и регистрация.
Хранит пользователей в JSON-файле. Пароли — хеш sha256.
"""

import json
import os
import hashlib

USERS_FILE = "data/users.json"


def _load_users() -> dict:
    if not os.path.exists(USERS_FILE):
        return {}
    with open(USERS_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {}


def _save_users(users: dict) -> None:
    os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


def _hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def register(login: str, password: str, role: str = "user") -> tuple[bool, str]:
    users = _load_users()
    if login in users:
        return False, "Пользователь с таким логином уже существует."

    users[login] = {
        "password": _hash(password),
        "role": role,
    }
    _save_users(users)
    return True, "Регистрация успешна."


def login(login: str, password: str) -> tuple[bool, str, str]:
    """Возвращает (успех, сообщение, роль)."""
    users = _load_users()
    if login not in users:
        return False, "Неверный логин или пароль.", ""

    if users[login]["password"] != _hash(password):
        return False, "Неверный логин или пароль.", ""

    return True, "Вход выполнен.", users[login].get("role", "user")


def change_password(login: str, old: str, new: str) -> tuple[bool, str]:
    users = _load_users()
    if login not in users:
        return False, "Пользователь не найден."
    if users[login]["password"] != _hash(old):
        return False, "Старый пароль неверный."

    users[login]["password"] = _hash(new)
    _save_users(users)
    return True, "Пароль изменён."


def list_users() -> list[dict]:
    users = _load_users()
    return [{"login": k, "role": v.get("role", "user")} for k, v in users.items()]


if __name__ == "__main__":
    print(register("admin", "admin123", role="admin"))
    print(login("admin", "admin123"))
    print(list_users())
