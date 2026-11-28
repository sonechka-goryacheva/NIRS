// /** Чат: маршруты #/chat и #/chat/:id */
// import { $, h, esc, setTitle } from "../ui/dom.js?v=202611161110";
// import { icon } from "../ui/icons.js?v=202611161110";
// import { commandCard } from "../ui/command-card.js?v=202611281130";
// import { chatsApi } from "../api/index.js?v=202611161110";
// import * as router from "../router.js?v=202611161110";
// import { getCategories } from "./categories.js?v=202611161110";
// import { isMounted, mountShell, refreshChats, setActiveChat, hideOverlay, setActiveNav } from "./shell.js?v=202611161110";
// import { session } from "../session.js?v=202611161110";

// const SUGGESTIONS = [
//   ["Проблема", "Не хватает прав при запуске скрипта"],
//   ["Объяснение", "Что делает du -sh"],
//   ["Git", "Как отменить последний коммит"],
//   ["Docker", "Посмотреть запущенные контейнеры"],
// ];

// let loadedId; // undefined — ничего не загружено, null — новый чат
// let chatTitle = "Новый чат";
// function showTitle(t) {
//   chatTitle = t;
//   const el = $("#chatTitle"); if (el) el.textContent = t;
//   setTitle(t);
// }
// // Чат переименовали в боковой панели → обновить заголовок, если он открыт
// document.addEventListener("chat:renamed", (e) => { if (e.detail.id === loadedId) showTitle(e.detail.title); });
// let busy = false;
// let loadToken = 0;

// /** Маршрут чата. keepOverlay — вызывается модальными маршрутами, чтобы под ними был чат. */
// export async function chatView({ params }, { keepOverlay = false } = {}) {
//   mountShell();
//   await getCategories().catch(() => {}); // подписи категорий в карточках
//   if (!isMounted()) return; // пока ждали — сессия истекла и открылся вход
//   if (!keepOverlay) { hideOverlay(); setActiveNav(null); }
//   const id = params.id || null;
//   ensureMain();
//   setActiveChat(id);
//   if (id === loadedId) { if (!keepOverlay) setTitle(chatTitle); return; }
//   loadedId = id;
//   const token = ++loadToken;

//   const inner = $("#threadInner");
//   if (!id) { showTitle("Новый чат"); renderEmpty(inner); focusInput(); return; }

//   inner.innerHTML = '<div class="thread-loading"><div class="typing">Загрузка <i></i><i></i><i></i></div></div>';
//   try {
//     const chat = await chatsApi.get(id);
//     if (token !== loadToken) return;
//     showTitle(chat.title);
//     inner.innerHTML = "";
//     chat.messages.forEach(appendMessage);
//     const t = $("#thread"); t.scrollTop = t.scrollHeight;
//   } catch (err) {
//     if (token !== loadToken) return;
//     loadedId = undefined;
//     showTitle("Чат не найден");
//     inner.innerHTML = `<div class="empty"><h1>Чат не найден</h1><p>${esc(err.message)}. Возможно, он был удалён.</p>
//       <a class="btn btn-primary" href="#/chat">Начать новый чат</a></div>`;
//   }
// }

// /** Для модальных маршрутов: если чат ещё не открыт — показать последний (или пустой). */
// export async function ensureChatBehind() {
//   mountShell();
//   if (loadedId === undefined) await chatView({ params: {} }, { keepOverlay: true });
// }

// export function resetChatState() { loadedId = undefined; }

// function ensureMain() {
//   const main = $("#main");
//   if ($("#thread", main)) return;
  
//   // Добавили кнопку загрузки (скрепка) перед textarea
//     main.innerHTML = `
//     <header class="topbar">
//       <button class="icon-btn show-when-closed" data-open-sidebar aria-label="Открыть панель">${icon("panel")}</button>
//       <div class="topbar-title" id="chatTitle">Новый чат</div>
//       ${session.isGuest ? '<a class="guest-chip" href="#/register" title="История гостя удалится после выхода"><span class="gc-long">Гостевой режим · </span><u>Зарегистрируйтесь<span class="gc-long">, чтобы сохранить историю</span></u></a>' : ""}
//     </header>
//     <section class="thread" id="thread" aria-live="polite"><div class="thread-inner" id="threadInner"></div></section>
//     <div class="composer-wrap">
//       <form class="composer" id="composer">
//         <!-- Кнопка прикрепления файла -->
//         <label class="attach-btn" for="image-upload" title="Прикрепить изображение" style="margin-bottom: 6px; align-self: flex-end;">
//           <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
//             <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
//           </svg>
//         </label>
//         <input type="file" id="image-upload" accept="image/*" style="display: none;">
        
