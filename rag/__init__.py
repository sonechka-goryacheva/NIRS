"""
RAG справочника IT-команд — этап поиска (retrieval): собственный обратный индекс и ранжирование BM25.

Документация — rag/README.md, обоснование решений и результаты — rag/REPORT.md.
"""

from .benchmark import run_benchmark
from .bm25 import BM25, InvertedIndex
from .engine import Config, Hit, SearchEngine
from .text import TextConfig, preprocess

__all__ = ["BM25", "Config", "Hit", "InvertedIndex", "SearchEngine", "TextConfig", "preprocess", "run_benchmark"]
