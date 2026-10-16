/** Администрирование: #/admin/commands и #/admin/users (только роль admin — проверяет гард роутера и сервер). */
import { $, h, esc, formatDate, roleLabel, setTitle } from "../ui/dom.js?v=202610162235";
import { icon } from "../ui/icons.js?v=202610162235";
import { openModal, modalHead, confirmDialog } from "../ui/modal.js?v=202610162235";
import { toast } from "../ui/toast.js?v=202610162235";
import { field, selectField, setFieldError, clearErrors, formAlert, showApiError, values, busy } from "../ui/forms.js?v=202610162235";
import { adminApi, datasetApi } from "../api/index.js?v=202610162235";
import { session } from "../session.js?v=202610162235";
import { showOverlay, overlayFrame, setActiveNav } from "./shell.js?v=202610162235";
import { ensureChatBehind } from "./chat.js?v=202610162235";
import { getCategories, invalidateCategories } from "./categories.js?v=202610162235";

const PLATFORMS = ["linux", "mac", "windows", "unix", "cross"];
const ROLE_OPTIONS = [["user", "Пользователь"], ["admin", "Администратор"]];

function tabs(active) {
  return `<div class="tabs" role="tablist">
    <a role="tab" href="#/admin/commands" aria-selected="${active === "commands"}">${icon("terminal")}Команды</a>
    <a role="tab" href="#/admin/users" aria-selected="${active === "users"}">${icon("users")}Пользователи</a>
  </div>`;
}

/* ============================ Команды ============================ */

