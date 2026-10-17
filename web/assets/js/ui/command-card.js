/** Карточка команды — одна разметка для ответа в чате и датасета. */
import { esc } from "./dom.js?v=202610162235";
import { icon } from "./icons.js?v=202610162235";
import { toast } from "./toast.js?v=202610162235";

let labels = {};
export function setCategoryLabels(map) { labels = map; }

const codeLine = (text, label) =>
  `<div class="code"><span>${esc(text)}</span><button type="button" class="icon-btn copy-btn" data-copy="${esc(text)}" aria-label="${label}">${icon("copy")}</button></div>`;

export function commandCard(c, { tags = false } = {}) {
  return `<article class="cmd-card">
    <header class="cmd-head">
      <h3 class="cmd-name">${esc(c.name)}</h3>
      <div class="cmd-tags">
        <span class="chip chip-accent">${esc(labels[c.category] || c.category)}</span>
        <span class="chip chip-mono">${esc(c.platform)}</span>
      </div>
    </header>
    <div class="cmd-label">Команда</div>
    ${codeLine(c.command, "Скопировать команду")}
    <div class="cmd-label">Описание</div>
    <p class="cmd-desc">${esc(c.description)}</p>
    <div class="cmd-label">Примеры применения</div>
    <div class="cmd-examples">${(c.examples || []).slice(0, 3).map((x) => codeLine(x, "Скопировать пример")).join("")}</div>
    ${tags && c.tags?.length ? `<div class="tag-row">${c.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join("")}</div>` : ""}
  </article>`;
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  const text = b.dataset.copy;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch {} ta.remove();
  }
  const old = b.innerHTML; b.innerHTML = icon("check"); setTimeout(() => (b.innerHTML = old), 1200);
  toast("Скопировано");
});
