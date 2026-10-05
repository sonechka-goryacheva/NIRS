"""
benchmark/run.py

Прогон всех кейсов из cases.json через поиск.
Считает Top-3 accuracy и выводит ошибки.
"""

import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.search import search

CASES_FILE = os.path.join(os.path.dirname(__file__), "cases.json")


def main():
    with open(CASES_FILE, "r", encoding="utf-8") as f:
        cases = json.load(f)

    correct = 0
    errors = []

    for case in cases:
        query = case["query"]
        expected = case["expected"]
        results = search(query, top_k=3)
        commands = [d.get("command", "") for d in results]

        hit = any(expected in cmd for cmd in commands)
        if hit:
            correct += 1
        else:
            errors.append({
                "query": query,
                "expected": expected,
                "found": commands,
            })

    total = len(cases)
    acc = correct / total * 100 if total else 0

    print(f"Top-3 accuracy: {correct}/{total} ({acc:.0f}%)")
    if errors:
        print("\nОшибки:")
        for e in errors:
            print(f"  - «{e['query']}» → ожидалось {e['expected']}, найдено {e['found']}")


if __name__ == "__main__":
    main()
