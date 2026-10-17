/** Профиль: #/profile */
import { $, h, esc, formatDate, roleLabel, setTitle } from "../ui/dom.js?v=202610162235";
import { icon } from "../ui/icons.js?v=202610162235";
import { modalHead } from "../ui/modal.js?v=202610162235";
import { authApi } from "../api/index.js?v=202610162235";
import { session } from "../session.js?v=202610162235";
import * as router from "../router.js?v=202610162235";
import { showOverlay, setActiveNav } from "./shell.js?v=202610162235";
import { ensureChatBehind } from "./chat.js?v=202610162235";
import { openChangePassword } from "./auth.js?v=202610162235";

export async function profileView() {
  await ensureChatBehind();
  setActiveNav("/profile");
  setTitle("Профиль");
  const u = session.user;
  const node = h(`<div class="modal glass" role="dialog" aria-modal="true">
    ${modalHead("Информация о пользователе", "Профиль")}
    <div class="profile-top"><span class="avatar">${esc(u.login[0])}</span>
      <div><b>${esc(u.login)}</b><span class="chip ${u.role === "admin" ? "chip-accent" : ""}">${roleLabel(u.role)}</span></div></div>
    <dl class="kv">
      <dt>Логин</dt><dd>${esc(u.login)}</dd>
      <dt>Роль</dt><dd>${roleLabel(u.role)}</dd>
      <dt>Дата регистрации</dt><dd>${formatDate(u.created_at)}</dd>
    </dl>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="pfLogout">${icon("logout")}Выйти</button>
      <button type="button" class="btn btn-primary grow" id="pfPass">${icon("key")}Сменить пароль</button>
    </div></div>`);
  showOverlay(node);
  $("#pfPass", node).addEventListener("click", () => openChangePassword(u.login, { lockLogin: true }));
  $("#pfLogout", node).addEventListener("click", async () => {
    try { await authApi.logout(); } catch {}
    session.clear();
    router.go("/login", { replace: true });
  });
}
