/**
 * Выпадающий список в стиле темы вместо системного меню <select> (на macOS оно серое системное).
 * Подключается автоматически ко всем <select class="select">: родной select остаётся в разметке
 * (скрыт) — значение, FormData, событие change и disabled работают как прежде.
 * Клавиатура: ↑/↓, Home/End, Enter/Пробел — выбрать, Esc — закрыть, буква — переход по первой букве.
 */
import { esc } from "./dom.js?v=202611161110";
import { icon } from "./icons.js?v=202611161110";

let openState = null; // { sel, btn, pop, active }

export function enhanceSelect(sel) {
  if (sel.dataset.enhanced) return;
  sel.dataset.enhanced = "1";
  const wrap = document.createElement("div");
  wrap.className = "cselect";
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.classList.add("cselect-native");
  sel.tabIndex = -1;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = sel.className.replace("cselect-native", "").trim() + " cselect-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  const label = document.querySelector(`label[for="${CSS.escape(sel.id || "-")}"]`);
  if (sel.getAttribute("aria-label")) btn.setAttribute("aria-label", sel.getAttribute("aria-label"));
  else if (label) btn.setAttribute("aria-label", label.textContent.trim());
  btn.innerHTML = `<span class="cselect-label"></span>${icon("chevronDown")}`;
  wrap.appendChild(btn);

  const sync = () => {
    const o = sel.options[sel.selectedIndex];
    btn.querySelector(".cselect-label").textContent = o ? o.textContent : "";
    btn.disabled = sel.disabled;
    if (openState?.sel === sel) renderPop();
  };
  sel._sync = sync;
  sync();
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
  sel.addEventListener("change", sync);
  sel.addEventListener("focus", () => btn.focus()); // клик по <label for> → на кнопку
  label?.addEventListener("click", (e) => { e.preventDefault(); btn.focus(); });

  btn.addEventListener("click", () => (openState?.sel === sel ? close() : open(sel, btn)));
  btn.addEventListener("keydown", (e) => onKey(e, sel, btn));
}

function open(sel, btn) {
  close();
  const pop = document.createElement("div");
  pop.className = "cselect-pop";
  pop.setAttribute("role", "listbox");
  document.body.appendChild(pop);
  openState = { sel, btn, pop, active: Math.max(0, sel.selectedIndex) };
  btn.setAttribute("aria-expanded", "true");
  btn.classList.add("is-open");
  renderPop();
  place();
  pop.addEventListener("mousedown", (e) => e.preventDefault()); // фокус остаётся на кнопке
  pop.addEventListener("click", (e) => {
    const li = e.target.closest("[data-i]");
    if (li) choose(+li.dataset.i);
  });
  pop.addEventListener("mousemove", (e) => {
    const li = e.target.closest("[data-i]");
    if (li && +li.dataset.i !== openState.active) { openState.active = +li.dataset.i; highlight(); }
  });
}

function renderPop() {
  const { sel, pop } = openState;
  pop.innerHTML = Array.from(sel.options).map((o, i) =>
    `<div class="cselect-opt${i === sel.selectedIndex ? " is-selected" : ""}${i === openState.active ? " is-active" : ""}" role="option" data-i="${i}" aria-selected="${i === sel.selectedIndex}">
      <span>${esc(o.textContent)}</span>${i === sel.selectedIndex ? icon("check") : ""}</div>`).join("");
}

function highlight() {
  const { pop, active } = openState;
  pop.querySelectorAll("[data-i]").forEach((el) => el.classList.toggle("is-active", +el.dataset.i === active));
  pop.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
}

function place() {
  const { btn, pop } = openState;
  const r = btn.getBoundingClientRect();
  pop.style.minWidth = r.width + "px";
  pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + "px";
  const below = innerHeight - r.bottom - 8, above = r.top - 8;
  const h = Math.min(pop.scrollHeight, 288);
  if (below < h && above > below) { pop.style.top = ""; pop.style.bottom = innerHeight - r.top + 6 + "px"; pop.style.maxHeight = Math.min(288, above) + "px"; }
  else { pop.style.bottom = ""; pop.style.top = r.bottom + 6 + "px"; pop.style.maxHeight = Math.min(288, below) + "px"; }
  highlight();
}

function choose(i) {
  const { sel, btn } = openState;
  close();
  btn.focus();
  if (i === sel.selectedIndex) return;
  sel.selectedIndex = i;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}

function close() {
  if (!openState) return;
  openState.pop.remove();
  openState.btn.setAttribute("aria-expanded", "false");
  openState.btn.classList.remove("is-open");
  openState = null;
}

function onKey(e, sel, btn) {
  const isOpen = openState?.sel === sel;
  const n = sel.options.length;
  const move = (i) => {
    i = Math.max(0, Math.min(n - 1, i));
    if (isOpen) { openState.active = i; highlight(); }
    else if (i !== sel.selectedIndex) { sel.selectedIndex = i; sel.dispatchEvent(new Event("change", { bubbles: true })); }
  };
  const cur = isOpen ? openState.active : sel.selectedIndex;
  switch (e.key) {
    case "ArrowDown": e.preventDefault(); if (!isOpen && e.altKey) open(sel, btn); else move(cur + 1); break;
    case "ArrowUp": e.preventDefault(); move(cur - 1); break;
    case "Home": e.preventDefault(); move(0); break;
    case "End": e.preventDefault(); move(n - 1); break;
    case "Enter": case " ":
      e.preventDefault();
      if (isOpen) choose(openState.active); else open(sel, btn);
      break;
    case "Escape":
      if (isOpen) { e.preventDefault(); e.stopPropagation(); close(); } // не закрывать окно под списком
      break;
    case "Tab": close(); break;
    default:
      if (e.key.length === 1 && /\S/.test(e.key)) {
        const k = e.key.toLowerCase();
        const opts = Array.from(sel.options);
        const next = opts.findIndex((o, i) => i > cur && o.textContent.trim().toLowerCase().startsWith(k));
        const first = opts.findIndex((o) => o.textContent.trim().toLowerCase().startsWith(k));
        const i = next >= 0 ? next : first;
        if (i >= 0) move(i);
      }
  }
}

// Закрытие: клик мимо, прокрутка, изменение размера окна
document.addEventListener("mousedown", (e) => {
  if (openState && !openState.pop.contains(e.target) && !openState.btn.contains(e.target)) close();
}, true);
addEventListener("resize", close);
document.addEventListener("scroll", (e) => { if (openState && !openState.pop.contains(e.target)) close(); }, true);

// Автоподключение ко всем select.select, в том числе появившимся позже
const scan = (root) => {
  if (root.nodeType !== 1) return;
  if (root.matches("select.select")) enhanceSelect(root);
  root.querySelectorAll?.("select.select").forEach(enhanceSelect);
};
new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(scan))).observe(document.documentElement, { childList: true, subtree: true });
scan(document.body);
