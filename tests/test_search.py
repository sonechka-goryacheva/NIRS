"""
tests/test_search.py

Базовые тесты поиска.
"""

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.search import Searcher

TEST_CORPUS = [
    {
        "name": "Размер папки",
        "command": "du -sh <path>",
        "description": "размер папки",
        "tags": ["linux", "disk", "размер", "папка"],
        "examples": ["du -sh /var/log"],
        "platform": "unix",
    },
    {
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


def test_empty_query():
    s = Searcher(TEST_CORPUS)
    results = s.search("", top_k=3)
    assert len(results) == 3
