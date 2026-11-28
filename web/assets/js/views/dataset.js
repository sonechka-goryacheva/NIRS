/** Датасет: #/dataset → #/dataset/:category → #/dataset/:category/:id (модальный маршрут поверх чата) */
import { $, esc, plural, setTitle } from "../ui/dom.js?v=202611161110";
import { icon } from "../ui/icons.js?v=202611161110";
import { confirmDialog } from "../ui/modal.js?v=202611161110";
import { toast } from "../ui/toast.js?v=202611161110";
import { commandCard } from "../ui/command-card.js?v=202611281130";
import { datasetApi, myCommandsApi } from "../api/index.js?v=202611161110";
import { session } from "../session.js?v=202611161110";
import * as router from "../router.js?v=202611161110";
import { showOverlay, overlayFrame, setActiveNav } from "./shell.js?v=202611161110";
import { ensureChatBehind } from "./chat.js?v=202611161110";
import { getCategories, invalidateCategories } from "./categories.js?v=202611161110";
import { MY, openImportDialog, openMyCommandDialog, downloadTemplate } from "./my-dataset.js?v=202611161110";

export const CAT_ICON = { linux: "sh", mac: "⌘", git: "git", docker: "dkr", sql: "SQL", python: "py", network: "net", powershell: "PS", my: "★" };

function crumbs(parts) {
  return `<nav class="crumbs" aria-label="Навигация">${parts.map((p, i) => i < parts.length - 1
    ? `<a href="#${p.path}">${esc(p.label)}</a>${icon("chevronRight")}`
    : `<span aria-current="page">${esc(p.label)}</span>`).join("")}</nav>`;
}

/** Куда ведёт «Редактировать»: свою команду правит владелец, общую — администратор. */
/** from — куда вернёт «Назад» из редактирования. */
const adminEditPath = (c, from) => `/admin/commands?category=${encodeURIComponent(c.category)}&id=${encodeURIComponent(c.id)}&from=${encodeURIComponent(from)}`;
const canEdit = (c) => c.category === MY || session.isAdmin;

export async function datasetView({ params }) {
  await ensureChatBehind();
  setActiveNav(params.category === MY ? "/dataset/my" : "/dataset");
  const cats = await getCategories();
  const root = { label: "Справочник команд", path: "/dataset" };
  const cat = params.category && cats.find((c) => c.key === params.category);

  setTitle(cat ? cat.label + " — справочник" : "Справочник команд");
  if (!params.category) {
    const general = cats.filter((c) => !c.personal), mine = cats.find((c) => c.personal);
    const node = overlayFrame({ head: crumbs([root]), body: `
      <div class="cat-grid">${general.map((c) => catCard(c)).join("")}</div>
      <div class="side-label cat-sep">Личное</div>
      <div class="cat-grid">${mine
        ? catCard(mine, mine.count ? "" : "Загрузите свой файл JSON или CSV")
        : `<a class="cat-card cat-card-locked" href="#/register"><span class="cat-icon">★</span><b>Мои команды</b><span>Доступно после регистрации</span></a>`}</div>` });
    showOverlay(node, { size: "wide" });
    return;
  }
  if (params.category === MY && session.isGuest) {
    showOverlay(overlayFrame({ back: root.path, head: crumbs([root, { label: "Мои команды" }]), body: `<div class="nothing">Свои команды можно загрузить после регистрации.<br><br><a class="btn btn-primary" href="#/register">Зарегистрироваться</a></div>` }), { size: "wide" });
    return;
  }
  if (!cat) { showOverlay(overlayFrame({ back: root.path, head: crumbs([root, { label: "Не найдено" }]), body: '<div class="nothing">Такой категории нет</div>' }), { size: "wide" }); return; }
  const lvl = { label: cat.label, path: `/dataset/${cat.key}` };

  if (params.id) return commandDetail(params.id, root, lvl, cat);

  const mine = cat.key === MY;
  const node = overlayFrame({ back: root.path, head: crumbs([root, lvl]), body: `
    <div class="list-tools">
      <div class="search-wrap">${icon("search")}<input class="input" type="search" placeholder="Фильтр по названию, команде или тегу" aria-label="Фильтр" /></div>
      ${mine ? `<button type="button" class="btn btn-primary" id="myUpload">${icon("upload")}<span class="btn-label">Загрузить файл</span></button>
        <button type="button" class="btn btn-ghost" id="myClear" title="Удалить все мои команды" aria-label="Удалить все мои команды">${icon("trash")}</button>` : ""}
      ${!mine && session.isAdmin ? `<a class="btn btn-ghost" href="#/admin/commands?category=${encodeURIComponent(cat.key)}&from=${encodeURIComponent(lvl.path)}">${icon("edit")}<span class="btn-label">Редактировать категорию</span></a>` : ""}
    </div>
    <div class="rows"><div class="nothing">Загрузка…</div></div>` });
  showOverlay(node, { size: "wide" });
  const input = $("input", node), rows = $(".rows", node);
  let cmds = [];

  async function load() {
    try { cmds = await datasetApi.commands({ category: cat.key }); draw(); }
    catch (err) { rows.innerHTML = `<div class="nothing">${esc(err.message)}</div>`; }
  }
  const draw = () => {
    const f = input.value.trim().toLowerCase();
    const list = cmds.filter((c) => !f || (c.name + " " + c.command + " " + (c.tags || []).join(" ")).toLowerCase().includes(f));
    if (!list.length && mine && !f) { rows.innerHTML = emptyMine(); return; }
    rows.innerHTML = list.length ? list.map((c) => `<div class="row-line">
      <a class="row" href="#/dataset/${cat.key}/${encodeURIComponent(c.id)}">
        <span class="r-name">${esc(c.name)}</span><span class="r-cmd">${esc(c.command)}</span><span class="chip chip-mono">${esc(c.platform)}</span>${icon("chevronRight")}</a>
      ${canEdit(c) ? `<button type="button" class="icon-btn row-edit" data-edit="${esc(c.id)}" aria-label="Редактировать «${esc(c.name)}»" title="Редактировать">${icon("edit")}</button>` : ""}
    </div>`).join("")
      : `<div class="nothing">${f ? "Ничего не найдено" : "В этой категории пока нет команд"}</div>`;
  };
  const reload = async () => { invalidateCategories(); await getCategories().catch(() => {}); await load(); };

  input.addEventListener("input", draw);
  rows.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tpl]"); if (t) { downloadTemplate(t.dataset.tpl); return; }
    if (e.target.closest("[data-upload]")) { openImportDialog(cmds.length, reload); return; }
    const b = e.target.closest("[data-edit]"); if (!b) return;
    const c = cmds.find((x) => x.id === b.dataset.edit);
    if (mine) openMyCommandDialog(c, reload);
    else router.go(adminEditPath(c, lvl.path));
  });
  $("#myUpload", node)?.addEventListener("click", () => openImportDialog(cmds.length, reload));
  $("#myClear", node)?.addEventListener("click", async () => {
    if (!cmds.length) { toast("Список уже пуст"); return; }
    if (!(await confirmDialog({ title: "Удалить все мои команды?", text: `${cmds.length} ${plural(cmds.length, "команда будет удалена", "команды будут удалены", "команд будут удалены")}. Общий справочник не изменится.` }))) return;
    try { await myCommandsApi.clear(); toast("Мои команды удалены"); reload(); } catch (err) { toast(err.message, "error"); }
  });
  await load();
}

