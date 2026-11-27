# """
# app/api.py — FastAPI-сервер для веб-интерфейса НИРС.
# Все эндпоинты под префиксом /api (см. web/assets/js/config.js: apiBase: "/api").
# Статика web/ раздаётся в конце, чтобы не перехватывать /api/*.
# Запуск: uvicorn app.api:app --reload --port 8000
# """
# from __future__ import annotations

# import hashlib
# import json
# import os
# import random
# import time
# from datetime import datetime, timezone
# from pathlib import Path
# from typing import Optional

# from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
# from fastapi.responses import FileResponse
# from fastapi.staticfiles import StaticFiles
# from pydantic import BaseModel

# from app.search import Searcher, get_engine
# from app.llm import ask_llm

# try:
#     from dotenv import load_dotenv
#     load_dotenv()
# except ImportError:
#     pass

# BASE_DIR = Path(__file__).resolve().parent.parent
# DATA_DIR = BASE_DIR / "data"
# WEB_DIR = BASE_DIR / "web"
# CORPUS_DIR = DATA_DIR / "corpus"

# SESSION_SECRET = os.getenv("SESSION_SECRET", "change-me")
# SESSION_COOKIE = "session"
# SESSION_MAX_AGE = 7 * 24 * 3600

# CATEGORIES = {
#     "linux": "Linux", "mac": "macOS", "windows": "Windows",
#     "git": "Git", "docker": "Docker", "sql": "SQL",
#     "python": "Python", "network": "Сеть", "powershell": "PowerShell",
# }
# PLATFORMS = ["linux", "mac", "windows", "unix", "cross"]


# # ===================== Утилиты =====================

# def now_iso() -> str:
#     return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# def hash_password(pw: str) -> str:
#     return hashlib.sha256(pw.encode()).hexdigest()

# def verify_password(pw: str, hashed: str) -> bool:
#     return hash_password(pw) == hashed

# def new_recovery_code() -> str:
#     chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
#     return "-".join("".join(random.choices(chars, k=4)) for _ in range(3))

# def normalize_code(code: str) -> str:
#     return code.upper().replace("-", "").replace(" ", "")

# def save_corpus(corpus: list[dict]):
#     by_cat: dict[str, list] = {}
#     for doc in corpus:
#         cat = doc.get("category", "unknown")
#         doc_copy = {k: v for k, v in doc.items() if k != "id"}
#         by_cat.setdefault(cat, []).append(doc_copy)
#     for cat, docs in by_cat.items():
#         with open(CORPUS_DIR / f"{cat}.json", "w", encoding="utf-8") as f:
#             json.dump(docs, f, ensure_ascii=False, indent=2)


# # ===================== Хранилище =====================

# class Store:
#     def __init__(self):
#         self.users_file = DATA_DIR / "users.json"
#         self.chats_file = DATA_DIR / "chats.json"
#         self.my_dir = DATA_DIR / "my_commands"
#         self.learn_dir = DATA_DIR / "learn"
#         DATA_DIR.mkdir(exist_ok=True)
#         self.my_dir.mkdir(exist_ok=True)
#         self.learn_dir.mkdir(exist_ok=True)
#         self._load()

#     def _load(self):
#         self.users = json.loads(self.users_file.read_text(encoding="utf-8")) if self.users_file.exists() else {}
#         if not self.users:
#             self._seed_users()
#         self.chats = json.loads(self.chats_file.read_text(encoding="utf-8")) if self.chats_file.exists() else []
#         self._save()

#     def _seed_users(self):
#         passwords = {"admin": "admin123", "demo": "demo123",
#                      "ivan.petrov": "qwerty12", "m.sokolova": "admin456"}
#         codes = {"admin": "ADMN-6F9C-W2LZ", "demo": "DEMO-7K2P-Q9XA",
#                  "ivan.petrov": "IVAN-4H8M-T3RW", "m.sokolova": "MSOK-8B3N-V5JD"}
#         for login, code in codes.items():
#             self.users[login] = {
#                 "password": hash_password(passwords[login]),
#                 "role": "admin" if login in ("admin", "m.sokolova") else "user",
#                 "recovery_code": code,
#                 "created_at": now_iso(),
#                 "last_login_at": None,
#             }

#     def _save(self):
#         self.users_file.write_text(json.dumps(self.users, ensure_ascii=False, indent=2), encoding="utf-8")
#         self.chats_file.write_text(json.dumps(self.chats, ensure_ascii=False, indent=2), encoding="utf-8")

#     def get_my_commands(self, login: str) -> list:
#         p = self.my_dir / f"{login}.json"
#         return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

#     def save_my_commands(self, login: str, cmds: list):
#         (self.my_dir / f"{login}.json").write_text(json.dumps(cmds, ensure_ascii=False, indent=2), encoding="utf-8")

#     def get_learn(self, login: str) -> dict:
#         p = self.learn_dir / f"{login}.json"
#         return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}

#     def save_learn(self, login: str, data: dict):
#         (self.learn_dir / f"{login}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# store = Store()
# quizzes_store: dict[str, dict] = {}


# # ===================== Сессии =====================

# def create_session_token(login: str) -> str:
#     payload = f"{login}:{int(time.time())}"
#     sig = hashlib.sha256(f"{payload}:{SESSION_SECRET}".encode()).hexdigest()[:16]
#     return f"{payload}:{sig}"

# def verify_session_token(token: str) -> Optional[str]:
#     try:
#         login, ts, sig = token.split(":")
#         expected = hashlib.sha256(f"{login}:{ts}:{SESSION_SECRET}".encode()).hexdigest()[:16]
#         if sig != expected:
#             return None
#         if time.time() - int(ts) > SESSION_MAX_AGE:
#             return None
#         return login
#     except Exception:
#         return None

# def get_current_user(request: Request) -> Optional[dict]:
#     token = request.cookies.get(SESSION_COOKIE)
#     if not token:
#         return None
#     login = verify_session_token(token)
#     if not login or login not in store.users:
#         return None
#     return {"login": login, **store.users[login]}

# def require_auth(request: Request) -> dict:
#     u = get_current_user(request)
#     if not u:
#         raise HTTPException(status_code=401, detail="Требуется авторизация")
#     return u

# def require_member(request: Request) -> dict:
#     u = require_auth(request)
#     if u["role"] == "guest":
#         raise HTTPException(status_code=403, detail="Доступно после регистрации")
#     return u

# def require_admin(request: Request) -> dict:
#     u = require_auth(request)
#     if u["role"] != "admin":
#         raise HTTPException(status_code=403, detail="Требуется роль администратора")
#     return u

# def set_session_cookie(response: Response, login: str, is_guest: bool = False):
#     token = create_session_token(login)
#     kwargs = {"httponly": True, "samesite": "lax"}
#     if not is_guest:
#         kwargs["max_age"] = SESSION_MAX_AGE
#     response.set_cookie(SESSION_COOKIE, token, **kwargs)


# # ===================== Pydantic-модели =====================

# class LoginReq(BaseModel):
#     login: str
#     password: str

# class RegisterReq(BaseModel):
#     login: str
#     password: str

# class ResetPwdReq(BaseModel):
#     login: str
#     recovery_code: str
#     new_password: str

# class ChangePwdReq(BaseModel):
#     new_password: str

# class ChatMsgReq(BaseModel):
#     message: str

# class ChatTitleReq(BaseModel):
#     title: str

# class ImportReq(BaseModel):
#     commands: list
#     mode: str = "append"

# class QuizReq(BaseModel):
#     topic: str
#     mode: str = "all"
#     size: int = 10

# class QuizAnswerReq(BaseModel):
#     question_id: str
#     option: int

# class AdminUserReq(BaseModel):
#     login: str
#     password: str
#     role: str

# class AdminUserPatch(BaseModel):
#     role: Optional[str] = None
#     password: Optional[str] = None

# class CommandCreate(BaseModel):
#     category: str
#     name: str
#     command: str
#     description: str
#     platform: str
#     examples: list
#     tags: list


# # ===================== Приложение и роутер =====================

# app = FastAPI(title="НИРС API")
# api = APIRouter(prefix="/api")  # ← ключевой момент: все маршруты под /api


# # ===================== Авторизация =====================

# @api.get("/auth/me")
# async def auth_me(request: Request):
#     u = get_current_user(request)
#     if not u:
#         raise HTTPException(status_code=401, detail="Не авторизован")
#     return {"login": u["login"], "role": u["role"],
#             "created_at": u.get("created_at"), "last_login_at": u.get("last_login_at")}

# @api.post("/auth/login")
# async def auth_login(req: LoginReq, response: Response):
#     login = req.login.strip().lower()
#     u = store.users.get(login)
#     if not u or u["role"] == "guest" or not verify_password(req.password, u["password"]):
#         raise HTTPException(status_code=401, detail="Неверный логин или пароль")
#     u["last_login_at"] = now_iso()
#     store._save()
#     set_session_cookie(response, login)
#     return {"login": login, "role": u["role"],
#             "created_at": u.get("created_at"), "last_login_at": u["last_login_at"]}

