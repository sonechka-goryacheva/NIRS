/** Профиль: #/profile — данные учётной записи, тема оформления, пароль и код восстановления. */
import { $, h, esc, formatDate, roleLabel, setTitle } from "../ui/dom.js?v=202611160100";
import { icon } from "../ui/icons.js?v=202611160100";
import { modalHead, confirmDialog } from "../ui/modal.js?v=202611160100";
import { toast } from "../ui/toast.js?v=202611160100";
import { authApi } from "../api/index.js?v=202611160100";
import { session } from "../session.js?v=202611160100";
import { themeMode, setThemeMode } from "../theme.js?v=202611160100";
import * as router from "../router.js?v=202611160100";
import { showOverlay, setActiveNav } from "./shell.js?v=202611160100";
import { ensureChatBehind } from "./chat.js?v=202611160100";
import { openChangePassword, showRecoveryCode } from "./auth.js?v=202611160100";

const THEMES = [["light", "sun", "Светлая"], ["dark", "moon", "Тёмная"], ["system", "monitor", "Как в системе"]];

export function themePicker() {
  const cur = themeMode();
  return `<div class="segmented" role="radiogroup" aria-label="Тема оформления">${THEMES.map(([v, ic, t]) =>
    `<button type="button" role="radio" aria-checked="${v === cur}" data-theme-mode="${v}">${icon(ic)}<span>${t}</span></button>`).join("")}</div>`;
}

export async function profileView() {
  await ensureChatBehind();
  setActiveNav("/profile");
  setTitle("Профиль");
  const u = session.user;
  const guest = session.isGuest;
  const node = h(`<div class="modal glass modal-profile" role="dialog" aria-modal="true">
    ${modalHead(guest ? "Гостевой режим" : "Информация о пользователе", "Профиль")}
    <div class="profile-top"><span class="avatar">${guest ? icon("user") : esc(u.login[0])}</span>
      <div><b>${guest ? "Гость" : esc(u.login)}</b><span class="chip ${u.role === "admin" ? "chip-accent" : ""}">${guest ? "Без регистрации" : roleLabel(u.role)}</span></div></div>
    ${guest ? `<div class="alert alert-warn">${icon("alert")}<span>Чаты гостя хранятся до выхода или закрытия вкладки. Зарегистрируйтесь, чтобы сохранять историю и загружать свои команды и сохранять прогресс обучения.</span></div>` : `
    <dl class="kv">
      <dt>Логин</dt><dd>${esc(u.login)}</dd>
      <dt>Роль</dt><dd>${roleLabel(u.role)}</dd>
      <dt>Дата регистрации</dt><dd>${formatDate(u.created_at)}</dd>
    </dl>`}
    <div class="profile-section"><div class="label">Тема оформления</div>${themePicker()}</div>
    ${guest ? `
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="pfLogout">${icon("logout")}Выйти</button>
      <a class="btn btn-primary grow" href="#/register">${icon("userPlus")}Зарегистрироваться</a>
    </div>` : `
    <div class="profile-actions">
      <button type="button" class="btn btn-ghost" id="pfPass">${icon("key")}Сменить пароль</button>
      <button type="button" class="btn btn-ghost" id="pfCode" title="Выпустить новый код восстановления пароля">${icon("shield")}Новый код</button>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost grow" id="pfLogout">${icon("logout")}Выйти</button>
    </div>`}
  </div>`);
  showOverlay(node);
  node.addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme-mode]");
    if (!b) return;
    setThemeMode(b.dataset.themeMode);
    node.querySelectorAll("[data-theme-mode]").forEach((x) => x.setAttribute("aria-checked", x === b));
  });
  $("#pfPass", node)?.addEventListener("click", () => openChangePassword());
  $("#pfCode", node)?.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Выпустить новый код?", text: "Прежний код восстановления перестанет действовать.", ok: "Выпустить", danger: false });
    if (!ok) return;
    try {
      const { recovery_code } = await authApi.newRecoveryCode();
      await showRecoveryCode(recovery_code, { title: "Новый код восстановления", text: "Сохраните код: он понадобится, если вы забудете пароль." });
    } catch (err) { toast(err.message, "error"); }
  });
  $("#pfLogout", node).addEventListener("click", async () => {
    if (guest && !(await confirmDialog({ title: "Выйти из гостевого режима?", text: "Все чаты гостя будут удалены.", ok: "Выйти" }))) return;
    try { await authApi.logout(); } catch {}
    session.clear();
    router.go("/login", { replace: true });
  });
}
