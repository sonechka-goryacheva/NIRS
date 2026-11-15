/**
 * Личный датасет («Мои команды», категория my): загрузка JSON/CSV, шаблоны, правка и удаление.
 * Файл читается в браузере, на сервер уходит массив команд (POST /my/commands/import) — сервер проверяет каждую.
 */
import { $, h, esc, plural } from "../ui/dom.js?v=202611160100";
import { icon } from "../ui/icons.js?v=202611160100";
import { openModal, modalHead, confirmDialog } from "../ui/modal.js?v=202611160100";
import { toast } from "../ui/toast.js?v=202611160100";
import { field, selectField, setFieldError, clearErrors, formAlert, showApiError, values, busy } from "../ui/forms.js?v=202611160100";
import { myCommandsApi } from "../api/index.js?v=202611160100";

export const MY = "my";
const PLATFORMS = ["cross", "linux", "mac", "windows", "unix"];
const MAX_BYTES = 1024 * 1024;
const FIELDS = ["name", "command", "description", "examples", "tags", "platform"];

/* ---------------- Шаблоны ---------------- */

const SAMPLE = [
  { name: "Логи сервиса за час", command: "journalctl -u <service> --since \"1 hour ago\"",
    description: "Показывает журнал systemd-сервиса за последний час.",
    examples: ["journalctl -u nginx --since \"1 hour ago\"", "journalctl -u ssh --since today", "journalctl -u docker -f"],
    tags: ["logs", "журнал", "systemd", "сервис", "journalctl"], platform: "linux" },
  { name: "Размер папок", command: "du -sh *",
    description: "Сколько места занимает каждая папка в текущем каталоге.",
    examples: ["du -sh *", "du -sh ~/Downloads", "du -sh /var/log/*"],
    tags: ["disk", "размер", "место", "du"], platform: "unix" },
];

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadTemplate(kind) {
  if (kind === "csv") {
    const rows = [FIELDS.join(",")].concat(SAMPLE.map((c) =>
      [c.name, c.command, c.description, c.examples.join(" | "), c.tags.join(", "), c.platform].map(csvCell).join(",")));
    download("my-commands-template.csv", "﻿" + rows.join("\n") + "\n", "text/csv;charset=utf-8");
  } else {
    download("my-commands-template.json", JSON.stringify(SAMPLE, null, 2) + "\n", "application/json");
  }
}

/* ---------------- Разбор файла ---------------- */

/** CSV (RFC 4180): кавычки, переносы строк в ячейках, разделитель «,» или «;». */
function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && !cell.trim()) { q = true; cell = ""; } // кавычки — только в начале ячейки
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const data = rows.filter((r) => r.some((c) => c.trim()));
  if (!data.length) throw new Error("Файл пустой");
  const head = data[0].map((c) => c.trim().toLowerCase());
  if (!head.includes("name") || !head.includes("command")) throw new Error("В первой строке CSV нужны заголовки: " + FIELDS.join(", "));
  return data.slice(1).map((r) => Object.fromEntries(head.map((k, i) => [k, (r[i] ?? "").trim()])));
}

/** JSON: массив команд, {commands: [...]} или файл корпуса по категориям {"linux": [...], ...}. */
function parseJson(text) {
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, "")); } catch (e) { throw new Error("Не удалось прочитать JSON: " + e.message); }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.commands)) return data.commands;
  if (data && typeof data === "object" && Object.values(data).every(Array.isArray)) return Object.values(data).flat();
  throw new Error("Ожидается массив команд");
}

export async function readDatasetFile(file) {
  if (file.size > MAX_BYTES) throw new Error("Файл больше 1 МБ");
  const text = await file.text();
  const isCsv = /\.csv$/i.test(file.name) || (!/\.json$/i.test(file.name) && !/^\s*[[{]/.test(text));
  const list = isCsv ? parseCsv(text) : parseJson(text);
  if (!list.length) throw new Error("В файле нет команд");
  return list;
}

/* ---------------- Окно загрузки ---------------- */

/** @param {number} existing сколько личных команд уже есть @param {() => void} onDone */
export function openImportDialog(existing, onDone) {
  let parsed = null;
  const node = h(`<div class="modal glass modal-import" role="dialog" aria-modal="true">
    ${modalHead("Загрузить свои команды", "Мои команды")}
    <div class="alert form-alert" hidden></div>
    <label class="dropzone" tabindex="0">
      <input type="file" accept=".json,.csv,application/json,text/csv" hidden />
      ${icon("upload")}
      <b>Перетащите файл сюда или выберите на компьютере</b>
      <span>JSON или CSV, до 1 МБ, не больше 500 команд</span>
    </label>
    <div class="import-file" hidden></div>
    <details class="format-help">
      <summary>Формат файла</summary>
      <p>Поля каждой команды: <code>name</code>, <code>command</code>, <code>description</code> — обязательны;
        <code>examples</code> — до 3 примеров, <code>tags</code> — теги, <code>platform</code> — linux, mac, windows, unix или cross.</p>
      <p>В CSV примеры разделяются «|», теги — запятыми. Подойдёт и файл корпуса из <code>data/corpus/</code>.</p>
      <div class="format-links">
        <button type="button" class="btn btn-ghost btn-sm" data-tpl="json">${icon("download")}Шаблон JSON</button>
        <button type="button" class="btn btn-ghost btn-sm" data-tpl="csv">${icon("download")}Шаблон CSV</button>
      </div>
    </details>
    ${existing ? `<div class="profile-section"><div class="label">Уже загружено ${existing} ${plural(existing, "команда", "команды", "команд")}</div>
      <div class="segmented" role="radiogroup" aria-label="Режим загрузки">
        <button type="button" role="radio" aria-checked="true" data-mode="append">${icon("plus")}<span>Добавить к ним</span></button>
        <button type="button" role="radio" aria-checked="false" data-mode="replace">${icon("upload")}<span>Заменить все</span></button>
      </div></div>` : ""}
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" data-close>Отмена</button>
      <button type="button" class="btn btn-primary grow" id="doImport" disabled>Загрузить</button>
    </div>
  </div>`);
  const close = openModal(node);
  const input = $("input[type=file]", node), zone = $(".dropzone", node), info = $(".import-file", node), alertBox = node;
  let mode = "append";

  const showErr = (msg) => formAlert(alertBox, msg);
  const hideErr = () => { $(".form-alert", node).hidden = true; };

  async function take(file) {
    hideErr(); parsed = null; $("#doImport", node).disabled = true; info.hidden = true;
    if (!file) return;
    try {
      parsed = await readDatasetFile(file);
      info.innerHTML = `${icon("file")}<div><b>${esc(file.name)}</b><span>Найдено ${parsed.length} ${plural(parsed.length, "команда", "команды", "команд")} — сервер проверит каждую</span></div>`;
      info.hidden = false;
      $("#doImport", node).disabled = false;
    } catch (err) { showErr(err.message); }
  }

  input.addEventListener("change", () => take(input.files[0]));
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  ["dragenter", "dragover"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove("is-over"); }));
  zone.addEventListener("drop", (e) => take(e.dataTransfer.files[0]));
  node.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tpl]"); if (t) downloadTemplate(t.dataset.tpl);
    const m = e.target.closest("[data-mode]");
    if (m) { mode = m.dataset.mode; node.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-checked", x === m)); }
  });

  $("#doImport", node).addEventListener("click", async (e) => {
    if (!parsed) return;
    e.target.disabled = true;
    try {
      const res = await myCommandsApi.import(parsed, mode);
      close();
      const skipped = res.skipped.length;
      toast(`Добавлено ${res.added} ${plural(res.added, "команда", "команды", "команд")}` + (skipped ? `, пропущено ${skipped}` : ""));
      if (skipped) showSkipped(res.skipped);
      onDone?.();
    } catch (err) { showErr(err.message); e.target.disabled = false; }
  });
}

