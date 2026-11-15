/** «База данных» мок-сервера в localStorage (в памяти, если хранилище недоступно). */
import { CATEGORIES, CORPUS } from "./corpus.js?v=202611160130";

const KEY = "nirs.mock.db.v2";
const SESSION_KEY = "nirs.mock.session"; // имитация httpOnly-cookie
const GUEST_KEY = "nirs.mock.guest";     // сессия гостя: живёт до закрытия вкладки (как cookie без срока)
const GUEST_TTL = 24 * 3600 * 1000;      // данные брошенных гостевых сессий удаляются через сутки
const mem = {};
const store = (s) => ({
  get(k) { try { return s.getItem(k); } catch { return mem[k] ?? null; } },
  set(k, v) { mem[k] = v; try { s.setItem(k, v); } catch {} },
  del(k) { delete mem[k]; try { s.removeItem(k); } catch {} },
});
let ls, ss;
try { ls = store(localStorage); ss = store(sessionStorage); } catch { ls = ss = store({}); }

const iso = (d) => new Date(d).toISOString();

/** Учебные коды восстановления пароля (в README). На сервере коды хранятся как хэш. */
export const SEED_CODES = { admin: "ADMN-6F9C-W2LZ", demo: "DEMO-7K2P-Q9XA", "ivan.petrov": "IVAN-4H8M-T3RW", "m.sokolova": "MSOK-8B3N-V5JD" };

function seed() {
  return {
    users: {
      // Пароли и коды в открытом виде — только в моке. На сервере: sha256 + соль (spec/tech/auth.md).
      admin: { password: "admin123", role: "admin", created_at: iso("2026-10-05T09:00:00+03:00"), last_login_at: iso("2026-10-14T18:20:00+03:00") },
      demo: { password: "demo123", role: "user", created_at: iso("2026-10-06T14:12:00+03:00"), last_login_at: iso("2026-10-15T10:02:00+03:00") },
      "ivan.petrov": { password: "qwerty12", role: "user", created_at: iso("2026-10-08T11:40:00+03:00"), last_login_at: null },
      "m.sokolova": { password: "admin456", role: "admin", created_at: iso("2026-10-09T16:05:00+03:00"), last_login_at: iso("2026-10-12T09:15:00+03:00") },
    },
    categories: CATEGORIES,
    commands: Object.values(CORPUS).flat(),
    my_commands: {}, // логин → личные команды
    learn: {},       // логин → прогресс обучения по темам
    chats: [],
    seq: 1,
  };
}

/** Догоняет старые сохранённые данные до текущей схемы, не сбрасывая их. */
function migrate(s) {
  s.my_commands ||= {};
  s.learn ||= {}; // логин → {категория: {best, last, attempts, mistakes: [id команд]}}
  for (const [login, code] of Object.entries(SEED_CODES)) if (s.users[login] && !s.users[login].recovery_code) s.users[login].recovery_code = code;
  // Гости без активности дольше суток удаляются вместе с чатами
  const now = Date.now();
  for (const [login, u] of Object.entries(s.users)) {
    if (u.role === "guest" && now - new Date(u.last_active_at || u.created_at).getTime() > GUEST_TTL) {
      delete s.users[login];
      delete s.learn?.[login];
      s.chats = s.chats.filter((c) => c.owner !== login);
    }
  }
}

let state = null;
export function db() {
  if (!state) {
    const raw = ls.get(KEY);
    try { state = raw ? JSON.parse(raw) : null; } catch { state = null; }
    if (!state) state = seed();
    migrate(state);
    save();
  }
  return state;
}
export function save() { ls.set(KEY, JSON.stringify(state)); }
export function resetDb() { ls.del(KEY); ls.del(SESSION_KEY); ss.del(GUEST_KEY); state = null; }
export function nextId(prefix) { const s = db(); return `${prefix}${(s.seq++).toString(36)}${Date.now().toString(36).slice(-4)}`; }

export function currentUser() {
  const login = ls.get(SESSION_KEY) || ss.get(GUEST_KEY);
  const u = login && db().users[login];
  return u ? { login, ...u } : null;
}
/** guest: true — сессия до закрытия вкладки. */
export function setSession(login, { guest = false } = {}) {
  ls.del(SESSION_KEY); ss.del(GUEST_KEY);
  if (login) (guest ? ss : ls).set(guest ? GUEST_KEY : SESSION_KEY, login);
}
