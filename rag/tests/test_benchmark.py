"""Контрольный набор и бенчмарк в рантайме: структура набора по слайдам КТ, подсчёт четырёх метрик, вызов из кода и CLI."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from rag.benchmark import covers, format_report, is_refusal, load_control, run_benchmark
from rag.pipeline import ask

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def control():
    return load_control()


def test_control_set_shape(control):
    docs, questions = control
    assert [d["id"] for d in docs] == [f"D{i:02d}" for i in range(1, 31)]
    regular = [q for q in questions if q["type"] == "regular"]
    traps = [q for q in questions if q["type"] == "trap"]
    assert (len(regular), len(traps)) == (10, 5)


def test_regular_questions_are_labelled(control):
    docs, questions = control
    by_id = {d["id"]: d for d in docs}
    for q in (q for q in questions if q["type"] == "regular"):
        assert len(q["relevant"]) >= 3 and set(q["relevant"]) <= set(by_id), q["id"]
        assert q["reference"].strip() and q["must_include"], q["id"]
        text = " ".join(by_id[i]["command"] + " " + by_id[i]["description"] + " " + " ".join(by_id[i]["examples"]) for i in q["relevant"])
        assert covers(text, q["must_include"]), f"{q['id']}: ключевые элементы эталона не встречаются в релевантных документах"


def test_refusal_and_covers():
    assert is_refusal("Подходящая команда не найдена. Попробуйте описать задачу другими словами.")
    assert is_refusal("В документах нет этой информации.")
    assert not is_refusal("1. Откат коммита\n2. Команда: git revert <commit>")
    assert covers("Команда:  GIT   revert <commit>", ["git revert"]) and not covers("git reset", ["git revert"])


def test_benchmark_runs_on_stub_and_is_deterministic():
    a, b = run_benchmark(stub=True), run_benchmark(stub=True)
    assert a["metrics"] == b["metrics"] and a["mode"] == "stub"
    assert set(a["metrics"]) == {"recall@3", "mrr", "mrr@3", "accuracy", "correct_rejection_rate"}
    assert all(0 <= v <= 1 for v in a["metrics"].values())
    assert len(a["questions"]) == 15 and json.dumps(a)  # результат сериализуется в JSON (для ответа сервера)


def test_perfect_answers_give_top_answer_scores(control):
    docs, questions = control
    by_q = {q["question"]: q for q in questions}

    def perfect(question, engine, k):
        q = by_q[question]
        if q["type"] == "trap":
            return {"answer": "В документах нет этой информации.", "sources": [], "type": "nothing"}
        return {"answer": q["reference"] + " " + " ".join(q["must_include"]),
                "sources": [{"id": i} for i in q["relevant"][:k]], "type": "found"}

    m = run_benchmark(ask=perfect)["metrics"]
    assert m["accuracy"] == m["correct_rejection_rate"] == 1.0


def test_wrong_answers_give_zero(control):
    docs, questions = control
    by_q = {q["question"]: q for q in questions}

    def wrong(question, engine, k):
        # отвечает на всё, даже на ловушки; нужных документов в выдаче нет
        other = [d["id"] for d in docs if d["id"] not in by_q[question].get("relevant", [])][:k]
        return {"answer": "Попробуйте команду reboot.", "sources": [{"id": i} for i in other], "type": "found"}

    m = run_benchmark(ask=wrong)["metrics"]
    assert m["accuracy"] == 0.0 and m["correct_rejection_rate"] == 0.0
    # метрики поиска не зависят от функции ответа
    real = run_benchmark(stub=True)["metrics"]
    assert (m["recall@3"], m["mrr"]) == (real["recall@3"], real["mrr"])


def test_pipeline_does_not_call_llm_when_nothing_found(monkeypatch):
    import app.llm as llm

    monkeypatch.setattr(llm, "_real_answer", lambda *a, **kw: pytest.fail("LLM вызвана без контекста"))
    r = ask("Как приготовить пасту?", stub=False)
    assert r["type"] == "nothing" and r["sources"] == [] and is_refusal(r["answer"])


def test_answer_has_source_labels():
    r = ask("откатить неудачный коммит", stub=True)
    ids = [s["id"] for s in r["sources"]]
    assert ids and "Источники: " + ", ".join(f"[{i}]" for i in ids) in r["answer"]


def test_context_for_llm_has_id_labels():
    from app.llm import build_context

    assert "[git-3]" in build_context([{"id": "git-3", "name": "n", "command": "c", "description": "d", "examples": []}])


def test_report_and_cli(tmp_path):
    assert "Correct Rejection Rate" in format_report(run_benchmark(stub=True))
    out = tmp_path / "r.json"
    p = subprocess.run([sys.executable, "-m", "rag", "benchmark", "--llm", "stub", "--brief", "--json", str(out)],
                       cwd=ROOT, capture_output=True, text=True)
    assert p.returncode == 0 and "Accuracy" in p.stdout and json.loads(out.read_text(encoding="utf-8"))["mode"] == "stub"


def test_openai_mode_without_key_fails_clearly(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        run_benchmark(stub=False)


def test_llm_errors_are_counted(monkeypatch):
    import app.llm as llm

    monkeypatch.setenv("OPENAI_API_KEY", "x")
    monkeypatch.setattr(llm, "_real_answer", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("сеть")))
    r = run_benchmark(stub=False)
    assert r["mode"] == "openai" and r["llm_errors"] == 15 and "LLM не ответила" in format_report(r)


def test_tune_marks_the_values_used_in_config(capsys):
    """Выбранные в перебое значения совпадают с Config: README и код не расходятся."""
    from rag.engine import Config
    from rag.tune import main

    main()
    marked = [ln for ln in capsys.readouterr().out.splitlines() if "← выбрано" in ln]
    assert len(marked) == 2
    k1, b = marked[0].split("|")[0].split()
    assert (float(k1), float(b)) == (Config().k1, Config().b)
    t, c = marked[1].split("|")[0].split()
    assert (float(t), float(c)) == (Config().found_min_score, Config().found_min_coverage)
