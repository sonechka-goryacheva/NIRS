# rag/ — поиск по справочнику (BM25)

Этап поиска (retrieval) схемы RAG по методичке НИРС: собственный обратный индекс и ранжирование BM25,
тестовый набор запросов и метрики Recall@k, MRR. Готовые поисковые библиотеки не используются.
Обоснование решений, эксперименты и выводы — [REPORT.md](REPORT.md).

## Запуск

Из **корня репозитория** (нужен Python 3.10+):

    pip install -r requirements.txt        # нужен только pymorphy3 (лемматизация)

    python rag/demo.py                      # RAG по шагам: поиск BM25 → промпт → ответ LLM со ссылками (3 примера)
    python rag/demo.py "откатить коммит"    # то же для своего вопроса
    python rag/evaluate.py                  # бенчмарк: Recall@3, MRR и разбор по каждому вопросу

    python -m rag tune                      # перебор параметров: k1 × b, глубина k, пороги типа ответа
    python -m rag benchmark                 # контрольный бенчмарк КТ: Recall@3, MRR, Accuracy, Correct Rejection Rate
    python -m rag benchmark --llm openai --md report.md --json report.json   # с настоящей LLM и сохранением результата

    python -m rag stats                     # корпус, словарь, фрагмент обратного индекса
    python -m rag search "не хватает прав при запуске скрипта"
    python -m rag search "посмотреть запущенные контейнеры" --explain -k 5
    python -m rag eval                      # Recall@1/3/5/10, MRR и MRR@3 на тестовом наборе
    python -m rag eval --corpus rag/results/corpus_before_tags   # тот же прогон на корпусе «до» дополнения тегов
    python -m rag eval --details            # + результат по каждому запросу (✓ — релевантный документ)
    python -m rag eval --compare            # + сравнение вариантов предобработки и сетка k1 × b
    python -m rag shell                     # интерактивный поиск
    python -m pytest                        # тесты индекса, формул, метрик, наборов запросов и бенчмарка

## Контрольный бенчмарк КТ и запуск в рантайме

Набор из слайдов КТ — `rag/control/`: 30 документов D01–D30 (`docs.json`), 10 обычных вопросов с эталонами и 5 ловушек
(`questions.json`). Прогон делает то же, что приложение: поиск → ответ (`rag/pipeline.py` → `app/llm.py`) → четыре метрики,
по каждому вопросу сохраняются выдача и ответ. Заглушка — доли секунды, OpenAI — до ~30 с. Результаты и разбор ошибок —
`REPORT.md`, раздел 8; сохранённый прогон — `results/control_stub.md` и `.json`.

Из кода (так бенчмарк запускает работающее приложение):

    from rag import run_benchmark
    result = run_benchmark()                 # k=3, LLM по .env; run_benchmark(stub=False) — настоящая LLM
    result["metrics"]                        # {"recall@3", "mrr", "mrr@3", "accuracy", "correct_rejection_rate"}
    result["questions"]                      # по каждому вопросу: top-k, ответ, вердикт, где потеряна информация

Подключение к серверу (`app/api.py`, часть интеграции; пример, ещё не реализован) — обычный обработчик для admin,
FastAPI выполняет обычную `def` в пуле потоков:

    @router.post("/admin/benchmark")
    def run_control_benchmark():
        return run_benchmark()

`python -m rag benchmark` без ключа и `.env` работает на заглушке; с `--llm openai` и без `OPENAI_API_KEY` останавливается
с понятной ошибкой, а если LLM не ответила на часть вопросов — в отчёте появляется предупреждение.

## Как демонстрировать (5–7 минут)

Две главные команды: `python rag/demo.py` (вопрос → top-3 BM25 с ID и баллами → промпт с найденными командами →
ответ LLM + источники; вопрос не по теме → «не найдено», LLM не вызывается) и `python rag/evaluate.py`
(Recall@3 и MRR на 46 вопросах с разбором). Подробнее по шагам:

1. **Корпус и индекс** — `python -m rag stats`.
   Показать: 149 команд, словарь 739 термов, векторы разреженные (1,5 % ненулевых),
   фрагмент «терм → документы» с DF и IDF — как таблица из раздела 1.4 методички.
