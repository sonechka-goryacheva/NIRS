/** Чат: маршруты #/chat и #/chat/:id */
import { $, h, esc, setTitle } from "../ui/dom.js?v=202610162235";
import { icon } from "../ui/icons.js?v=202610162235";
import { commandCard } from "../ui/command-card.js?v=202610162235";
import { chatsApi } from "../api/index.js?v=202610162235";
import * as router from "../router.js?v=202610162235";
import { getCategories } from "./categories.js?v=202610162235";
import { isMounted, mountShell, refreshChats, setActiveChat, hideOverlay, setActiveNav } from "./shell.js?v=202610162235";

const SUGGESTIONS = [
  ["Проблема", "Не хватает прав при запуске скрипта"],
  ["Объяснение", "Что делает du -sh"],
  ["Git", "Как отменить последний коммит"],
  ["Docker", "Посмотреть запущенные контейнеры"],
];

let loadedId; // undefined — ничего не загружено, null — новый чат
let chatTitle = "Новый чат";
function showTitle(t) { chatTitle = t; const el = $("#chatTitle"); if (el) el.textContent = t; setTitle(t); }
let busy = false;
let loadToken = 0;

/** Маршрут чата. keepOverlay — вызывается модальными маршрутами, чтобы под ними был чат. */
export async function chatView({ params }, { keepOverlay = false } = {}) {
  mountShell();
  await getCategories().catch(() => {}); // подписи категорий в карточках
  if (!isMounted()) return; // пока ждали — сессия истекла и открылся вход
  if (!keepOverlay) { hideOverlay(); setActiveNav(null); }
  const id = params.id || null;
  ensureMain();
  setActiveChat(id);
  if (id === loadedId) { if (!keepOverlay) setTitle(chatTitle); return; }
  loadedId = id;
  const token = ++loadToken;

  const inner = $("#threadInner");
  if (!id) { showTitle("Новый чат"); renderEmpty(inner); focusInput(); return; }

  inner.innerHTML = '<div class="thread-loading"><div class="typing">Загрузка <i></i><i></i><i></i></div></div>';
  try {
    const chat = await chatsApi.get(id);
    if (token !== loadToken) return;
    showTitle(chat.title);
    inner.innerHTML = "";
    chat.messages.forEach(appendMessage);
    const t = $("#thread"); t.scrollTop = t.scrollHeight;
  } catch (err) {
    if (token !== loadToken) return;
    loadedId = undefined;
    showTitle("Чат не найден");
    inner.innerHTML = `<div class="empty"><h1>Чат не найден</h1><p>${esc(err.message)}. Возможно, он был удалён.</p>
      <a class="btn btn-primary" href="#/chat">Начать новый чат</a></div>`;
  }
}

/** Для модальных маршрутов: если чат ещё не открыт — показать последний (или пустой). */
export async function ensureChatBehind() {
  mountShell();
  if (loadedId === undefined) await chatView({ params: {} }, { keepOverlay: true });
}

export function resetChatState() { loadedId = undefined; }

function ensureMain() {
  const main = $("#main");
  if ($("#thread", main)) return;
  main.innerHTML = `
    <header class="topbar">
      <button class="icon-btn show-when-closed" data-open-sidebar aria-label="Открыть панель">${icon("panel")}</button>
      <div class="topbar-title" id="chatTitle">Новый чат</div>
    </header>
    <section class="thread" id="thread" aria-live="polite"><div class="thread-inner" id="threadInner"></div></section>
    <div class="composer-wrap">
      <form class="composer" id="composer">
        <label class="sr-only" for="q">Запрос</label>
        <textarea id="q" rows="1" maxlength="2000" placeholder="${matchMedia("(max-width: 600px)").matches ? "Опишите задачу или вставьте команду…" : "Опишите задачу или вставьте команду, которую нужно объяснить…"}"></textarea>
        <button class="send-btn" type="submit" aria-label="Отправить" disabled>${icon("send")}</button>
      </form>
      <div class="composer-hint"><kbd>Enter</kbd> — отправить · <kbd>Shift</kbd>+<kbd>Enter</kbd> — новая строка</div>
    </div>`;

  const q = $("#q");
  q.addEventListener("input", autosize);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $("#composer").addEventListener("submit", (e) => { e.preventDefault(); send(); });

  $("#threadInner").addEventListener("click", (e) => {
    const s = e.target.closest("[data-suggest]");
    if (s) { q.value = s.dataset.suggest; autosize(); send(); return; }
    const r = e.target.closest("[data-related]");
    if (r) {
      const wrap = r.closest(".related");
      wrap.insertAdjacentHTML("beforebegin", commandCard(JSON.parse(r.dataset.related)));
      r.remove();
      if (!wrap.querySelector("[data-related]")) wrap.remove();
    }
  });
}

