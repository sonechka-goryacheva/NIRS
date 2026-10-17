/** Вход и регистрация: маршруты #/login и #/register */
import { $, h } from "../ui/dom.js?v=202610162235";
import { openModal, modalHead } from "../ui/modal.js?v=202610162235";
import { field, setFieldError, clearErrors, formAlert, showApiError, values, busy } from "../ui/forms.js?v=202610162235";
import { authApi } from "../api/index.js?v=202610162235";
import { session } from "../session.js?v=202610162235";
import * as router from "../router.js?v=202610162235";
import { unmount } from "./shell.js?v=202610162235";
import { resetChatState } from "./chat.js?v=202610162235";

let artSvg = null;
async function loadArt() {
  if (artSvg !== null) return artSvg;
  try { artSvg = await (await fetch("assets/img/auth-keys.svg?v=202610162235", { cache: "no-cache" })).text(); }
  catch { artSvg = '<img class="hero-art" src="assets/img/auth-keys.svg?v=202610162235" alt="" />'; }
  return artSvg;
}

export async function authView({ query }, mode) {
  unmount();
  resetChatState();
  document.body.className = "page-auth";
  document.title = (mode === "register" ? "Регистрация" : "Вход") + " — Справочник IT-команд";
  const reg = mode === "register";

  $("#app").innerHTML = `
  <main class="auth-stage">
    <div class="auth-wrap">
      <section class="auth-card" aria-labelledby="authTitle">
        <div class="eyebrow">Справочник IT-команд</div>
        <h1 class="auth-title" id="authTitle">${reg ? "Регистрация" : "Вход"}</h1>
        <p class="auth-lead">${reg ? "Придумайте логин и пароль, чтобы сохранять историю чатов." : "Опишите задачу своими словами — подберём команду с примерами."}</p>
        <form class="auth-form" id="authForm" novalidate>
          <div class="alert form-alert" role="alert" hidden></div>
          ${field({ name: "login", label: "Логин", autocomplete: "username", placeholder: "например, ivan.petrov", hint: reg ? "От 3 до 32 символов, без пробелов" : "" })}
          ${field({ name: "password", label: "Пароль", type: "password", autocomplete: reg ? "new-password" : "current-password", hint: reg ? "Не короче 6 символов" : "" })}
          ${reg ? field({ name: "password2", label: "Повторите пароль", type: "password", autocomplete: "new-password" }) : ""}
          <button type="submit" class="btn btn-primary btn-block">${reg ? "Создать аккаунт" : "Войти"}</button>
        </form>
        <div class="auth-lines" aria-hidden="true"><span></span><span></span></div>
        <div class="auth-foot">
          <span>${reg ? 'Уже есть аккаунт? <a href="#/login">Войти</a>' : 'Нет аккаунта? <a href="#/register">Зарегистрироваться</a>'}</span>
          ${reg ? "" : '<button type="button" class="btn-text" id="openChangePw">Сменить пароль</button>'}
        </div>
      </section>
      <div class="auth-art" aria-hidden="true">
        <div class="hero-slot"></div>
        <div class="float-chip c1"><b>$</b> git status</div>
        <div class="float-chip c2"><b>$</b> docker ps -a</div>
        <div class="float-chip c3"><b>$</b> du -sh *</div>
      </div>
    </div>
  </main>`;

  loadArt().then((svg) => { const slot = $(".hero-slot"); if (slot) slot.innerHTML = svg; });
  $("#f-login").focus();
  $("#openChangePw")?.addEventListener("click", () => openChangePassword($("#f-login").value.trim()));

  const form = $("#authForm");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrors(form);
    const v = values(form);
    const login = v.login.trim();
    let ok = true;
    if (!login) ok = !setFieldError(form, "login", "Введите логин");
    if (!v.password) ok = !setFieldError(form, "password", "Введите пароль") && ok;
    if (reg) {
      if (login && !/^\S{3,32}$/.test(login)) ok = !setFieldError(form, "login", "Логин: от 3 до 32 символов, без пробелов");
      if (v.password && v.password.length < 6) ok = !setFieldError(form, "password", "Пароль: минимум 6 символов");
      if (v.password !== v.password2) ok = !setFieldError(form, "password2", "Пароли не совпадают");
    }
    if (!ok) return;
    busy(form, async () => {
      try {
        const user = reg ? await authApi.register(login, v.password) : await authApi.login(login, v.password);
        session.set(user);
        router.go(query.next && query.next.startsWith("/") ? query.next : "/chat", { replace: true });
      } catch (err) {
        showApiError(form, err);
      }
    });
  });
}

/** Смена пароля по логину и текущему паролю — со страницы входа и из профиля. */
export function openChangePassword(login = "", { lockLogin = false } = {}) {
  const node = h(`<div class="modal glass" role="dialog" aria-modal="true">
    ${modalHead("Смена пароля", "Учётная запись")}
    <form novalidate>
      <div class="alert form-alert" hidden></div>
      ${field({ name: "login", label: "Логин", value: login, autocomplete: "username", attrs: lockLogin ? "readonly" : "" })}
      ${field({ name: "old_password", label: "Текущий пароль", type: "password", autocomplete: "current-password" })}
      ${field({ name: "new_password", label: "Новый пароль", type: "password", autocomplete: "new-password", hint: "Не короче 6 символов" })}
      ${field({ name: "new_password2", label: "Повторите новый пароль", type: "password", autocomplete: "new-password" })}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Отмена</button>
        <button type="submit" class="btn btn-primary grow">Сменить пароль</button>
      </div>
    </form></div>`);
  const close = openModal(node);
  const form = $("form", node);
  if (lockLogin) requestAnimationFrame(() => $("#f-old_password", node).focus());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrors(form);
    const v = values(form);
    let ok = true;
    if (!v.login.trim()) ok = !setFieldError(form, "login", "Введите логин");
    if (!v.old_password) ok = !setFieldError(form, "old_password", "Введите текущий пароль") && ok;
    if (v.new_password.length < 6) ok = !setFieldError(form, "new_password", "Пароль: минимум 6 символов") && ok;
    if (v.new_password !== v.new_password2) ok = !setFieldError(form, "new_password2", "Пароли не совпадают") && ok;
    if (!ok) return;
    busy(form, async () => {
      try {
        await authApi.changePassword(v.login.trim(), v.old_password, v.new_password);
        formAlert(form, "Пароль изменён", "ok");
        setTimeout(close, 900);
      } catch (err) { showApiError(form, err); }
    });
  });
}
