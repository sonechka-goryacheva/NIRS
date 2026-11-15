/**
 * Каркас приложения после входа: боковая панель + область чата + слой для модальных маршрутов
 * (#/dataset, #/profile, #/admin/...). Каркас создаётся один раз и переживает смену маршрутов.
 */
import { $, $$, h, esc, roleLabel } from "../ui/dom.js?v=202611160100";
import { icon } from "../ui/icons.js?v=202611160100";
import { openModal, confirmDialog } from "../ui/modal.js?v=202611160100";
import { toast } from "../ui/toast.js?v=202611160100";
import { chatsApi } from "../api/index.js?v=202611160100";
import { themeButtonHtml } from "../ui/theme-toggle.js?v=202611160100";
import { session } from "../session.js?v=202611160100";
import * as router from "../router.js?v=202611160100";

let mounted = false;
let overlayClose = null;
let closingByRoute = false;
let activeChatId = null;
let searchQuery = "";
let searchTimer = null;
let listToken = 0;
export let lastChatPath = "/chat";

const isMobile = () => matchMedia("(max-width: 900px)").matches;

export function isMounted() { return mounted; }
export function unmount() { mounted = false; hideOverlay(); }

export function mountShell() {
  document.body.className = "page-app";
  if (mounted) return;
  mounted = true;
  const u = session.user;
  const guest = u.role === "guest";
  const app = $("#app");
  app.innerHTML = `
  <div class="app-shell" id="shell" data-sidebar="open">
    <aside class="sidebar" aria-label="Боковая панель">
      <div class="sidebar-inner">
        <div class="side-head">
          <a class="brand" href="#/chat"><img src="assets/img/logo.svg?v=202611160100" alt="" /><span>Справочник<small>IT-команд</small></span></a>
          <div class="side-head-tools">
            ${themeButtonHtml()}
            <button class="icon-btn" id="closeSidebar" aria-label="Скрыть панель">${icon("panel")}</button>
          </div>
        </div>
        <a class="btn btn-ghost btn-block" href="#/chat" id="newChat">${icon("plus")}Новый чат</a>
        <div class="search-wrap side-search">${icon("search")}<input class="input" id="chatSearch" type="search" placeholder="Поиск по истории" aria-label="Поиск по истории" maxlength="100" autocomplete="off" /></div>
        <div class="side-label" id="historyLabel">История</div>
        <nav class="chat-list" id="chatList" aria-label="История чатов"></nav>
        ${guest ? `<div class="guest-note">${icon("alert")}<div><b>Гостевой режим</b><span>История удалится после выхода.</span><a href="#/register">Зарегистрироваться</a></div></div>` : ""}
        <nav class="side-nav" aria-label="Разделы">
          <a class="nav-btn" href="#/dataset" data-nav="/dataset">${icon("book")}Справочник команд</a>
          ${guest ? "" : `<a class="nav-btn" href="#/dataset/my" data-nav="/dataset/my">${icon("star")}Мои команды</a>`}
          <a class="nav-btn" href="#/learn" data-nav="/learn">${icon("cap")}Обучение</a>
          ${u.role === "admin" ? `
          <div class="side-label side-label-tight">Администрирование</div>
          <a class="nav-btn" href="#/admin/commands" data-nav="/admin/commands">${icon("edit")}Редактировать справочник</a>
          <a class="nav-btn" href="#/admin/users" data-nav="/admin/users">${icon("users")}Пользователи</a>` : ""}
          <a class="nav-btn user-btn" href="#/profile" data-nav="/profile" aria-label="Профиль">
            <span class="avatar">${guest ? icon("user") : esc(u.login[0])}</span>
            <span class="user-meta"><b>${guest ? "Гость" : esc(u.login)}</b><span>${guest ? "Без регистрации" : roleLabel(u.role)}</span></span>
          </a>
        </nav>
      </div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <main class="main" id="main"></main>
  </div>`;
  searchQuery = "";

  let saved = null;
  try { saved = localStorage.getItem("nirs.sidebar"); } catch {}
  setSidebar(isMobile() ? false : saved !== "closed");
  $("#closeSidebar").addEventListener("click", () => setSidebar(false));
  $("#scrim").addEventListener("click", () => setSidebar(false));
  $("#shell").addEventListener("click", (e) => {
    if (e.target.closest("[data-open-sidebar]")) setSidebar(true);
    else if (isMobile() && e.target.closest(".sidebar a")) setSidebar(false);
  });

  const search = $("#chatSearch");
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchQuery = search.value.trim(); refreshChats(); }, 200);
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && search.value) { e.preventDefault(); search.value = ""; searchQuery = ""; refreshChats(); }
  });

  const list = $("#chatList");
  list.addEventListener("click", async (e) => {
    const ren = e.target.closest("[data-rename-chat]");
    if (ren) { e.preventDefault(); startRename(ren.closest(".chat-row")); return; }
    const del = e.target.closest("[data-delete-chat]");
    if (!del) return;
    e.preventDefault();
    const row = del.closest(".chat-row");
    const id = row.dataset.id;
    if (!(await confirmDialog({ title: "Удалить чат?", text: `«${row.dataset.title}» будет удалён без возможности восстановления.` }))) return;
    try {
      await chatsApi.remove(id);
      toast("Чат удалён");
      if (activeChatId === id) router.go("/chat");
      refreshChats();
    } catch (err) { toast(err.message, "error"); }
  });
  list.addEventListener("dblclick", (e) => {
    const row = e.target.closest(".chat-row");
    if (row && e.target.closest(".chat-item")) { e.preventDefault(); startRename(row); }
  });
  refreshChats();
}

