/**
 * Обработчики мок-сервера. Повторяют контракт spec/tech/api.md:
 * те же пути, статусы, тексты ошибок и проверки прав, что должен делать бэкенд.
 */
import { route, HttpError } from "./router.js?v=202611161110";
import { db, save, nextId, setSession, currentUser } from "./db.js?v=202611161110";
import { answer } from "./search.js?v=202611161110";

const now = () => new Date().toISOString();
const ROLES = ["user", "admin"];
const PLATFORMS = ["linux", "mac", "windows", "unix", "cross"];
const LOGIN_RE = /^\S{3,32}$/;
const MY = "my"; // категория личных команд
const MY_LIMIT = 500;

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

/** Код восстановления: 3 группы по 4 символа без похожих букв и цифр (0/O, 1/I/L). */
function newRecoveryCode() {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const pick = () => A[Math.floor(Math.random() * A.length)];
  return [0, 1, 2].map(() => Array.from({ length: 4 }, pick).join("")).join("-");
}
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Удаляет гостя вместе с чатами (выход, вход или регистрация из гостевого режима). */
function dropGuest(user) {
  if (!user || user.role !== "guest") return;
  delete db().users[user.login];
  delete db().learn[user.login];
  db().chats = db().chats.filter((c) => c.owner !== user.login);
  save();
}

/* ===================== Авторизация ===================== */

route("GET", "/auth/me", ({ user }) => publicUser(user.login, user));

route("POST", "/auth/login", ({ body }) => {
  const login = normLogin(body.login);
  const u = db().users[login];
  if (!u || u.role === "guest" || u.password !== body.password) throw new HttpError(401, "Неверный логин или пароль");
  dropGuest(currentUser());
  u.last_login_at = now(); save();
  setSession(login);
  return publicUser(login, u);
}, { auth: false });

/** Регистрация. Ответ содержит recovery_code — показывается один раз. */
route("POST", "/auth/register", ({ body }) => {
  const login = normLogin(body.login);
  checkLogin(login);
  if (login.startsWith("guest-")) throw bad("Логин не может начинаться с «guest-»", "login");
  checkPassword(body.password);
  if (db().users[login]) throw conflict("Пользователь с таким логином уже существует", "login");
  dropGuest(currentUser()); // чаты гостя не переносятся
  const code = newRecoveryCode();
  // Регистрация всегда создаёт роль user — роль из тела запроса игнорируется.
  db().users[login] = { password: body.password, role: "user", recovery_code: code, created_at: now(), last_login_at: now() };
  save(); setSession(login);
  return { ...publicUser(login, db().users[login]), recovery_code: code };
}, { auth: false, status: 201 });

/** Гостевой вход без регистрации: временная учётная запись до выхода/закрытия вкладки. */
route("POST", "/auth/guest", () => {
  dropGuest(currentUser());
  const login = "guest-" + Math.random().toString(36).slice(2, 8);
  db().users[login] = { role: "guest", created_at: now(), last_login_at: now(), last_active_at: now() };
  save(); setSession(login, { guest: true });
  return publicUser(login, db().users[login]);
}, { auth: false, status: 201 });

route("POST", "/auth/logout", () => { dropGuest(currentUser()); setSession(null); }, { auth: false });

/** «Забыли пароль?»: логин + код восстановления → новый пароль. Старый код сгорает, выдаётся новый. */
route("POST", "/auth/reset-password", ({ body }) => {
  const login = normLogin(body.login);
  const u = db().users[login];
  if (!String(body.recovery_code || "").trim()) throw bad("Введите код восстановления", "recovery_code");
  if (!u || u.role === "guest" || !u.recovery_code || normCode(u.recovery_code) !== normCode(body.recovery_code)) {
    throw new HttpError(401, "Неверный логин или код восстановления");
  }
  checkPassword(body.new_password, "new_password");
  u.password = body.new_password;
  u.recovery_code = newRecoveryCode();
  save();
  return { recovery_code: u.recovery_code };
}, { auth: false });

