"""
Поисковая система справочника: корпус → предобработка → обратный индекс → BM25 → top-k.

    from rag import SearchEngine
    engine = SearchEngine()                       # корпус data/corpus, настройки по умолчанию
    for hit in engine.search("не хватает прав на скрипт", k=3):
        print(hit.doc["command"], round(hit.score, 2))
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .bm25 import BM25, Contribution, InvertedIndex
from .corpus import CORPUS_DIR, FIELDS, field_text, id_key, load_corpus
from .text import TextConfig, preprocess, trace


@dataclass(frozen=True)
class Config:
    """
    Параметры поиска. Значения по умолчанию выбраны экспериментально (rag/REPORT.md, раздел 4).

    weights — вес поля: сколько раз его термы входят в документ (0 — поле не индексируется).
    Повтор поля — простой способ поднять его TF без изменения формулы BM25.
    """

    k1: float = 1.2
    b: float = 0.75
    text: TextConfig = TextConfig()
    weights: dict = field(default_factory=lambda: {"name": 1, "command": 1, "description": 1, "tags": 1, "examples": 0})

    def describe(self) -> str:
        w = ", ".join(f"{f}×{n}" for f, n in self.weights.items() if n)
        return (f"k1={self.k1}, b={self.b}, лемматизация={'да' if self.text.lemmatize else 'нет'}, "
                f"стоп-слова={'да' if self.text.stopwords else 'нет'}, поля: {w}")


@dataclass
class Hit:
    rank: int
    doc: dict
    score: float
    contributions: list[Contribution]


# Тип ответа для чата (spec/tech/api.md, «Правила ответа»): found / similar / nothing.
FOUND_MIN_COVERAGE = 0.5   # лучший документ содержит не меньше половины термов запроса
FOUND_MIN_SCORE = 5.0      # и его оценка BM25 не ниже порога (REPORT.md, раздел 6)


def corpus_signature(corpus_dir) -> tuple:
    """Отпечаток файлов корпуса: имя, размер, время изменения. Меняется при любой правке датасета."""
    from pathlib import Path  # noqa: PLC0415

    return tuple((p.name, p.stat().st_size, p.stat().st_mtime_ns) for p in sorted(Path(corpus_dir).glob("*.json")))


class SearchEngine:
    def __init__(self, corpus: list[dict] | None = None, config: Config = Config(), corpus_dir=CORPUS_DIR):
        """corpus=None — загрузить корпус из corpus_dir и следить за изменением его файлов (is_stale)."""
        self.config = config
        self.corpus_dir = corpus_dir if corpus is None else None
        self.signature = corpus_signature(corpus_dir) if corpus is None else None
        self.corpus = load_corpus(corpus_dir) if corpus is None else corpus
        self.docs_terms = [self.doc_terms(d) for d in self.corpus]
        self.index = InvertedIndex(self.docs_terms)
        self.bm25 = BM25(self.index, k1=config.k1, b=config.b)
        # при равных баллах — по ID в естественном порядке (категория, номер)
        self.tie_keys = [id_key(d.get("id", i)) for i, d in enumerate(self.corpus)]

    def is_stale(self) -> bool:
        """Файлы корпуса изменились после построения индекса (правка администратора, новый датасет)."""
        return self.corpus_dir is not None and corpus_signature(self.corpus_dir) != self.signature

    def doc_terms(self, doc: dict) -> list[str]:
        terms: list[str] = []
        for f in FIELDS:
            n = self.config.weights.get(f, 0)
            if n:
                terms += preprocess(field_text(doc, f), self.config.text) * n
        return terms

    def query_terms(self, query: str) -> list[str]:
        return preprocess(query, self.config.text)

    def search(self, query: str, k: int = 3, platform: str | None = None) -> list[Hit]:
        """Top-k документов по BM25. platform — оставить только команды этой платформы (и cross)."""
        q = self.query_terms(query)
        hits = []
        for doc_id, score in self.bm25.rank(q, tie_keys=self.tie_keys):
            doc = self.corpus[doc_id]
            if platform and doc.get("platform") not in (platform, "cross"):
                continue
            hits.append(Hit(len(hits) + 1, doc, score, self.bm25.explain(q, doc_id)))
            if len(hits) >= k:
                break
        return hits

    def ranked_ids(self, query: str) -> list[str]:
        """Все найденные документы по порядку — для метрик."""
        return [self.corpus[i]["id"] for i, _ in self.bm25.rank(self.query_terms(query), tie_keys=self.tie_keys)]

    def answer(self, query: str, k: int = 3) -> dict:
        """
        Решение для чата:
          found   — уверенное совпадение: лучшая команда + до 2 похожих;
          similar — совпали только отдельные слова: до 3 вариантов;
          nothing — ни один терм запроса не встречается в корпусе (бессмыслица, тема не про IT).
        """
        q = set(self.query_terms(query))
        hits = self.search(query, k=k)
        if not hits:
            return {"type": "nothing", "hits": []}
        top = hits[0]
        coverage = len({c.term for c in top.contributions}) / len(q)
        if coverage >= FOUND_MIN_COVERAGE and top.score >= FOUND_MIN_SCORE:
            return {"type": "found", "hits": hits}
        return {"type": "similar", "hits": hits}

    def trace(self, query: str):
        return trace(query, self.config.text)