//         <label class="sr-only" for="q">Запрос</label>
//         <textarea id="q" rows="1" maxlength="2000" placeholder="${matchMedia("(max-width: 600px)").matches ? "Опишите задачу или вставьте команду…" : "Опишите задачу или вставьте команду, которую нужно объяснить…"}"></textarea>
//         <button class="send-btn" type="submit" aria-label="Отправить" disabled>${icon("send")}</button>
//       </form>
//       <div class="composer-hint"><kbd>Enter</kbd> — отправить · <kbd>Shift</kbd>+<kbd>Enter</kbd> — новая строка</div>
//     </div>`;

//   const q = $("#q");
//   q.addEventListener("input", autosize);
//   q.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
//   $("#composer").addEventListener("submit", (e) => { e.preventDefault(); send(); });


//     // Обработчик загрузки изображения
//   const imgUploadBtn = $("#image-upload"); // <--- ИЗМЕНИЛИ ИМЯ ЗДЕСЬ
//   imgUploadBtn.addEventListener("change", async (e) => { // <--- И ЗДЕСЬ
//     const file = e.target.files[0];
//     if (!file || busy) return;

//     busy = true;
//     autosize();
    
//     const originalPlaceholder = q.placeholder;
//     q.placeholder = "Распознаю текст...";
//     q.disabled = true;

//     try {
//       let res;
//       if (loadedId) {
//         // Если чат уже существует — загружаем фото в него
//         res = await chatsApi.uploadImage(loadedId, file);
//       } else {
//         // Если чата нет — просим сначала создать его текстом
//         alert("Сначала напишите любой запрос, чтобы создать чат, затем сможете прикреплять фото.");
//         busy = false;
//         q.disabled = false;
//         q.placeholder = originalPlaceholder;
//         imageInput.value = "";
//         return;
//       }

//       if (res && res.messages) {
//         $("#threadInner .empty")?.remove();
//         appendMessage(res.messages[0]); // Сообщение пользователя
//         appendMessage(res.messages[1]); // Ответ бота
        
//         const thread = $("#thread");
//         thread.scrollTop = thread.scrollHeight;
//         refreshChats();
//       }
//     } catch (err) {
//       console.error(err);
//       alert("Ошибка при загрузке: " + err.message);
//     } finally {
//       busy = false;
//       q.disabled = false;
//       q.placeholder = originalPlaceholder;
//       imageInput.value = "";
//       autosize();
//     }
//   });
  
//   // --- НОВАЯ ЛОГИКА ДЛЯ ЗАГРУЗКИ ФОТО ---
//   const imageInput = $("#image-upload");
//   imageInput.addEventListener("change", async (e) => {
//     const file = e.target.files[0];
//     if (!file || busy) return;

//     // Блокируем интерфейс
//     busy = true;
//     autosize(); // обновить состояние кнопки отправки
    
//     // Показываем индикатор загрузки (опционально можно добавить спиннер)
//     const originalPlaceholder = q.placeholder;
//     q.placeholder = "Распознаю текст с изображения...";
//     q.disabled = true;

//     try {
//       let res;
//       // Если чат уже есть — отправляем в него, иначе создаем новый
//       if (loadedId) {
//         res = await chatsApi.uploadImage(loadedId, file);
//       } else {
//         // Для нового чата сначала создаем его с пустым сообщением или текстом из OCR?
//         // Пока создадим чат, а потом загрузим туда фото. 
//         // Но API требует chat_id. Поэтому сначала создадим чат через обычный create, 
//         // но это создаст лишнее сообщение. 
//         // Лучше: если loadedId нет, мы не можем загрузить фото напрямую по текущему API.
//         // Временное решение: запретить загрузку фото в "новый чат" пока он не создан, 
//         // ИЛИ создать чат автоматически.
        
//         // Вариант А: Просто просим пользователя сначала написать текст.
//         alert("Сначала напишите любой запрос, чтобы создать чат, затем сможете прикреплять фото.");
//         busy = false;
//         q.disabled = false;
//         q.placeholder = originalPlaceholder;
//         imageInput.value = ""; // сброс
//         return;
//       }

