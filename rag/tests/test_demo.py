"""Демо RAG и запуск скриптов одной командой."""
import subprocess
import sys
from pathlib import Path

from app import llm
from rag import SearchEngine
from rag.demo import run

ROOT = Path(__file__).resolve().parents[2]


def test_offtopic_does_not_call_llm(capsys, monkeypatch):
    def boom(*a, **kw):
        raise AssertionError("LLM не должна вызываться без найденных команд")

    monkeypatch.setattr(llm, "ask_llm", boom)
    run(SearchEngine(), "Как приготовить пасту?")
    out = capsys.readouterr().out
    assert "не найдено" in out and llm.NOTHING_FOUND in out and "Источники: нет" in out


def test_three_stages_and_sources(capsys):
    run(SearchEngine(), "откатить неудачный коммит")
    out = capsys.readouterr().out
    assert "1) Retrieval" in out and "2) Augmented" in out and "3) Generation" in out
    assert "[git-12] балл:" in out                       # ID и балл BM25
    assert "Пользователь спрашивает: откатить неудачный коммит" in out   # контекст подставлен в промпт
    assert "Источники:" in out and "data/corpus/git.json" in out


def test_scripts_run_as_files():
    for script in ("rag/evaluate.py", "rag/demo.py"):
        r = subprocess.run([sys.executable, script], cwd=ROOT, capture_output=True, text=True, timeout=60)
        assert r.returncode == 0, r.stderr
    r = subprocess.run([sys.executable, "rag/evaluate.py"], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert "Recall@3" in r.stdout and "MRR" in r.stdout and "не в top-3" in r.stdout
