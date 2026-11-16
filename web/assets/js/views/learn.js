/**
 * Обучение: #/learn — темы с прогрессом; «Начать тест» спрашивает длину: 10 вопросов или вся тема (≤ 10 команд — сразу вся), #/learn/:topic[?mode=mistakes] — тест (модальный маршрут поверх чата).
 * Вопросы и проверку ответов делает сервер (POST /learn/quizzes…): правильный ответ клиент узнаёт только после выбора.
 * Закрепление: после каждого ответа — карточка команды; ошибки копятся и повторяются отдельным тестом, пока не будут отвечены верно.
 */
import { $, h, esc, plural, setTitle } from "../ui/dom.js?v=202611161110";
import { icon } from "../ui/icons.js?v=202611161110";
import { confirmDialog, openModal, modalHead } from "../ui/modal.js?v=202611161110";
import { toast } from "../ui/toast.js?v=202611161110";
import { commandCard } from "../ui/command-card.js?v=202611161110";
import { learnApi } from "../api/index.js?v=202611161110";
import * as router from "../router.js?v=202611161110";
import { showOverlay, overlayFrame, setActiveNav } from "./shell.js?v=202611161110";
import { ensureChatBehind } from "./chat.js?v=202611161110";
import { getCategories } from "./categories.js?v=202611161110";
import { CAT_ICON } from "./dataset.js?v=202611161110";

const LETTERS = ["A", "B", "C", "D"];
/** Варианты длины теста: «10 вопросов» (если в теме больше 10 команд) и «Вся тема». */
function sizeOptions(count) {
  return (count > 10 ? [["10", "10 вопросов"]] : []).concat([["all", `Вся тема · ${count}`]]);
}
const normSize = (v) => (v === "all" || v === "10" ? v : "10");
const root = { label: "Обучение", path: "/learn" };

function crumbs(parts) {
  return `<nav class="crumbs" aria-label="Навигация">${parts.map((p, i) => i < parts.length - 1
    ? `<a href="#${p.path}">${esc(p.label)}</a>${icon("chevronRight")}`
    : `<span aria-current="page">${esc(p.label)}</span>`).join("")}</nav>`;
}

export async function learnView({ params, query }) {
  await ensureChatBehind();
  setActiveNav("/learn");
  await getCategories().catch(() => {}); // подписи категорий в карточках команд
  if (params.topic) return quizView(params.topic, query.mode === "mistakes" ? "mistakes" : "all", normSize(query.size));
  setTitle("Обучение");

  const node = overlayFrame({ head: crumbs([root]), body: `
    <p class="learn-intro">Тест по теме: подобрать команду под задачу, объяснить команду, назвать её, узнать пример.
      Вопросы каждый раз другие — сначала идут команды, которых давно не было. Ошибки запоминаются: повторяйте их,
      пока не ответите верно, — так материал закрепляется.</p>
    <div class="learn-grid"><div class="nothing">Загрузка…</div></div>` });
  showOverlay(node, { size: "wide" });
  const grid = $(".learn-grid", node);

  async function load() {
    try {
      topics = await learnApi.topics();
      grid.innerHTML = topics.map(topicCard).join("");
    } catch (err) { grid.innerHTML = `<div class="nothing">${esc(err.message)}</div>`; }
  }
  let topics = [];
  grid.addEventListener("click", async (e) => {
    const st = e.target.closest("[data-start]");
    if (st) { chooseSize(topics.find((t) => t.key === st.dataset.start)); return; }
    const r = e.target.closest("[data-reset]");
    if (!r) return;
    if (!(await confirmDialog({ title: "Сбросить прогресс?", text: `Результаты и список ошибок по теме «${r.dataset.label}» будут удалены.`, ok: "Сбросить" }))) return;
    try { await learnApi.reset(r.dataset.reset); toast("Прогресс сброшен"); load(); } catch (err) { toast(err.message, "error"); }
  });
  await load();
}

/** Нажали «Начать тест»: выбор числа вопросов под эту тему (в каждой теме своё число команд). */
function chooseSize(t) {
  const opts = sizeOptions(t.count);
  const go = (v) => router.go(`/learn/${encodeURIComponent(t.key)}?size=${v}`);
  if (opts.length === 1) { go(opts[0][0]); return; } // команд ≤ 10 — выбирать нечего
  const node = h(`<div class="modal glass" role="dialog" aria-modal="true">
    ${modalHead(t.label, "Сколько вопросов?")}
    <p class="modal-text">В теме ${t.count} ${plural(t.count, "команда", "команды", "команд")}. Вопросы каждый раз другие —
      сначала идут команды, которых давно не было.</p>
    <div class="size-options">${opts.map(([v, label], k) => `<button type="button" class="btn ${k === 0 ? "btn-primary" : "btn-ghost"}" data-size="${v}">${label}</button>`).join("")}</div>
  </div>`);
  const close = openModal(node);
  node.addEventListener("click", (e) => { const b = e.target.closest("[data-size]"); if (b) { close(); go(b.dataset.size); } });
}

