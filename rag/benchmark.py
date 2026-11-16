"""
Контрольный бенчмарк КТ (слайды «RAG и BM25»), запускаемый в работающей системе.

Набор — rag/control/: 30 документов D01–D30, 10 обычных вопросов (≥ 3 релевантных документа, эталонный ответ,
ключевые элементы must_include) и 5 вопросов-ловушек (ответа в документах нет — ожидается отказ).
Набор зафиксирован до прогонов и не используется для подбора параметров (рабочий набор — rag/queries.json).

Четыре метрики:
  Recall@k и MRR       — поиск, только 10 обычных вопросов (ловушки в метрики поиска не входят);
  Accuracy             — доля полностью правильных ответов из 10: не отказ и содержит все элементы must_include;
  Correct Rejection Rate — доля корректных отказов из 5: ответ — отказ («Подходящая команда не найдена…»).

Запуск: `python -m rag benchmark` или из кода (так вызовет сервер):

    from rag import run_benchmark
    result = run_benchmark()                  # dict, сериализуется в JSON; result["metrics"] — 4 метрики
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path

from .engine import SearchEngine
from .metrics import mean, recall_at_k, reciprocal_rank

CONTROL_DIR = Path(__file__).resolve().parent / "control"

# Признаки отказа в тексте ответа (заглушка и LLM по промпту app/llm.py начинают ответ с первого).
REFUSAL_MARKS = (
    "подходящая команда не найдена",
    "в документах нет этой информации",
    "нет этой информации",
    "в контексте нет",
)


LLM_ERROR_MARK = "Не удалось получить ответ от нейросети"


def is_refusal(answer: str) -> bool:
    text = " ".join(answer.lower().split())
    return any(m in text for m in REFUSAL_MARKS)


def covers(text: str, must_include: list[str]) -> bool:
    """Текст содержит все ключевые элементы эталона (без учёта регистра и лишних пробелов)."""
    norm = " ".join(text.lower().split())
    return all(" ".join(m.lower().split()) in norm for m in must_include)


def load_control(control_dir: Path | str = CONTROL_DIR) -> tuple[list[dict], list[dict]]:
    control_dir = Path(control_dir)
    docs = json.loads((control_dir / "docs.json").read_text(encoding="utf-8"))
    questions = json.loads((control_dir / "questions.json").read_text(encoding="utf-8"))["questions"]
    return docs, questions


def _doc_text(doc: dict) -> str:
    return " ".join([doc.get("name", ""), doc.get("command", ""), doc.get("description", ""), *doc.get("examples", [])])


def run_benchmark(k: int = 3, stub: bool | None = None, ask=None, control_dir: Path | str = CONTROL_DIR) -> dict:
    """
    Прогон 15 вопросов: поиск → ответ → метрики. Блокирующий: заглушка — секунда, OpenAI — до ~30 с.

    k     — глубина выдачи для Recall@k и MRR@k (в контекст LLM попадает столько же документов);
    stub  — True: заглушка, False: настоящая LLM, None: как в .env (USE_STUB);
    ask   — своя функция ответа ask(question, engine, k) -> {"answer", "sources", "type"}
            (по умолчанию rag.pipeline.ask — тот же путь, что и в приложении).
    """
    from .pipeline import ask as pipeline_ask  # noqa: PLC0415

    t0, started = time.perf_counter(), datetime.now().astimezone()
    docs, questions = load_control(control_dir)
    engine = SearchEngine(corpus=docs)
    answer_fn = ask or (lambda q, e, kk: pipeline_ask(q, engine=e, k=kk, stub=stub))
    if ask is None:
        from app import llm  # noqa: PLC0415

        mode = "stub" if (llm.USE_STUB if stub is None else stub) else "openai"
        if mode == "openai" and not os.getenv("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY не задан: укажите ключ в .env или запустите с заглушкой (--llm stub)")
    else:
        mode = "custom"

    by_id = {d["id"]: d for d in docs}
    records = []
    for q in questions:
        reply = answer_fn(q["question"], engine, k)
        answer = reply["answer"]
        top = [s["id"] for s in reply["sources"]]
        rec = {
            "id": q["id"], "type": q["type"], "question": q["question"],
            "retrieved": reply["sources"], "answer_type": reply.get("type"), "answer": answer,
            "refusal": is_refusal(answer),
            "llm_error": answer.startswith(LLM_ERROR_MARK),  # LLM не ответила, app.llm выдал запасной вариант
        }
        if q["type"] == "regular":
            relevant = set(q["relevant"])
            ranked = engine.ranked_ids(q["question"])
            rec |= {
                "relevant": q["relevant"], "reference": q["reference"], "must_include": q["must_include"],
                # метрики поиска считаются по выдаче самого поиска и не зависят от функции ответа
                "recall": recall_at_k(ranked[:k], relevant, k),
                "rr": reciprocal_rank(ranked, relevant), "rr_at_k": reciprocal_rank(ranked, relevant, k),
            }
            in_context = covers(" ".join(_doc_text(by_id[i]) for i in top if i in by_id), q["must_include"])
            rec["correct"] = (not rec["refusal"]) and covers(answer, q["must_include"])
            # где потеряли нужную информацию (слайд «Где искать причину ошибки»)
            if rec["correct"]:
                rec["lost_at"] = None
            elif not in_context:
                rec["lost_at"] = "поиск: нужная команда не попала в top-k"
            elif rec["refusal"]:
                rec["lost_at"] = "тип ответа: команда найдена, но поиск счёл совпадение неуверенным (отказ с подсказками)"
            else:
                rec["lost_at"] = "ответ: команда была в контексте, в ответе её нет"
        else:
            rec["correct"] = rec["refusal"]
            rec["lost_at"] = None if rec["correct"] else "ответ: вместо отказа выдан ответ по найденным командам"
        records.append(rec)

    regular = [r for r in records if r["type"] == "regular"]
    traps = [r for r in records if r["type"] == "trap"]
    return {
        "started_at": started.isoformat(timespec="seconds"),
        "duration_s": round(time.perf_counter() - t0, 2),
        "mode": mode, "k": k, "config": engine.config.describe(),
        "llm_errors": sum(r["llm_error"] for r in records),
        "corpus": {"documents": len(docs), "regular": len(regular), "traps": len(traps)},
        "metrics": {
            f"recall@{k}": round(mean(r["recall"] for r in regular), 3),
            "mrr": round(mean(r["rr"] for r in regular), 3),
            f"mrr@{k}": round(mean(r["rr_at_k"] for r in regular), 3),
            "accuracy": round(mean(r["correct"] for r in regular), 3),
            "correct_rejection_rate": round(mean(r["correct"] for r in traps), 3),
        },
        "questions": records,
    }


def format_report(result: dict, details: bool = True) -> str:
    """Отчёт в Markdown: метрики, таблица по вопросам и разбор ошибок."""
    m, k, c = result["metrics"], result["k"], result["corpus"]
    n_reg, n_trap = c["regular"], c["traps"]
    ok_reg = sum(r["correct"] for r in result["questions"] if r["type"] == "regular")
    ok_trap = sum(r["correct"] for r in result["questions"] if r["type"] == "trap")
    mode = {"stub": "заглушка (без LLM)", "openai": "OpenAI", "custom": "своя функция ответа"}[result["mode"]]
    out = [
        "# Контрольный бенчмарк", "",
        f"Запуск: {result['started_at']} · {result['duration_s']} с · LLM: {mode} · k = {k}",
        f"Корпус: {c['documents']} документов D01–D{c['documents']:02d}, вопросов: {n_reg} обычных + {n_trap} ловушек",
        f"Поиск: {result['config']}",
        *([f"⚠ LLM не ответила на {result['llm_errors']} вопросов — метрики ответов получены по запасному варианту"] if result["llm_errors"] else []),
        "",
        "| Метрика | Значение | Что считаем |", "|---|---|---|",
        f"| Recall@{k} | **{m[f'recall@{k}']:.3f}** | доля релевантных документов в top-{k}, {n_reg} обычных вопросов |",
        f"| MRR | **{m['mrr']:.3f}** | средний 1 / ранг первого релевантного (вся выдача); MRR@{k} = {m[f'mrr@{k}']:.3f} |",
        f"| Accuracy | **{m['accuracy']:.3f}** | {ok_reg} из {n_reg}: не отказ и в ответе есть все ключевые элементы эталона |",
        f"| Correct Rejection Rate | **{m['correct_rejection_rate']:.3f}** | {ok_trap} из {n_trap}: на ловушку дан отказ |", "",
    ]
    if details:
        out += ["## По вопросам", "", f"| № | Вопрос | top-{k} | Recall | RR | Ответ | Итог |", "|---|---|---|---|---|---|---|"]
        for r in result["questions"]:
            ids = " ".join(s["id"] for s in r["retrieved"]) or "—"
            kind = {"found": "найдено", "similar": "отказ+подсказки", "nothing": "отказ"}.get(r["answer_type"], r["answer_type"] or "—")
            if r["type"] == "regular":
                out.append(f"| {r['id']} | {r['question']} | {ids} | {r['recall']:.2f} | {r['rr']:.2f} | {kind} | {'✓' if r['correct'] else '✗'} |")
            else:
                out.append(f"| {r['id']} | {r['question']} | {ids} | — | — | {kind} | {'✓ отказ' if r['correct'] else '✗ ответил'} |")
        errors = [r for r in result["questions"] if not r["correct"]]
        out += ["", "## Разбор ошибок", ""]
        if not errors:
            out.append("Ошибок нет.")
        for r in errors:
            out.append(f"- **{r['id']}** «{r['question']}» — {r['lost_at']}.")
    return "\n".join(out) + "\n"
