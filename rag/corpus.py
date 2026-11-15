"""
Корпус: data/corpus/<категория>.json → список документов.

Документ (индексируемая единица) — одна команда справочника. id и category добавляются при загрузке:
id = "<категория>-<индекс в файле>", например "git-3" (spec/tech/corpus.md).
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORPUS_DIR = ROOT / "data" / "corpus"


def load_corpus(corpus_dir: Path | str = CORPUS_DIR) -> list[dict]:
    """Все файлы корпуса по алфавиту категорий; порядок документов внутри файла сохраняется."""
    corpus = []
    for path in sorted(Path(corpus_dir).glob("*.json")):
        category = path.stem
        with path.open(encoding="utf-8") as f:
            items = json.load(f)
        for i, item in enumerate(items):
            corpus.append({"id": f"{category}-{i}", "category": category, **item})
    return corpus


# Поля документа, из которых собирается индексируемый текст.
FIELDS = ("name", "command", "description", "tags", "examples")


def id_key(doc_id: str) -> tuple:
    """
    Ключ сортировки ID в естественном порядке: "docker-2" < "docker-10" (строковая сортировка дала бы обратное).
    Используется при равных баллах BM25.
    """
    head, _, tail = str(doc_id).rpartition("-")
    return (head, int(tail)) if tail.isdigit() else (str(doc_id), -1)


def field_text(doc: dict, field: str) -> str:
    value = doc.get(field, "")
    return " ".join(value) if isinstance(value, list) else str(value or "")