/** Смена пароля из профиля: пользователь уже вошёл, старый пароль не нужен. */
route("POST", "/auth/change-password", ({ body, user }) => {
  checkPassword(body.new_password, "new_password");
  db().users[user.login].password = body.new_password; save();
}, { member: true });

/** Новый код восстановления (старый перестаёт действовать). */
route("POST", "/auth/recovery-code", ({ user }) => {
  const code = newRecoveryCode();
  db().users[user.login].recovery_code = code; save();
  return { recovery_code: code };
}, { member: true });

/* ===================== Датасет (чтение — любой вошедший) ===================== */

const myList = (user) => (user && user.role !== "guest" ? (db().my_commands[user.login] ||= []) : []);

/** Категории общего датасета + «Мои команды» для зарегистрированных. */
route("GET", "/categories", ({ user }) => {
  const list = Object.entries(db().categories).map(([key, label]) => ({
    key, label, count: db().commands.filter((c) => c.category === key).length,
  }));
  if (user.role !== "guest") list.push({ key: MY, label: "Мои команды", count: myList(user).length, personal: true });
  return list;
});

route("GET", "/commands", ({ query, user }) => {
  let list;
  if (query.category === MY) {
    if (user.role === "guest") throw new HttpError(403, "Доступно после регистрации");
    list = myList(user);
  } else {
    list = db().commands;
    if (query.category) {
      if (!db().categories[query.category]) throw notFound("Категория не найдена");
      list = list.filter((c) => c.category === query.category);
    }
  }
  if (query.q) {
    const q = query.q.toLowerCase();
    list = list.filter((c) => (c.name + " " + c.command + " " + (c.tags || []).join(" ")).toLowerCase().includes(q));
  }
  return list;
});

route("GET", "/commands/:id", ({ params, user }) => {
  const c = db().commands.find((x) => x.id === params.id) || myList(user).find((x) => x.id === params.id);
  if (!c) throw notFound("Команда не найдена"); // чужая личная команда = 404
  return c;
});

/* ===================== Личный датасет (только зарегистрированные) ===================== */

/** Проверка личной команды: мягче, чем в общем датасете (примеры 0–3, теги необязательны). */
function validateMyCommand(b) {
  const s = (v) => String(v ?? "").trim();
  // Строкой (из CSV): примеры через «|» (в командах бывают запятые), теги через «,» или «|»
  const list = (v, sep) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(sep) : []).map(s).filter(Boolean);
  const cmd = {
    category: MY, name: s(b.name), command: s(b.command), description: s(b.description),
    platform: PLATFORMS.includes(s(b.platform)) ? s(b.platform) : "cross",
    examples: list(b.examples, /\|/).slice(0, 3), tags: list(b.tags, /[|,]/).slice(0, 20),
  };
  if (!cmd.name) throw bad("Нет названия (name)", "name");
  if (!cmd.command) throw bad("Нет команды (command)", "command");
  if (!cmd.description) throw bad("Нет описания (description)", "description");
  if (cmd.name.length > 120 || cmd.command.length > 500 || cmd.description.length > 2000) throw bad("Слишком длинное поле", "description");
  return cmd;
}

route("GET", "/my/commands", ({ user }) => myList(user), { member: true });

/** Импорт из файла: commands — массив; mode append | replace. Невалидные строки пропускаются с причиной. */
route("POST", "/my/commands/import", ({ body, user }) => {
  if (!Array.isArray(body.commands) || !body.commands.length) throw bad("В файле нет команд", "file");
  const mode = body.mode === "replace" ? "replace" : "append";
  const list = mode === "replace" ? [] : [...myList(user)];
  const skipped = [];
  let added = 0;
  body.commands.forEach((raw, i) => {
    if (list.length >= MY_LIMIT) { skipped.push({ index: i, reason: `Превышен лимит ${MY_LIMIT} команд` }); return; }
    try {
      const v = validateMyCommand(raw || {});
      if (list.some((c) => c.command === v.command && c.name === v.name)) { skipped.push({ index: i, reason: "Уже есть в датасете" }); return; }
      list.push({ id: nextId("my-"), ...v });
      added++;
    } catch (e) { skipped.push({ index: i, reason: e.message }); }
  });
  if (!added && mode === "append") throw bad("Ни одна команда не подошла: " + (skipped[0]?.reason || "проверьте формат"), "file");
  db().my_commands[user.login] = list; save();
  return { added, skipped, total: list.length };
}, { member: true });

