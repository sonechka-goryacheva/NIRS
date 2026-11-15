"""
app/search.py

Поиск команд для приложения — тонкая обёртка над rag/ (собственный индекс BM25, см. rag/README.md).
Интерфейс прежний: search(query, top_k, platform) → список команд, поэтому app/ui.py и app/llm.py не меняются.
"""

from __future__ import annotations

from rag import SearchEngine
from rag.corpus import load_corpus  # noqa: F401 — реэкспорт для обратной совместимости

_engine: SearchEngine | None = None


class Searcher:
    """Поиск по переданному корпусу (используется в тестах и при обновлении датасета администратором)."""

    def __init__(self, corpus: list[dict]):
        self.engine = SearchEngine(corpus)
        self.corpus = self.engine.corpus

    def search(self, query: str, top_k: int = 3, platform: str | None = None) -> list[dict]:
        return [h.doc for h in self.engine.search(query, k=top_k, platform=platform)]

    def answer(self, query: str, top_k: int = 3) -> dict:
        """Тип ответа для чата (found / similar / nothing) и команды — spec/tech/rag.md."""
        a = self.engine.answer(query, k=top_k)
        return {"type": a["type"], "commands": [h.doc for h in a["hits"]]}


def get_engine() -> SearchEngine:
    """Индекс строится при первом запросе и пересчитывается сам, если файлы data/corpus изменились."""
    global _engine
    if _engine is None or _engine.is_stale():
        _engine = SearchEngine()
    return _engine


def reload() -> None:
    """Принудительно пересобрать индекс (обычно не нужно: get_engine() замечает изменения файлов сам)."""
    global _engine
    _engine = None


def search(query: str, top_k: int = 3, platform: str | None = None) -> list[dict]:
    return [h.doc for h in get_engine().search(query, k=top_k, platform=platform)]


if __name__ == "__main__":
    e = get_engine()
    print(f"Загружено команд: {len(e.corpus)}")
    for q in ["размер папки", "сделать файл исполняемым", "git статус"]:
        print(f"\nЗапрос: {q}")
        for d in search(q, top_k=3):
            print(f"  - {d.get('command')} ({d.get('name')})")