function catCard(c, note = "") {
  return `<a class="cat-card${c.personal ? " cat-card-my" : ""}" href="#/dataset/${c.key}"><span class="cat-icon">${esc(CAT_ICON[c.key] || c.key.slice(0, 3))}</span>
    <b>${esc(c.label)}</b><span>${note || `${c.count} ${plural(c.count, "команда", "команды", "команд")}`}</span></a>`;
}

function emptyMine() {
  return `<div class="my-empty">
    ${icon("upload")}
    <b>Здесь будут ваши команды</b>
    <p>Загрузите файл JSON или CSV — команды появятся в этом разделе, и чат будет искать по ним вместе с общим справочником. Их видите только вы.</p>
    <div class="format-links">
      <button type="button" class="btn btn-primary" data-upload>${icon("upload")}Загрузить файл</button>
      <button type="button" class="btn btn-ghost" data-tpl="json">${icon("download")}Шаблон JSON</button>
      <button type="button" class="btn btn-ghost" data-tpl="csv">${icon("download")}Шаблон CSV</button>
    </div></div>`;
}

/** Карточка одной команды + переход к редактированию. */
async function commandDetail(id, root, lvl, cat) {
  const node = overlayFrame({ back: lvl.path, head: crumbs([root, lvl, { label: "…" }]), body: '<div class="nothing">Загрузка…</div>' });
  showOverlay(node, { size: "wide" });
  try {
    const c = await datasetApi.command(id);
    $(".crumbs", node).outerHTML = crumbs([root, lvl, { label: c.name }]);
    const actions = canEdit(c) ? `<div class="detail-actions">
      ${c.category === MY
        ? `<button type="button" class="btn btn-primary btn-sm" id="editCmd">${icon("edit")}Редактировать</button>`
        : `<a class="btn btn-primary btn-sm" href="#${adminEditPath(c, `${lvl.path}/${encodeURIComponent(c.id)}`)}">${icon("edit")}Редактировать</a>`}
    </div>` : "";
    $(".mw-body", node).innerHTML = actions + commandCard(c, { tags: true });
    setTitle(c.name);
    $("#editCmd", node)?.addEventListener("click", () => openMyCommandDialog(c, (saved) => {
      invalidateCategories();
      if (saved) commandDetail(saved.id, root, lvl, cat); else router.go(lvl.path);
    }));
  } catch (err) { $(".mw-body", node).innerHTML = `<div class="nothing">${esc(err.message)}</div>`; }
}
