# Зафиксированные результаты: до и после дополнения тегов

Эксперимент «до / после» (rag/REPORT.md, раздел 4). Одинаковые условия в обоих прогонах:
те же 149 команд (те же id и тексты — отличаются только теги), те же 46 вопросов `rag/queries.json`,
та же предобработка и параметры (k1 = 1,2, b = 0,75), та же глубина выдачи для метрик (k = 1, 3, 5, 10).

| Файл | Что это |
|---|---|
| `corpus_before_tags/` | корпус до дополнения тегов (состояние `data/corpus/` в коммите d74ae15) |
| `before_tags.txt` | прогон на корпусе «до»: `python -m rag eval --details --compare --corpus rag/results/corpus_before_tags` |
| `after_tags.txt` | прогон на текущем корпусе `data/corpus/`: `python -m rag eval --details --compare` |

| | Recall@1 | Recall@3 | Recall@5 | Recall@10 | MRR | MRR@3 |
|---|---|---|---|---|---|---|
| До дополнения тегов | 0,132 | 0,312 | 0,416 | 0,480 | 0,552 | 0,511 |
| После дополнения тегов | 0,208 | 0,447 | 0,555 | 0,632 | 0,777 | 0,757 |

Повторить прогон и сравнить с сохранённым:

    python -m rag eval --details --compare --corpus rag/results/corpus_before_tags | diff - rag/results/before_tags.txt
    python -m rag eval --details --compare | diff - rag/results/after_tags.txt

Пустой вывод `diff` — результаты воспроизводятся. Если корпус или вопросы менялись, файлы нужно перезаписать
теми же командами (`> rag/results/…txt`) и отметить это в CHANGE_HISTORY.md.
