"""
tests/test_search.py

Тесты обёртки app/search.py (сам поиск и метрики — rag/tests/).
"""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.search import Searcher, search  # noqa: E402

TEST_CORPUS = [
    {
        "id": "linux-0",
        "name": "Размер папки",
        "command": "du -sh <path>",
        "description": "размер папки",
        "tags": ["linux", "disk", "размер", "папка"],
        "examples": ["du -sh /var/log"],
        "platform": "unix",
    },
    {
        "id": "git-0",
        "name": "Статус git",
        "command": "git status",
        "description": "статус репозитория",
        "tags": ["git", "статус", "репозиторий"],
        "examples": ["git status"],
        "platform": "cross",
    },
]


def test_search_finds_du():
    s = Searcher(TEST_CORPUS)
    results = s.search("размер папки", top_k=1)
    assert results[0]["command"] == "du -sh <path>"


def test_search_finds_git():
    s = Searcher(TEST_CORPUS)
    results = s.search("статус репозитория", top_k=1)
    assert results[0]["command"] == "git status"


def test_word_forms_match():
    # лемматизация: «папок» и «папка» — один терм
    assert Searcher(TEST_CORPUS).search("размеры папок", top_k=1)[0]["command"] == "du -sh <path>"


def test_empty_query():
    # Пустой запрос — пустой ответ (раньше тест ожидал 3 случайные команды, что противоречило spec/tech/api.md)
    assert Searcher(TEST_CORPUS).search("", top_k=3) == []


def test_answer_nothing_for_offtopic():
    assert Searcher(TEST_CORPUS).answer("рецепт борща")["type"] == "nothing"


def test_real_corpus():
    assert search("посмотреть запущенные контейнеры", top_k=1)[0]["command"] == "docker ps"


def test_llm_does_not_invent_when_nothing_found():
    from app.llm import NOTHING_FOUND, ask_llm

    assert search("Как сварить борщ?") == []
    assert ask_llm("Как сварить борщ?", []) == NOTHING_FOUND
