/** Модальные окна и подтверждения (вместо alert/confirm/prompt). */
import { $, $$, h, esc } from "./dom.js?v=202610162235";
import { icon } from "./icons.js?v=202610162235";

/**
 * Показывает node внутри затемнения. Закрытие: [data-close], Esc, клик по фону.
 * @returns {() => void} close
 */
export function openModal(node, { onClose, size } = {}) {
  const back = h('<div class="modal-backdrop"></div>');
  if (size) size.split(" ").forEach((s) => node.classList.add("modal-" + s));
  back.appendChild(node);
  document.body.appendChild(back);
  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    back.remove();
    document.removeEventListener("keydown", onKey);
    prevFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    // Esc закрывает только верхнее окно
    const all = $$(".modal-backdrop");
    if (all[all.length - 1] === back) close();
  };
  document.addEventListener("keydown", onKey);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  $$("[data-close]", node).forEach((b) => b.addEventListener("click", close));
  requestAnimationFrame(() => $("[autofocus], input:not([type=hidden]), select, textarea", node)?.focus());
  return close;
}

/** Шапка модалки. */
export function modalHead(title, eyebrow = "") {
  return `<div class="modal-head">
    <div>${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}<h2 class="modal-title">${esc(title)}</h2></div>
    <button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon("x")}</button>
  </div>`;
}

/** Подтверждение опасного действия. @returns {Promise<boolean>} */
export function confirmDialog({ title, text, ok = "Удалить", danger = true }) {
  return new Promise((resolve) => {
    let result = false;
    const node = h(`<div class="modal glass" role="alertdialog" aria-modal="true">
      ${modalHead(title)}
      <p class="modal-text">${esc(text)}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Отмена</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok autofocus>${esc(ok)}</button>
      </div></div>`);
    const close = openModal(node, { onClose: () => resolve(result) });
    $("[data-ok]", node).addEventListener("click", () => { result = true; close(); });
  });
}