function autosize() {
  const q = $("#q");
  q.style.height = "auto";
  const max = 12.5 * parseFloat(getComputedStyle(document.documentElement).fontSize); // = 12.5rem, как max-height в CSS
  q.style.height = Math.min(q.scrollHeight, max) + "px";
  $(".send-btn").disabled = busy || !q.value.trim();
}
function focusInput() { if (!matchMedia("(max-width: 900px)").matches) $("#q")?.focus(); }

function renderEmpty(inner) {
  inner.innerHTML = `<div class="empty">
    <img src="assets/img/logo.svg?v=202610162235" alt="" />
    <h1>Какую команду ищем?</h1>
    <p>Введите запрос — опишите задачу своими словами или вставьте команду, которую нужно объяснить.</p>
    <div class="suggest">${SUGGESTIONS.map(([k, t]) => `<button type="button" data-suggest="${esc(t)}"><span class="eyebrow">${esc(k)}</span>${esc(t)}</button>`).join("")}</div>
  </div>`;
}

function appendMessage(m) {
  const inner = $("#threadInner");
  if (m.role === "user") {
    inner.insertAdjacentHTML("beforeend", `<div class="msg-user"><div class="bubble-user">${esc(m.text)}</div></div>`);
    return null;
  }
  const node = h(`<div class="msg-bot"><img src="assets/img/logo.svg?v=202610162235" alt="" /><div class="bot-body"></div></div>`);
  fillReply(node, m.reply);
  inner.appendChild(node);
  return node;
}

function fillReply(node, reply) {
  const body = $(".bot-body", node);
  if (!reply) { body.innerHTML = '<div class="typing">Ищу <i></i><i></i><i></i></div>'; return; }
  if (reply.type === "error") { body.innerHTML = `<div class="alert alert-error">${icon("alert")}<span>${esc(reply.message)}</span></div>`; return; }
  if (reply.type === "not_found") {
    // Варианты показываются, только если сервер нашёл хоть что-то по делу; иначе — одно сообщение
    body.innerHTML = `<div class="alert alert-warn">${icon("alert")}<span>${esc(reply.message)}</span></div>` +
      (reply.commands || []).map((c) => commandCard(c)).join("");
    return;
  }
  const rel = reply.related || [];
  body.innerHTML = reply.commands.map((c) => commandCard(c)).join("") +
    (rel.length ? `<div class="related">Похожие: ${rel.map((c) => `<button type="button" class="chip chip-mono" data-related="${esc(JSON.stringify(c))}">${esc(c.command)}</button>`).join("")}</div>` : "");
}

async function send() {
  const q = $("#q");
  const text = q.value.trim();
  if (!text || busy) return;
  busy = true; q.value = ""; autosize();

  $("#threadInner .empty")?.remove();
  appendMessage({ role: "user", text });
  const pending = appendMessage({ role: "assistant", reply: null });
  const thread = $("#thread");
  thread.scrollTop = thread.scrollHeight;

  try {
    const res = loadedId ? await chatsApi.send(loadedId, text) : await chatsApi.create(text);
    if (!loadedId) {
      loadedId = res.chat.id;
      showTitle(res.chat.title);
      router.go(`/chat/${encodeURIComponent(res.chat.id)}`, { silent: true });
      setActiveChat(res.chat.id);
    }
    fillReply(pending, res.messages.find((m) => m.role === "assistant").reply);
    refreshChats();
  } catch (err) {
    fillReply(pending, { type: "error", message: err.message });
  } finally {
    busy = false; autosize();
    const top = pending.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop - 12;
    thread.scrollTo({ top, behavior: "smooth" });
  }
}
