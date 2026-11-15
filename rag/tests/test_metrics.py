import pytest

from rag.metrics import recall_at_k, reciprocal_rank


def test_recall_at_k():
    ranked = ["a", "x", "b", "y", "c"]
    rel = {"a", "b", "c"}
    assert recall_at_k(ranked, rel, 1) == pytest.approx(1 / 3)
    assert recall_at_k(ranked, rel, 3) == pytest.approx(2 / 3)
    assert recall_at_k(ranked, rel, 5) == 1.0


def test_reciprocal_rank():
    assert reciprocal_rank(["x", "a"], {"a"}) == 0.5
    assert reciprocal_rank(["x", "y"], {"a"}) == 0.0


def test_mrr_at_k():
    ranked = ["x", "y", "z", "a"]
    assert reciprocal_rank(ranked, {"a"}) == 0.25        # вся выдача
    assert reciprocal_rank(ranked, {"a"}, k=3) == 0.0     # нет в top-3 → 0