# @api.post("/auth/register", status_code=201)
# async def auth_register(req: RegisterReq, response: Response):
#     login = req.login.strip().lower()
#     if len(login) < 3 or len(login) > 32 or " " in login:
#         raise HTTPException(status_code=400, detail="Логин: от 3 до 32 символов, без пробелов")
#     if login.startswith("guest-"):
#         raise HTTPException(status_code=400, detail="Логин не может начинаться с «guest-»")
#     if len(req.password) < 6:
#         raise HTTPException(status_code=400, detail="Пароль: минимум 6 символов")
#     if login in store.users:
#         raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")
#     code = new_recovery_code()
#     store.users[login] = {
#         "password": hash_password(req.password), "role": "user",
#         "recovery_code": code, "created_at": now_iso(), "last_login_at": now_iso(),
#     }
#     store._save()
#     set_session_cookie(response, login)
#     return {"login": login, "role": "user",
#             "created_at": store.users[login]["created_at"],
#             "last_login_at": store.users[login]["last_login_at"], "recovery_code": code}

# @api.post("/auth/guest", status_code=201)
# async def auth_guest(response: Response):
#     login = f"guest-{random.randint(100000, 999999)}"
#     store.users[login] = {"role": "guest", "created_at": now_iso(), "last_login_at": now_iso()}
#     store._save()
#     set_session_cookie(response, login, is_guest=True)
#     return {"login": login, "role": "guest",
#             "created_at": store.users[login]["created_at"],
#             "last_login_at": store.users[login]["last_login_at"]}

# @api.post("/auth/logout", status_code=204)
# async def auth_logout(response: Response):
#     response.delete_cookie(SESSION_COOKIE)
#     return None

# @api.post("/auth/reset-password")
# async def auth_reset(req: ResetPwdReq):
#     login = req.login.strip().lower()
#     u = store.users.get(login)
#     if not u or u["role"] == "guest":
#         raise HTTPException(status_code=401, detail="Неверный логин или код восстановления")
#     if not u.get("recovery_code") or normalize_code(u["recovery_code"]) != normalize_code(req.recovery_code):
#         raise HTTPException(status_code=401, detail="Неверный логин или код восстановления")
#     if len(req.new_password) < 6:
#         raise HTTPException(status_code=400, detail="Пароль: минимум 6 символов")
#     u["password"] = hash_password(req.new_password)
#     u["recovery_code"] = new_recovery_code()
#     store._save()
#     return {"recovery_code": u["recovery_code"]}

# @api.post("/auth/change-password", status_code=204)
# async def auth_change(req: ChangePwdReq, request: Request):
#     u = require_member(request)
#     if len(req.new_password) < 6:
#         raise HTTPException(status_code=400, detail="Пароль: минимум 6 символов")
#     store.users[u["login"]]["password"] = hash_password(req.new_password)
#     store._save()
#     return None

# @api.post("/auth/recovery-code")
# async def auth_recovery(request: Request):
#     u = require_member(request)
#     code = new_recovery_code()
#     store.users[u["login"]]["recovery_code"] = code
#     store._save()
#     return {"recovery_code": code}


# # ===================== Датасет =====================

# @api.get("/categories")
# async def categories(request: Request):
#     u = get_current_user(request)
#     engine = get_engine()
#     out = [{"key": k, "label": v, "count": len([c for c in engine.corpus if c.get("category") == k])}
#            for k, v in CATEGORIES.items()]
#     if u and u["role"] != "guest":
#         out.append({"key": "my", "label": "Мои команды",
#                     "count": len(store.get_my_commands(u["login"])), "personal": True})
#     return out

# @api.get("/commands")
# async def commands(request: Request, category: Optional[str] = None, q: Optional[str] = None):
#     u = get_current_user(request)
#     if category == "my":
#         if not u or u["role"] == "guest":
#             raise HTTPException(status_code=403, detail="Доступно после регистрации")
#         result = store.get_my_commands(u["login"])
#     else:
#         result = get_engine().corpus
#         if category:
#             result = [c for c in result if c.get("category") == category]
#     if q:
#         ql = q.lower()
#         result = [c for c in result if ql in c.get("name", "").lower()
#                   or ql in c.get("command", "").lower()
#                   or ql in " ".join(c.get("tags", [])).lower()]
#     return result

# @api.get("/commands/{command_id}")
# async def command_by_id(command_id: str, request: Request):
#     u = get_current_user(request)
#     cmd = next((c for c in get_engine().corpus if c.get("id") == command_id), None)
#     if not cmd and u and u["role"] != "guest":
#         cmd = next((c for c in store.get_my_commands(u["login"]) if c.get("id") == command_id), None)
#     if not cmd:
#         raise HTTPException(status_code=404, detail="Команда не найдена")
#     return cmd


# # ===================== Личный датасет =====================

# @api.get("/my/commands")
# async def my_list(request: Request):
#     return store.get_my_commands(require_member(request)["login"])

# @api.post("/my/commands/import")
# async def my_import(req: ImportReq, request: Request):
#     u = require_member(request)
#     if not req.commands:
#         raise HTTPException(status_code=400, detail="В файле нет команд")
#     mode = "replace" if req.mode == "replace" else "append"
#     current = [] if mode == "replace" else store.get_my_commands(u["login"])
#     skipped, added = [], 0
#     for i, raw in enumerate(req.commands):
#         if len(current) >= 500:
#             skipped.append({"index": i, "reason": "Превышен лимит 500 команд"}); continue
#         try:
#             name = str(raw.get("name", "")).strip()
#             command = str(raw.get("command", "")).strip()
#             description = str(raw.get("description", "")).strip()
#             if not name: raise ValueError("Нет названия")
#             if not command: raise ValueError("Нет команды")
#             if not description: raise ValueError("Нет описания")
#             if any(c["name"] == name and c["command"] == command for c in current):
#                 skipped.append({"index": i, "reason": "Уже есть в датасете"}); continue
#             plat = raw.get("platform", "cross")
#             current.append({
#                 "id": f"my-{random.randint(1000, 9999)}", "category": "my",
#                 "name": name, "command": command, "description": description,
#                 "examples": (raw.get("examples") or [])[:3],
#                 "tags": (raw.get("tags") or [])[:20],
#                 "platform": plat if plat in PLATFORMS else "cross",
#             })
#             added += 1
#         except Exception as e:
#             skipped.append({"index": i, "reason": str(e)})
#     if added == 0 and mode == "append":
#         raise HTTPException(status_code=400, detail="Ни одна команда не подошла")
#     store.save_my_commands(u["login"], current)
#     return {"added": added, "skipped": skipped, "total": len(current)}

# @api.put("/my/commands/{command_id}")
# async def my_update(command_id: str, req: dict, request: Request):
#     u = require_member(request)
#     cmds = store.get_my_commands(u["login"])
#     idx = next((i for i, c in enumerate(cmds) if c["id"] == command_id), None)
#     if idx is None:
#         raise HTTPException(status_code=404, detail="Команда не найдена")
#     for k in ("name", "command", "description"):
#         if k in req: cmds[idx][k] = str(req[k]).strip()
#     store.save_my_commands(u["login"], cmds)
#     return cmds[idx]

# @api.delete("/my/commands/{command_id}", status_code=204)
# async def my_delete(command_id: str, request: Request):
#     u = require_member(request)
#     store.save_my_commands(u["login"], [c for c in store.get_my_commands(u["login"]) if c["id"] != command_id])
#     return None

# @api.delete("/my/commands", status_code=204)
# async def my_delete_all(request: Request):
#     store.save_my_commands(require_member(request)["login"], [])
#     return None


# # ===================== Чаты =====================

# def search_and_answer(query: str, user_login: Optional[str], chat_history: list[dict] = None) -> dict:
#     """Поиск + LLM для чата с учетом истории."""
#     if chat_history is None:
#         chat_history = []
    
#     engine = get_engine()
#     searcher = Searcher(engine.corpus)
#     result = searcher.answer(query, top_k=3)
    
#     # Добавляем личные команды пользователя
#     if user_login:
#         my_commands = store.get_my_commands(user_login)
#         if my_commands:
#             q_lower = query.lower()
#             my_matches = [c for c in my_commands if q_lower in c.get("name", "").lower() 
#                          or q_lower in c.get("command", "").lower()
#                          or q_lower in c.get("description", "").lower()]
#             if my_matches:
#                 result["commands"] = (my_matches[:3] + result["commands"])[:3]
    
#     # Передаем историю в LLM
#     text = ask_llm(query, result["commands"], history=chat_history, kind=result["type"])
    
#     return {
#         "type": result["type"],
#         "commands": result["commands"],
#         "related": result.get("related", []),
#         "text": text,
#     }

