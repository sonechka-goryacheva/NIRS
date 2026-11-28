"""
Собственная реализация поискового индекса и ранжирования BM25 (без готовых поисковых библиотек).

Обозначения — как в методичке (разделы 1.3–1.5):
  TF(t, d)  — число вхождений терма t в документ d;
  DF(t)     — число документов, где встречается t;
  IDF(t)    = ln(1 + (N − DF(t) + 0.5) / (DF(t) + 0.5));
  BM25(q,d) = Σ_{t∈q} IDF(t) · TF(t,d)·(k1+1) / (TF(t,d) + k1·(1 − b + b·|d|/avgdl)).
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass


@dataclass(frozen=True)
class Contribution:
    """Вклад одного терма запроса в оценку документа — для объяснения ранжирования."""

    term: str
    tf: int
    idf: float
    score: float


class InvertedIndex:
    """
    Обратный индекс: терм → {номер документа: TF}.
    Хранит длины документов |d| и среднюю длину avgdl — всё, что нужно для BM25.
    """

    def __init__(self, docs_terms: list[list[str]]):
        self.n_docs = len(docs_terms)
        self.postings: dict[str, dict[int, int]] = {}
        self.doc_len: list[int] = []
        for doc_id, terms in enumerate(docs_terms):
            self.doc_len.append(len(terms))
            for term, tf in Counter(terms).items():
                self.postings.setdefault(term, {})[doc_id] = tf
        self.avgdl = (sum(self.doc_len) / self.n_docs) if self.n_docs else 0.0

    @property
    def vocabulary(self) -> list[str]:
        """Словарь корпуса V = {t1, …, tm} (термы по алфавиту)."""
        return sorted(self.postings)

    def df(self, term: str) -> int:
        return len(self.postings.get(term, ()))

    def tf(self, term: str, doc_id: int) -> int:
        return self.postings.get(term, {}).get(doc_id, 0)

    def idf(self, term: str) -> float:
        """Модифицированный IDF из BM25 (всегда > 0, в отличие от «классического» Okapi-варианта)."""
        df = self.df(term)
        return math.log(1 + (self.n_docs - df + 0.5) / (df + 0.5))

    def doc_vector(self, doc_id: int) -> dict[str, int]:
        """Разреженный вектор документа: только ненулевые координаты (терм → TF)."""
        return {t: p[doc_id] for t, p in self.postings.items() if doc_id in p}


class BM25:
    """Ранжирование документов индекса функцией BM25."""

    def __init__(self, index: InvertedIndex, k1: float = 1.5, b: float = 0.75):
        if k1 < 0 or not 0 <= b <= 1:
            raise ValueError("k1 ≥ 0, 0 ≤ b ≤ 1")
        self.index, self.k1, self.b = index, k1, b

    def term_score(self, term: str, doc_id: int) -> float:
        """Слагаемое BM25 для одного терма запроса."""
        ix = self.index
        tf = ix.tf(term, doc_id)
        if not tf:
            return 0.0
        norm = 1 - self.b + self.b * ix.doc_len[doc_id] / ix.avgdl
        return ix.idf(term) * tf * (self.k1 + 1) / (tf + self.k1 * norm)

    def scores(self, query_terms: list[str]) -> dict[int, float]:
        """
        Оценки только для документов, где встретился хотя бы один терм запроса
        (обход списков документов индекса, а не всего корпуса).
        Запрос — кортеж термов: повтор терма в запросе учитывается повторно, как в формуле.
        """
        acc: dict[int, float] = {}
        for term in query_terms:
            for doc_id in self.index.postings.get(term, ()):
                acc[doc_id] = acc.get(doc_id, 0.0) + self.term_score(term, doc_id)
        return acc

    def rank(self, query_terms: list[str], k: int | None = None, tie_keys: list | None = None) -> list[tuple[int, float]]:
        """
        Документы по невозрастанию BM25. При равных баллах — по tie_keys[doc_id]
        (поисковая система передаёт ключ ID документа), без него — по номеру документа.
        """
        key = (lambda x: (-x[1], tie_keys[x[0]])) if tie_keys else (lambda x: (-x[1], x[0]))
        ranked = sorted(self.scores(query_terms).items(), key=key)
        return ranked[:k] if k else ranked

    def explain(self, query_terms: list[str], doc_id: int) -> list[Contribution]:
        """Из каких слагаемых сложилась оценка документа."""
        out = []
        for term in dict.fromkeys(query_terms):  # уникальные, в порядке запроса
            tf = self.index.tf(term, doc_id)
            if tf:
                mult = query_terms.count(term)
                out.append(Contribution(term, tf, self.index.idf(term), mult * self.term_score(term, doc_id)))
        return out
