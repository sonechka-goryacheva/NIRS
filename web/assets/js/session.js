/** Текущий пользователь. Сессия живёт в httpOnly-cookie, фронт знает только результат /auth/me. */
import { authApi } from "./api/index.js?v=202610162235";

let user = null;
const listeners = new Set();

export const session = {
  get user() { return user; },
  get isAdmin() { return user?.role === "admin"; },
  async load() {
    try { user = await authApi.me(); } catch { user = null; }
    return user;
  },
  set(u) { user = u; listeners.forEach((fn) => fn(user)); },
  clear() { this.set(null); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