# @api.get("/chats")
# async def chats_list(request: Request, q: Optional[str] = None):
#     u = require_auth(request)
#     mine = sorted([c for c in store.chats if c["owner"] == u["login"]],
#                   key=lambda c: c["updated_at"], reverse=True)
#     if not q:
#         return [{"id": c["id"], "title": c["title"],
#                  "created_at": c["created_at"], "updated_at": c["updated_at"]} for c in mine]
#     ql = q.lower()
#     out = []
#     for c in mine:
#         if ql in c["title"].lower():
#             out.append({"id": c["id"], "title": c["title"],
#                         "created_at": c["created_at"], "updated_at": c["updated_at"], "match": None})
#             continue
#         match = None
#         for m in c["messages"]:
#             if m["role"] == "user" and ql in m["text"].lower():
#                 match = m["text"][:60]; break
#             if m["role"] == "assistant" and m.get("reply", {}).get("text", "") and ql in m["reply"]["text"].lower():
#                 match = m["reply"]["text"][:60]; break
#         if match:
#             out.append({"id": c["id"], "title": c["title"],
#                         "created_at": c["created_at"], "updated_at": c["updated_at"], "match": match})
#     return out

# @api.post("/chats", status_code=201)
# async def chat_create(req: ChatMsgReq, request: Request):
#     u = require_auth(request)
#     if not req.message.strip():
#         raise HTTPException(status_code=400, detail="Введите запрос")
#     if len(req.message) > 2000:
#         raise HTTPException(status_code=400, detail="Запрос слишком длинный")
    
#     chat = {
#         "id": f"c-{random.randint(100000, 999999)}",
#         "owner": u["login"],
#         "title": req.message[:48],
#         "created_at": now_iso(),
#         "updated_at": now_iso(),
#         "messages": [],
#     }
    
#     # Передаем пустую историю (это первое сообщение)
#     reply = search_and_answer(req.message, u["login"], chat_history=[])
    
#     um = {"id": f"m-{random.randint(100000, 999999)}", "role": "user", "text": req.message, "created_at": now_iso()}
#     bm = {"id": f"m-{random.randint(100000, 999999)}", "role": "assistant", "reply": reply, "created_at": now_iso()}
    
#     chat["messages"] = [um, bm]
#     store.chats.append(chat)
#     store._save()
    
#     return {
#         "chat": {"id": chat["id"], "title": chat["title"], "created_at": chat["created_at"], "updated_at": chat["updated_at"]},
#         "messages": [um, bm]
#     }

# @api.get("/chats/{chat_id}")
# async def chat_get(chat_id: str, request: Request):
#     u = require_auth(request)
#     c = next((x for x in store.chats if x["id"] == chat_id and x["owner"] == u["login"]), None)
#     if not c:
#         raise HTTPException(status_code=404, detail="Чат не найден")
#     return {"id": c["id"], "title": c["title"], "created_at": c["created_at"],
#             "updated_at": c["updated_at"], "messages": c["messages"]}

# @api.post("/chats/{chat_id}/messages", status_code=201)
# async def chat_message(chat_id: str, req: ChatMsgReq, request: Request):
#     u = require_auth(request)
#     c = next((x for x in store.chats if x["id"] == chat_id and x["owner"] == u["login"]), None)
#     if not c:
#         raise HTTPException(status_code=404, detail="Чат не найден")
#     if not req.message.strip():
#         raise HTTPException(status_code=400, detail="Введите запрос")
#     if len(req.message) > 2000:
#         raise HTTPException(status_code=400, detail="Запрос слишком длинный")
    
#     # Передаем всю историю чата в LLM
#     reply = search_and_answer(req.message, u["login"], chat_history=c["messages"])
    
#     um = {"id": f"m-{random.randint(100000, 999999)}", "role": "user", "text": req.message, "created_at": now_iso()}
#     bm = {"id": f"m-{random.randint(100000, 999999)}", "role": "assistant", "reply": reply, "created_at": now_iso()}
    
#     c["messages"].extend([um, bm])
#     c["updated_at"] = now_iso()
#     store._save()
    
#     return {
#         "chat": {"id": c["id"], "title": c["title"], "created_at": c["created_at"], "updated_at": c["updated_at"]},
#         "messages": [um, bm]
#     }

# @api.patch("/chats/{chat_id}")
# async def chat_rename(chat_id: str, req: ChatTitleReq, request: Request):
#     u = require_auth(request)
#     c = next((x for x in store.chats if x["id"] == chat_id and x["owner"] == u["login"]), None)
#     if not c:
#         raise HTTPException(status_code=404, detail="Чат не найден")
#     title = req.title.strip()
#     if not title:
#         raise HTTPException(status_code=400, detail="Введите название")
#     if len(title) > 100:
#         raise HTTPException(status_code=400, detail="Название: максимум 100 символов")
#     c["title"] = title; store._save()
#     return {"id": c["id"], "title": c["title"], "created_at": c["created_at"], "updated_at": c["updated_at"]}

# @api.delete("/chats/{chat_id}", status_code=204)
# async def chat_delete(chat_id: str, request: Request):
#     u = require_auth(request)
#     store.chats = [c for c in store.chats if not (c["id"] == chat_id and c["owner"] == u["login"])]
#     store._save(); return None


# # ===================== Обучение =====================

# @api.get("/learn/topics")
# async def learn_topics(request: Request):
#     u = require_auth(request)
#     engine = get_engine()
#     out = []
#     for key, label in CATEGORIES.items():
#         count = len([c for c in engine.corpus if c.get("category") == key])
#         p = store.get_learn(u["login"]).get(key, {})
#         out.append({"key": key, "label": label, "count": count, "available": count >= 4,
#                     "best": p.get("best"), "last": p.get("last"),
#                     "attempts": p.get("attempts", 0), "mistakes": len(p.get("mistakes", []))})
#     if u["role"] != "guest":
#         mc = len(store.get_my_commands(u["login"]))
#         p = store.get_learn(u["login"]).get("my", {})
#         out.append({"key": "my", "label": "Мои команды", "count": mc, "available": mc >= 4, "personal": True,
#                     "best": p.get("best"), "last": p.get("last"),
#                     "attempts": p.get("attempts", 0), "mistakes": len(p.get("mistakes", []))})
#     return out

# @api.post("/learn/quizzes", status_code=201)
# async def quiz_create(req: QuizReq, request: Request):
#     u = require_auth(request)
#     if req.topic == "my":
#         if u["role"] == "guest":
#             raise HTTPException(status_code=403, detail="Доступно после регистрации")
#         pool = store.get_my_commands(u["login"])
#     else:
#         if req.topic not in CATEGORIES:
#             raise HTTPException(status_code=404, detail="Тема не найдена")
#         pool = [c for c in get_engine().corpus if c.get("category") == req.topic]
#     if len(pool) < 4:
#         raise HTTPException(status_code=400, detail="Для теста нужно хотя бы 4 команды")
#     size = len(pool) if req.size == "all" else min(int(req.size), len(pool))
#     picked = random.sample(pool, size)
#     questions = []
#     for cmd in picked:
#         others = [c for c in pool if c["id"] != cmd["id"]]
#         wrong = random.sample(others, min(3, len(others)))
#         q_type = random.choice(["task", "explain", "name"])
#         if q_type == "task":
#             prompt, subject, correct = "Какая команда подходит для задачи?", cmd["description"], cmd["command"]
#             options = [correct] + [c["command"] for c in wrong]
#         elif q_type == "explain":
#             prompt, subject, correct = "Что делает эта команда?", cmd["command"], cmd["description"]
#             options = [correct] + [c["description"] for c in wrong]
#         else:
#             prompt, subject, correct = "Как называется эта команда?", cmd["command"], cmd["name"]
#             options = [correct] + [c["name"] for c in wrong]
#         random.shuffle(options)
#         questions.append({"id": f"q-{random.randint(100000, 999999)}", "type": q_type,
#                           "prompt": prompt, "subject": subject, "options": options,
#                           "answer": options.index(correct), "command_id": cmd["id"]})
#     quiz_id = f"quiz-{random.randint(100000, 999999)}"
#     quizzes_store[quiz_id] = {"id": quiz_id, "owner": u["login"], "topic": req.topic,
#                               "mode": req.mode, "questions": questions, "answered": {}, "finished": False}
#     return {"id": quiz_id, "topic": req.topic, "mode": req.mode, "total": len(questions),
#             "questions": [{"id": q["id"], "type": q["type"], "prompt": q["prompt"],
#                            "subject": q["subject"], "options": q["options"]} for q in questions]}

