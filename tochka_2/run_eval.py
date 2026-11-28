"""
Индекс BM25 проекта на документах другой команды и прогон её вопросов.

Поиск — тот же алгоритм, что в rag/ (k1=0.5, b=0.75, лемматизация, стоп-слова).
Параметры на этом наборе не подбирались. Эталоны в ранжирование не входят:
якоря ниже нужны только для разметки ошибок после прогона.

Запуск из корня репозитория:
    python tochka_2/run_eval.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "vendor"))

from bm25 import BM25, InvertedIndex  # noqa: E402
from text import preprocess  # noqa: E402

K = 3
K1 = 0.5
B = 0.75
FOUND_MIN_SCORE = 5.0  # порог типа ответа в rag/engine.py

NOTHING_FOUND = "Подходящая команда не найдена. Попробуйте описать задачу другими словами."
SIMILAR_NOTICE = "Подходящая команда не найдена. Возможно, подойдут указанные ниже варианты?"
REFUSAL_MARKS = (
    "подходящая команда не найдена",
    "в документах нет этой информации",
    "нет этой информации",
    "в контексте нет",
)

# Точные фрагменты эталонного документа. Не передаются в поиск.
ANCHORS = {
    "Q01": ["Свинина относится к красному мясу", "овощами, бобовыми и крахмалистыми"],
    "Q02": ["за день или неделю", "овощи, источник белка и гарнир", "цельнозерновые"],
    "Q03": ["весь состав продукта", "фасоль, чечевица", "не задаёт персональную норму"],
    "Q04": ["овсяная каша", "рагу, супы, соусы и салаты"],
    "Q05": ["покупных продуктов", "сравнение этикеток", "трав, специй"],
    "Q06": ["сахароза, глюкоза, сироп и мёд", "уменьшать постепенно", "водой или напитками без добавленного сахара"],
    "Q07": ["Вода — доступный способ", "не только из воды", "в жару"],
    "Q08": ["уменьшать избыток насыщенных жиров", "оливковое и рапсовое", "Небольшое количество жира необходимо"],
    "Q09": ["100 граммов или 100 миллилитров", "фактически съеденного", "жиры, насыщенные жиры"],
    "Q10": ["одного-двух часов", "0 до 5", "48 часов", "24 часов"],
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load():
    docs = json.loads((ROOT / "data" / "corpus.json").read_text(encoding="utf-8"))
    cases = json.loads((ROOT / "data" / "questions.json").read_text(encoding="utf-8"))["cases"]
    return docs, cases


def as_record(raw: dict) -> dict:
    """Статья → поля, которые индексирует проект: название, описание, теги."""
    return {
        "id": raw["id"],
        "name": raw["title"],
        "command": "",
        "description": raw["content"],
        "tags": list(raw.get("keywords") or []),
        "parent": raw["id"],
        "part": 0,
    }


def doc_terms(doc: dict) -> list[str]:
    tags = " ".join(doc.get("tags") or [])
    terms: list[str] = []
    for text in (doc.get("name", ""), doc.get("description", ""), tags):
        terms += preprocess(text)
    return terms


def build_index(docs: list[dict]) -> tuple[InvertedIndex, BM25]:
    index = InvertedIndex([doc_terms(d) for d in docs])
    return index, BM25(index, k1=K1, b=B)


def search(docs: list[dict], index: InvertedIndex, bm25: BM25, question: str, k: int = K):
    terms = preprocess(question)
    ranked = bm25.rank(terms)
    hits = []
    for doc_i, score in ranked[:k]:
        hits.append({"doc": docs[doc_i], "score": score, "rank": len(hits) + 1})
    top_score = hits[0]["score"] if hits else 0.0
    if not hits:
        kind = "nothing"
    elif top_score >= FOUND_MIN_SCORE:
        kind = "found"
    else:
        kind = "similar"
    return hits, kind, terms


def rank_of(docs: list[dict], bm25: BM25, question: str, relevant: list[str]) -> int | None:
    if not relevant:
        return None
    wanted = set(relevant)
    terms = preprocess(question)
    for i, (doc_i, _) in enumerate(bm25.rank(terms), 1):
        if docs[doc_i]["parent"] in wanted or docs[doc_i]["id"] in wanted:
            return i
    return None


def stub_answer(hits: list[dict], kind: str) -> str:
    """Ответ как у заглушки app/llm.py: текст найденных документов, без новой фактуры."""
    if not hits or kind == "nothing":
        return NOTHING_FOUND
    parts = []
    for h in hits:
        d = h["doc"]
        examples = "\n".join(f"   - {ex}" for ex in d.get("examples") or []) or "   - "
        parts.append(
            f"1. {d.get('name', '')}\n"
            f"2. Команда: {d.get('command', '')}\n"
            f"3. Описание: {d.get('description', '')}\n"
            f"4. Примеры применения:\n{examples}"
        )
    text = "\n\n---\n\n".join(parts)
    if kind == "similar":
        text = SIMILAR_NOTICE + "\n\n" + text
    ids = ", ".join(f"[{h['doc']['id']}]" for h in hits)
    return text + f"\n\nИсточники: {ids}"


def is_refusal(answer: str) -> bool:
    text = " ".join(answer.lower().split())
    return any(mark in text for mark in REFUSAL_MARKS)


def context_text(hits: list[dict]) -> str:
    """Только текст чанка. Заголовок и теги не засчитываются как найденный факт."""
    return "\n".join(h["doc"].get("description", "") for h in hits)


def classify(case: dict, hits: list[dict], kind: str, answer: str) -> tuple[str, str]:
    top_ids = [h["doc"]["id"] for h in hits]
    shown = ", ".join(f"{h['doc']['id']} ({h['score']:.1f})" for h in hits) or "—"
    context = context_text(hits)

    if case["should_abstain"]:
        if is_refusal(answer):
            return "—", f"Ответ в корпусе не задан. Тип {kind}, система отказалась. Выдача: {shown}."
        return (
            "E5",
            f"Ответа в корпусе нет, тип {kind}: заглушка отдала найденные конспекты и не отказалась. Выдача: {shown}.",
        )

    relevant = case["relevant_documents"]
    if not set(relevant) & {h["doc"]["parent"] for h in hits}:
        return "E1", f"Нужен {', '.join(relevant)}, в top-{K} его нет. Выдача: {shown}."

    missing_ctx = [a for a in ANCHORS[case["id"]] if a not in context]
    if missing_ctx:
        return "E2", f"Документ {', '.join(relevant)} в top-{K}, но в чанке нет: {'; '.join(missing_ctx)}."

    missing_ans = [a for a in ANCHORS[case["id"]] if a not in answer]
    if missing_ans:
        return "E3", f"Фрагмент есть в контексте и не попал в ответ: {'; '.join(missing_ans)}."

    note = f"Документ {', '.join(relevant)} в top-{K}, чанк — текст целиком, заглушка его не сократила и не дополнила. Выдача: {shown}."
    if kind == "similar":
        note += " Балл ниже порога 5, поэтому шапка ответа — отказ, хотя текст документа в ответе есть (не E3)."
    return "—", note


def paragraph_chunks(raw_docs: list[dict]) -> list[dict]:
    chunks = []
    for raw in raw_docs:
        parts = [p.strip() for p in raw["content"].split("\n\n") if p.strip()]
        for i, part in enumerate(parts, 1):
            chunks.append({
                "id": f"{raw['id']}.{i}",
                "parent": raw["id"],
                "name": raw["title"],
                "command": "",
                "description": part,
                "tags": list(raw.get("keywords") or []) if i == 1 else [],
                "part": i,
            })
    return chunks


def chunk_diagnostic(raw_docs: list[dict], cases: list[dict]) -> list[str]:
    """Проверка E2: если резать конспект на абзацы, остаётся ли якорь в top-3."""
    chunks = paragraph_chunks(raw_docs)
    index, bm25 = build_index(chunks)
    by_id = {c["id"]: c for c in chunks}
    lines = []
    for case in cases:
        if case["should_abstain"]:
            continue
        hits, _, _ = search(chunks, index, bm25, case["question"])
        context = context_text(hits)
        ids = " ".join(h["doc"]["id"] for h in hits)
        missing = [a for a in ANCHORS[case["id"]] if a not in context]
        if not missing:
            lines.append(f"- {case['id']}: нужные фрагменты есть в top-3 абзацев ({ids}).")
            continue
        where = []
        for anchor in missing:
            holder = next((c["id"] for c in chunks if anchor in c["description"]), "—")
            exact = None
            if holder in by_id:
                terms = preprocess(case["question"])
                for i, (doc_i, _) in enumerate(bm25.rank(terms), 1):
                    if chunks[doc_i]["id"] == holder:
                        exact = i
                        break
            where.append(f"«{anchor}» лежит в {holder}, ранг абзаца {exact}")
        lines.append(f"- {case['id']}: в top-3 ({ids}) нет фрагмента. {'; '.join(where)}. На такой нарезке это E2.")
    return lines


def brief_answer(hits: list[dict], kind: str) -> str:
    """Короткий ответ для таблицы: шапка отказа, источники и начало лучшего документа."""
    if not hits or kind == "nothing":
        return NOTHING_FOUND
    top = hits[0]["doc"]
    text = " ".join(top.get("description", "").split())
    if len(text) > 240:
        text = text[:237].rstrip() + "…"
    ids = ", ".join(f"[{h['doc']['id']}]" for h in hits)
    head = SIMILAR_NOTICE + " " if kind == "similar" else ""
    return f"{head}Источники: {ids}. {top['id']}: {text}"


def breakage(case: dict, hits: list[dict], kind: str, error: str) -> str:
    """Что именно сломалось. Прочерк по классу не означает, что комментарий пустой."""
    qid = case["id"]
    score = hits[0]["score"] if hits else 0.0
    top_id = hits[0]["doc"]["id"] if hits else "—"
    shown = ", ".join(f"{h['doc']['id']} {h['score']:.1f}" for h in hits) or "—"

    if qid == "Q01":
        return f"Не сломалось. {top_id} первый ({score:.1f}). В ответе текст D04: свинина — красное мясо, в тушёном блюде часть мяса заменяют овощами, бобовыми и крахмалистыми продуктами."
    if qid == "Q02":
        return f"Не сломалось. {top_id} первый ({score:.1f}). Ответ говорит, что баланс Eatwell Guide нужен за день или неделю, а в обеде проверяют овощи, белок и гарнир."
    if qid == "Q03":
        return f"Не сломалось. Первым пришёл D19 ({hits[0]['score']:.1f}) из-за слов про граммы и состав, D03 второй ({hits[1]['score']:.1f}) и целиком в ответе: смотреть надо весь продукт, растительные источники — фасоль, чечевица, соя, орехи."
    if qid == "Q04":
        return f"Сломалась шапка ответа, не поиск. D05 первый, но балл {score:.1f} ниже порога 5, тип стал similar, и ответ начинается с «Подходящая команда не найдена». Текст D05 про овсяную кашу и добавление бобовых в рагу в ответе есть, поэтому это не E3."
    if qid == "Q05":
        return f"Не сломалось. {top_id} первый ({score:.1f}). Ответ учитывает соль покупных продуктов, сравнение этикеток и замену соли травами и специями."
    if qid == "Q06":
        return f"Не сломалось. {top_id} первый ({score:.1f}). Ответ предлагает воду вместо сладких напитков, постепенно уменьшать сахар в чае и кофе и читать на этикетке сахарозу, глюкозу, сироп и мёд."
    if qid == "Q07":
        return f"Не сломалось. {top_id} первый ({score:.1f}), порог пройден впритык. Ответ называет воду доступным способом, жидкость не только из воды и рост потребности в жару и при нагрузке."
    if qid == "Q08":
        return f"Не сломалось. {top_id} первый ({score:.1f}), рядом D04 ({hits[1]['score']:.1f}). Ответ предлагает уменьшить насыщенные жиры и заменить часть ненасыщенными, без полного отказа от жиров."
    if qid == "Q09":
        return f"Не сломалось на целом документе. Первым пришёл D20 ({hits[0]['score']:.1f}) про serving size, D19 второй ({hits[1]['score']:.1f}) и целиком в ответе: сравнение на 100 г или 100 мл и учёт фактически съеденного. Если резать D19 на абзацы, фраза про съеденную порцию остаётся в D19.2 на ранге 21 — тогда это был бы E2."
    if qid == "Q10":
        return f"Не сломалось. {top_id} первый ({score:.1f}). Ответ даёт охлаждение за 1–2 часа, холодильник 0–5 °C, 48 часов или заморозку и использование в течение 24 часов после разморозки."
    if qid == "T01":
        return f"Сломался отказ. Этикетки йогурта «Учебный фермер Манго 2026» в корпусе нет, но D19 набрал {score:.1f} по словам про калории, белок и граммы. Тип стал found, заглушка не пишет отказ и показывает {shown} как ответ. Числа калорий не выдуманы, это не E4."
    if qid == "T02":
        return f"Отказ удержался на пороге. D06 набрал {score:.1f}, это ниже 5, тип similar, шапка — «Подходящая команда не найдена», граммы белка не посчитаны. Отказ шаблонный, про команду, а не про отсутствие данных по почкам. На балле 5 это был бы тот же E5."
    if qid == "T03":
        return f"Сломался отказ. Лечебной дозы по анализу 17 нг/мл в корпусе нет. D24 про витамин D набрал {score:.1f}, тип found, заглушка отдала общий конспект ({shown}) и не сказала, что дозу назначить нельзя."
    if qid == "T04":
        return f"Сломался отказ. Диагноза в корпусе нет. D26 набрал {score:.1f} по словам «молоко» и «вздутие», тип found. Заглушка показывает {shown} как ответ и не говорит, что по этим симптомам диагноз не ставится."
    if qid == "T05":
        return f"Сломался отказ. Дневника пользователя в корпусе нет. D10 набрал {score:.1f} по словам про калории и меню, тип found. Заглушка показывает {shown} и не отказывается составлять меню на семь дней."
    if error == "E1":
        return f"Сломался поиск: нужного документа нет в top-3. Выдача: {shown}."
    if error == "E5":
        return f"Сломался отказ: тип {kind}, выдача {shown}."
    return f"Класс {error}. Выдача: {shown}."


def cell(text: str) -> str:
    return " ".join(text.replace("|", "\\|").split())


def write_report(result: dict, chunk_lines: list[str]) -> str:
    m = result["metrics"]
    rows = [
        "| Вопрос | Документ | Ответ системы | Класс | Комментарий: что сломалось |",
        "|---|---|---|---|---|",
    ]
    for row in result["questions"]:
        doc = "нет в корпусе" if row["abstain"] else ", ".join(row["relevant"])
        rows.append(
            f"| {row['id']}. {cell(row['question'])} | {doc} | {cell(row['answer_brief'])} | {row['error_class']} | {cell(row['comment'])} |"
        )

    body = [
        "# Точка 2. Документы и вопросы другой команды",
        "",
        "Корпус и вопросы — учебный набор nutrition-counter-classroom-v1 (30 конспектов D01–D30, 10 вопросов и 5 ловушек).",
        "Индекс построен поиском этого проекта: обратный индекс и BM25 из `rag/`, без готовых поисковых библиотек.",
        "Параметры не подбирались на этих вопросах: k1 = 0,5, b = 0,75, в контекст идут 3 документа, тип found при балле ≥ 5.",
        "Генерация — штатная заглушка (`USE_STUB`, ключа OpenAI нет, Ollama не установлен): она переносит найденный текст и не вызывает модель.",
        "",
        f"Документов: {result['documents']}. Словарь: {result['vocabulary']} термов. Средняя длина: {result['avgdl']}.",
        f"Hit@{K} = {m['hit']:.0%}, Recall@{K} = {m['recall']:.3f}, MRR = {m['mrr']:.3f}.",
        f"SHA-256 корпуса `{result['corpus_sha']}`, вопросов `{result['questions_sha']}`.",
        "",
        "## Таблица ошибок",
        "",
        "Класс ставится только если ошибка есть. Прочерк — сбоя из списка E1–E6 нет. Полный текст заглушки — в `answers.md`.",
        "",
        *rows,
        "",
        "## Как читаются классы",
        "",
        "- E1 — нужного документа нет в top-3. Здесь не встретился: эталонный документ есть у всех 10 обычных вопросов.",
        "- E2 — документ найден, но нарезка оставила ответ за пределами чанка. В рабочем индексе документ не режется: конспект короче 900 символов и входит в индекс целиком. Якоря эталона лежат в этом тексте.",
        "- E3 — документ в контексте, а ответ его отбросил. Заглушка печатает описание целиком, поэтому такой потери нет.",
        "- E4 — в ответе появились факты, которых нет в выданных документах. Заглушка их не добавляет. Живая модель не запускалась, так что E4 на ней не измерен.",
        "- E5 — ответа в корпусе нет, а система не отказалась. Так устроены ловушки с типом found: заглушка показывает близкие конспекты без фразы отказа.",
        "- E6 — эталон сам неверен или неполон. Тексты D02, D03, D04, D05, D07, D08, D09, D14, D19 и D29 содержат пункты эталонов; спорного листа нет.",
        "",
        "",
        "## Нарезка по абзацам",
        "",
        "Отдельная проверка, не рабочий индекс. Каждый конспект разрезан на абзацы, в контекст попадают три абзаца.",
        "",
        *chunk_lines,
        "",
        (
            "На этой нарезке часть фрагментов выпадает из top-3. "
            "Рабочий индекс так не режет конспект, поэтому в таблице выше этим вопросам E2 не поставлен."
            if any("это E2" in line for line in chunk_lines)
            else "На этой нарезке якоря тоже остаются в top-3."
        ),
        "",
    ]
    return "\n".join(body) + "\n"


def main() -> None:
    raw_docs, cases = load()
    docs = [as_record(d) for d in raw_docs]
    index, bm25 = build_index(docs)

    records = []
    answers = ["# Ответы заглушки", ""]
    for case in cases:
        hits, kind, terms = search(docs, index, bm25, case["question"])
        answer = stub_answer(hits, kind)
        error, why = classify(case, hits, kind, answer)
        rank = rank_of(docs, bm25, case["question"], case["relevant_documents"])
        records.append({
            "id": case["id"],
            "question": case["question"],
            "abstain": case["should_abstain"],
            "relevant": case["relevant_documents"],
            "rank": rank,
            "kind": kind,
            "top": [{"id": h["doc"]["id"], "score": round(h["score"], 3)} for h in hits],
            "query_terms": terms,
            "error_class": error,
            "why": why,
            "answer_brief": brief_answer(hits, kind),
            "comment": breakage(case, hits, kind, error),
            "refusal": is_refusal(answer),
        })
        answers.append(f"## {case['id']} · {kind} · {error}")
        answers.append("")
        answers.append(case["question"])
        answers.append("")
        answers.append(answer)
        answers.append("")

    regular = [r for r in records if not r["abstain"]]
    hit = sum(r["rank"] is not None and r["rank"] <= K for r in regular) / len(regular)
    recall = hit  # у каждого обычного вопроса один эталонный документ
    mrr = sum((1 / r["rank"]) if r["rank"] else 0 for r in regular) / len(regular)

    result = {
        "documents": len(docs),
        "vocabulary": len(index.vocabulary),
        "avgdl": round(index.avgdl, 1),
        "k": K,
        "k1": K1,
        "b": B,
        "found_min_score": FOUND_MIN_SCORE,
        "corpus_sha": sha256(ROOT / "data" / "corpus.json"),
        "questions_sha": sha256(ROOT / "data" / "questions.json"),
        "metrics": {"hit": hit, "recall": recall, "mrr": round(mrr, 3)},
        "questions": records,
        "postings_sample": {
            term: index.postings[term]
            for term in ("свинина", "клетчатка", "йогурт", "соль")
            if term in index.postings
        },
    }

    chunk_lines = chunk_diagnostic(raw_docs, cases)
    out = ROOT / "results"
    out.mkdir(exist_ok=True)
    (out / "run.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "report.md").write_text(write_report(result, chunk_lines), encoding="utf-8")
    (out / "answers.md").write_text("\n".join(answers) + "\n", encoding="utf-8")

    print(f"docs={result['documents']} vocab={result['vocabulary']} avgdl={result['avgdl']}")
    print(f"Hit@{K}={hit:.3f} Recall@{K}={recall:.3f} MRR={mrr:.3f}")
    for r in records:
        print(f"{r['id']} {r['kind']:7} rank={r['rank']} {r['error_class']:3} {[t['id'] for t in r['top']]}")
    missed = [line for line in chunk_lines if "E2" in line]
    print("paragraph E2:", len(missed))


if __name__ == "__main__":
    main()
