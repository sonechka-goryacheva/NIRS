/** Таблица маршрутов мок-сервера: метод + путь с параметрами (:id) → обработчик. */
import { currentUser } from "./db.js?v=202610162235";

export class HttpError extends Error {
  constructor(status, detail, field = null) { super(detail); this.status = status; this.field = field; }
}

const routes = [];

/**
 * @param {string} method
 * @param {string} pattern например "/chats/:id/messages"
 * @param {(ctx: {params, query, body, user}) => any} handler вернуть тело ответа или {status, body}
 * @param {{auth?: boolean, admin?: boolean, status?: number}} opts
 */
export function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ method, re, keys, handler, auth: opts.auth ?? true, admin: !!opts.admin, status: opts.status || 200 });
}

export async function dispatch(method, path, query, body) {
  let pathMatched = false;
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const user = currentUser();
    if (r.auth && !user) return err(401, "Требуется вход");
    if (r.admin && user.role !== "admin") return err(403, "Недостаточно прав");
    try {
      const out = await r.handler({ params, query, body: body || {}, user });
      if (out === undefined) return { status: 204, body: null };
      return { status: r.status, body: out };
    } catch (e) {
      if (e instanceof HttpError) return err(e.status, e.message, e.field);
      console.error("[mock] 500", e);
      return err(500, "Ошибка сервера. Попробуйте ещё раз");
    }
  }
  return pathMatched ? err(405, "Метод не поддерживается") : err(404, "Не найдено");
}

const err = (status, detail, field = null) => ({ status, body: { detail, field } });