# @api.post("/learn/quizzes/{quiz_id}/answers")
# async def quiz_answer(quiz_id: str, req: QuizAnswerReq, request: Request):
#     u = require_auth(request)
#     quiz = quizzes_store.get(quiz_id)
#     if not quiz or quiz["owner"] != u["login"]:
#         raise HTTPException(status_code=404, detail="Тест не найден")
#     if quiz["finished"]:
#         raise HTTPException(status_code=409, detail="Тест уже завершён")
#     q = next((x for x in quiz["questions"] if x["id"] == req.question_id), None)
#     if not q:
#         raise HTTPException(status_code=404, detail="Вопрос не найден")
#     if req.question_id in quiz["answered"]:
#         raise HTTPException(status_code=409, detail="Ответ уже принят")
#     correct = req.option == q["answer"]
#     quiz["answered"][req.question_id] = correct
#     progress = store.get_learn(u["login"])
#     tp = progress.get(quiz["topic"], {"mistakes": []})
#     if correct:
#         tp["mistakes"] = [m for m in tp["mistakes"] if m != q["command_id"]]
#     elif q["command_id"] not in tp["mistakes"]:
#         tp["mistakes"].append(q["command_id"])
#     progress[quiz["topic"]] = tp
#     store.save_learn(u["login"], progress)
#     command = next((c for c in get_engine().corpus if c["id"] == q["command_id"]), None)
#     return {"correct": correct, "correct_option": q["answer"], "command": command}

# @api.post("/learn/quizzes/{quiz_id}/finish")
# async def quiz_finish(quiz_id: str, request: Request):
#     u = require_auth(request)
#     quiz = quizzes_store.get(quiz_id)
#     if not quiz or quiz["owner"] != u["login"]:
#         raise HTTPException(status_code=404, detail="Тест не найден")
#     total = len(quiz["questions"])
#     correct = sum(1 for v in quiz["answered"].values() if v)
#     answered = len(quiz["answered"])
#     if not quiz["finished"]:
#         quiz["finished"] = True
#         if quiz["mode"] == "all" and answered == total:
#             pct = round((correct / total) * 100)
#             progress = store.get_learn(u["login"])
#             tp = progress.get(quiz["topic"], {})
#             tp["last"] = pct
#             tp["best"] = max(tp.get("best") or 0, pct)
#             tp["attempts"] = tp.get("attempts", 0) + 1
#             progress[quiz["topic"]] = tp
#             store.save_learn(u["login"], progress)
#     return {"correct": correct, "total": total, "answered": answered}

# @api.delete("/learn/topics/{topic_key}", status_code=204)
# async def topic_reset(topic_key: str, request: Request):
#     u = require_auth(request)
#     progress = store.get_learn(u["login"])
#     progress.pop(topic_key, None)
#     store.save_learn(u["login"], progress)
#     return None


# # ===================== Админ: команды =====================

# @api.post("/admin/commands", status_code=201)
# async def admin_create(req: CommandCreate, request: Request):
#     require_admin(request)
#     if req.category not in CATEGORIES:
#         raise HTTPException(status_code=400, detail="Выберите категорию")
#     if not req.name.strip(): raise HTTPException(status_code=400, detail="Обязательное поле")
#     if not req.command.strip(): raise HTTPException(status_code=400, detail="Обязательное поле")
#     if not req.description.strip(): raise HTTPException(status_code=400, detail="Обязательное поле")
#     if req.platform not in PLATFORMS: raise HTTPException(status_code=400, detail="Выберите платформу")
#     if len(req.examples) != 3: raise HTTPException(status_code=400, detail="Нужно ровно 3 примера")
#     if len(req.tags) < 5: raise HTTPException(status_code=400, detail="Минимум 5 тегов")
#     cmd = {"id": f"{req.category}-{random.randint(100, 999)}", "category": req.category,
#            "name": req.name.strip(), "command": req.command.strip(),
#            "description": req.description.strip(), "platform": req.platform,
#            "examples": req.examples, "tags": req.tags}
#     engine = get_engine()
#     engine.corpus.append(cmd)
#     save_corpus(engine.corpus)
#     return cmd

# @api.put("/admin/commands/{command_id}")
# async def admin_update(command_id: str, req: CommandCreate, request: Request):
#     require_admin(request)
#     engine = get_engine()
#     idx = next((i for i, c in enumerate(engine.corpus) if c["id"] == command_id), None)
#     if idx is None:
#         raise HTTPException(status_code=404, detail="Команда не найдена")
#     engine.corpus[idx] = {"id": command_id, "category": req.category,
#                           "name": req.name.strip(), "command": req.command.strip(),
#                           "description": req.description.strip(), "platform": req.platform,
#                           "examples": req.examples, "tags": req.tags}
#     save_corpus(engine.corpus)
#     return engine.corpus[idx]

# @api.delete("/admin/commands/{command_id}", status_code=204)
# async def admin_delete(command_id: str, request: Request):
#     require_admin(request)
#     engine = get_engine()
#     engine.corpus = [c for c in engine.corpus if c["id"] != command_id]
#     save_corpus(engine.corpus)
#     return None


# # ===================== Админ: пользователи =====================

# @api.get("/admin/users")
# async def admin_users(request: Request, q: Optional[str] = None, role: Optional[str] = None):
#     require_admin(request)
#     out = []
#     for login, u in store.users.items():
#         if u["role"] == "guest": continue
#         if q and q.lower() not in login.lower(): continue
#         if role and u["role"] != role: continue
#         out.append({"login": login, "role": u["role"], "created_at": u.get("created_at"),
#                     "last_login_at": u.get("last_login_at"),
#                     "chats_count": len([c for c in store.chats if c["owner"] == login])})
#     return sorted(out, key=lambda x: x["login"])

# @api.get("/admin/users/{login}")
# async def admin_user(login: str, request: Request):
#     require_admin(request)
#     u = store.users.get(login)
#     if not u or u["role"] == "guest":
#         raise HTTPException(status_code=404, detail="Пользователь не найден")
#     return {"login": login, "role": u["role"], "created_at": u.get("created_at"),
#             "last_login_at": u.get("last_login_at"),
#             "chats_count": len([c for c in store.chats if c["owner"] == login])}

# @api.post("/admin/users", status_code=201)
# async def admin_create_user(req: AdminUserReq, request: Request):
#     require_admin(request)
#     login = req.login.strip().lower()
#     if len(login) < 3 or len(login) > 32 or " " in login:
#         raise HTTPException(status_code=400, detail="Логин: от 3 до 32 символов, без пробелов")
#     if len(req.password) < 6:
#         raise HTTPException(status_code=400, detail="Пароль: минимум 6 символов")
#     if req.role not in ("user", "admin"):
#         raise HTTPException(status_code=400, detail="Выберите роль")
#     if login in store.users:
#         raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")
#     store.users[login] = {"password": hash_password(req.password), "role": req.role,
#                           "recovery_code": new_recovery_code(), "created_at": now_iso(), "last_login_at": None}
#     store._save()
#     return {"login": login, "role": req.role, "created_at": store.users[login]["created_at"],
#             "last_login_at": None, "chats_count": 0}

# @api.patch("/admin/users/{login}")
# async def admin_patch_user(login: str, req: AdminUserPatch, request: Request):
#     me = require_admin(request)
#     target = store.users.get(login)
#     if not target or target["role"] == "guest":
#         raise HTTPException(status_code=404, detail="Пользователь не найден")
#     if req.role is not None and req.role != target["role"]:
#         if req.role not in ("user", "admin"):
#             raise HTTPException(status_code=400, detail="Выберите роль")
#         if login == me["login"]:
#             raise HTTPException(status_code=409, detail="Нельзя изменить роль своей учётной записи")
#         if target["role"] == "admin" and len([u for u in store.users.values() if u["role"] == "admin"]) <= 1:
#             raise HTTPException(status_code=409, detail="Должен остаться хотя бы один администратор")
#         target["role"] = req.role
#     if req.password:
#         if len(req.password) < 6:
#             raise HTTPException(status_code=400, detail="Пароль: минимум 6 символов")
#         target["password"] = hash_password(req.password)
#     store._save()
#     return {"login": login, "role": target["role"], "created_at": target.get("created_at"),
#             "last_login_at": target.get("last_login_at"),
#             "chats_count": len([c for c in store.chats if c["owner"] == login])}

# @api.delete("/admin/users/{login}", status_code=204)
# async def admin_delete_user(login: str, request: Request):
#     me = require_admin(request)
#     target = store.users.get(login)
#     if not target or target["role"] == "guest":
#         raise HTTPException(status_code=404, detail="Пользователь не найден")
#     if login == me["login"]:
#         raise HTTPException(status_code=409, detail="Нельзя удалить свою учётную запись")
#     if target["role"] == "admin" and len([u for u in store.users.values() if u["role"] == "admin"]) <= 1:
#         raise HTTPException(status_code=409, detail="Должен остаться хотя бы один администратор")
#     store.users.pop(login, None)
#     store.chats = [c for c in store.chats if c["owner"] != login]
#     store._save()
#     return None


# # ===================== Подключение роутера и статики =====================
# # ВАЖНО: сначала /api/*, потом index.html, потом catch-all для статики.

# app.include_router(api)

# @app.get("/")
# async def index():
#     return FileResponse(str(WEB_DIR / "index.html"))