route("PUT", "/my/commands/:id", ({ params, body, user }) => {
  const list = myList(user);
  const i = list.findIndex((x) => x.id === params.id);
  if (i < 0) throw notFound("Команда не найдена");
  list[i] = { id: params.id, ...validateMyCommand(body) }; save();
  return list[i];
}, { member: true });

route("DELETE", "/my/commands/:id", ({ params, user }) => {
  const list = myList(user);
  if (!list.some((x) => x.id === params.id)) throw notFound("Команда не найдена");
  db().my_commands[user.login] = list.filter((x) => x.id !== params.id); save();
}, { member: true });

route("DELETE", "/my/commands", ({ user }) => { db().my_commands[user.login] = []; save(); }, { member: true });

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
  // Поиск по общему датасету + личным командам владельца чата
  const pool = db().commands.concat(db().my_commands[chat.owner] || []);
  const userMsg = { id: nextId("m"), role: "user", text, created_at: now() };
  const botMsg = { id: nextId("m"), role: "assistant", reply: answer(pool, text), created_at: now() };
  chat.messages.push(userMsg, botMsg);
  chat.updated_at = botMsg.created_at;
  save();
  return { chat: chatSummary(chat), messages: [userMsg, botMsg] };
}

/** Фрагмент текста вокруг совпадения: «…начало совпадение конец…» */
function snippet(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return null;
  const from = Math.max(0, i - 24), to = Math.min(text.length, i + q.length + 40);
  return (from ? "…" : "") + text.slice(from, to).replace(/\s+/g, " ") + (to < text.length ? "…" : "");
}
/** Где в чате встретился запрос: заголовок → null (видно и так), иначе фрагмент сообщения или ответа. */
function chatMatch(c, q) {
  if (c.title.toLowerCase().includes(q)) return { match: null };
  for (const m of c.messages) {
    if (m.role === "user") { const sn = snippet(m.text, q); if (sn) return { match: sn }; continue; }
    for (const cmd of (m.reply?.commands || []).concat(m.reply?.related || [])) {
      const sn = snippet(cmd.command, q) || snippet(cmd.name, q);
      if (sn) return { match: "Ответ: " + sn };
    }
  }
  return null;
}

/** История. q — поиск по названию чата, тексту запросов и командам в ответах. */
route("GET", "/chats", ({ user, query }) => {
  const q = String(query.q || "").trim().toLowerCase();
  if (q.length > 100) throw bad("Запрос слишком длинный", "q");
  return db().chats
    .filter((c) => c.owner === user.login)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((c) => {
      if (!q) return chatSummary(c);
      const m = chatMatch(c, q);
      return m && { ...chatSummary(c), match: m.match };
    })
    .filter(Boolean);
});

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

/** Переименование чата. */
route("PATCH", "/chats/:id", ({ user, params, body }) => {
  const c = ownChat(user, params.id);
  const title = String(body.title ?? "").trim().replace(/\s+/g, " ");
  if (!title) throw bad("Введите название", "title");
  if (title.length > 100) throw bad("Название: максимум 100 символов", "title");
  c.title = title; save();
  return chatSummary(c);
});

route("DELETE", "/chats/:id", ({ user, params }) => {
  const c = ownChat(user, params.id);
  db().chats = db().chats.filter((x) => x !== c); save();
});

