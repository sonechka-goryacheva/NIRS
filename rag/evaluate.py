"""
Бенчмарк поиска: тестовый набор rag/queries.json → Recall@k, MRR, покрытие корпуса,
сравнение вариантов предобработки и параметров BM25.

Запуск одной командой из корня репозитория (сводка + разбор по каждому вопросу):

    python rag/evaluate.py                 # то же, что python -m rag eval --details
    python rag/evaluate.py --compare       # + сравнение вариантов и сетка k1 × b
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from pathlib import Path

if __package__ in (None, ""):  # запуск файлом: python rag/evaluate.py
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag.engine import Config, SearchEngine
from rag.metrics import first_relevant_rank, mean, recall_at_k, reciprocal_rank
from rag.text import TextConfig

QUERIES_FILE = Path(__file__).resolve().parent / "queries.json"
KS = (1, 3, 5, 10)


def load_queries(path: Path | str = QUERIES_FILE) -> dict:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for q in data["queries"]:
        if len(q["relevant"]) < 3:
            raise ValueError(f"{q['id']}: нужно не меньше 3 релевантных документов")
    return data


@dataclass
class QueryResult:
    id: str
    topic: str
    query: str
    relevant: list[str]
    ranked: list[str]
    recall: dict
    rr: float
    first_rank: int | None


@dataclass
class Report:
    config: Config
    results: list[QueryResult]

    def recall(self, k: int) -> float:
        return mean(r.recall[k] for r in self.results)

    def recall_bound(self, k: int) -> float:
        """Максимально возможный Recall@k: в top-k помещается не больше k релевантных из |R|."""
        return mean(min(k, len(r.relevant)) / len(r.relevant) for r in self.results)

    @property
    def mrr(self) -> float:
        return mean(r.rr for r in self.results)

    def mrr_at(self, k: int) -> float:
        """MRR по top-k: первый релевантный ниже k-й позиции даёт 0."""
        return mean((1 / r.first_rank) if r.first_rank and r.first_rank <= k else 0.0 for r in self.results)

    def by_topic(self) -> dict[str, dict]:
        groups = defaultdict(list)
        for r in self.results:
            groups[r.topic].append(r)
        return {t: {"n": len(rs), "recall3": mean(r.recall[3] for r in rs), "recall5": mean(r.recall[5] for r in rs),
                    "mrr": mean(r.rr for r in rs),
                    "mrr3": mean((1 / r.first_rank) if r.first_rank and r.first_rank <= 3 else 0.0 for r in rs)}
                for t, rs in groups.items()}


def evaluate(engine: SearchEngine, queries: list[dict], ks=KS) -> Report:
    results = []
    known = {d["id"] for d in engine.corpus}
    for q in queries:
        rel = set(q["relevant"])
        missing = rel - known
        if missing:
            raise ValueError(f"{q['id']}: нет в корпусе {sorted(missing)}")
        ranked = engine.ranked_ids(q["query"])
        results.append(QueryResult(q["id"], q["topic"], q["query"], q["relevant"], ranked,
                                   {k: recall_at_k(ranked, rel, k) for k in ks},
                                   reciprocal_rank(ranked, rel), first_relevant_rank(ranked, rel)))
    return Report(engine.config, results)


def coverage(corpus: list[dict], queries: list[dict]) -> dict:
    """Насколько равномерно тестовый набор покрывает корпус: доля команд каждой категории, попавших в relevant."""
    relevant = {d for q in queries for d in q["relevant"]}
    total, covered = Counter(), Counter()
    for d in corpus:
        total[d["category"]] += 1
        covered[d["category"]] += d["id"] in relevant
    per_q = Counter(len(q["relevant"]) for q in queries)
    return {"categories": {c: (covered[c], total[c]) for c in sorted(total)},
            "covered": len(relevant), "total": len(corpus), "relevant_per_query": dict(sorted(per_q.items()))}


# Варианты для сравнения (REPORT.md, раздел 4): каждый меняет один фактор относительно выбранной конфигурации.
def variants(base: Config) -> list[tuple[str, Config]]:
    w = base.weights
    return [
        ("Выбранная конфигурация", base),
        ("Без лемматизации", replace(base, text=TextConfig(lemmatize=False, stopwords=base.text.stopwords))),
        ("Без стоп-слов", replace(base, text=TextConfig(lemmatize=base.text.lemmatize, stopwords=False))),
        ("Без лемматизации и стоп-слов (как было в app/search.py)", replace(base, text=TextConfig(False, False))),
        ("Название ×2", replace(base, weights={**w, "name": 2})),
        ("Без тегов", replace(base, weights={**w, "tags": 0})),
        ("+ примеры применения", replace(base, weights={**w, "examples": 1})),
        ("b = 0 (без нормализации длины)", replace(base, b=0.0)),
        ("b = 1 (полная нормализация)", replace(base, b=1.0)),
        ("k1 = 1.2 (значение из примера методички)", replace(base, k1=1.2)),
        ("k1 = 2.0", replace(base, k1=2.0)),
    ]


def grid(corpus, queries, base: Config, k1s=(0.5, 0.9, 1.2, 1.5, 2.0), bs=(0.0, 0.25, 0.5, 0.75, 1.0)) -> dict:
    out = {}
    for k1 in k1s:
        for b in bs:
            rep = evaluate(SearchEngine(corpus, replace(base, k1=k1, b=b)), queries)
            out[(k1, b)] = (rep.recall(3), rep.recall(5), rep.mrr)
    return out


def negatives(engine: SearchEngine, data: dict) -> dict:
    """Типы ответа: не по теме → nothing; по теме → не nothing."""
    neg = {q: engine.answer(q)["type"] for q in data.get("negative", [])}
    traps = {q: engine.answer(q)["type"] for q in data.get("traps", [])}
    pos = Counter(engine.answer(q["query"])["type"] for q in data["queries"])
    return {"negative": neg, "traps": traps, "positive_types": dict(pos)}


if __name__ == "__main__":
    from rag.__main__ import main

    sys.exit(main(["eval", "--details", *sys.argv[1:]]))
