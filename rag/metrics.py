"""
Метрики качества поиска (методичка, раздел 1.5).

  Recall@k = 1/|Q| · Σ |R_q ∩ Top_k(q)| / |R_q|
  MRR      = 1/|Q| · Σ 1 / rank_q,   rank_q — позиция первого релевантного документа
             (если релевантных в выдаче нет — вклад запроса 0).
  MRR@k    — то же, но учитывается только top-k: первый релевантный ниже k-й позиции даёт 0
             (так MRR считают для выдачи фиксированной глубины; в отчёте приводятся оба значения).
"""

from __future__ import annotations


def recall_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        raise ValueError("у запроса нет релевантных документов")
    return len(relevant & set(ranked[:k])) / len(relevant)


def reciprocal_rank(ranked: list[str], relevant: set[str], k: int | None = None) -> float:
    """1 / позиция первого релевантного; k — глубина выдачи (None — вся выдача)."""
    for pos, doc_id in enumerate(ranked[:k] if k else ranked, start=1):
        if doc_id in relevant:
            return 1 / pos
    return 0.0


def first_relevant_rank(ranked: list[str], relevant: set[str]) -> int | None:
    for pos, doc_id in enumerate(ranked, start=1):
        if doc_id in relevant:
            return pos
    return None


def mean(values) -> float:
    values = list(values)
    return sum(values) / len(values) if values else 0.0
