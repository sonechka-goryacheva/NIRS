/**
 * Имитация поиска (на сервере — BM25 + LLM). Повторяет правила ответа из spec/product/errors.md:
 *   found     — есть уверенное совпадение: лучшая команда + до 2 похожих;
 *   not_found — уверенного совпадения нет: до 3 команд, где совпало хотя бы одно значимое слово (или его основа);
 *               если таких нет (бессмыслица, тема не про IT) — только сообщение, без вариантов.
 */
const STOP = new Set(("как что где это для или при без над под про его она они оно мне мой моя мои нам вас вам они " +
  "делает делать сделать команда команду команды команде надо нужно можно хочу есть был была было будет если чтобы тоже ещё уже очень там тут вот так все всё весь " +
  "the and for with how what are you can not").split(" "));

const words = (s) => String(s).toLowerCase().replace(/[^a-zа-яё0-9\-]+/gi, " ").split(" ").filter(Boolean);
const significant = (s) => words(s).filter((w) => w.length >= 3 && !STOP.has(w));

/** 2 — слово совпало целиком, 1 — совпала основа (первые 4–5 букв),
 *  +6 — запрос содержит команду целиком, +3 — запрос содержит её имя (ls, df, git…). */
function score(cmd, qTokens, qRaw) {
  const hay = words([cmd.name, cmd.command, cmd.description, (cmd.tags || []).join(" ")].join(" "));
  let s = 0;
  for (const q of qTokens) {
    if (hay.includes(q)) { s += 2; continue; }
    if (q.length >= 4) {
      const stem = q.slice(0, Math.min(5, q.length));
      if (hay.some((h) => h.startsWith(stem))) s += 1;
    }
  }
  const q = ` ${words(qRaw).join(" ")} `;
  const base = words(cmd.command.split(" <")[0]).join(" ");
  const name = words(cmd.command)[0];
  if (base && q.includes(` ${base} `)) s += 6;
  else if (name && name.length >= 2 && q.includes(` ${name} `)) s += 3;
  return s;
}

export const MSG_VARIANTS = "Подходящая команда не найдена. Возможно, подойдут указанные ниже варианты?";
export const MSG_NOTHING = "Подходящая команда не найдена. Попробуйте описать задачу другими словами.";

/** Ответ на запрос — объект Reply из api/index.js. */
export function answer(commands, query) {
  const qTokens = significant(query);
  const ranked = commands.map((c) => ({ c, s: score(c, qTokens, query) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s);
  if (ranked[0] && ranked[0].s >= 3) {
    return { type: "found", commands: [ranked[0].c], related: ranked.slice(1, 3).filter((r) => r.s >= 2).map((r) => r.c) };
  }
  const variants = ranked.filter((r) => r.s >= 1).slice(0, 3).map((r) => r.c);
  return { type: "not_found", message: variants.length ? MSG_VARIANTS : MSG_NOTHING, commands: variants };
}