export async function adminCommandsView({ query }) {
  await ensureChatBehind();
  setActiveNav("/admin/commands");
  setTitle("Команды — администрирование");
  const cats = await getCategories();
  let cat = cats.some((c) => c.key === query.category) ? query.category : cats[0].key;
  let cmds = [];
  let selected = null; // null — новая команда

  const node = overlayFrame({ cls: "modal-admin", head: tabs("commands"), body: `
    <div class="admin-grid">
      <div class="admin-side">
        <select class="select" id="adCat" aria-label="Категория">${cats.map((c) => `<option value="${c.key}"${c.key === cat ? " selected" : ""}>${esc(c.label)} · ${c.count}</option>`).join("")}</select>
        <button type="button" class="btn btn-primary btn-sm" id="adNew">${icon("plus")}Новая команда</button>
        <div class="search-wrap">${icon("search")}<input class="input" id="adFilter" type="search" placeholder="Фильтр" aria-label="Фильтр" /></div>
        <div class="rows" id="adList"></div>
      </div>
      <form class="admin-form" id="adForm" novalidate></form>
    </div>` });
  $(".mw-body", node).classList.add("is-fixed");
  showOverlay(node, { size: "wide tall" });

  const list = $("#adList", node), form = $("#adForm", node), filter = $("#adFilter", node);

  async function load(keepId) {
    cmds = await datasetApi.commands({ category: cat });
    selected = cmds.find((c) => c.id === keepId) || cmds[0] || null;
    drawList(); drawForm();
    list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
    form.scrollTop = 0;
  }
  function drawList() {
    const f = filter.value.trim().toLowerCase();
    const shown = cmds.filter((c) => !f || (c.name + " " + c.command).toLowerCase().includes(f));
    list.innerHTML = shown.length ? shown.map((c) => `<button type="button" class="row${selected && c.id === selected.id ? " is-active" : ""}" data-id="${esc(c.id)}">
      <span class="r-name">${esc(c.name)}</span><span class="r-cmd">${esc(c.command)}</span></button>`).join("") : '<div class="nothing">Нет команд</div>';
  }
  function drawForm() {
    const c = selected || { name: "", command: "", description: "", examples: ["", "", ""], tags: [], platform: "cross", category: cat };
    form.innerHTML = `
      <div class="form-title"><span class="eyebrow">${selected ? "Редактирование" : "Новая команда"}</span>${selected ? `<span class="chip chip-mono">${esc(selected.id)}</span>` : ""}</div>
      <div class="alert form-alert" hidden></div>
      <div class="form-grid">
        ${field({ name: "name", label: "Название", value: c.name })}
        ${field({ name: "command", label: "Команда", value: c.command, mono: true })}
        ${selectField({ name: "category", label: "Категория", value: c.category, options: cats.map((k) => [k.key, k.label]) })}
        ${selectField({ name: "platform", label: "Платформа", value: c.platform, options: PLATFORMS.map((p) => [p, p]) })}
        <div class="field span-2" data-field="description"><label class="label" for="f-description">Описание</label>
          <textarea class="textarea" id="f-description" name="description">${esc(c.description)}</textarea><div class="field-error" hidden></div></div>
        <div class="field span-2 examples-group" data-field="examples">
          <div class="label">Примеры применения (3)</div>
          ${[0, 1, 2].map((i) => `<input class="input mono" name="ex${i}" aria-label="Пример ${i + 1}" placeholder="Пример ${i + 1}" value="${esc(c.examples[i] || "")}" />`).join("")}
          <div class="field-error" hidden></div>
        </div>
        <div class="span-2">${field({ name: "tags", label: "Теги", value: c.tags.join(", "), hint: "Через запятую, минимум 5, на русском и английском" })}</div>
      </div>
      <div class="form-actions">
        ${selected ? `<button type="button" class="btn btn-danger" id="adDel">${icon("trash")}Удалить</button>` : "<span></span>"}
        <button type="submit" class="btn btn-primary">${selected ? "Сохранить" : "Добавить команду"}</button>
      </div>`;
    $("#adDel", form)?.addEventListener("click", remove);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrors(form);
    const v = values(form);
    const data = {
      name: v.name.trim(), command: v.command.trim(), category: v.category, platform: v.platform, description: v.description.trim(),
      examples: [v.ex0, v.ex1, v.ex2].map((x) => x.trim()),
      tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    let ok = true;
    for (const k of ["name", "command", "description"]) if (!data[k]) ok = !setFieldError(form, k, "Обязательное поле");
    if (data.examples.some((x) => !x)) ok = !setFieldError(form, "examples", "Нужно ровно 3 примера");
    if (data.tags.length < 5) ok = !setFieldError(form, "tags", "Минимум 5 тегов");
    if (!ok) return;
    busy(form, async () => {
      try {
        const isNew = !selected;
        const saved = isNew ? await adminApi.commands.create(data) : await adminApi.commands.update(selected.id, data);
        cat = saved.category;
        await refreshCounts();
        await load(saved.id);
        formAlert(form, isNew ? "Команда добавлена" : "Изменения сохранены", "ok");
      } catch (err) { showApiError(form, err); }
    });
  });

  /** Обновить счётчики в списке категорий после изменений. */
  async function refreshCounts() {
    invalidateCategories();
    const fresh = await getCategories();
    $("#adCat", node).innerHTML = fresh.map((c) => `<option value="${c.key}"${c.key === cat ? " selected" : ""}>${esc(c.label)} · ${c.count}</option>`).join("");
  }

  async function remove() {
    if (!(await confirmDialog({ title: "Удалить команду?", text: `«${selected.name}» будет удалена из датасета.` }))) return;
    try {
      await adminApi.commands.remove(selected.id);
      await refreshCounts();
      toast("Команда удалена");
      await load();
    } catch (err) { formAlert(form, err.message); }
  }

  list.addEventListener("click", (e) => {
    const r = e.target.closest(".row"); if (!r) return;
    selected = cmds.find((c) => c.id === r.dataset.id); drawList(); drawForm();
  });
  filter.addEventListener("input", drawList);
  $("#adNew", node).addEventListener("click", () => { selected = null; drawList(); drawForm(); $("#f-name", form).focus(); });
  $("#adCat", node).addEventListener("change", (e) => { cat = e.target.value; filter.value = ""; load(); });
  await load();
}

/* ============================ Пользователи ============================ */