2. **Предобработка** — `python -m rag search "посмотреть запущенные контейнеры" --explain`.
   Показать цепочку: токены → леммы («запущенные» → «запустить», «контейнеры» → «контейнер») → термы без стоп-слов;
   у каждой найденной команды — вклад термов (tf, idf, слагаемое BM25).
3. **Поиск по задаче, а не по названию** — несколько запросов:
   `"не хватает прав при запуске скрипта"` (chmod и Set-ExecutionPolicy),
   `"что делает du -sh"` (объяснение команды),
   `"рецепт борща"` (ничего не найдено — случайные команды не подставляются).
4. **Качество** — `python -m rag eval`: 46 запросов, у каждого ≥ 3 релевантных, покрытие 134 из 149 команд;
   Recall@k и MRR с «максимумом возможного», разбивка по темам.
5. **Обоснование выбора** — `python -m rag eval --compare`: без лемматизации хуже, без стоп-слов поиск отвечает
   на посторонние запросы, параметры BM25 влияют слабо (подобраны: k1 = 0,5, раздел 3 отчёта). Выводы — REPORT.md, раздел 7.

Самопроверка формул — `python -m pytest rag -v`: индекс на примере из методички (граф → d1, d2; матрица → d2, d3)
и BM25 против ручного расчёта.

## Устройство

    rag/
      text.py        предобработка: нормализация, токенизация, лемматизация (pymorphy3), стоп-слова
      bm25.py        обратный индекс InvertedIndex и ранжирование BM25 (формулы методички)
      corpus.py      загрузка data/corpus/*.json, id = <категория>-<индекс>
      engine.py      SearchEngine: поиск top-k, тип ответа для чата (found / similar / nothing), настройки Config
      metrics.py     Recall@k, MRR
      tune.py        перебор параметров: k1 × b, глубина k, пороги типа ответа (`python -m rag tune`)
      evaluate.py    оценка на тестовом наборе, покрытие корпуса, сравнение вариантов
      queries.json   тестовый набор: 46 запросов (≥ 3 релевантных) + 7 запросов не по теме
      results/       зафиксированные прогоны «до» и «после» дополнения тегов + корпус «до»
      pipeline.py    ask(): вопрос → поиск → LLM → {answer, sources, type} — путь одного запроса
      benchmark.py   run_benchmark(): контрольный бенчмарк КТ в рантайме, 4 метрики, отчёт
      control/       контрольный набор КТ: docs.json (D01–D30), questions.json (10 + 5)
      demo.py        демонстрация RAG: Retrieval → Augmented (промпт) → Generation (app/llm.py) + источники
      __main__.py    командная строка
      tests/         pytest
      REPORT.md      отчёт

Использование из кода (так его вызывает приложение — `app/search.py`):

    from rag import SearchEngine
    engine = SearchEngine()                                  # корпус data/corpus
    hits = engine.search("откатить коммит", k=3)             # [Hit(rank, doc, score, contributions)]
    engine.answer("откатить коммит")                         # {"type": "found" | "similar" | "nothing", "hits": [...]}

Индекс строится в памяти при создании `SearchEngine` — доли секунды (149 команд и загрузка словаря pymorphy3).
Если файлы `data/corpus/` изменились (правка администратора, новый датасет), `app.search.get_engine()` пересоберёт
индекс сам при следующем запросе (`SearchEngine.is_stale()`).

## Связь с остальным проектом

- `app/search.py` — обёртка над `rag` с прежним интерфейсом `search(query, top_k, platform)` для `app/ui.py` и сервера.
- Веб-интерфейс (`web/`) пока работает на моках: `web/assets/js/mock/search.js` — упрощённая имитация на JS.
  Когда появится сервер FastAPI (`app/api.py`), ответы чата будут строиться через `rag` (`SearchEngine.answer`).
- Спецификация поиска — `spec/tech/rag.md`, оценки — `spec/tech/benchmark.md`.
- `benchmark/` — прежняя проверка (Top-3 accuracy, одна ожидаемая команда), оставлена для истории; `python benchmark/run.py`
  работает на новом поиске (18/20, было 15/20).