function topicCard(t) {
  const pct = t.best ?? 0;
  const status = !t.available ? (t.personal ? "Загрузите хотя бы 4 свои команды — и тест по ним появится" : "Мало команд для теста (нужно 4)")
    : t.attempts ? `Лучший результат — ${t.best}% · ${t.attempts} ${plural(t.attempts, "попытка", "попытки", "попыток")}`
    : "Ещё не проходили";
  return `<div class="learn-card${t.available ? "" : t.personal ? " is-hint" : " is-off"}${t.personal ? " is-my" : ""}${t.best === 100 ? " is-done" : ""}">
    <div class="learn-card-head">
      <span class="cat-icon">${esc(CAT_ICON[t.key] || t.key.slice(0, 3))}</span>
      <div><b>${esc(t.label)}</b><span>${t.count} ${plural(t.count, "команда", "команды", "команд")}</span></div>
      ${t.attempts || t.mistakes ? `<button type="button" class="icon-btn" data-reset="${esc(t.key)}" data-label="${esc(t.label)}" aria-label="Сбросить прогресс" title="Сбросить прогресс">${icon("rotate")}</button>` : ""}
    </div>
    <div class="learn-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Лучший результат"><i style="width:${pct}%"></i></div>
    <div class="learn-status">${status}</div>
    <div class="learn-actions">
      ${t.available ? `<button type="button" class="btn btn-primary btn-sm" data-start="${esc(t.key)}">${t.attempts ? "Пройти ещё раз" : "Начать тест"}</button>`
        : t.personal ? `<a class="btn btn-ghost btn-sm" href="#/dataset/my">${icon("upload")}${t.count ? "Добавить команды" : "Загрузить команды"}</a>` : ""}
      ${t.mistakes ? `<a class="btn btn-ghost btn-sm learn-mistakes" href="#/learn/${encodeURIComponent(t.key)}?mode=mistakes">${icon("rotate")}Повторить ошибки · ${t.mistakes}</a>` : ""}
    </div>
  </div>`;
}

/* ---------------- Прохождение теста ---------------- */

