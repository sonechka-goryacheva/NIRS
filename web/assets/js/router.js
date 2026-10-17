/**
 * Hash-роутер: #/chat/abc → обработчик маршрута "/chat/:id".
 * Hash выбран, чтобы статику можно было отдавать с любого хостинга без настройки fallback.
 *
 * Маршрут: { pattern, view(ctx), auth?: boolean, roles?: string[], guestOnly?: boolean }
 * ctx: { path, params, query }
 */
const routes = [];
let guard = null;
let notFoundView = null;
let silentNext = false;

export function define(pattern, view, meta = {}) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ pattern, re, keys, view, auth: true, ...meta });
}
export function fallback(view) { notFoundView = view; }
/** guard(route, ctx) → путь для редиректа или null */
export function setGuard(fn) { guard = fn; }

export function current() {
  const raw = decodeURI(location.hash.slice(1)) || "/";
  const [path, qs = ""] = raw.split("?");
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

/**
 * Переход. replace — без записи в историю; silent — только поменять адрес, не перерисовывая
 * (например, когда новый чат получил id).
 */
export function go(path, { replace = false, silent = false } = {}) {
  if (silent) {
    if (replace) history.replaceState(null, "", "#" + path);
    else { silentNext = true; location.hash = path; }
    return;
  }
  if (replace) { history.replaceState(null, "", "#" + path); resolve(); return; }
  if (decodeURI(location.hash.slice(1)) === path) { resolve(); return; }
  location.hash = path;
}

export function link(path) { return "#" + path; }

async function resolve() {
  if (silentNext) { silentNext = false; return; }
  const { path, query } = current();
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const ctx = { path, query, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    const redirect = guard ? guard(r, ctx) : null;
    if (redirect) { go(redirect, { replace: true }); return; }
    await r.view(ctx);
    return;
  }
  notFoundView?.({ path, query, params: {} });
}

export function start() {
  window.addEventListener("hashchange", resolve);
  resolve();
}
