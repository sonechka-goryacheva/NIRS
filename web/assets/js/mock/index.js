/**
 * Мок-сервер. Перехватывает fetch к CONFIG.apiBase и отвечает как настоящий бэкенд
 * (статусы, JSON, ошибки {detail, field}). Остальные запросы уходят в сеть как обычно.
 *
 * Удаляется целиком вместе с папкой mock/ — фронтенд о нём не знает.
 * В консоли: mockServer.reset() — сбросить данные, mockServer.db — посмотреть состояние.
 */
import { CONFIG } from "../config.js?v=202610162235";
import { dispatch } from "./router.js?v=202610162235";
import { db, resetDb } from "./db.js?v=202610162235";
import "./handlers.js?v=202610162235"; // регистрирует маршруты

const realFetch = window.fetch.bind(window);
const LATENCY = [200, 600];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

window.fetch = async function mockFetch(input, init = {}) {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (!url.pathname.startsWith(CONFIG.apiBase + "/")) return realFetch(input, init);

  const method = (init.method || "GET").toUpperCase();
  const path = url.pathname.slice(CONFIG.apiBase.length);
  let body;
  try { body = init.body ? JSON.parse(init.body) : undefined; } catch { body = undefined; }

  const isChat = path.startsWith("/chats") && method === "POST";
  await sleep(isChat ? 900 : LATENCY[0] + Math.random() * (LATENCY[1] - LATENCY[0]));

  const res = await dispatch(method, path, Object.fromEntries(url.searchParams), body);
  console.debug(`%c[mock] ${method} ${url.pathname}${url.search} → ${res.status}`, "color:#0f8f72", res.body ?? "");
  return new Response(res.status === 204 ? null : JSON.stringify(res.body), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
};

window.mockServer = { reset: () => { resetDb(); location.reload(); }, get db() { return db(); } };
console.info("%c[mock] API работает на заглушке. Демо: admin / admin123, demo / demo123", "color:#0f8f72;font-weight:600");
