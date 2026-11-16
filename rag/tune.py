"""
Перебор параметров поиска: `python -m rag tune` (результат сохранён в rag/results/tuning.txt).

Правило выбора: значения выбираются по РАБОЧЕМУ набору (rag/queries.json: 46 вопросов + ловушки по теме), контрольный набор
(rag/control/) показывается рядом только для проверки — по нему параметры не подбираются.

  1. k1 × b      — параметры BM25; критерий: Recall@3 + MRR на рабочем наборе;
  2. глубина k   — сколько документов попадает в выдачу и контекст LLM (Recall@k и Accuracy / CRR на контрольном наборе);
  3. пороги типа ответа (found / similar): критерий — доля обычных вопросов с ответом «найдено» и доля отклонённых ловушек,
     среднее двух долей (баланс «не отказывать зря» и «не выдумывать»).
"""

from __future__ import annotations

from dataclasses import replace

from .benchmark import load_control, run_benchmark
from .corpus import load_corpus
from .engine import Config, SearchEngine, answer_type
from .evaluate import evaluate, load_queries
from .metrics import mean, recall_at_k, reciprocal_rank


def _control_retrieval(engine, questions, k: int = 3) -> tuple[float, float]:
    reg = [q for q in questions if q["type"] == "regular"]
    ranked = [engine.ranked_ids(q["question"]) for q in reg]
    return (mean(recall_at_k(r, set(q["relevant"]), k) for r, q in zip(ranked, reg)),
            mean(reciprocal_rank(r, set(q["relevant"])) for r, q in zip(ranked, reg)))


def sweep_bm25(base: Config, work: list[dict], corpus, docs, questions) -> None:
    print("1. Параметры BM25: k1 × b (рабочий набор — выбор, контрольный — проверка)")
    print(f"   {'k1':<5}{'b':<6}| {'раб. R@3':>9}{'MRR':>7} | {'контр. R@3':>10}{'MRR':>7}")
    rows = []
    for k1 in (0.5, 0.9, 1.2, 1.5, 2.0):
        for b in (0.0, 0.25, 0.5, 0.75, 1.0):
            cfg = replace(base, k1=k1, b=b)
            rep = evaluate(SearchEngine(corpus, cfg), work)
            cr3, cmrr = _control_retrieval(SearchEngine(docs, cfg), questions)
            rows.append((rep.recall(3) + rep.mrr, k1, b, rep.recall(3), rep.mrr, cr3, cmrr))
    best = max(rows)
    for _, k1, b, r3, mrr, cr3, cmrr in rows:
        mark = "  ← выбрано" if (k1, b) == best[1:3] else ("  ← пример методички" if (k1, b) == (1.2, 0.75) else "")
        print(f"   {k1:<5}{b:<6}| {r3:>9.3f}{mrr:>7.3f} | {cr3:>10.3f}{cmrr:>7.3f}{mark}")


def sweep_depth(base: Config, work: list[dict], corpus) -> None:
    print("\n2. Глубина выдачи k (в контекст LLM попадают k документов; интерфейс показывает 3 команды)")
    rep = evaluate(SearchEngine(corpus, base), work, ks=(1, 3, 5, 10))
    print(f"   {'k':<4}{'раб. Recall@k':>14} | {'контр. Recall@k':>15}{'Accuracy':>10}{'CRR':>6}")
    for k in (1, 3, 5, 10):
        res = run_benchmark(k=k, stub=True)
        m = res["metrics"]
        print(f"   {k:<4}{rep.recall(k):>14.3f} | {m[f'recall@{k}']:>15.3f}{m['accuracy']:>10.3f}{m['correct_rejection_rate']:>6.3f}")


def sweep_thresholds(base: Config, data: dict, corpus, docs, questions) -> None:
    print("\n3. Пороги типа ответа: found, если BM25 лучшего документа ≥ T и он содержит ≥ C долей термов запроса")

    def features(engine, query):
        hits = engine.search(query, k=1)
        if not hits:
            return None
        n = len(set(engine.query_terms(query)))
        return hits[0].score, len({c.term for c in hits[0].contributions}) / n, hits[0].doc["id"]

    e_work, e_ctl = SearchEngine(corpus, base), SearchEngine(docs, base)
    pos = [(features(e_work, q["query"]), set(q["relevant"])) for q in data["queries"]]
    traps = [features(e_work, q) for q in data["traps"]]
    c_reg = [features(e_ctl, q["question"]) for q in questions if q["type"] == "regular"]
    c_trap = [features(e_ctl, q["question"]) for q in questions if q["type"] == "trap"]

    def found(f, cfg):
        return f is not None and answer_type(f[0], f[1], cfg) == "found"

    print(f"   {'T':<5}{'C':<6}| {'раб.: found':>11}{'верная 1-я':>11}{'ловушки отклонены':>18}{'баланс':>8} | {'контр.: found':>13}{'ловушки отклонены':>18}")
    rows = []
    for T in (0, 3, 4, 5, 6, 7, 8):
        for C in (0.0, 0.2, 0.34, 0.5):
            cfg = replace(base, found_min_score=T, found_min_coverage=C)
            fp = [(f, r) for f, r in pos if found(f, cfg)]
            share = len(fp) / len(pos)
            prec = sum(f[2] in r for f, r in fp) / len(fp) if fp else 0.0
            rej = sum(not found(f, cfg) for f in traps) / len(traps)
            rows.append(((share + rej) / 2, -C, T, C, share, prec, rej,
                         sum(found(f, cfg) for f in c_reg) / len(c_reg), sum(not found(f, cfg) for f in c_trap) / len(c_trap)))
    best = max(rows)
    for bal, _, T, C, share, prec, rej, cshare, crej in rows:
        mark = "  ← выбрано" if (T, C) == best[2:4] else ("  ← было до подбора" if (T, C) == (5, 0.5) else "")
        print(f"   {T:<5}{C:<6}| {share:>11.2f}{prec:>11.2f}{rej:>18.2f}{bal:>8.3f} | {cshare:>13.2f}{crej:>18.2f}{mark}")
    print("   (Критерий выбора — «баланс»; при равенстве предпочитается меньшее C. «верная 1-я» — доля found, где первая команда релевантна.)")


def main() -> None:
    base = Config()
    print(f"Текущая конфигурация: {base.describe()}, found: BM25 ≥ {base.found_min_score}, покрытие ≥ {base.found_min_coverage}\n")
    data = load_queries()
    corpus = load_corpus()
    docs, questions = load_control()
    sweep_bm25(base, data["queries"], corpus, docs, questions)
    sweep_depth(base, data["queries"], corpus)
    sweep_thresholds(base, data, corpus, docs, questions)