//       if (res && res.messages) {
//         // Удаляем "пустое" состояние если оно было
//         $("#threadInner .empty")?.remove();
        
//         // Добавляем сообщения в интерфейс
//         appendMessage(res.messages[0]); // Сообщение пользователя [Изображение]...
//         const botMsg = appendMessage(res.messages[1]); // Ответ бота
        
//         // Прокрутка вниз
//         const thread = $("#thread");
//         thread.scrollTop = thread.scrollHeight;
        
//         refreshChats();
//       }
//     } catch (err) {
//       console.error(err);
//       alert("Ошибка при загрузке: " + err.message);
//     } finally {
//       busy = false;
//       q.disabled = false;
//       q.placeholder = originalPlaceholder;
//       imageInput.value = ""; // сброс input, чтобы можно было загрузить тот же файл снова
//       autosize();
//     }
//   });
//   // -------------------------------------

//   $("#threadInner").addEventListener("click", (e) => {
//     const s = e.target.closest("[data-suggest]");
//     if (s) { q.value = s.dataset.suggest; autosize(); send(); return; }
//     const r = e.target.closest("[data-related]");
//     if (r) {
//       const wrap = r.closest(".related");
//       wrap.insertAdjacentHTML("beforebegin", commandCard(JSON.parse(r.dataset.related)));
//       r.remove();
//       if (!wrap.querySelector("[data-related]")) wrap.remove();
//     }
//   });
// }

// function autosize() {
//   const q = $("#q");
//   q.style.height = "auto";
//   const max = 12.5 * parseFloat(getComputedStyle(document.documentElement).fontSize); // = 12.5rem, как max-height в CSS
//   q.style.height = Math.min(q.scrollHeight, max) + "px";
//   $(".send-btn").disabled = busy || !q.value.trim();
// }
// function focusInput() { if (!matchMedia("(max-width: 900px)").matches) $("#q")?.focus(); }

// function renderEmpty(inner) {
//   inner.innerHTML = `<div class="empty">
//     <img src="assets/img/logo.svg?v=202611161110" alt="" />
//     <h1>Какую команду ищем?</h1>
//     <p>Введите запрос — опишите задачу своими словами или вставьте команду, которую нужно объяснить.</p>
//     <div class="suggest">${SUGGESTIONS.map(([k, t]) => `<button type="button" data-suggest="${esc(t)}"><span class="eyebrow">${esc(k)}</span>${esc(t)}</button>`).join("")}</div>
//   </div>`;
// }

// function appendMessage(m) {
//   const inner = $("#threadInner");
//   if (m.role === "user") {
//     inner.insertAdjacentHTML("beforeend", `<div class="msg-user"><div class="bubble-user">${esc(m.text)}</div></div>`);
//     return null;
//   }
//   const node = h(`<div class="msg-bot"><img src="assets/img/logo.svg?v=202611161110" alt="" /><div class="bot-body"></div></div>`);
//   fillReply(node, m.reply);
//   inner.appendChild(node);
//   return node;
// }

// function fillReply(node, reply) {
//     const body = $(".bot-body", node);
//     if (!reply) { body.innerHTML = '<div class="typing">Ищу <i></i><i></i><i></i></div>'; return; }
//     if (reply.type === "error") { body.innerHTML = `<div class="alert alert-error">${icon("alert")}<span>${esc(reply.message)}</span></div>`; return; }

//     // Текст LLM (объяснение словами) — показываем первым, если он есть
//     const textBlock = reply.text
//         ? `<div class="llm-text" style="margin:0 0 12px;line-height:1.5;white-space:pre-wrap;">${esc(reply.text)}</div>`
//         : "";

//     if (reply.type === "not_found") {
//         // Варианты показываются, только если сервер нашёл хоть что-то по делу; иначе — одно сообщение
//         body.innerHTML = textBlock +
//             `<div class="alert alert-warn">${icon("alert")}<span>${esc(reply.message || "")}</span></div>` +
//             (reply.commands || []).map((c) => commandCard(c)).join(" ");
//         return;
//     }
//     const rel = reply.related || [];
//     body.innerHTML = textBlock +
//         reply.commands.map((c) => commandCard(c)).join(" ") +
//         (rel.length ? `<div class="related">Похожие: ${rel.map((c) => `<button type="button" class="chip chip-mono" data-related="${esc(JSON.stringify(c))}">${esc(c.command)}</button>`).join("")}</div>` : "");
// }

