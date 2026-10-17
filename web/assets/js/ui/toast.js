import { h } from "./dom.js?v=202610162235";
let timer;
/** Короткое уведомление внизу экрана. kind: "ok" | "error" */
export function toast(text, kind = "ok") {
  let t = document.querySelector(".toast");
  if (!t) { t = h('<div class="toast" role="status" aria-live="polite"></div>'); document.body.appendChild(t); }
  t.textContent = text;
  t.dataset.kind = kind;
  t.hidden = false;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(timer);
  timer = setTimeout(() => (t.hidden = true), 2200);
}
