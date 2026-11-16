/** Вход и регистрация: маршруты #/login и #/register; гостевой вход; «Забыли пароль?» */
import { $, h, esc } from "../ui/dom.js?v=202611161110";
import { icon } from "../ui/icons.js?v=202611161110";
import { openModal, modalHead } from "../ui/modal.js?v=202611161110";
import { toast } from "../ui/toast.js?v=202611161110";
import { field, setFieldError, clearErrors, formAlert, showApiError, values, busy } from "../ui/forms.js?v=202611161110";
import { authApi } from "../api/index.js?v=202611161110";
import { session } from "../session.js?v=202611161110";
import { themeButtonHtml } from "../ui/theme-toggle.js?v=202611161110";
import * as router from "../router.js?v=202611161110";
import { unmount } from "./shell.js?v=202611161110";
import { resetChatState } from "./chat.js?v=202611161110";

let artSvg = null;
async function loadArt() {
  if (artSvg !== null) return artSvg;
  try { artSvg = await (await fetch("assets/img/auth-keys.svg?v=202611161110", { cache: "no-cache" })).text(); }
  catch { artSvg = '<img class="hero-art" src="assets/img/auth-keys.svg?v=202611161110" alt="" />'; }
  return artSvg;
}

export async function authView({ query }, mode) {
  unmount();
  resetChatState();
  document.body.className = "page-auth";
  document.title = (mode === "register" ? "Регистрация" : "Вход") + " — Справочник IT-команд";
  const reg = mode === "register";
  const fromGuest = session.isGuest;

  $("#app").innerHTML = `
  ${themeButtonHtml("icon-btn theme-fab")}
  <main class="auth-stage">
    <div class="auth-wrap">
      <section class="auth-card" aria-labelledby="authTitle">
        <div class="eyebrow">Справочник IT-команд</div>
        <h1 class="auth-title" id="authTitle">${reg ? "Регистрация" : "Вход"}</h1>
        <p class="auth-lead">${reg ? "Придумайте логин и пароль, чтобы сохранять историю чатов." : "Опишите задачу своими словами — подберём команду с примерами."}</p>
        <form class="auth-form" id="authForm" novalidate>
          <div class="alert form-alert" role="alert" hidden></div>
          ${fromGuest ? `<div class="alert alert-warn" style="margin-bottom:1rem">${icon("alert")}<span>Вы в гостевом режиме. Чаты гостя не переносятся в новый аккаунт и удалятся.</span></div>` : ""}
          ${field({ name: "login", label: "Логин", autocomplete: "username", placeholder: "например, ivan.petrov", hint: reg ? "От 3 до 32 символов, без пробелов" : "" })}
          ${field({ name: "password", label: "Пароль", type: "password", autocomplete: reg ? "new-password" : "current-password", hint: reg ? "Не короче 6 символов" : "" })}
          ${reg ? field({ name: "password2", label: "Повторите пароль", type: "password", autocomplete: "new-password" }) : ""}
          <button type="submit" class="btn btn-primary btn-block">${reg ? "Создать аккаунт" : "Войти"}</button>
          ${fromGuest
            ? '<a class="auth-guest btn" href="#/chat">Вернуться в гостевой режим</a>'
            : '<button type="button" class="auth-guest" id="guestBtn">Продолжить без регистрации</button>'}
        </form>
        <div class="auth-lines" aria-hidden="true"><span></span><span></span></div>
        <div class="auth-foot">
          <span>${reg ? 'Уже есть аккаунт? <a href="#/login">Войти</a>' : 'Нет аккаунта? <a href="#/register">Зарегистрироваться</a>'}</span>
          ${reg ? "" : '<button type="button" class="btn-text" id="openForgot">Забыли пароль?</button>'}
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
  $("#openForgot")?.addEventListener("click", () => openForgotPassword($("#f-login").value.trim()));
  $("#guestBtn")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      session.set(await authApi.guest());
      router.go("/chat", { replace: true });
    } catch (err) { formAlert($("#authForm"), err.message); e.target.disabled = false; }
  });

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
        const res = reg ? await authApi.register(login, v.password) : await authApi.login(login, v.password);
        const { recovery_code, ...user } = res;
        if (reg && recovery_code) {
          await showRecoveryCode(recovery_code, {
            title: "Аккаунт создан",
            text: "Сохраните код восстановления. Он понадобится, если вы забудете пароль, и больше не будет показан.",
          });
        }
        session.set(user);
        router.go(query.next && query.next.startsWith("/") ? query.next : "/chat", { replace: true });
      } catch (err) {
        showApiError(form, err);
      }
    });
  });
}

/**
 * Показ кода восстановления с копированием. Закрыть можно только кнопкой «Я сохранил код».
 * @returns {Promise<void>}
 */
export function showRecoveryCode(code, { title = "Код восстановления", text = "" } = {}) {
  return new Promise((resolve) => {
    const node = h(`<div class="modal glass" role="alertdialog" aria-modal="true">
      ${modalHead(title, "Код восстановления")}
      <p class="modal-text">${esc(text)}</p>
      <div class="recovery-code"><span>${esc(code)}</span>
        <button type="button" class="icon-btn copy-btn" data-copy="${esc(code)}" aria-label="Скопировать код">${icon("copy")}</button></div>
      <p class="field-hint">Храните код отдельно от пароля. Использованный код сгорает — взамен выдаётся новый.</p>
      <div class="modal-actions"><button type="button" class="btn btn-primary grow" data-close>Я сохранил код</button></div>
    </div>`);
    openModal(node, { onClose: resolve });
  });
}

/** «Забыли пароль?»: логин + код восстановления → новый пароль. */
export function openForgotPassword(login = "") {
  const node = h(`<div class="modal glass" role="dialog" aria-modal="true">
    ${modalHead("Восстановление пароля", "Забыли пароль?")}
    <form novalidate>
      <p class="modal-text" style="margin-bottom:1rem">Введите код восстановления, который вы получили при регистрации. Если кода нет — обратитесь к администратору, он задаст новый пароль.</p>
      <div class="alert form-alert" hidden></div>
      ${field({ name: "login", label: "Логин", value: login, autocomplete: "username" })}
      ${field({ name: "recovery_code", label: "Код восстановления", placeholder: "XXXX-XXXX-XXXX", mono: true, autocomplete: "one-time-code" })}
      ${field({ name: "new_password", label: "Новый пароль", type: "password", autocomplete: "new-password", hint: "Не короче 6 символов" })}
      ${field({ name: "new_password2", label: "Повторите новый пароль", type: "password", autocomplete: "new-password" })}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Отмена</button>
        <button type="submit" class="btn btn-primary grow">Сменить пароль</button>
      </div>
    </form></div>`);
  const close = openModal(node);
  const form = $("form", node);
  if (login) requestAnimationFrame(() => $("#f-recovery_code", node).focus());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrors(form);
    const v = values(form);
    let ok = true;
    if (!v.login.trim()) ok = !setFieldError(form, "login", "Введите логин");
    if (!v.recovery_code.trim()) ok = !setFieldError(form, "recovery_code", "Введите код восстановления") && ok;
    if (v.new_password.length < 6) ok = !setFieldError(form, "new_password", "Пароль: минимум 6 символов") && ok;
    if (v.new_password !== v.new_password2) ok = !setFieldError(form, "new_password2", "Пароли не совпадают") && ok;
    if (!ok) return;
    busy(form, async () => {
      try {
        const { recovery_code } = await authApi.resetPassword(v.login.trim(), v.recovery_code.trim(), v.new_password);
        close();
        await showRecoveryCode(recovery_code, {
          title: "Пароль изменён",
          text: "Старый код больше не действует. Сохраните новый код — теперь войдите с новым паролем.",
        });
        const lf = $("#f-login"); if (lf) { lf.value = v.login.trim(); $("#f-password")?.focus(); }
      } catch (err) { showApiError(form, err); }
    });
  });
}

/** Смена пароля из профиля: пользователь уже вошёл, старый пароль не спрашиваем. */
export function openChangePassword() {
  const node = h(`<div class="modal glass" role="dialog" aria-modal="true">
    ${modalHead("Смена пароля", "Учётная запись")}
    <form novalidate>
      <div class="alert form-alert" hidden></div>
      ${field({ name: "new_password", label: "Новый пароль", type: "password", autocomplete: "new-password", hint: "Не короче 6 символов" })}
      ${field({ name: "new_password2", label: "Повторите новый пароль", type: "password", autocomplete: "new-password" })}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Отмена</button>
        <button type="submit" class="btn btn-primary grow">Сменить пароль</button>
      </div>
    </form></div>`);
  const close = openModal(node);
  const form = $("form", node);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrors(form);
    const v = values(form);
    let ok = true;
    if (v.new_password.length < 6) ok = !setFieldError(form, "new_password", "Пароль: минимум 6 символов");
    if (v.new_password !== v.new_password2) ok = !setFieldError(form, "new_password2", "Пароли не совпадают") && ok;
    if (!ok) return;
    busy(form, async () => {
      try {
        await authApi.changePassword(v.new_password);
        close();
        toast("Пароль изменён");
      } catch (err) { showApiError(form, err); }
    });
  });
}