// async function send() {
//   const q = $("#q");
//   const text = q.value.trim();
//   if (!text || busy) return;
//   busy = true; q.value = ""; autosize();

//   $("#threadInner .empty")?.remove();
//   appendMessage({ role: "user", text });
//   const pending = appendMessage({ role: "assistant", reply: null });
//   const thread = $("#thread");
//   thread.scrollTop = thread.scrollHeight;

//   try {
//     const res = loadedId ? await chatsApi.send(loadedId, text) : await chatsApi.create(text);
//     if (!loadedId) {
//       loadedId = res.chat.id;
//       showTitle(res.chat.title);
//       router.go(`/chat/${encodeURIComponent(res.chat.id)}`, { silent: true });
//       setActiveChat(res.chat.id);
//     }
//     fillReply(pending, res.messages.find((m) => m.role === "assistant").reply);
//     refreshChats();
//   } catch (err) {
//     fillReply(pending, { type: "error", message: err.message });
//   } finally {
//     busy = false; autosize();
//     const top = pending.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop - 12;
//     thread.scrollTo({ top, behavior: "smooth" });
//   }
// }



/** Чат: маршруты #/chat и #/chat/:id */
import { $, h, esc, setTitle } from "../ui/dom.js?v=202611161110";
import { icon } from "../ui/icons.js?v=202611161110";
import { commandCard } from "../ui/command-card.js?v=202611281130";
import { chatsApi } from "../api/index.js?v=202611161110";
import * as router from "../router.js?v=202611161110";
import { getCategories } from "./categories.js?v=202611161110";
import { isMounted, mountShell, refreshChats, setActiveChat, hideOverlay, setActiveNav } from "./shell.js?v=202611161110";
import { session } from "../session.js?v=202611161110";

const SUGGESTIONS = [
  ["Проблема", "Не хватает прав при запуске скрипта"],
  ["Объяснение", "Что делает du -sh"],
  ["Git", "Как отменить последний коммит"],
  ["Docker", "Посмотреть запущенные контейнеры"],
];

let loadedId;
let chatTitle = "Новый чат";
function showTitle(t) {
  chatTitle = t;
  const el = $("#chatTitle"); if (el) el.textContent = t;
  setTitle(t);
}
document.addEventListener("chat:renamed", (e) => { if (e.detail.id === loadedId) showTitle(e.detail.title); });
let busy = false;
let loadToken = 0;

export async function chatView({ params }, { keepOverlay = false } = {}) {
  mountShell();
  await getCategories().catch(() => {});
  if (!isMounted()) return;
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
      ${session.isGuest ? '<a class="guest-chip" href="#/register" title="История гостя удалится после выхода"><span class="gc-long">Гостевой режим · </span><u>Зарегистрируйтесь<span class="gc-long">, чтобы сохранить историю</span></u></a>' : ""}
    </header>
    <section class="thread" id="thread" aria-live="polite"><div class="thread-inner" id="threadInner"></div></section>
    <div class="composer-wrap">
      <form class="composer" id="composer">
        <label class="attach-btn" for="image-upload" title="Прикрепить изображение" style="margin-bottom: 6px; align-self: flex-end;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
          </svg>
        </label>
        <input type="file" id="image-upload" accept="image/*" style="display: none;">
        
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

  // ✅ ЕДИНЫЙ ОБРАБОТЧИК ЗАГРУЗКИ ФОТО
  const imageInput = $("#image-upload");
  imageInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || busy) return;

    busy = true;
    autosize();
    
    const originalPlaceholder = q.placeholder;
    q.placeholder = "Распознаю текст...";
    q.disabled = true;

    try {
      let res;
      if (loadedId) {
        res = await chatsApi.uploadImage(loadedId, file);
      } else {
        alert("Сначала напишите любой запрос, чтобы создать чат, затем сможете прикреплять фото.");
        busy = false;
        q.disabled = false;
        q.placeholder = originalPlaceholder;
        imageInput.value = "";
        return;
      }

      if (res && res.messages) {
        $("#threadInner .empty")?.remove();
        appendMessage(res.messages[0]);
        appendMessage(res.messages[1]);
        
        const thread = $("#thread");
        thread.scrollTop = thread.scrollHeight;
        refreshChats();
      }
    } catch (err) {
      console.error(err);
      alert("Ошибка при загрузке: " + err.message);
    } finally {
      busy = false;
      q.disabled = false;
      q.placeholder = originalPlaceholder;
      imageInput.value = "";
      autosize();
    }
  });

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
  const max = 12.5 * parseFloat(getComputedStyle(document.documentElement).fontSize);
  q.style.height = Math.min(q.scrollHeight, max) + "px";
  $(".send-btn").disabled = busy || !q.value.trim();
}
function focusInput() { if (!matchMedia("(max-width: 900px)").matches) $("#q")?.focus(); }

