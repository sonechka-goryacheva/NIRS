/** Датасет: #/dataset → #/dataset/:category → #/dataset/:category/:id (модальный маршрут поверх чата) */
import { $, esc, plural, setTitle } from "../ui/dom.js?v=202610162235";
import { icon } from "../ui/icons.js?v=202610162235";
import { commandCard } from "../ui/command-card.js?v=202610162235";
import { datasetApi } from "../api/index.js?v=202610162235";
import { showOverlay, overlayFrame, setActiveNav } from "./shell.js?v=202610162235";
import { ensureChatBehind } from "./chat.js?v=202610162235";
import { getCategories } from "./categories.js?v=202610162235";

export const CAT_ICON = { linux: "sh", mac: "⌘", git: "git", docker: "dkr", sql: "SQL", python: "py", network: "net", powershell: "PS" };

function crumbs(parts) {
  return `<nav class="crumbs" aria-label="Навигация">${parts.map((p, i) => i < parts.length - 1
    ? `<a href="#${p.path}">${esc(p.label)}</a>${icon("chevronRight")}`
    : `<span aria-current="page">${esc(p.label)}</span>`).join("")}</nav>`;
}

export async function datasetView({ params }) {
  await ensureChatBehind();
  setActiveNav("/dataset");
  const cats = await getCategories();
  const root = { label: "Датасет команд", path: "/dataset" };
  const cat = params.category && cats.find((c) => c.key === params.category);

  setTitle(cat ? cat.label + " — датасет" : "Датасет команд");
  if (!params.category) {
    const node = overlayFrame({ head: crumbs([root]), body: `<div class="cat-grid">${cats.map((c) => `
      <a class="cat-card" href="#/dataset/${c.key}"><span class="cat-icon">${esc(CAT_ICON[c.key] || c.key.slice(0, 3))}</span>
      <b>${esc(c.label)}</b><span>${c.count} ${plural(c.count, "команда", "команды", "команд")}</span></a>`).join("")}</div>` });
    showOverlay(node, { size: "wide" });
    return;
  }
  if (!cat) { showOverlay(overlayFrame({ head: crumbs([root, { label: "Не найдено" }]), body: '<div class="nothing">Такой категории нет</div>' }), { size: "wide" }); return; }
  const lvl = { label: cat.label, path: `/dataset/${cat.key}` };

  if (params.id) {
    const node = overlayFrame({ head: crumbs([root, lvl, { label: "…" }]), body: '<div class="nothing">Загрузка…</div>' });
    showOverlay(node, { size: "wide" });
    try {
      const c = await datasetApi.command(params.id);
      $(".crumbs", node).outerHTML = crumbs([root, lvl, { label: c.name }]);
      $(".mw-body", node).innerHTML = commandCard(c, { tags: true });
      setTitle(c.name);
    } catch (err) { $(".mw-body", node).innerHTML = `<div class="nothing">${esc(err.message)}</div>`; }
    return;
  }

  const node = overlayFrame({ head: crumbs([root, lvl]), body: `
    <div class="list-tools"><div class="search-wrap">${icon("search")}<input class="input" type="search" placeholder="Фильтр по названию, команде или тегу" aria-label="Фильтр" /></div></div>
    <div class="rows"><div class="nothing">Загрузка…</div></div>` });
  showOverlay(node, { size: "wide" });
  const cmds = await datasetApi.commands({ category: cat.key });
  const input = $("input", node), rows = $(".rows", node);
  const draw = () => {
    const f = input.value.trim().toLowerCase();
    const list = cmds.filter((c) => !f || (c.name + " " + c.command + " " + c.tags.join(" ")).toLowerCase().includes(f));
    rows.innerHTML = list.length ? list.map((c) => `<a class="row" href="#/dataset/${cat.key}/${encodeURIComponent(c.id)}">
      <span class="r-name">${esc(c.name)}</span><span class="r-cmd">${esc(c.command)}</span><span class="chip chip-mono">${esc(c.platform)}</span>${icon("chevronRight")}</a>`).join("")
      : `<div class="nothing">${f ? "Ничего не найдено" : "В этой категории пока нет команд"}</div>`;
  };
  input.addEventListener("input", draw);
  draw();
}
