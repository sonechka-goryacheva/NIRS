/**
 * Обработчики мок-сервера. Повторяют контракт spec/tech/api.md:
 * те же пути, статусы, тексты ошибок и проверки прав, что должен делать бэкенд.
 */
import { route, HttpError } from "./router.js?v=202610162235";
import { db, save, nextId, setSession } from "./db.js?v=202610162235";
import { answer } from "./search.js?v=202610162235";

const now = () => new Date().toISOString();
const ROLES = ["user", "admin"];
const PLATFORMS = ["linux", "mac", "windows", "unix", "cross"];
const LOGIN_RE = /^\S{3,32}$/;

const bad = (detail, field = null) => new HttpError(400, detail, field);
const notFound = (detail = "Не найдено") => new HttpError(404, detail);
const conflict = (detail, field = null) => new HttpError(409, detail, field);

const publicUser = (login, u) => ({ login, role: u.role, created_at: u.created_at, last_login_at: u.last_login_at || null });
const adminUser = (login, u) => ({ ...publicUser(login, u), chats_count: db().chats.filter((c) => c.owner === login).length });
const chatSummary = (c) => ({ id: c.id, title: c.title, created_at: c.created_at, updated_at: c.updated_at });
const adminsCount = () => Object.values(db().users).filter((u) => u.role === "admin").length;

function normLogin(v) { return String(v || "").trim().toLowerCase(); }
function checkLogin(login) { if (!LOGIN_RE.test(login)) throw bad("Логин: от 3 до 32 символов, без пробелов", "login"); }
function checkPassword(pw, field = "password") { if (String(pw || "").length < 6) throw bad("Пароль: минимум 6 символов", field); }

/* ===================== Авторизация ===================== */

route("GET", "/auth/me", ({ user }) => publicUser(user.login, user));

route("POST", "/auth/login", ({ body }) => {
  const login = normLogin(body.login);
  const u = db().users[login];
  if (!u || u.password !== body.password) throw new HttpError(401, "Неверный логин или пароль");
  u.last_login_at = now(); save();
  setSession(login);
  return publicUser(login, u);
}, { auth: false });

route("POST", "/auth/register", ({ body }) => {
  const login = normLogin(body.login);
  checkLogin(login);
  checkPassword(body.password);
  if (db().users[login]) throw conflict("Пользователь с таким логином уже существует", "login");
  // Регистрация всегда создаёт роль user — роль из тела запроса игнорируется.
  db().users[login] = { password: body.password, role: "user", created_at: now(), last_login_at: now() };
  save(); setSession(login);
  return publicUser(login, db().users[login]);
}, { auth: false, status: 201 });

route("POST", "/auth/logout", () => { setSession(null); }, { auth: false });

route("POST", "/auth/change-password", ({ body }) => {
  const login = normLogin(body.login);
  const u = db().users[login];
  if (!u || u.password !== body.old_password) throw new HttpError(401, "Неверный логин или пароль");
  checkPassword(body.new_password, "new_password");
  if (body.new_password === body.old_password) throw bad("Новый пароль совпадает с текущим", "new_password");
  u.password = body.new_password; save();
}, { auth: false });

/* ===================== Датасет (чтение — любой вошедший) ===================== */

route("GET", "/categories", () => Object.entries(db().categories).map(([key, label]) => ({
  key, label, count: db().commands.filter((c) => c.category === key).length,
})));

route("GET", "/commands", ({ query }) => {
  let list = db().commands;
  if (query.category) {
    if (!db().categories[query.category]) throw notFound("Категория не найдена");
    list = list.filter((c) => c.category === query.category);
  }
  if (query.q) {
    const q = query.q.toLowerCase();
    list = list.filter((c) => (c.name + " " + c.command + " " + (c.tags || []).join(" ")).toLowerCase().includes(q));
  }
  return list;
});

route("GET", "/commands/:id", ({ params }) => {
  const c = db().commands.find((x) => x.id === params.id);
  if (!c) throw notFound("Команда не найдена");
  return c;
});

/* ===================== Чаты (только свои) ===================== */

function ownChat(user, id) {
  const c = db().chats.find((x) => x.id === id && x.owner === user.login);
  if (!c) throw notFound("Чат не найден"); // чужой чат = 404, чтобы не раскрывать существование
  return c;
}
function checkMessage(text) {
  const t = String(text || "").trim();
  if (!t) throw bad("Введите запрос", "message");
  if (t.length > 2000) throw bad("Запрос слишком длинный: максимум 2000 символов", "message");
  return t;
}
function exchange(chat, text) {
  const userMsg = { id: nextId("m"), role: "user", text, created_at: now() };
  const botMsg = { id: nextId("m"), role: "assistant", reply: answer(db().commands, text), created_at: now() };
  chat.messages.push(userMsg, botMsg);
  chat.updated_at = botMsg.created_at;
  save();
  return { chat: chatSummary(chat), messages: [userMsg, botMsg] };
}

route("GET", "/chats", ({ user }) => db().chats
  .filter((c) => c.owner === user.login)
  .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  .map(chatSummary));

route("POST", "/chats", ({ user, body }) => {
  const text = checkMessage(body.message);
  const chat = { id: nextId("c"), owner: user.login, title: text.slice(0, 48), created_at: now(), updated_at: now(), messages: [] };
  db().chats.push(chat);
  return exchange(chat, text);
}, { status: 201 });

