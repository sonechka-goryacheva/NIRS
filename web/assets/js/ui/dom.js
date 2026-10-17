/** Мелкие DOM-хелперы. */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Экранирование любых данных перед вставкой в HTML (защита от XSS). */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Строка разметки → элемент. */
export function h(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
}

/** ISO → «05.10.2026 09:00» */
export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const roleLabel = (role) => (role === "admin" ? "Администратор" : "Пользователь");

/** Заголовок вкладки: «<раздел> — Справочник IT-команд». */
export function setTitle(part) {
  document.title = part ? `${part} — Справочник IT-команд` : "Справочник IT-команд";
}