export async function adminUsersView() {
  await ensureChatBehind();
  setActiveNav("/admin/users");
  setTitle("Пользователи — администрирование");
  const me = session.user.login;
  const node = overlayFrame({ cls: "modal-admin", head: tabs("users"), body: `
    <div class="users-tools">
      <div class="search-wrap">${icon("search")}<input class="input" id="uQ" type="search" placeholder="Поиск по логину" aria-label="Поиск по логину" /></div>
      <select class="select" id="uRole" aria-label="Роль"><option value="">Все роли</option>${ROLE_OPTIONS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>
      <button type="button" class="btn btn-primary" id="uNew">${icon("userPlus")}Создать</button>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Логин</th><th>Роль</th><th>Регистрация</th><th>Последний вход</th><th>Чатов</th><th></th></tr></thead>
      <tbody id="uRows"><tr><td colspan="6" class="nothing">Загрузка…</td></tr></tbody>
    </table></div>
    <p class="field-hint">Свою учётную запись нельзя удалить или понизить. В системе всегда остаётся хотя бы один администратор.</p>` });
  showOverlay(node, { size: "wide" });

  const q = $("#uQ", node), roleSel = $("#uRole", node), rows = $("#uRows", node);
  let users = [];
  let timer;

  async function load() {
    try {
      users = await adminApi.users.list({ q: q.value.trim(), role: roleSel.value });
      draw();
    } catch (err) { rows.innerHTML = `<tr><td colspan="6" class="nothing">${esc(err.message)}</td></tr>`; }
  }
  function draw() {
    rows.innerHTML = users.length ? users.map((u) => {
      const self = u.login === me;
      return `<tr>
        <td><b>${esc(u.login)}</b>${self ? ' <span class="chip">вы</span>' : ""}<span class="role-inline">${roleLabel(u.role)}</span></td>
        <td><span class="chip ${u.role === "admin" ? "chip-accent" : ""}">${roleLabel(u.role)}</span></td>
        <td class="muted">${formatDate(u.created_at)}</td>
        <td class="muted">${u.last_login_at ? formatDate(u.last_login_at) : "не входил"}</td>
        <td class="muted">${u.chats_count}</td>
        <td class="actions">
          <button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(u.login)}" aria-label="Изменить ${esc(u.login)}">${icon("edit")}<span class="btn-label">Изменить</span></button>
          <button type="button" class="btn btn-danger btn-sm" data-del="${esc(u.login)}" aria-label="Удалить ${esc(u.login)}"${self ? ' disabled title="Нельзя удалить себя"' : ""}>${icon("trash")}</button>
        </td></tr>`;
    }).join("") : '<tr><td colspan="6" class="nothing">Никого не найдено</td></tr>';
  }

  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  roleSel.addEventListener("change", load);
  $("#uNew", node).addEventListener("click", () => userDialog(null, load));
  rows.addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
    if (ed) userDialog(users.find((u) => u.login === ed.dataset.edit), load);
    if (del && !del.disabled) {
      const u = users.find((x) => x.login === del.dataset.del);
      const ok = await confirmDialog({ title: "Удалить пользователя?", text: `Учётная запись «${u.login}» и её история чатов (${u.chats_count}) будут удалены без возможности восстановления.` });
      if (!ok) return;
      try { await adminApi.users.remove(u.login); toast("Пользователь удалён"); load(); }
      catch (err) { toast(err.message, "error"); }
    }
  });
  await load();
}

/** Создание (user = null) или изменение пользователя: роль и/или новый пароль. */
function userDialog(user, onDone) {
  const self = user && user.login === session.user.login;
  const node = h(`<div class="modal glass" role="dialog" aria-modal="true">
    ${modalHead(user ? user.login : "Новый пользователь", user ? "Изменить пользователя" : "Пользователи")}
    <form novalidate>
      <div class="alert form-alert" hidden></div>
      ${user ? "" : field({ name: "login", label: "Логин", hint: "От 3 до 32 символов, без пробелов", autocomplete: "off" })}
      ${selectField({ name: "role", label: "Роль", value: user ? user.role : "user", options: ROLE_OPTIONS })}
      ${self ? '<div class="field-hint" style="margin-top:-0.375rem">Свою роль изменить нельзя.</div>' : ""}
      ${field({ name: "password", label: user ? "Новый пароль" : "Пароль", type: "password", autocomplete: "new-password", hint: user ? "Оставьте пустым, чтобы не менять" : "Не короче 6 символов" })}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Отмена</button>
        <button type="submit" class="btn btn-primary grow">${user ? "Сохранить" : "Создать"}</button>
      </div>
    </form></div>`);
  const close = openModal(node);
  const form = $("form", node);
  if (self) $("#f-role", form).disabled = true;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrors(form);
    const v = values(form);
    let ok = true;
    if (!user && !/^\S{3,32}$/.test((v.login || "").trim())) ok = !setFieldError(form, "login", "Логин: от 3 до 32 символов, без пробелов");
    if ((!user || v.password) && (v.password || "").length < 6) ok = !setFieldError(form, "password", "Пароль: минимум 6 символов");
    if (!ok) return;
    busy(form, async () => {
      try {
        if (user) {
          const patch = {};
          if (!self && v.role !== user.role) patch.role = v.role;
          if (v.password) patch.password = v.password;
          if (!Object.keys(patch).length) { close(); return; }
          await adminApi.users.update(user.login, patch);
          toast("Изменения сохранены");
        } else {
          await adminApi.users.create({ login: v.login.trim(), password: v.password, role: v.role });
          toast("Пользователь создан");
        }
        close(); onDone();
      } catch (err) { showApiError(form, err); }
    });
  });
}
