"""Индекс и BM25: пример из методички (раздел 1.4) и проверка формулы вручную."""
import math

import pytest

from rag.bm25 import BM25, InvertedIndex
from rag.text import TextConfig, preprocess

# Документы из методички — после предобработки должны дать ту же структуру индекса
DOCS = [
    "Лапласиан графа используется для анализа структуры графа",
    "Матрица смежности графа описывает связи между вершинами",
    "Методы машинного обучения используют матрицы данных",
]


@pytest.fixture(scope="module")
def index():
    return InvertedIndex([preprocess(d) for d in DOCS])


def test_preprocess_like_methodology():
    assert preprocess(DOCS[0]) == ["лапласиан", "граф", "использоваться", "анализ", "структура", "граф"]


def test_index_structure_like_methodology(index):
    # «Терм — документы» из таблицы методички
    assert sorted(index.postings["лапласиан"]) == [0]
    assert sorted(index.postings["граф"]) == [0, 1]
    assert sorted(index.postings["матрица"]) == [1, 2]
    assert sorted(index.postings["обучение"]) == [2]
    assert index.tf("граф", 0) == 2


def test_idf_formula(index):
    n, df = 3, 2
    assert index.idf("граф") == pytest.approx(math.log(1 + (n - df + 0.5) / (df + 0.5)))
    assert index.idf("лапласиан") > index.idf("граф") > 0  # редкий терм весит больше, IDF всегда > 0


def test_bm25_formula(index):
    bm = BM25(index, k1=1.5, b=0.75)
    tf, dl, avg = 2, index.doc_len[0], index.avgdl
    expected = index.idf("граф") * tf * 2.5 / (tf + 1.5 * (1 - 0.75 + 0.75 * dl / avg))
    assert bm.term_score("граф", 0) == pytest.approx(expected)
    assert bm.scores(["граф"])[0] == pytest.approx(expected)


def test_rank_order_and_only_matching_docs(index):
    bm = BM25(index)
    ranked = bm.rank(preprocess("матрица графа"))
    assert [d for d, _ in ranked][0] == 1           # d2 содержит оба терма
    assert {d for d, _ in ranked} == {0, 1, 2}
    assert bm.rank(preprocess("кракозябра")) == []   # нет термов в словаре — нет документов


def test_query_term_repetition_counts(index):
    bm = BM25(index)
    one = bm.scores(["граф"])[0]
    assert bm.scores(["граф", "граф"])[0] == pytest.approx(2 * one)  # запрос — кортеж термов


def test_b_zero_ignores_length():
    ix = InvertedIndex([["x"], ["x", "y", "z", "w"]])
    bm = BM25(ix, b=0.0)
    assert bm.term_score("x", 0) == pytest.approx(bm.term_score("x", 1))


def test_no_lemmatization_option():
    assert preprocess("графа графом", TextConfig(lemmatize=False, stopwords=False)) == ["графа", "графом"]


def test_tokenization_of_commands():
    assert preprocess("du -sh <path>") == ["du", "sh", "path"]
    assert preprocess("Get-Process") == ["get", "process"]
    assert preprocess("Ёлка") == ["елка"]
