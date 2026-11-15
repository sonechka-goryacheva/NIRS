"""Поиск по настоящему корпусу и тестовый набор."""
import pytest

from rag import SearchEngine
from rag.evaluate import coverage, evaluate, load_queries


@pytest.fixture(scope="module")
def engine():
    return SearchEngine()


def test_queries_have_at_least_three_relevant(engine):
    data = load_queries()
    ids = {d["id"] for d in engine.corpus}
    for q in data["queries"]:
        assert len(q["relevant"]) >= 3
        assert set(q["relevant"]) <= ids


def test_every_category_covered(engine):
    cov = coverage(engine.corpus, load_queries()["queries"])
    assert all(a / b >= 0.6 for a, b in cov["categories"].values())


def test_metrics_do_not_degrade(engine):
    rep = evaluate(engine, load_queries()["queries"])
    assert rep.mrr >= 0.7 and rep.recall(5) >= 0.5


def test_known_queries(engine):
    # Сценарий 1 spec/product/scenarios.md
    # (верны и chmod для Linux/macOS, и Set-ExecutionPolicy для Windows)
    top3 = [h.doc["id"] for h in engine.search("не хватает прав при запуске скрипта", k=3)]
    assert {"linux-13", "powershell-17"} <= set(top3)
    # Здесь первым идёт which: в его описании дословно «исполняемому файлу» (ограничение лексического поиска, REPORT.md)
    assert "linux-13" in [h.doc["id"] for h in engine.search("сделать файл исполняемым", k=3)]
    assert engine.search("что делает du -sh", k=1)[0].doc["id"] == "linux-16"


def test_answer_types(engine):
    assert engine.answer("кракозябра")["type"] == "nothing"
    assert engine.answer("")["type"] == "nothing"
    assert engine.answer("посмотреть запущенные контейнеры")["type"] == "found"


def test_platform_filter(engine):
    hits = engine.search("список процессов", k=5, platform="windows")
    assert hits and all(h.doc["platform"] in ("windows", "cross") for h in hits)


def test_ties_ordered_by_id():
    from rag.corpus import id_key
    corpus = [{"id": f"docker-{i}", "name": "одинаковый", "command": "x", "description": "", "tags": []} for i in (10, 2, 1)]
    e = SearchEngine(corpus)
    assert [h.doc["id"] for h in e.search("одинаковый", k=3)] == ["docker-1", "docker-2", "docker-10"]
    assert id_key("docker-2") < id_key("docker-10")


def test_index_rebuilds_when_corpus_changes(tmp_path):
    import json, os, time
    f = tmp_path / "linux.json"
    f.write_text(json.dumps([{"name": "Размер папки", "command": "du -sh", "description": "", "tags": ["размер"]}]), encoding="utf-8")
    e = SearchEngine(corpus_dir=tmp_path)
    assert not e.is_stale()
    time.sleep(0.01)
    f.write_text(json.dumps([{"name": "Свободное место", "command": "df -h", "description": "", "tags": ["место"]}]), encoding="utf-8")
    os.utime(f, None)
    assert e.is_stale()