function renderEmpty(inner) {
  inner.innerHTML = `<div class="empty">
    <img src="assets/img/logo.svg?v=202611161110" alt="" />
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
  const node = h(`<div class="msg-bot"><img src="assets/img/logo.svg?v=202611161110" alt="" /><div class="bot-body"></div></div>`);
  fillReply(node, m.reply);
  inner.appendChild(node);
  return node;
}

// function fillReply(node, reply) {
//     const body = $(".bot-body", node);
//     if (!reply) { body.innerHTML = '<div class="typing">Ищу <i></i><i></i><i></i></div>'; return; }
//     if (reply.type === "error") { body.innerHTML = `<div class="alert alert-error">${icon("alert")}<span>${esc(reply.message)}</span></div>`; return; }

//     const textBlock = reply.text
//         ? `<div class="llm-text" style="margin:0 0 12px;line-height:1.5;white-space:pre-wrap;">${esc(reply.text)}</div>`
//         : "";

//     // ✅ ПРОВЕРЯЕМ ВСЕ ВОЗМОЖНЫЕ ТИПЫ "НЕ НАЙДЕНО"
//     if (reply.type === "not_found" || reply.type === "nothing") {
//         body.innerHTML = textBlock +
//             `<div class="alert-warn">
//                 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
//                     <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
//                     <line x1="12" y1="9" x2="12" y2="13"></line>
//                     <line x1="12" y1="17" x2="12.01" y2="17"></line>
//                 </svg>
//                 <span>${esc(reply.message || reply.text || "Подходящая команда не найдена.")}</span>
//              </div>` +
//             (reply.commands || []).map((c) => commandCard(c)).join(" ");
//         return;
//     }

//     const rel = reply.related || [];
//     body.innerHTML = textBlock +
//         reply.commands.map((c) => commandCard(c)).join(" ") +
//         (rel.length ? `<div class="related">Похожие: ${rel.map((c) => `<button type="button" class="chip chip-mono" data-related="${esc(JSON.stringify(c))}">${esc(c.command)}</button>`).join("")}</div>` : "");
// }

function fillReply(node, reply) {
    const body = $(".bot-body", node);
    
    // 1. Индикатор загрузки
    if (!reply) { 
        body.innerHTML = '<div class="typing">Ищу <i></i><i></i><i></i></div>'; 
        return; 
    }
    
    // 2. Ошибка системы
    if (reply.type === "error") { 
        body.innerHTML = `<div class="alert alert-error">${icon("alert")}<span>${esc(reply.message)}</span></div>`; 
        return; 
    }

    // 3. Логика для "Команда не найдена"
    // Проверяем типы not_found или nothing
    if (reply.type === "not_found" || reply.type === "nothing") {
        // ВАЖНО: Мы НЕ добавляем textBlock здесь, чтобы избежать дублирования.
        // Берем сообщение из reply.message (оно приходит от сервера внутри этого типа).
        const warnText = reply.message || "Подходящая команда не найдена. Попробуйте описать задачу иначе — например, укажите операционную систему.";
        
        body.innerHTML = 
            `<div class="alert-warn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <span>${esc(warnText)}</span>
             </div>` +
            // Если есть какие-то частичные совпадения (commands), показываем их ниже
            (reply.commands || []).map((c) => commandCard(c)).join(" ");
        return;
    }

    // 4. Обычный успешный ответ
    // Здесь textBlock нужен, так как это нормальное объяснение команды
    const textBlock = reply.text
        ? `<div class="llm-text" style="margin:0 0 12px;line-height:1.5;white-space:pre-wrap;">${esc(reply.text)}</div>`
        : "";

    const rel = reply.related || [];
    body.innerHTML = textBlock +
        reply.commands.map((c) => commandCard(c)).join(" ") +
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