/** Переименование прямо в списке: Enter или уход фокуса — сохранить, Esc — отменить. */
function startRename(row) {
  if (!row || row.classList.contains("is-editing")) return;
  const { id, title } = row.dataset;
  row.classList.add("is-editing");
  const form = h(`<form class="chat-edit"><input class="input" maxlength="100" aria-label="Название чата" value="${esc(title)}" /></form>`);
  row.prepend(form);
  const input = $("input", form);
  input.focus(); input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    const v = input.value.trim().replace(/\s+/g, " ");
    if (save && v && v !== title) {
      try { await renameChat(id, v); } catch (err) { toast(err.message, "error"); }
    }
    form.remove(); row.classList.remove("is-editing");
    if (save && !v) toast("Название не может быть пустым", "error");
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); finish(true); });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } });
  input.addEventListener("blur", () => finish(true));
}

/** Сохранить новое название; заголовок открытого чата обновится по событию chat:renamed. */
export async function renameChat(id, title) {
  const chat = await chatsApi.rename(id, title);
  document.dispatchEvent(new CustomEvent("chat:renamed", { detail: chat }));
  await refreshChats();
  toast("Чат переименован");
  return chat;
}

export function setSidebar(open) {
  const s = $("#shell");
  if (!s) return;
  s.dataset.sidebar = open ? "open" : "closed";
  if (!isMobile()) try { localStorage.setItem("nirs.sidebar", open ? "open" : "closed"); } catch {}
}

/** Подсветка совпадения в уже экранированной строке. */
function mark(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return safe;
  return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" + esc(text.slice(i + q.length));
}

export async function refreshChats() {
  const list = $("#chatList");
  if (!list) return;
  const q = searchQuery;
  const token = ++listToken;
  try {
    const chats = await chatsApi.list(q || undefined);
    if (token !== listToken) return; // пришёл ответ на устаревший запрос
    const label = $("#historyLabel");
    if (label) label.textContent = q ? `Найдено: ${chats.length}` : "История";
    list.innerHTML = chats.length
      ? chats.map((c) => `<div class="chat-row${c.id === activeChatId ? " is-active" : ""}" data-id="${esc(c.id)}" data-title="${esc(c.title)}">
          <a class="chat-item" href="#/chat/${encodeURIComponent(c.id)}" title="${esc(c.title)}">
            <span class="chat-title">${mark(c.title, q)}</span>${c.match ? `<span class="chat-match">${mark(c.match, q)}</span>` : ""}</a>
          <div class="chat-actions">
            <button class="icon-btn" data-rename-chat aria-label="Переименовать чат" title="Переименовать">${icon("edit")}</button>
            <button class="icon-btn chat-del" data-delete-chat aria-label="Удалить чат" title="Удалить">${icon("trash")}</button>
          </div>
        </div>`).join("")
      : `<div class="chat-empty">${q ? "Ничего не найдено" : "Пока нет чатов"}</div>`;
  } catch { if (token === listToken) list.innerHTML = '<div class="chat-empty">Не удалось загрузить историю</div>'; }
}

export function setActiveChat(id) {
  activeChatId = id;
  lastChatPath = id ? `/chat/${encodeURIComponent(id)}` : "/chat";
  $$(".chat-row").forEach((r) => r.classList.toggle("is-active", r.querySelector(".chat-item").getAttribute("href") === "#" + lastChatPath));
}

/** Подсветка пункта меню текущего раздела. */
/** Подсветка пункта меню: самый длинный подходящий префикс (/dataset/my → «Мои команды», не «Справочник»). */
export function setActiveNav(path) {
  const items = $$("[data-nav]");
  const best = path ? items.filter((a) => path === a.dataset.nav || path.startsWith(a.dataset.nav + "/"))
    .sort((a, b) => b.dataset.nav.length - a.dataset.nav.length)[0] : null;
  items.forEach((a) => a.classList.toggle("is-active", a === best));
}

/**
 * Модальный маршрут поверх чата. Закрытие пользователем → возврат к последнему чату.
 * @param {HTMLElement} node @param {{size?: "wide"|"tall"}} opts
 */
export function showOverlay(node, opts = {}) {
  hideOverlay();
  overlayClose = openModal(node, {
    size: opts.size,
    onClose: () => {
      overlayClose = null;
      // Окно сменилось другим по маршруту — подсветку меню уже выставил новый экран
      if (!closingByRoute) { setActiveNav(null); router.go(lastChatPath); }
    },
  });
}
export function hideOverlay() {
  if (!overlayClose) return;
  closingByRoute = true;
  overlayClose();
  closingByRoute = false;
}
export const hasOverlay = () => !!overlayClose;

/** back — адрес уровня выше: слева в шапке появляется «Назад». */
export function overlayFrame({ head, body = "", cls = "", back = null }) {
  return h(`<div class="modal glass ${cls}" role="dialog" aria-modal="true">
    <div class="mw-head">${back ? `<a class="icon-btn mw-back" href="#${back}" aria-label="Назад" title="Назад">${icon("arrowLeft")}</a>` : ""}<div class="mw-head-main">${head}</div><button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon("x")}</button></div>
    <div class="mw-body">${body}</div>
  </div>`);
}
