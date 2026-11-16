# Зафиксированные результаты: до и после дополнения тегов

Эксперимент «до / после» (rag/REPORT.md, раздел 4). Одинаковые условия в обоих прогонах:
те же 149 команд (те же id и тексты — отличаются только теги), те же 46 вопросов `rag/queries.json`,
та же предобработка и параметры (k1 = 0,5, b = 0,75 — подобраны, REPORT.md, раздел 3), та же глубина выдачи для метрик (k = 1, 3, 5, 10).

| Файл | Что это |
|---|---|
| `corpus_before_tags/` | корпус до дополнения тегов (состояние `data/corpus/` в коммите d74ae15) |
| `before_tags.txt` | прогон на корпусе «до»: `python -m rag eval --details --compare --corpus rag/results/corpus_before_tags` |
| `after_tags.txt` | прогон на текущем корпусе `data/corpus/`: `python -m rag eval --details --compare` |

| | Recall@1 | Recall@3 | Recall@5 | Recall@10 | MRR | MRR@3 |
|---|---|---|---|---|---|---|
| До дополнения тегов | 0,140 | 0,330 | 0,404 | 0,480 | 0,567 | 0,533 |
| После дополнения тегов | 0,222 | 0,467 | 0,562 | 0,646 | 0,809 | 0,793 |

Повторить прогон и сравнить с сохранённым:

    python -m rag eval --details --compare --corpus rag/results/corpus_before_tags | diff - rag/results/before_tags.txt
    python -m rag eval --details --compare | diff - rag/results/after_tags.txt

Пустой вывод `diff` — результаты воспроизводятся. Если корпус или вопросы менялись, файлы нужно перезаписать
теми же командами (`> rag/results/…txt`) и отметить это в CHANGE_HISTORY.md.

## Контрольный бенчмарк КТ

`control_stub.md` (отчёт) и `control_stub.json` (выдача и ответ по каждому вопросу) — прогон `python -m rag benchmark --llm stub`
на наборе `rag/control/`; разбор — `rag/REPORT.md`, раздел 8. Метрики заглушки: Recall@3 0,800, MRR 0,950, Accuracy 0,600,
Correct Rejection Rate 1,000. Прогон с настоящей LLM: `python -m rag benchmark --llm openai --md rag/results/control_openai.md`.
Время запуска в файлах отличается от прогона к прогону, метрики на заглушке — нет.

`tuning.txt` — вывод `python -m rag tune`: перебор k1 × b, глубины k и порогов типа ответа на рабочем и контрольном наборах
(выбранные значения помечены «← выбрано»); разбор — `rag/REPORT.md`, разделы 3 и 6.
