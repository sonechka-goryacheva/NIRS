/**
 * Каркас приложения после входа: боковая панель + область чата + слой для модальных маршрутов
 * (#/dataset, #/profile, #/admin/...). Каркас создаётся один раз и переживает смену маршрутов.
 */
import { $, $$, h, esc, roleLabel } from "../ui/dom.js?v=202610162235";
import { icon } from "../ui/icons.js?v=202610162235";
import { openModal, confirmDialog } from "../ui/modal.js?v=202610162235";
import { toast } from "../ui/toast.js?v=202610162235";
import { chatsApi } from "../api/index.js?v=202610162235";
import { session } from "../session.js?v=202610162235";
import * as router from "../router.js?v=202610162235";

let mounted = false;
let overlayClose = null;
let closingByRoute = false;
let activeChatId = null;
export let lastChatPath = "/chat";

const isMobile = () => matchMedia("(max-width: 900px)").matches;

export function isMounted() { return mounted; }
export function unmount() { mounted = false; hideOverlay(); }

export function mountShell() {
  document.body.className = "theme-light page-app";
  if (mounted) return;
  mounted = true;
  const u = session.user;
  const app = $("#app");
  app.innerHTML = `
  <div class="app-shell" id="shell" data-sidebar="open">
    <aside class="sidebar" aria-label="Боковая панель">
      <div class="sidebar-inner">
        <div class="side-head">
          <a class="brand" href="#/chat"><img src="assets/img/logo.svg?v=202610162235" alt="" /><span>Справочник<small>IT-команд</small></span></a>
          <button class="icon-btn" id="closeSidebar" aria-label="Скрыть панель">${icon("panel")}</button>
        </div>
        <a class="btn btn-ghost btn-block" href="#/chat" id="newChat">${icon("plus")}Новый чат</a>
        <div class="side-label">История</div>
        <nav class="chat-list" id="chatList" aria-label="История чатов"></nav>
        <nav class="side-nav" aria-label="Разделы">
          <a class="nav-btn" href="#/dataset" data-nav="/dataset">${icon("book")}Датасет команд</a>
          ${u.role === "admin" ? `
          <div class="side-label side-label-tight">Администрирование</div>
          <a class="nav-btn" href="#/admin/commands" data-nav="/admin/commands">${icon("edit")}Редактировать датасет</a>
          <a class="nav-btn" href="#/admin/users" data-nav="/admin/users">${icon("users")}Пользователи</a>` : ""}
          <a class="nav-btn user-btn" href="#/profile" data-nav="/profile" aria-label="Профиль">
            <span class="avatar">${esc(u.login[0])}</span>
            <span class="user-meta"><b>${esc(u.login)}</b><span>${roleLabel(u.role)}</span></span>
          </a>
        </nav>
      </div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <main class="main" id="main"></main>
  </div>`;

  let saved = null;
  try { saved = localStorage.getItem("nirs.sidebar"); } catch {}
  setSidebar(isMobile() ? false : saved !== "closed");
  $("#closeSidebar").addEventListener("click", () => setSidebar(false));
  $("#scrim").addEventListener("click", () => setSidebar(false));
  $("#shell").addEventListener("click", (e) => {
    if (e.target.closest("[data-open-sidebar]")) setSidebar(true);
    else if (isMobile() && e.target.closest(".sidebar a")) setSidebar(false);
  });

  $("#chatList").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delete-chat]");
    if (!del) return;
    e.preventDefault();
    const id = del.dataset.deleteChat;
    const title = del.closest(".chat-row").querySelector(".chat-item").textContent.trim();
    if (!(await confirmDialog({ title: "Удалить чат?", text: `«${title}» будет удалён без возможности восстановления.` }))) return;
    try {
      await chatsApi.remove(id);
      toast("Чат удалён");
      if (activeChatId === id) router.go("/chat");
      refreshChats();
    } catch (err) { toast(err.message, "error"); }
  });
  refreshChats();
}

export function setSidebar(open) {
  const s = $("#shell");
  if (!s) return;
  s.dataset.sidebar = open ? "open" : "closed";
  if (!isMobile()) try { localStorage.setItem("nirs.sidebar", open ? "open" : "closed"); } catch {}
}

export async function refreshChats() {
  const list = $("#chatList");
  if (!list) return;
  try {
    const chats = await chatsApi.list();
    list.innerHTML = chats.length
      ? chats.map((c) => `<div class="chat-row${c.id === activeChatId ? " is-active" : ""}">
          <a class="chat-item" href="#/chat/${encodeURIComponent(c.id)}" title="${esc(c.title)}">${esc(c.title)}</a>
          <button class="icon-btn chat-del" data-delete-chat="${esc(c.id)}" aria-label="Удалить чат">${icon("trash")}</button>
        </div>`).join("")
      : '<div class="chat-empty">Пока нет чатов</div>';
  } catch { list.innerHTML = '<div class="chat-empty">Не удалось загрузить историю</div>'; }
}

export function setActiveChat(id) {
  activeChatId = id;
  lastChatPath = id ? `/chat/${encodeURIComponent(id)}` : "/chat";
  $$(".chat-row").forEach((r) => r.classList.toggle("is-active", r.querySelector(".chat-item").getAttribute("href") === "#" + lastChatPath));
}

/** Подсветка пункта меню текущего раздела. */
export function setActiveNav(path) {
  $$("[data-nav]").forEach((a) => a.classList.toggle("is-active", !!path && path.startsWith(a.dataset.nav)));
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
      setActiveNav(null);
      if (!closingByRoute) router.go(lastChatPath);
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

export function overlayFrame({ head, body = "", cls = "" }) {
  return h(`<div class="modal glass ${cls}" role="dialog" aria-modal="true">
    <div class="mw-head">${head}<button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon("x")}</button></div>
    <div class="mw-body">${body}</div>
  </div>`);
}