/** Отчёт: какие строки файла не загрузились и почему. */
function showSkipped(skipped) {
  const node = h(`<div class="modal glass" role="dialog" aria-modal="true">
    ${modalHead(`Пропущено: ${skipped.length}`, "Отчёт о загрузке")}
    <div class="skip-list">${skipped.slice(0, 50).map((s) => `<div><span class="chip chip-mono">№ ${s.index + 1}</span><span>${esc(s.reason)}</span></div>`).join("")}
      ${skipped.length > 50 ? `<div class="field-hint">и ещё ${skipped.length - 50}</div>` : ""}</div>
    <div class="modal-actions"><button type="button" class="btn btn-primary grow" data-close>Понятно</button></div>
  </div>`);
  openModal(node);
}

/* ---------------- Правка личной команды ---------------- */

/** @param {object} c команда @param {(saved|null) => void} onDone null — удалена */
export function openMyCommandDialog(c, onDone) {
  const node = h(`<div class="modal glass modal-cmd" role="dialog" aria-modal="true">
    ${modalHead(c.name, "Моя команда · редактирование")}
    <form novalidate>
      <div class="alert form-alert" hidden></div>
      <div class="form-grid">
        ${field({ name: "name", label: "Название", value: c.name })}
        ${selectField({ name: "platform", label: "Платформа", value: c.platform, options: PLATFORMS.map((p) => [p, p]) })}
        <div class="span-2">${field({ name: "command", label: "Команда", value: c.command, mono: true })}</div>
        <div class="field span-2" data-field="description"><label class="label" for="f-description">Описание</label>
          <textarea class="textarea" id="f-description" name="description">${esc(c.description)}</textarea><div class="field-error" hidden></div></div>
        <div class="field span-2 examples-group" data-field="examples">
          <div class="label">Примеры (до 3)</div>
          ${[0, 1, 2].map((i) => `<input class="input mono" name="ex${i}" aria-label="Пример ${i + 1}" placeholder="Пример ${i + 1}" value="${esc(c.examples?.[i] || "")}" />`).join("")}
          <div class="field-error" hidden></div>
        </div>
        <div class="span-2">${field({ name: "tags", label: "Теги", value: (c.tags || []).join(", "), hint: "Через запятую" })}</div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-danger" id="myDel">${icon("trash")}Удалить</button>
        <button type="button" class="btn btn-ghost" data-close>Отмена</button>
        <button type="submit" class="btn btn-primary grow">Сохранить</button>
      </div>
    </form></div>`);
  const close = openModal(node);
  const form = $("form", node);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrors(form);
    const v = values(form);
    const data = {
      name: v.name.trim(), command: v.command.trim(), description: v.description.trim(), platform: v.platform,
      examples: [v.ex0, v.ex1, v.ex2].map((x) => x.trim()).filter(Boolean),
      tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    let ok = true;
    for (const k of ["name", "command", "description"]) if (!data[k]) ok = !setFieldError(form, k, "Обязательное поле");
    if (!ok) return;
    busy(form, async () => {
      try { const saved = await myCommandsApi.update(c.id, data); close(); toast("Изменения сохранены"); onDone?.(saved); }
      catch (err) { showApiError(form, err); }
    });
  });
  $("#myDel", node).addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "Удалить команду?", text: `«${c.name}» будет удалена из ваших команд.` }))) return;
    try { await myCommandsApi.remove(c.id); close(); toast("Команда удалена"); onDone?.(null); }
    catch (err) { formAlert(form, err.message); }
  });
}