# @app.get("/{path:path}")
# async def serve_static(path: str):
#     # /api/* сюда попадать не должен — он закрыт выше через include_router
#     file_path = (WEB_DIR / path).resolve()
#     if not str(file_path).startswith(str(WEB_DIR.resolve())):
#         raise HTTPException(status_code=404, detail="Не найдено")
#     if file_path.is_file():
#         return FileResponse(str(file_path))
#     # SPA-fallback: index.html для hash-роутера
#     return FileResponse(str(WEB_DIR / "index.html"))



"""
app/api.py — FastAPI-сервер для веб-интерфейса НИРС.
Все эндпоинты под префиксом /api (см. web/assets/js/config.js: apiBase: "/api").
Статика web/ раздаётся в конце, чтобы не перехватывать /api/*.
Запуск: uvicorn app.api:app --reload --port 8000
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from fastapi import UploadFile, File
from app.ocr import extract_text_from_image

from app.search import Searcher, get_engine
from app.llm import ask_llm

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
WEB_DIR = BASE_DIR / "web"
CORPUS_DIR = DATA_DIR / "corpus"

SESSION_SECRET = os.getenv("SESSION_SECRET", "change-me")
SESSION_COOKIE = "session"
SESSION_MAX_AGE = 7 * 24 * 3600

CATEGORIES = {
    "linux": "Linux", "mac": "macOS", "windows": "Windows",
    "git": "Git", "docker": "Docker", "sql": "SQL",
    "python": "Python", "network": "Сеть", "powershell": "PowerShell",
}
PLATFORMS = ["linux", "mac", "windows", "unix", "cross"]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def verify_password(pw: str, hashed: str) -> bool:
    return hash_password(pw) == hashed

def new_recovery_code() -> str:
    chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    return "-".join("".join(random.choices(chars, k=4)) for _ in range(3))

def normalize_code(code: str) -> str:
    return code.upper().replace("-", "").replace(" ", "")

def save_corpus(corpus: list[dict]):
    by_cat: dict[str, list] = {}
    for doc in corpus:
        cat = doc.get("category", "unknown")
        doc_copy = {k: v for k, v in doc.items() if k != "id"}
        by_cat.setdefault(cat, []).append(doc_copy)
    for cat, docs in by_cat.items():
        with open(CORPUS_DIR / f"{cat}.json", "w", encoding="utf-8") as f:
            json.dump(docs, f, ensure_ascii=False, indent=2)


class Store:
    def __init__(self):
        self.users_file = DATA_DIR / "users.json"
        self.chats_file = DATA_DIR / "chats.json"
        self.my_dir = DATA_DIR / "my_commands"
        self.learn_dir = DATA_DIR / "learn"
        DATA_DIR.mkdir(exist_ok=True)
        self.my_dir.mkdir(exist_ok=True)
        self.learn_dir.mkdir(exist_ok=True)
        self._load()

    def _load(self):
        self.users = json.loads(self.users_file.read_text(encoding="utf-8")) if self.users_file.exists() else {}
        if not self.users:
            self._seed_users()
        self.chats = json.loads(self.chats_file.read_text(encoding="utf-8")) if self.chats_file.exists() else []
        self._save()

    def _seed_users(self):
        passwords = {"admin": "admin123", "demo": "demo123",
                     "ivan.petrov": "qwerty12", "m.sokolova": "admin456"}
        codes = {"admin": "ADMN-6F9C-W2LZ", "demo": "DEMO-7K2P-Q9XA",
                 "ivan.petrov": "IVAN-4H8M-T3RW", "m.sokolova": "MSOK-8B3N-V5JD"}
        for login, code in codes.items():
            self.users[login] = {
                "password": hash_password(passwords[login]),
                "role": "admin" if login in ("admin", "m.sokolova") else "user",
                "recovery_code": code,
                "created_at": now_iso(),
                "last_login_at": None,
            }

    def _save(self):
        self.users_file.write_text(json.dumps(self.users, ensure_ascii=False, indent=2), encoding="utf-8")
        self.chats_file.write_text(json.dumps(self.chats, ensure_ascii=False, indent=2), encoding="utf-8")

    def get_my_commands(self, login: str) -> list:
        p = self.my_dir / f"{login}.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

    def save_my_commands(self, login: str, cmds: list):
        (self.my_dir / f"{login}.json").write_text(json.dumps(cmds, ensure_ascii=False, indent=2), encoding="utf-8")

    def get_learn(self, login: str) -> dict:
        p = self.learn_dir / f"{login}.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}

    def save_learn(self, login: str, data: dict):
        (self.learn_dir / f"{login}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


store = Store()
quizzes_store: dict[str, dict] = {}


def create_session_token(login: str) -> str:
    payload = f"{login}:{int(time.time())}"
    sig = hashlib.sha256(f"{payload}:{SESSION_SECRET}".encode()).hexdigest()[:16]
    return f"{payload}:{sig}"

def verify_session_token(token: str) -> Optional[str]:
    try:
        login, ts, sig = token.split(":")
        expected = hashlib.sha256(f"{login}:{ts}:{SESSION_SECRET}".encode()).hexdigest()[:16]
        if sig != expected:
            return None
        if time.time() - int(ts) > SESSION_MAX_AGE:
            return None
        return login
    except Exception:
        return None

def get_current_user(request: Request) -> Optional[dict]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    login = verify_session_token(token)
    if not login or login not in store.users:
        return None
    return {"login": login, **store.users[login]}

def require_auth(request: Request) -> dict:
    u = get_current_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    return u

def require_member(request: Request) -> dict:
    u = require_auth(request)
    if u["role"] == "guest":
        raise HTTPException(status_code=403, detail="Доступно после регистрации")
    return u

def require_admin(request: Request) -> dict:
    u = require_auth(request)
    if u["role"] != "admin":
        raise HTTPException(status_code=403, detail="Требуется роль администратора")
    return u

def set_session_cookie(response: Response, login: str, is_guest: bool = False):
    token = create_session_token(login)
    kwargs = {"httponly": True, "samesite": "lax"}
    if not is_guest:
        kwargs["max_age"] = SESSION_MAX_AGE
    response.set_cookie(SESSION_COOKIE, token, **kwargs)


class LoginReq(BaseModel):
    login: str
    password: str

class RegisterReq(BaseModel):
    login: str
    password: str

class ResetPwdReq(BaseModel):
    login: str
    recovery_code: str
    new_password: str

class ChangePwdReq(BaseModel):
    new_password: str

class ChatMsgReq(BaseModel):
    message: str

class ChatTitleReq(BaseModel):
    title: str

class ImportReq(BaseModel):
    commands: list
    mode: str = "append"

class QuizReq(BaseModel):
    topic: str
    mode: str = "all"
    size: int = 10

class QuizAnswerReq(BaseModel):
    question_id: str
    option: int

class AdminUserReq(BaseModel):
    login: str
    password: str
    role: str

class AdminUserPatch(BaseModel):
    role: Optional[str] = None
    password: Optional[str] = None

class CommandCreate(BaseModel):
    category: str
    name: str
    command: str
    description: str
    platform: str
    examples: list
    tags: list


app = FastAPI(title="НИРС API")
api = APIRouter(prefix="/api")


@api.get("/auth/me")
async def auth_me(request: Request):
    u = get_current_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return {"login": u["login"], "role": u["role"],
            "created_at": u.get("created_at"), "last_login_at": u.get("last_login_at")}

@api.post("/auth/login")
async def auth_login(req: LoginReq, response: Response):
    login = req.login.strip().lower()
    u = store.users.get(login)
    if not u or u["role"] == "guest" or not verify_password(req.password, u["password"]):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    u["last_login_at"] = now_iso()
    store._save()
    set_session_cookie(response, login)
    return {"login": login, "role": u["role"],
            "created_at": u.get("created_at"), "last_login_at": u["last_login_at"]}

@api.post("/auth/register", status_code=201)
async def auth_register(req: RegisterReq, response: Response):
    login = req.login.strip().lower()
    if len(login) < 3 or len(login) > 32 or " " in login:
        raise HTTPException(status_code=400, detail="Логин: от 3 до 32 символов, без пробелов")
    if login.startswith("guest-"):
        raise HTTPException(status_code=400, detail="Логин не может начинаться с «guest-»")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Пароль: минимум 6 символов")
    if login in store.users:
        raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")
    code = new_recovery_code()
    store.users[login] = {
        "password": hash_password(req.password), "role": "user",
        "recovery_code": code, "created_at": now_iso(), "last_login_at": now_iso(),
    }
    store._save()
    set_session_cookie(response, login)
    return {"login": login, "role": "user",
            "created_at": store.users[login]["created_at"],
            "last_login_at": store.users[login]["last_login_at"], "recovery_code": code}

@api.post("/auth/guest", status_code=201)
async def auth_guest(response: Response):
    login = f"guest-{random.randint(100000, 999999)}"
    store.users[login] = {"role": "guest", "created_at": now_iso(), "last_login_at": now_iso()}
    store._save()
    set_session_cookie(response, login, is_guest=True)
    return {"login": login, "role": "guest",
            "created_at": store.users[login]["created_at"],
            "last_login_at": store.users[login]["last_login_at"]}

@api.post("/auth/logout", status_code=204)
async def auth_logout(response: Response):
    response.delete_cookie(SESSION_COOKIE)
    return None

@api.post("/auth/reset-password")
async def auth_reset(req: ResetPwdReq):
    login = req.login.strip().lower()
    u = store.users.get(login)
    if not u or u["role"] == "guest":
        raise HTTPException(status_code=401, detail="Неверный логин или код восстановления")
    if not u.get("recovery_code") or normalize_code(u["recovery_code"]) != normalize_code(req.recovery_code):
        raise HTTPException(status_code=401, detail="Неверный логин или код восстановления")
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Пароль: минимум 6 символов")
    u["password"] = hash_password(req.new_password)
    u["recovery_code"] = new_recovery_code()
    store._save()
    return {"recovery_code": u["recovery_code"]}

@api.post("/auth/change-password", status_code=204)
async def auth_change(req: ChangePwdReq, request: Request):
    u = require_member(request)
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Пароль: минимум 6 символов")
    store.users[u["login"]]["password"] = hash_password(req.new_password)
    store._save()
    return None

@api.post("/auth/recovery-code")
async def auth_recovery(request: Request):
    u = require_member(request)
    code = new_recovery_code()
    store.users[u["login"]]["recovery_code"] = code
    store._save()
    return {"recovery_code": code}


@api.get("/categories")
async def categories(request: Request):
    u = get_current_user(request)
    engine = get_engine()
    out = [{"key": k, "label": v, "count": len([c for c in engine.corpus if c.get("category") == k])}
           for k, v in CATEGORIES.items()]
    if u and u["role"] != "guest":
        out.append({"key": "my", "label": "Мои команды",
                    "count": len(store.get_my_commands(u["login"])), "personal": True})
    return out

@api.get("/commands")
async def commands(request: Request, category: Optional[str] = None, q: Optional[str] = None):
    u = get_current_user(request)
    if category == "my":
        if not u or u["role"] == "guest":
            raise HTTPException(status_code=403, detail="Доступно после регистрации")
        result = store.get_my_commands(u["login"])
    else:
        result = get_engine().corpus
        if category:
            result = [c for c in result if c.get("category") == category]
    if q:
        ql = q.lower()
        result = [c for c in result if ql in c.get("name", "").lower()
                  or ql in c.get("command", "").lower()
                  or ql in " ".join(c.get("tags", [])).lower()]
    return result

@api.get("/commands/{command_id}")
async def command_by_id(command_id: str, request: Request):
    u = get_current_user(request)
    cmd = next((c for c in get_engine().corpus if c.get("id") == command_id), None)
    if not cmd and u and u["role"] != "guest":
        cmd = next((c for c in store.get_my_commands(u["login"]) if c.get("id") == command_id), None)
    if not cmd:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    return cmd


@api.get("/my/commands")
async def my_list(request: Request):
    return store.get_my_commands(require_member(request)["login"])

@api.post("/my/commands/import")
async def my_import(req: ImportReq, request: Request):
    u = require_member(request)
    if not req.commands:
        raise HTTPException(status_code=400, detail="В файле нет команд")
    mode = "replace" if req.mode == "replace" else "append"
    current = [] if mode == "replace" else store.get_my_commands(u["login"])
    skipped, added = [], 0
    for i, raw in enumerate(req.commands):
        if len(current) >= 500:
            skipped.append({"index": i, "reason": "Превышен лимит 500 команд"}); continue
        try:
            name = str(raw.get("name", "")).strip()
            command = str(raw.get("command", "")).strip()
            description = str(raw.get("description", "")).strip()
            if not name: raise ValueError("Нет названия")
            if not command: raise ValueError("Нет команды")
            if not description: raise ValueError("Нет описания")
            if any(c["name"] == name and c["command"] == command for c in current):
                skipped.append({"index": i, "reason": "Уже есть в датасете"}); continue
            plat = raw.get("platform", "cross")
            current.append({
                "id": f"my-{random.randint(1000, 9999)}", "category": "my",
                "name": name, "command": command, "description": description,
                "examples": (raw.get("examples") or [])[:3],
                "tags": (raw.get("tags") or [])[:20],
                "platform": plat if plat in PLATFORMS else "cross",
            })
            added += 1
        except Exception as e:
            skipped.append({"index": i, "reason": str(e)})
    if added == 0 and mode == "append":
        raise HTTPException(status_code=400, detail="Ни одна команда не подошла")
    store.save_my_commands(u["login"], current)
    return {"added": added, "skipped": skipped, "total": len(current)}

@api.put("/my/commands/{command_id}")
async def my_update(command_id: str, req: dict, request: Request):
    u = require_member(request)
    cmds = store.get_my_commands(u["login"])
    idx = next((i for i, c in enumerate(cmds) if c["id"] == command_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    for k in ("name", "command", "description"):
        if k in req: cmds[idx][k] = str(req[k]).strip()
    store.save_my_commands(u["login"], cmds)
    return cmds[idx]

@api.delete("/my/commands/{command_id}", status_code=204)
async def my_delete(command_id: str, request: Request):
    u = require_member(request)
    store.save_my_commands(u["login"], [c for c in store.get_my_commands(u["login"]) if c["id"] != command_id])
    return None

@api.delete("/my/commands", status_code=204)
async def my_delete_all(request: Request):
    store.save_my_commands(require_member(request)["login"], [])
    return None


def search_and_answer(query: str, user_login: Optional[str], chat_history: list[dict] = None) -> dict:
    """Поиск + LLM для чата с учётом уточнений и жалоб."""
    if chat_history is None:
        chat_history = []

    engine = get_engine()
    searcher = Searcher(engine.corpus)

    q_low = query.lower().strip()

    # --- Жалобы и уточнения: не ищем заново, берём команды из прошлого ответа ---
    complaint_words = ("не работает", "не получается", "ничего не получается", "твои команды",
                       "не то", "другую", "другой", "другая", "еще", "ещё", "предпоследнюю",
                       "последнюю", "альтернатив", "вариант", "не подошло", "не подходит")
    is_followup = any(k in q_low for k in complaint_words)

    if is_followup and chat_history:
        # Ищем последний ответ ассистента с командами
        last_reply = None
        prev_query = None
        for m in reversed(chat_history):
            if m["role"] == "assistant" and m.get("reply", {}).get("commands"):
                last_reply = m["reply"]
                break
        for m in reversed(chat_history):
            if m["role"] == "user":
                prev_query = m["text"]
                break

        if last_reply and last_reply.get("commands"):
            # Для «предпоследнюю» / «последнюю» — берём нужную команду из истории
            if "предпоследнюю" in q_low:
                prev_commands = []
                for m in chat_history:
                    if m["role"] == "assistant" and m.get("reply", {}).get("commands"):
                        prev_commands = m["reply"]["commands"]
                target = prev_commands[-2] if len(prev_commands) >= 2 else prev_commands[-1] if prev_commands else None
                if target:
                    text = ask_llm(query, [target], history=chat_history, kind="found")
                    return {"type": "found", "commands": [target], "related": [], "text": text}
                return {"type": "not_found", "commands": [], "related": [],
                        "message": "Предпоследней команды в истории нет.",
                        "text": "Предпоследней команды в истории нет."}

            if "последнюю" in q_low and "предпоследнюю" not in q_low:
                prev_commands = []
                for m in chat_history:
                    if m["role"] == "assistant" and m.get("reply", {}).get("commands"):
                        prev_commands = m["reply"]["commands"]
                target = prev_commands[-1] if prev_commands else None
                if target:
                    text = ask_llm(query, [target], history=chat_history, kind="found")
                    return {"type": "found", "commands": [target], "related": [], "text": text}

            # Для «не то», «другую», «ещё» — показываем те же команды, LLM переформулирует
            text = ask_llm(query, last_reply["commands"], history=chat_history, kind="found")
            return {"type": "found", "commands": last_reply["commands"],
                    "related": last_reply.get("related", []), "text": text}

    # --- Обычный поиск ---
    result = searcher.answer(query, top_k=3)

    if user_login:
        my_commands = store.get_my_commands(user_login)
        if my_commands:
            ql = query.lower()
            my_matches = [c for c in my_commands if ql in c.get("name", "").lower()
                          or ql in c.get("command", "").lower()
                          or ql in c.get("description", "").lower()]
            if my_matches:
                result["commands"] = (my_matches[:3] + result["commands"])[:3]

    text = ask_llm(query, result["commands"], history=chat_history, kind=result["type"])
    return {
        "type": result["type"],
        "commands": result["commands"],
        "related": result.get("related", []),
        "text": text,
    }



@api.get("/chats")
async def chats_list(request: Request, q: Optional[str] = None):
    u = require_auth(request)
    mine = sorted([c for c in store.chats if c["owner"] == u["login"]],
                  key=lambda c: c["updated_at"], reverse=True)
    if not q:
        return [{"id": c["id"], "title": c["title"],
                 "created_at": c["created_at"], "updated_at": c["updated_at"]} for c in mine]
    ql = q.lower()
    out = []
    for c in mine:
        if ql in c["title"].lower():
            out.append({"id": c["id"], "title": c["title"],
                        "created_at": c["created_at"], "updated_at": c["updated_at"], "match": None})
            continue
        match = None
        for m in c["messages"]:
            if m["role"] == "user" and ql in m["text"].lower():
                match = m["text"][:60]; break
            if m["role"] == "assistant" and m.get("reply", {}).get("text", "") and ql in m["reply"]["text"].lower():
                match = m["reply"]["text"][:60]; break
        if match:
            out.append({"id": c["id"], "title": c["title"],
                        "created_at": c["created_at"], "updated_at": c["updated_at"], "match": match})
    return out

@api.post("/chats", status_code=201)
async def chat_create(req: ChatMsgReq, request: Request):
    u = require_auth(request)
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Введите запрос")
    if len(req.message) > 2000:
        raise HTTPException(status_code=400, detail="Запрос слишком длинный")
    chat = {
        "id": f"c-{random.randint(100000, 999999)}",
        "owner": u["login"],
        "title": req.message[:48],
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "messages": [],
    }
    reply = search_and_answer(req.message, u["login"], chat_history=[])
    um = {"id": f"m-{random.randint(100000, 999999)}", "role": "user", "text": req.message, "created_at": now_iso()}
    bm = {"id": f"m-{random.randint(100000, 999999)}", "role": "assistant", "reply": reply, "created_at": now_iso()}
    chat["messages"] = [um, bm]
    store.chats.append(chat)
    store._save()
    return {
        "chat": {"id": chat["id"], "title": chat["title"], "created_at": chat["created_at"], "updated_at": chat["updated_at"]},
        "messages": [um, bm]
    }

@api.get("/chats/{chat_id}")
async def chat_get(chat_id: str, request: Request):
    u = require_auth(request)
    c = next((x for x in store.chats if x["id"] == chat_id and x["owner"] == u["login"]), None)
    if not c:
        raise HTTPException(status_code=404, detail="Чат не найден")
    return {"id": c["id"], "title": c["title"], "created_at": c["created_at"],
            "updated_at": c["updated_at"], "messages": c["messages"]}

@api.post("/chats/{chat_id}/messages", status_code=201)
async def chat_message(chat_id: str, req: ChatMsgReq, request: Request):
    u = require_auth(request)
    c = next((x for x in store.chats if x["id"] == chat_id and x["owner"] == u["login"]), None)
    if not c:
        raise HTTPException(status_code=404, detail="Чат не найден")
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Введите запрос")
    if len(req.message) > 2000:
        raise HTTPException(status_code=400, detail="Запрос слишком длинный")
    reply = search_and_answer(req.message, u["login"], chat_history=c["messages"])
    um = {"id": f"m-{random.randint(100000, 999999)}", "role": "user", "text": req.message, "created_at": now_iso()}
    bm = {"id": f"m-{random.randint(100000, 999999)}", "role": "assistant", "reply": reply, "created_at": now_iso()}
    c["messages"].extend([um, bm])
    c["updated_at"] = now_iso()
    store._save()
    return {
        "chat": {"id": c["id"], "title": c["title"], "created_at": c["created_at"], "updated_at": c["updated_at"]},
        "messages": [um, bm]
    }
@api.post("/chats/{chat_id}/upload-image", status_code=201)
async def chat_upload_image(
    chat_id: str, 
    request: Request, 
    file: UploadFile = File(...)
):
    """
    Загрузка изображения с текстом команды/ошибки.
    Извлекает текст через OCR и использует его как запрос к поиску.
    """
    u = require_auth(request)
    
    # Проверяем чат
    c = next((x for x in store.chats if x["id"] == chat_id and x["owner"] == u["login"]), None)
    if not c:
        raise HTTPException(status_code=404, detail="Чат не найден")
    
    # Проверяем тип файла
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="Загрузите изображение (PNG, JPEG)")
    
    # Читаем файл
    image_bytes = await file.read()
    if len(image_bytes) > 5 * 1024 * 1024:  # 5 MB лимит
        raise HTTPException(status_code=400, detail="Изображение слишком большое (максимум 5 МБ)")
    
    # Извлекаем текст через OCR
    extracted_text = extract_text_from_image(image_bytes)
    
    if not extracted_text:
        raise HTTPException(status_code=400, detail="Не удалось распознать текст на изображении")
    
    # Используем извлечённый текст как запрос
    reply = search_and_answer(extracted_text, u["login"], chat_history=c["messages"])
    
    # Создаём сообщения
    um = {
        "id": f"m-{random.randint(100000, 999999)}", 
        "role": "user", 
        "text": f"[Изображение] {extracted_text[:100]}...",
        "created_at": now_iso(),
        "has_image": True
    }
    
    bm = {
        "id": f"m-{random.randint(100000, 999999)}", 
        "role": "assistant", 
        "reply": reply, 
        "created_at": now_iso()
    }
    
    c["messages"].extend([um, bm])
    c["updated_at"] = now_iso()
    store._save()
    
    return {
        "chat": {"id": c["id"], "title": c["title"], "created_at": c["created_at"], "updated_at": c["updated_at"]},
        "messages": [um, bm],
        "extracted_text": extracted_text
    }
@api.patch("/chats/{chat_id}")
async def chat_rename(chat_id: str, req: ChatTitleReq, request: Request):
    u = require_auth(request)
    c = next((x for x in store.chats if x["id"] == chat_id and x["owner"] == u["login"]), None)
    if not c:
        raise HTTPException(status_code=404, detail="Чат не найден")
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Введите название")
    if len(title) > 100:
        raise HTTPException(status_code=400, detail="Название: максимум 100 символов")
    c["title"] = title; store._save()
    return {"id": c["id"], "title": c["title"], "created_at": c["created_at"], "updated_at": c["updated_at"]}

@api.delete("/chats/{chat_id}", status_code=204)
async def chat_delete(chat_id: str, request: Request):
    u = require_auth(request)
    store.chats = [c for c in store.chats if not (c["id"] == chat_id and c["owner"] == u["login"])]
    store._save(); return None


@api.get("/learn/topics")
async def learn_topics(request: Request):
    u = require_auth(request)
    engine = get_engine()
    out = []
    for key, label in CATEGORIES.items():
        count = len([c for c in engine.corpus if c.get("category") == key])
        p = store.get_learn(u["login"]).get(key, {})
        out.append({"key": key, "label": label, "count": count, "available": count >= 4,
                    "best": p.get("best"), "last": p.get("last"),
                    "attempts": p.get("attempts", 0), "mistakes": len(p.get("mistakes", []))})
    if u["role"] != "guest":
        mc = len(store.get_my_commands(u["login"]))
        p = store.get_learn(u["login"]).get("my", {})
        out.append({"key": "my", "label": "Мои команды", "count": mc, "available": mc >= 4, "personal": True,
                    "best": p.get("best"), "last": p.get("last"),
                    "attempts": p.get("attempts", 0), "mistakes": len(p.get("mistakes", []))})
    return out

@api.post("/learn/quizzes", status_code=201)
async def quiz_create(req: QuizReq, request: Request):
    u = require_auth(request)
    if req.topic == "my":
        if u["role"] == "guest":
            raise HTTPException(status_code=403, detail="Доступно после регистрации")
        pool = store.get_my_commands(u["login"])
    else:
        if req.topic not in CATEGORIES:
            raise HTTPException(status_code=404, detail="Тема не найдена")
        pool = [c for c in get_engine().corpus if c.get("category") == req.topic]
    if len(pool) < 4:
        raise HTTPException(status_code=400, detail="Для теста нужно хотя бы 4 команды")
    size = len(pool) if req.size == "all" else min(int(req.size), len(pool))
    picked = random.sample(pool, size)
    questions = []
    for cmd in picked:
        others = [c for c in pool if c["id"] != cmd["id"]]
        wrong = random.sample(others, min(3, len(others)))
        q_type = random.choice(["task", "explain", "name"])
        if q_type == "task":
            prompt, subject, correct = "Какая команда подходит для задачи?", cmd["description"], cmd["command"]
            options = [correct] + [c["command"] for c in wrong]
        elif q_type == "explain":
            prompt, subject, correct = "Что делает эта команда?", cmd["command"], cmd["description"]
            options = [correct] + [c["description"] for c in wrong]
        else:
            prompt, subject, correct = "Как называется эта команда?", cmd["command"], cmd["name"]
            options = [correct] + [c["name"] for c in wrong]
        random.shuffle(options)
        questions.append({"id": f"q-{random.randint(100000, 999999)}", "type": q_type,
                          "prompt": prompt, "subject": subject, "options": options,
                          "answer": options.index(correct), "command_id": cmd["id"]})
    quiz_id = f"quiz-{random.randint(100000, 999999)}"
    quizzes_store[quiz_id] = {"id": quiz_id, "owner": u["login"], "topic": req.topic,
                              "mode": req.mode, "questions": questions, "answered": {}, "finished": False}
    return {"id": quiz_id, "topic": req.topic, "mode": req.mode, "total": len(questions),
            "questions": [{"id": q["id"], "type": q["type"], "prompt": q["prompt"],
                           "subject": q["subject"], "options": q["options"]} for q in questions]}

@api.post("/learn/quizzes/{quiz_id}/answers")
async def quiz_answer(quiz_id: str, req: QuizAnswerReq, request: Request):
    u = require_auth(request)
    quiz = quizzes_store.get(quiz_id)
    if not quiz or quiz["owner"] != u["login"]:
        raise HTTPException(status_code=404, detail="Тест не найден")
    if quiz["finished"]:
        raise HTTPException(status_code=409, detail="Тест уже завершён")
    q = next((x for x in quiz["questions"] if x["id"] == req.question_id), None)
    if not q:
        raise HTTPException(status_code=404, detail="Вопрос не найден")
    if req.question_id in quiz["answered"]:
        raise HTTPException(status_code=409, detail="Ответ уже принят")
    correct = req.option == q["answer"]
    quiz["answered"][req.question_id] = correct
    progress = store.get_learn(u["login"])
    tp = progress.get(quiz["topic"], {"mistakes": []})
    if correct:
        tp["mistakes"] = [m for m in tp["mistakes"] if m != q["command_id"]]
    elif q["command_id"] not in tp["mistakes"]:
        tp["mistakes"].append(q["command_id"])
    progress[quiz["topic"]] = tp
    store.save_learn(u["login"], progress)
    command = next((c for c in get_engine().corpus if c["id"] == q["command_id"]), None)
    return {"correct": correct, "correct_option": q["answer"], "command": command}

@api.post("/learn/quizzes/{quiz_id}/finish")
async def quiz_finish(quiz_id: str, request: Request):
    u = require_auth(request)
    quiz = quizzes_store.get(quiz_id)
    if not quiz or quiz["owner"] != u["login"]:
        raise HTTPException(status_code=404, detail="Тест не найден")
    total = len(quiz["questions"])
    correct = sum(1 for v in quiz["answered"].values() if v)
    answered = len(quiz["answered"])
    if not quiz["finished"]:
        quiz["finished"] = True
        if quiz["mode"] == "all" and answered == total:
            pct = round((correct / total) * 100)
            progress = store.get_learn(u["login"])
            tp = progress.get(quiz["topic"], {})
            tp["last"] = pct
            tp["best"] = max(tp.get("best") or 0, pct)
            tp["attempts"] = tp.get("attempts", 0) + 1
            progress[quiz["topic"]] = tp
            store.save_learn(u["login"], progress)
    return {"correct": correct, "total": total, "answered": answered}

@api.delete("/learn/topics/{topic_key}", status_code=204)
async def topic_reset(topic_key: str, request: Request):
    u = require_auth(request)
    progress = store.get_learn(u["login"])
    progress.pop(topic_key, None)
    store.save_learn(u["login"], progress)
    return None


@api.post("/admin/commands", status_code=201)
async def admin_create(req: CommandCreate, request: Request):
    require_admin(request)
    if req.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Выберите категорию")
    if not req.name.strip(): raise HTTPException(status_code=400, detail="Обязательное поле")
    if not req.command.strip(): raise HTTPException(status_code=400, detail="Обязательное поле")
    if not req.description.strip(): raise HTTPException(status_code=400, detail="Обязательное поле")
    if req.platform not in PLATFORMS: raise HTTPException(status_code=400, detail="Выберите платформу")
    if len(req.examples) != 3: raise HTTPException(status_code=400, detail="Нужно ровно 3 примера")
    if len(req.tags) < 5: raise HTTPException(status_code=400, detail="Минимум 5 тегов")
    cmd = {"id": f"{req.category}-{random.randint(100, 999)}", "category": req.category,
           "name": req.name.strip(), "command": req.command.strip(),
           "description": req.description.strip(), "platform": req.platform,
           "examples": req.examples, "tags": req.tags}
    engine = get_engine()
    engine.corpus.append(cmd)
    save_corpus(engine.corpus)
    return cmd

@api.put("/admin/commands/{command_id}")
async def admin_update(command_id: str, req: CommandCreate, request: Request):
    require_admin(request)
    engine = get_engine()
    idx = next((i for i, c in enumerate(engine.corpus) if c["id"] == command_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    engine.corpus[idx] = {"id": command_id, "category": req.category,
                          "name": req.name.strip(), "command": req.command.strip(),
                          "description": req.description.strip(), "platform": req.platform,
                          "examples": req.examples, "tags": req.tags}
    save_corpus(engine.corpus)
    return engine.corpus[idx]

@api.delete("/admin/commands/{command_id}", status_code=204)
async def admin_delete(command_id: str, request: Request):
    require_admin(request)
    engine = get_engine()
    engine.corpus = [c for c in engine.corpus if c["id"] != command_id]
    save_corpus(engine.corpus)
    return None


@api.get("/admin/users")
async def admin_users(request: Request, q: Optional[str] = None, role: Optional[str] = None):
    require_admin(request)
    out = []
    for login, u in store.users.items():
        if u["role"] == "guest": continue
        if q and q.lower() not in login.lower(): continue
        if role and u["role"] != role: continue
        out.append({"login": login, "role": u["role"], "created_at": u.get("created_at"),
                    "last_login_at": u.get("last_login_at"),
                    "chats_count": len([c for c in store.chats if c["owner"] == login])})
    return sorted(out, key=lambda x: x["login"])

@api.get("/admin/users/{login}")
async def admin_user(login: str, request: Request):
    require_admin(request)
    u = store.users.get(login)
    if not u or u["role"] == "guest":
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return {"login": login, "role": u["role"], "created_at": u.get("created_at"),
            "last_login_at": u.get("last_login_at"),
            "chats_count": len([c for c in store.chats if c["owner"] == login])}

@api.post("/admin/users", status_code=201)
async def admin_create_user(req: AdminUserReq, request: Request):
    require_admin(request)
    login = req.login.strip().lower()
    if len(login) < 3 or len(login) > 32 or " " in login:
        raise HTTPException(status_code=400, detail="Логин: от 3 до 32 символов, без пробелов")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Пароль: минимум 6 символов")
    if req.role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="Выберите роль")
    if login in store.users:
        raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")
    store.users[login] = {"password": hash_password(req.password), "role": req.role,
                          "recovery_code": new_recovery_code(), "created_at": now_iso(), "last_login_at": None}
    store._save()
    return {"login": login, "role": req.role, "created_at": store.users[login]["created_at"],
            "last_login_at": None, "chats_count": 0}

@api.patch("/admin/users/{login}")
async def admin_patch_user(login: str, req: AdminUserPatch, request: Request):
    me = require_admin(request)
    target = store.users.get(login)
    if not target or target["role"] == "guest":
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if req.role is not None and req.role != target["role"]:
        if req.role not in ("user", "admin"):
            raise HTTPException(status_code=400, detail="Выберите роль")
        if login == me["login"]:
            raise HTTPException(status_code=409, detail="Нельзя изменить роль своей учётной записи")
        if target["role"] == "admin" and len([u for u in store.users.values() if u["role"] == "admin"]) <= 1:
            raise HTTPException(status_code=409, detail="Должен остаться хотя бы один администратор")
        target["role"] = req.role
    if req.password:
        if len(req.password) < 6:
            raise HTTPException(status_code=400, detail="Пароль: минимум 6 символов")
        target["password"] = hash_password(req.password)
    store._save()
    return {"login": login, "role": target["role"], "created_at": target.get("created_at"),
            "last_login_at": target.get("last_login_at"),
            "chats_count": len([c for c in store.chats if c["owner"] == login])}

@api.delete("/admin/users/{login}", status_code=204)
async def admin_delete_user(login: str, request: Request):
    me = require_admin(request)
    target = store.users.get(login)
    if not target or target["role"] == "guest":
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if login == me["login"]:
        raise HTTPException(status_code=409, detail="Нельзя удалить свою учётную запись")
    if target["role"] == "admin" and len([u for u in store.users.values() if u["role"] == "admin"]) <= 1:
        raise HTTPException(status_code=409, detail="Должен остаться хотя бы один администратор")
    store.users.pop(login, None)
    store.chats = [c for c in store.chats if c["owner"] != login]
    store._save()
    return None


app.include_router(api)

@app.get("/")
async def index():
    return FileResponse(str(WEB_DIR / "index.html"))

@app.get("/{path:path}")
async def serve_static(path: str):
    file_path = (WEB_DIR / path).resolve()
    if not str(file_path).startswith(str(WEB_DIR.resolve())):
        raise HTTPException(status_code=404, detail="Не найдено")
    if file_path.is_file():
        return FileResponse(str(file_path))
    return FileResponse(str(WEB_DIR / "index.html"))