/* ===================== Обучение: тесты по темам (guest, user, admin) ===================== */

const QUIZ_SIZES = [10];  // или "all" — все команды темы
const MIN_TOPIC = 4;  // для 4 вариантов ответа нужно хотя бы 4 команды
const quizzes = {};   // id → тест; ответы хранятся только на «сервере»

const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const topicCommands = (user, key) => (key === MY ? myList(user) : db().commands.filter((c) => c.category === key));
const progressOf = (user, key) => {
  const p = ((db().learn[user.login] ||= {})[key] ||= { best: null, last: null, attempts: 0, mistakes: [] });
  p.asked ||= {}; // id команды → когда спрашивали последний раз (чтобы вопросы чередовались)
  return p;
};

function topicsFor(user) {
  const list = Object.entries(db().categories).map(([key, label]) => ({ key, label }));
  if (user.role !== "guest") list.push({ key: MY, label: "Мои команды", personal: true }); // доступна при ≥ 4 своих командах
  return list.map((t) => {
    const p = progressOf(user, t.key);
    const count = topicCommands(user, t.key).length;
    return { ...t, count, available: count >= MIN_TOPIC, best: p.best, last: p.last, attempts: p.attempts,
      mistakes: p.mistakes.filter((id) => topicCommands(user, t.key).some((c) => c.id === id)).length };
  });
}

/**
 * Вопрос по команде c; варианты-отвлекатели — из той же темы.
 *   task    — «Какая команда …?» (по описанию выбрать команду)
 *   explain — «Что делает команда?» (по команде выбрать описание)
 *   example — «Какой пример относится к …?» (по названию выбрать пример применения)
 */
function makeQuestion(c, pool) {
  const others = shuffle(pool.filter((x) => x.id !== c.id));
  const types = ["task", "explain", "name"];
  if ((c.examples || []).length && others.filter((x) => (x.examples || []).length).length >= 3) types.push("example");
  const type = types[Math.floor(Math.random() * types.length)];
  const pick = { task: (x) => x.command, explain: (x) => x.description, name: (x) => x.name, example: (x) => shuffle(x.examples || [])[0] }[type];
  const right = pick(c);
  const wrong = [];
  for (const o of others) {
    const v = pick(o);
    if (v && v !== right && !wrong.includes(v)) wrong.push(v);
    if (wrong.length === 3) break;
  }
  const options = shuffle([right, ...wrong]);
  const prompt = {
    task: "Какая команда подходит для задачи?",
    explain: "Что делает эта команда?",
    name: "Как называется эта команда?",
    example: `Какой пример относится к команде «${c.name}»?`,
  }[type];
  return {
    public: { id: nextId("q"), type, prompt, subject: type === "task" ? c.description : type === "explain" || type === "name" ? c.command : null, options },
    answer: options.indexOf(right), command_id: c.id,
  };
}

route("GET", "/learn/topics", ({ user }) => topicsFor(user));

/** Новый тест: mode all — случайные команды темы, mistakes — только ошибки прошлых попыток. */
route("POST", "/learn/quizzes", ({ user, body }) => {
  const key = String(body.topic || "");
  if (key === MY && user.role === "guest") throw new HttpError(403, "Доступно после регистрации");
  if (key !== MY && !db().categories[key]) throw notFound("Тема не найдена");
  const pool = topicCommands(user, key);
  if (pool.length < MIN_TOPIC) throw bad(`Для теста нужно хотя бы ${MIN_TOPIC} команды`, "topic");
  const mode = body.mode === "mistakes" ? "mistakes" : "all";
  let picked;
  if (mode === "mistakes") {
    const ids = progressOf(user, key).mistakes;
    picked = shuffle(pool.filter((c) => ids.includes(c.id)));
    if (!picked.length) throw bad("Ошибок для повторения нет — все закреплены", "mode");
  } else {
    // Сколько вопросов: 10, 20 или вся тема. Сначала команды, которые давно не спрашивали (или ни разу), — так тесты не повторяются
    const size = body.size === "all" ? pool.length : QUIZ_SIZES.includes(Number(body.size)) ? Number(body.size) : QUIZ_SIZES[0];
    const asked = progressOf(user, key).asked;
    picked = shuffle(pool).sort((a, b) => (asked[a.id] || 0) - (asked[b.id] || 0)).slice(0, size);
    picked = shuffle(picked);
  }
  const p0 = progressOf(user, key);
  picked.forEach((c, n) => { p0.asked[c.id] = Date.now() + n; });
  save();
  const qs = picked.map((c) => makeQuestion(c, pool));
  const id = nextId("quiz");
  quizzes[id] = { id, owner: user.login, topic: key, mode, qs, answered: {}, finished: false };
  return { id, topic: key, mode, total: qs.length, questions: qs.map((q) => q.public) };
}, { status: 201 });

