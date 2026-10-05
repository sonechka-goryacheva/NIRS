"""
app/search.py

Поиск команд по корпусу через BM25.
Индекс строится по полям: command + description + tags + name.
"""

import json
import os
from rank_bm25 import BM25Okapi

CORPUS_DIR = "data/corpus"

CATEGORIES = [
    "linux", "mac", "git", "docker",
    "sql", "python", "network", "powershell",
]


def load_corpus(corpus_dir: str = CORPUS_DIR) -> list[dict]:
    """Загружает все JSON-файлы из data/corpus/ и объединяет в один список."""
    corpus = []
    if not os.path.isdir(corpus_dir):
        return corpus

    for fname in sorted(os.listdir(corpus_dir)):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(corpus_dir, fname)
        category = fname.replace(".json", "")
        with open(path, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError:
                continue
        for item in data:
            item.setdefault("category", category)
            corpus.append(item)

    return corpus


def tokenize(text: str) -> list[str]:
    """Приводит текст к нижнему регистру и разбивает на слова."""
    if not text:
        return []
    for ch in ".,:;!?()[]{}\"'`/\\|<>@#$%^&*+=~":
        text = text.replace(ch, " ")
    return [w for w in text.lower().split() if w]


def doc_to_text(doc: dict) -> str:
    """Собирает все поля записи в одну строку для индексации."""
    parts = [
        doc.get("name", ""),
        doc.get("command", ""),
        doc.get("description", ""),
        " ".join(doc.get("tags", [])),
    ]
    return " ".join(parts)


class Searcher:
    def __init__(self, corpus: list[dict]):
        self.corpus = corpus
        self.docs_text = [doc_to_text(d) for d in corpus]
        self.tokenized = [tokenize(t) for t in self.docs_text]
        self.bm25 = BM25Okapi(self.tokenized) if self.tokenized else None

    def search(
        self,
        query: str,
        top_k: int = 3,
        platform: str | None = None,
    ) -> list[dict]:
        """Возвращает top-k релевантных документов."""
        if not self.bm25 or not self.corpus:
            return []

        tokens = tokenize(query)
        scores = self.bm25.get_scores(tokens)

        ranked = sorted(
            zip(self.corpus, scores),
            key=lambda x: x[1],
            reverse=True,
        )

        results = []
        for doc, _score in ranked:
            if platform and doc.get("platform") not in (platform, "cross"):
                continue
            results.append(doc)
            if len(results) >= top_k:
                break

        return results


_searcher: Searcher | None = None


def get_searcher() -> Searcher:
    global _searcher
    if _searcher is None:
        _searcher = Searcher(load_corpus())
    return _searcher


def search(query: str, top_k: int = 3, platform: str | None = None) -> list[dict]:
    return get_searcher().search(query, top_k=top_k, platform=platform)


if __name__ == "__main__":
    s = get_searcher()
    print(f"Загружено команд: {len(s.corpus)}")
    for q in ["размер папки", "сделать файл исполняемым", "git статус"]:
        print(f"\nЗапрос: {q}")
        for d in s.search(q, top_k=3):
            print(f"  - {d.get('command')} ({d.get('name')})")
