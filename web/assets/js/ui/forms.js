/** Поля форм и показ ошибок (в т.ч. ошибок API с полем field). */
import { $, $$, esc } from "./dom.js?v=202610162235";
import { icon } from "./icons.js?v=202610162235";

export function field({ name, label, type = "text", value = "", hint = "", autocomplete = "off", placeholder = "", mono = false, attrs = "" }) {
  const isPass = type === "password";
  const input = `<input class="input${mono ? " mono" : ""}" id="f-${name}" name="${name}" type="${type}" value="${esc(value)}"
    autocomplete="${autocomplete}" placeholder="${esc(placeholder)}" spellcheck="false" ${attrs} />`;
  return `<div class="field" data-field="${name}">
    <label class="label" for="f-${name}">${esc(label)}</label>
    ${isPass ? `<div class="input-wrap">${input}<button type="button" class="icon-btn" data-toggle-pass aria-label="Показать пароль">${icon("eye")}</button></div>` : input}
    ${hint ? `<div class="field-hint">${esc(hint)}</div>` : ""}
    <div class="field-error" hidden></div>
  </div>`;
}

export function selectField({ name, label, options, value }) {
  return `<div class="field" data-field="${name}">
    <label class="label" for="f-${name}">${esc(label)}</label>
    <select class="select" id="f-${name}" name="${name}">
      ${options.map(([v, t]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(t)}</option>`).join("")}
    </select>
    <div class="field-error" hidden></div>
  </div>`;
}

export function setFieldError(form, name, msg) {
  const f = form.querySelector(`[data-field="${name}"]`);
  if (!f) return false;
  f.classList.toggle("has-error", !!msg);
  const e = $(".field-error", f);
  e.textContent = msg || "";
  e.hidden = !msg;
  return true;
}

export function clearErrors(form) {
  $$(".field", form).forEach((f) => setFieldError(form, f.dataset.field, ""));
  const a = $(".form-alert", form);
  if (a) a.hidden = true;
}

export function formAlert(form, msg, kind = "error") {
  const a = $(".form-alert", form);
  if (!a) return;
  a.className = `alert alert-${kind} form-alert`;
  a.innerHTML = icon(kind === "ok" ? "check" : "alert") + `<span>${esc(msg)}</span>`;
  a.hidden = false;
}

/** Ошибка API → под поле (если сервер указал field) или плашкой. */
export function showApiError(form, err, fieldMap = {}) {
  const name = err.field && (fieldMap[err.field] || err.field);
  if (!(name && setFieldError(form, name, err.message))) formAlert(form, err.message);
}

export const values = (form) => Object.fromEntries(new FormData(form).entries());

/** Блокирует кнопку отправки на время запроса. */
export async function busy(form, fn) {
  const btn = $('[type="submit"]', form);
  if (btn) btn.disabled = true;
  try { return await fn(); } finally { if (btn) btn.disabled = false; }
}

// Показ/скрытие пароля — для всех полей сразу
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-toggle-pass]");
  if (!b) return;
  const input = b.parentElement.querySelector("input");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  b.innerHTML = icon(show ? "eyeOff" : "eye");
  b.setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
});