route("GET", "/chats/:id", ({ user, params }) => {
  const c = ownChat(user, params.id);
  return { ...chatSummary(c), messages: c.messages };
});

route("POST", "/chats/:id/messages", ({ user, params, body }) => exchange(ownChat(user, params.id), checkMessage(body.message)), { status: 201 });

route("DELETE", "/chats/:id", ({ user, params }) => {
  const c = ownChat(user, params.id);
  db().chats = db().chats.filter((x) => x !== c); save();
});

/* ===================== Администратор: команды ===================== */

function validateCommand(b) {
  const s = (v) => String(v ?? "").trim();
  const cmd = {
    category: s(b.category), name: s(b.name), command: s(b.command), description: s(b.description), platform: s(b.platform),
    examples: (Array.isArray(b.examples) ? b.examples : []).map(s).filter(Boolean),
    tags: (Array.isArray(b.tags) ? b.tags : []).map(s).filter(Boolean),
  };
  if (!db().categories[cmd.category]) throw bad("Выберите категорию", "category");
  if (!cmd.name) throw bad("Обязательное поле", "name");
  if (!cmd.command) throw bad("Обязательное поле", "command");
  if (!cmd.description) throw bad("Обязательное поле", "description");
  if (!PLATFORMS.includes(cmd.platform)) throw bad("Выберите платформу", "platform");
  if (cmd.examples.length !== 3) throw bad("Нужно ровно 3 примера", "examples");
  if (cmd.tags.length < 5) throw bad("Минимум 5 тегов", "tags");
  return cmd;
}

route("POST", "/admin/commands", ({ body }) => {
  const v = validateCommand(body);
  const cmd = { id: nextId(v.category + "-"), ...v };
  db().commands.push(cmd); save();
  return cmd;
}, { admin: true, status: 201 });

route("PUT", "/admin/commands/:id", ({ params, body }) => {
  const i = db().commands.findIndex((x) => x.id === params.id);
  if (i < 0) throw notFound("Команда не найдена");
  db().commands[i] = { id: params.id, ...validateCommand(body) }; save();
  return db().commands[i];
}, { admin: true });

route("DELETE", "/admin/commands/:id", ({ params }) => {
  if (!db().commands.some((x) => x.id === params.id)) throw notFound("Команда не найдена");
  db().commands = db().commands.filter((x) => x.id !== params.id); save();
}, { admin: true });

/* ===================== Администратор: пользователи ===================== */

function getUser(login) {
  const u = db().users[login];
  if (!u) throw notFound("Пользователь не найден");
  return u;
}

route("GET", "/admin/users", ({ query }) => {
  const q = normLogin(query.q);
  return Object.entries(db().users)
    .filter(([login, u]) => (!q || login.includes(q)) && (!query.role || u.role === query.role))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([login, u]) => adminUser(login, u));
}, { admin: true });

route("GET", "/admin/users/:login", ({ params }) => adminUser(params.login, getUser(params.login)), { admin: true });

route("POST", "/admin/users", ({ body }) => {
  const login = normLogin(body.login);
  checkLogin(login);
  checkPassword(body.password);
  if (!ROLES.includes(body.role)) throw bad("Выберите роль", "role");
  if (db().users[login]) throw conflict("Пользователь с таким логином уже существует", "login");
  db().users[login] = { password: body.password, role: body.role, created_at: now(), last_login_at: null };
  save();
  return adminUser(login, db().users[login]);
}, { admin: true, status: 201 });

route("PATCH", "/admin/users/:login", ({ params, body, user }) => {
  const u = getUser(params.login);
  if (body.role !== undefined && body.role !== u.role) {
    if (!ROLES.includes(body.role)) throw bad("Выберите роль", "role");
    if (params.login === user.login) throw conflict("Нельзя изменить роль своей учётной записи", "role");
    if (u.role === "admin" && adminsCount() <= 1) throw conflict("Должен остаться хотя бы один администратор", "role");
  }
  if (body.password !== undefined && body.password !== "") checkPassword(body.password);
  if (body.role !== undefined) u.role = body.role;
  if (body.password) u.password = body.password;
  save();
  return adminUser(params.login, u);
}, { admin: true });

route("DELETE", "/admin/users/:login", ({ params, user }) => {
  const u = getUser(params.login);
  if (params.login === user.login) throw conflict("Нельзя удалить свою учётную запись");
  if (u.role === "admin" && adminsCount() <= 1) throw conflict("Должен остаться хотя бы один администратор");
  delete db().users[params.login];
  db().chats = db().chats.filter((c) => c.owner !== params.login); // вместе с историей
  save();
}, { admin: true });

/* ===================== Демо-история при первом запуске ===================== */
if (!db().seededChats) {
  for (const [owner, qs] of [["demo", ["Не хватает прав при запуске скрипта", "Что делает du -sh"]], ["admin", ["Посмотреть запущенные контейнеры"]]]) {
    for (const q of qs) {
      const chat = { id: nextId("c"), owner, title: q, created_at: now(), updated_at: now(), messages: [] };
      db().chats.push(chat);
      exchange(chat, q);
    }
  }
  db().seededChats = true; save();
}
