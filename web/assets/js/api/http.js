/** HTTP-клиент: единственное место, где вызывается fetch. */
import { CONFIG } from "../config.js?v=202610162235";

export class ApiError extends Error {
  /** @param {number} status  @param {string} message  @param {string|null} field */
  constructor(status, message, field = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

const DEFAULT_MESSAGES = {
  0: "Сервер недоступен. Проверьте подключение и попробуйте ещё раз",
  401: "Требуется вход",
  403: "Недостаточно прав",
  404: "Не найдено",
  500: "Ошибка сервера. Попробуйте ещё раз",
};

let unauthorizedHandler = null;
/** Вызывается при 401 на любой запрос, кроме помеченных silent401 (например, /auth/me). */
export function onUnauthorized(fn) { unauthorizedHandler = fn; }

export async function request(method, path, { body, query, silent401 = false } = {}) {
  let url = CONFIG.apiBase + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, v);
    const s = qs.toString();
    if (s) url += "?" + s;
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin", // сессия — httpOnly-cookie
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, DEFAULT_MESSAGES[0]);
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !silent401 && unauthorizedHandler) unauthorizedHandler();
    throw new ApiError(res.status, (data && data.detail) || DEFAULT_MESSAGES[res.status] || DEFAULT_MESSAGES[500], data && data.field);
  }
  return data;
}