async function quizView(topicKey, mode, size = "10") {
  const cats = await getCategories().catch(() => []);
  const label = topicKey === "my" ? "Мои команды" : cats.find((c) => c.key === topicKey)?.label || topicKey;
  setTitle(`Тест: ${label}`);
  const node = overlayFrame({ back: root.path, head: crumbs([root, { label: mode === "mistakes" ? `${label} · ошибки` : label }]),
    body: '<div class="quiz"><div class="nothing">Готовим вопросы…</div></div>' });
  showOverlay(node, { size: "wide" });
  const box = $(".quiz", node);

  let quiz;
  try { quiz = await learnApi.start(topicKey, mode, size); }
  catch (err) {
    box.innerHTML = `<div class="nothing">${esc(err.message)}<br><br><a class="btn btn-primary" href="#/learn">К темам</a></div>`;
    return;
  }

  let i = 0, right = 0, answered = false;

  const onKey = (e) => {
    if (!node.isConnected) { document.removeEventListener("keydown", onKey); return; }
    if (document.querySelectorAll(".modal-backdrop").length > 1) return; // поверх открыто другое окно
    if (e.target.closest?.("input, textarea")) return;
    const n = Number(e.key);
    if (!answered && n >= 1 && n <= quiz.questions[i]?.options.length) { e.preventDefault(); choose(n - 1); }
    else if (answered && e.key === "Enter") { e.preventDefault(); $("#quizNext", node)?.click(); }
  };
  document.addEventListener("keydown", onKey);

  function drawQuestion() {
    answered = false;
    const q = quiz.questions[i];
    const mono = q.type === "task" || q.type === "example"; // варианты — команды или примеры
    box.innerHTML = `
      <div class="quiz-top">
        <span>Вопрос ${i + 1} из ${quiz.total}</span>
        <span class="quiz-score">${icon("check")}Верно: ${right}</span>
      </div>
      <div class="learn-bar"><i style="width:${(i / quiz.total) * 100}%"></i></div>
      <h3 class="quiz-prompt">${esc(q.prompt)}</h3>
      ${q.subject ? (q.type === "explain" || q.type === "name"
        ? `<div class="code quiz-subject"><span>${esc(q.subject)}</span></div>`
        : `<blockquote class="quiz-task">${esc(q.subject)}</blockquote>`) : ""}
      <div class="quiz-options" role="group" aria-label="Варианты ответа">
        ${q.options.map((o, k) => `<button type="button" class="quiz-opt${mono ? " is-mono" : ""}" data-opt="${k}">
          <kbd>${LETTERS[k]}</kbd><span>${esc(o)}</span></button>`).join("")}
      </div>
      <div class="quiz-feedback" aria-live="polite"></div>
      <p class="field-hint quiz-hint">Клавиши 1–${q.options.length} — выбрать ответ, Enter — дальше</p>`;
    box.querySelector(".quiz-opt")?.focus();
  }

  async function choose(k) {
    if (answered) return;
    answered = true;
    const q = quiz.questions[i];
    box.querySelectorAll(".quiz-opt").forEach((b) => (b.disabled = true));
    let res;
    try { res = await learnApi.answer(quiz.id, q.id, k); }
    catch (err) { answered = false; box.querySelectorAll(".quiz-opt").forEach((b) => (b.disabled = false)); toast(err.message, "error"); return; }
    if (res.correct) right++;
    const opts = box.querySelectorAll(".quiz-opt");
    opts[res.correct_option].classList.add("is-right");
    if (!res.correct) opts[k].classList.add("is-wrong");
    $(".quiz-score", box).innerHTML = `${icon("check")}Верно: ${right}`;
    const last = i === quiz.total - 1;
    $(".quiz-feedback", box).innerHTML = `
      <div class="alert ${res.correct ? "alert-ok" : "alert-error"}">${icon(res.correct ? "check" : "alert")}
        <span>${res.correct ? "Верно!" : "Неверно — команда добавлена в «Повторить ошибки»."} Закрепите:</span></div>
      ${res.command ? commandCard(res.command) : ""}
      <div class="quiz-next"><button type="button" class="btn btn-primary" id="quizNext">${last ? "Результат" : "Дальше"}${icon("chevronRight")}</button></div>`;
    $(".quiz-hint", box).hidden = true;
    $("#quizNext", box).addEventListener("click", () => { if (last) finish(); else { i++; drawQuestion(); } });
    $("#quizNext", box).focus({ preventScroll: true });
    $(".quiz-feedback", box).scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function finish() {
    let r;
    try { r = await learnApi.finish(quiz.id); } catch (err) { toast(err.message, "error"); return; }
    document.removeEventListener("keydown", onKey);
    const pct = Math.round((r.correct / r.total) * 100);
    const verdict = pct === 100 ? "Отлично — тема закреплена!" : pct >= 70 ? "Хороший результат. Повторите ошибки, чтобы закрепить." : "Стоит повторить тему: пройдите ошибки ещё раз.";
    box.innerHTML = `<div class="quiz-result">
      <div class="quiz-ring" style="--p:${pct}"><b>${pct}%</b></div>
      <h3>${esc(verdict)}</h3>
      <p>${r.correct} из ${r.total} верно${mode === "all" && r.best !== null ? ` · лучший результат по теме — ${r.best}%` : ""}${mode === "mistakes" ? " · повтор ошибок не влияет на лучший результат" : ""}</p>
      <p class="field-hint">${r.mistakes ? `На повторение по теме: ${r.mistakes} ${plural(r.mistakes, "команда", "команды", "команд")}` : "Ошибок для повторения нет"}</p>
      <div class="format-links">
        ${r.mistakes ? `<a class="btn btn-primary" href="#/learn/${encodeURIComponent(topicKey)}?mode=mistakes" data-restart>${icon("rotate")}Повторить ошибки · ${r.mistakes}</a>` : ""}
        <a class="btn ${r.mistakes ? "btn-ghost" : "btn-primary"}" href="#/learn/${encodeURIComponent(topicKey)}?size=${size}" data-restart>Пройти ещё раз</a>
        <a class="btn btn-ghost" href="#/learn">К темам</a>
      </div></div>`;
    // Тот же адрес (#/learn/git → #/learn/git) роутер не перерисует сам — запускаем заново
    box.querySelectorAll("[data-restart]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault(); router.go(a.getAttribute("href").slice(1));
    }));
  }

  box.addEventListener("click", (e) => { const b = e.target.closest("[data-opt]"); if (b) choose(+b.dataset.opt); });
  drawQuestion();
}
