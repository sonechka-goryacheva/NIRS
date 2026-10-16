/** «База данных» мок-сервера в localStorage (в памяти, если хранилище недоступно). */
import { CATEGORIES, CORPUS } from "./corpus.js?v=202610162235";

const KEY = "nirs.mock.db.v2";
const SESSION_KEY = "nirs.mock.session"; // имитация httpOnly-cookie
const mem = {};
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } },
  set(k, v) { mem[k] = v; try { localStorage.setItem(k, v); } catch {} },
  del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch {} },
};

const iso = (d) => new Date(d).toISOString();

function seed() {
  return {
    users: {
      // Пароли в открытом виде — только в моке. На сервере: sha256 + соль (spec/tech/auth.md).
      admin: { password: "admin123", role: "admin", created_at: iso("2026-10-05T09:00:00+03:00"), last_login_at: iso("2026-10-14T18:20:00+03:00") },
      demo: { password: "demo123", role: "user", created_at: iso("2026-10-06T14:12:00+03:00"), last_login_at: iso("2026-10-15T10:02:00+03:00") },
      "ivan.petrov": { password: "qwerty12", role: "user", created_at: iso("2026-10-08T11:40:00+03:00"), last_login_at: null },
      "m.sokolova": { password: "admin456", role: "admin", created_at: iso("2026-10-09T16:05:00+03:00"), last_login_at: iso("2026-10-12T09:15:00+03:00") },
    },
    categories: CATEGORIES,
    commands: Object.values(CORPUS).flat(),
    chats: [],
    seq: 1,
  };
}

let state = null;
export function db() {
  if (!state) {
    const raw = ls.get(KEY);
    try { state = raw ? JSON.parse(raw) : null; } catch { state = null; }
    if (!state) { state = seed(); save(); }
  }
  return state;
}
export function save() { ls.set(KEY, JSON.stringify(state)); }
export function resetDb() { ls.del(KEY); ls.del(SESSION_KEY); state = null; }
export function nextId(prefix) { const s = db(); return `${prefix}${(s.seq++).toString(36)}${Date.now().toString(36).slice(-4)}`; }

export function currentUser() {
  const login = ls.get(SESSION_KEY);
  const u = login && db().users[login];
  return u ? { login, ...u } : null;
}
export function setSession(login) { login ? ls.set(SESSION_KEY, login) : ls.del(SESSION_KEY); }