function ownQuiz(user, id) {
  const q = quizzes[id];
  if (!q || q.owner !== user.login) throw notFound("Тест не найден. Начните заново");
  return q;
}

/** Ответ на вопрос: сразу говорим, верно ли, и показываем команду для закрепления. */
route("POST", "/learn/quizzes/:id/answers", ({ user, params, body }) => {
  const quiz = ownQuiz(user, params.id);
  if (quiz.finished) throw conflict("Тест уже завершён");
  const q = quiz.qs.find((x) => x.public.id === body.question_id);
  if (!q) throw notFound("Вопрос не найден");
  if (quiz.answered[q.public.id] !== undefined) throw conflict("Ответ уже принят");
  const option = Number(body.option);
  if (!Number.isInteger(option) || option < 0 || option >= q.public.options.length) throw bad("Выберите вариант", "option");
  const correct = option === q.answer;
  quiz.answered[q.public.id] = correct;
  const p = progressOf(user, quiz.topic);
  // Ошибка попадает в «повторить», верный ответ её закрепляет — убирает из списка
  if (correct) p.mistakes = p.mistakes.filter((id) => id !== q.command_id);
  else if (!p.mistakes.includes(q.command_id)) p.mistakes.push(q.command_id);
  save();
  const command = topicCommands(user, quiz.topic).find((c) => c.id === q.command_id);
  return { correct, correct_option: q.answer, command };
});

route("POST", "/learn/quizzes/:id/finish", ({ user, params }) => {
  const quiz = ownQuiz(user, params.id);
  const total = quiz.qs.length;
  const correct = Object.values(quiz.answered).filter(Boolean).length;
  const answered = Object.keys(quiz.answered).length;
  const p = progressOf(user, quiz.topic);
  if (!quiz.finished) {
    quiz.finished = true;
    if (quiz.mode === "all" && answered === total) {
      const pct = Math.round((correct / total) * 100);
      p.last = pct; p.best = Math.max(p.best ?? 0, pct); p.attempts++;
    }
    save();
  }
  return { correct, total, answered, best: p.best, mistakes: p.mistakes.length };
});

/** Сбросить прогресс темы (результаты и список ошибок). */
route("DELETE", "/learn/topics/:key", ({ user, params }) => {
  delete (db().learn[user.login] || {})[params.key]; save();
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
  if (!u || u.role === "guest") throw notFound("Пользователь не найден"); // гости в управлении не видны
  return u;
}

route("GET", "/admin/users", ({ query }) => {
  const q = normLogin(query.q);
  return Object.entries(db().users)
    .filter(([login, u]) => u.role !== "guest" && (!q || login.includes(q)) && (!query.role || u.role === query.role))
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
  db().users[login] = { password: body.password, role: body.role, recovery_code: newRecoveryCode(), created_at: now(), last_login_at: null };
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
  delete db().my_commands[params.login];
  delete db().learn[params.login];
  db().chats = db().chats.filter((c) => c.owner !== params.login); // вместе с историей и личным датасетом
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
