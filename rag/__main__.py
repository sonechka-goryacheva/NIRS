"""
Командная строка RAG (запуск из корня репозитория):

    python -m rag stats                     корпус, словарь, фрагмент обратного индекса
    python -m rag search "запрос" [-k 5]    top-k с оценками BM25 и вкладом каждого терма
    python -m rag search "запрос" --explain + все этапы предобработки запроса
    python -m rag eval                      Recall@k и MRR на тестовом наборе, по темам и по запросам
    python -m rag eval --compare            + сравнение вариантов предобработки и сетка k1 × b
    python -m rag shell                     интерактивный поиск
    python -m rag demo ["вопрос"]           RAG по шагам: поиск → промпт → ответ LLM со ссылками (= python rag/demo.py)
"""

from __future__ import annotations

import argparse
import sys

from .engine import SearchEngine
from .evaluate import KS, coverage, evaluate, grid, load_queries, negatives, variants


def _bar(x: float, width: int = 20) -> str:
    n = round(x * width)
    return "█" * n + "·" * (width - n)


def cmd_stats(engine: SearchEngine, args) -> None:
    ix = engine.index
    cats = {}
    for d in engine.corpus:
        cats[d["category"]] = cats.get(d["category"], 0) + 1
    print(f"Документов (команд): {ix.n_docs}  ·  " + ", ".join(f"{c} {n}" for c, n in sorted(cats.items())))
    print(f"Термов в словаре |V|: {len(ix.postings)}")
    print(f"Средняя длина документа avgdl: {ix.avgdl:.1f} терма (мин {min(ix.doc_len)}, макс {max(ix.doc_len)})")
    nnz = sum(len(p) for p in ix.postings.values())
    print(f"Заполненность матрицы документ×терм: {nnz} из {ix.n_docs * len(ix.postings)} "
          f"({100 * nnz / (ix.n_docs * len(ix.postings)):.1f} %) — векторы документов разреженные")
    print(f"Настройки: {engine.config.describe()}\n")

    terms = args.terms or ["контейнер", "файл", "ветка", "процесс", "таблица", "удалить", "скрипт", "git"]
    print("Фрагмент обратного индекса (терм → документы, TF):")
    print(f"  {'терм':<12} {'DF':>3} {'IDF':>6}  документы")
    for t in terms:
        p = ix.postings.get(t)
        docs = ", ".join(f"{engine.corpus[i]['id']}({tf})" for i, tf in sorted(p.items())[:8]) + (" …" if p and len(p) > 8 else "") if p else "— нет в словаре"
        print(f"  {t:<12} {ix.df(t):>3} {ix.idf(t):>6.2f}  {docs}")

    common = sorted(ix.postings, key=lambda t: -ix.df(t))[:10]
    print("\nСамые частые термы (низкий IDF): " + ", ".join(f"{t} ({ix.df(t)})" for t in common))


def cmd_search(engine: SearchEngine, args) -> None:
    query = " ".join(args.query)
    if args.explain:
        tr = engine.trace(query)
        print(f"Запрос:        {tr.text}")
        print(f"Нормализация:  {tr.normalized}")
        print(f"Токены:        {tr.tokens}")
        print(f"Леммы:         {tr.lemmas}")
        print(f"Термы запроса: {tr.terms}")
        unknown = [t for t in tr.terms if t not in engine.index.postings]
        if unknown:
            print(f"Нет в словаре: {unknown}")
        print()
    hits = engine.search(query, k=args.k)
    if not hits:
        print("Ничего не найдено: ни один терм запроса не встречается в корпусе.")
        return
    ans = engine.answer(query, k=args.k)
    label = {"found": "найдено", "similar": "есть похожие", "nothing": "ничего"}[ans["type"]]
    print(f"Тип ответа для чата: {ans['type']} ({label})\n")
    for h in hits:
        d = h.doc
        print(f"{h.rank:>2}. {h.score:6.2f}  {d['command']:<40} {d['name']}  [{d['id']}]")
        parts = "  ".join(f"{c.term}: tf={c.tf} idf={c.idf:.2f} → {c.score:.2f}" for c in h.contributions)
        print(f"            {parts}")


def cmd_eval(engine: SearchEngine, args) -> None:
    data = load_queries()
    queries = data["queries"]
    cov = coverage(engine.corpus, queries)
    print(f"Тестовый набор: {len(queries)} запросов, релевантных на запрос: "
          + ", ".join(f"{n} — {c} запр." for n, c in cov["relevant_per_query"].items()))
    print(f"Покрытие корпуса: {cov['covered']} из {cov['total']} команд встречаются среди релевантных")
    print("  " + ", ".join(f"{c} {a}/{b}" for c, (a, b) in cov["categories"].items()))
    print(f"Настройки: {engine.config.describe()}\n")

    rep = evaluate(engine, queries)
    for k in KS:
        print(f"Recall@{k:<3} {rep.recall(k):.3f}  {_bar(rep.recall(k))}  (максимум возможного {rep.recall_bound(k):.3f})")
    print(f"MRR        {rep.mrr:.3f}  {_bar(rep.mrr)}  (по всей выдаче, как в методичке)")
    print(f"MRR@3      {rep.mrr_at(3):.3f}  {_bar(rep.mrr_at(3))}  (только top-3: нет релевантного в top-3 → 0)\n")

    print(f"{'Тема':<22} {'запр.':>5} {'R@3':>6} {'R@5':>6} {'MRR':>6} {'MRR@3':>6}")
    for t, m in rep.by_topic().items():
        print(f"{t:<22} {m['n']:>5} {m['recall3']:>6.2f} {m['recall5']:>6.2f} {m['mrr']:>6.2f} {m['mrr3']:>6.2f}")

    if args.details:
        print("\nРазбор по вопросам (✓ — эталонная команда, ✗ — не из эталона; позиция — место первой эталонной в выдаче):")
        for r in rep.results:
            fr = r.first_rank if r.first_rank else "нет"
            top = "  ".join(("✓" if d in r.relevant else "✗") + d for d in r.ranked[:3]) or "пусто"
            missed = [d for d in r.relevant if d not in r.ranked[:3]]
            print(f"{r.id}  «{r.query}»  R@3 {r.recall[3]:.2f}  1/позиция {r.rr:.2f} (позиция {fr})")
            print(f"     top-3: {top}")
            print(f"     эталон: {', '.join(r.relevant)}" + (f"  · не в top-3: {', '.join(missed)}" if missed else "  · все в top-3"))

    neg = negatives(engine, data)
    print("\nТипы ответа: по теме — " + ", ".join(f"{t} {n}" for t, n in neg["positive_types"].items())
          + "; не по теме — " + ", ".join(f"«{q}» → {t}" for q, t in neg["negative"].items()))

    if args.compare:
        print("\nСравнение вариантов (меняется один фактор):")
        n_neg = len(data.get("negative", []))
        print(f"  {'вариант':<58} {'R@1':>6} {'R@3':>6} {'R@5':>6} {'R@10':>6} {'MRR':>6} {'MRR@3':>6}  не по теме → nothing")
        for name, cfg in variants(engine.config):
            e = SearchEngine(engine.corpus, cfg)
            r = evaluate(e, queries)
            ok = sum(t == "nothing" for t in negatives(e, data)["negative"].values())
            print(f"  {name:<58} {r.recall(1):>6.3f} {r.recall(3):>6.3f} {r.recall(5):>6.3f} {r.recall(10):>6.3f} {r.mrr:>6.3f} {r.mrr_at(3):>6.3f}  {ok}/{n_neg}")
        g = grid(engine.corpus, queries, engine.config)
        bs = sorted({b for _, b in g})
        print("\nСетка параметров BM25, MRR (строки — k1, столбцы — b):")
        print("  k1\\b " + "".join(f"{b:>7}" for b in bs))
        for k1 in sorted({k for k, _ in g}):
            print(f"  {k1:<5}" + "".join(f"{g[(k1, b)][2]:>7.3f}" for b in bs))


def cmd_shell(engine: SearchEngine, args) -> None:
    print("Поиск по справочнику (BM25). Пустая строка или Ctrl+D — выход.")
    while True:
        try:
            q = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not q:
            return
        cmd_search(engine, argparse.Namespace(query=[q], k=args.k, explain=True))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m rag", description="BM25-поиск по справочнику IT-команд")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("stats", help="корпус, словарь, фрагмент индекса")
    s.add_argument("terms", nargs="*", help="термы для показа в индексе")
    s = sub.add_parser("search", help="поиск")
    s.add_argument("query", nargs="+")
    s.add_argument("-k", type=int, default=3)
    s.add_argument("--explain", action="store_true", help="показать этапы предобработки")
    s = sub.add_parser("eval", help="метрики на тестовом наборе")
    s.add_argument("--corpus", help="папка корпуса (по умолчанию data/corpus); например rag/results/corpus_before_tags")
    s.add_argument("--details", action="store_true", help="результат по каждому запросу")
    s.add_argument("--compare", action="store_true", help="сравнение вариантов и сетка k1×b")
    if argv is None and len(sys.argv) > 1 and sys.argv[1] == "demo":  # демо — свой разбор аргументов
        from rag.demo import main as demo_main  # noqa: PLC0415

        return demo_main(sys.argv[2:])
    s = sub.add_parser("demo", help="RAG по шагам (python rag/demo.py)")
    s = sub.add_parser("shell", help="интерактивный поиск")
    s.add_argument("-k", type=int, default=5)
    args = p.parse_args(argv)
    corpus_dir = getattr(args, "corpus", None)
    if corpus_dir:
        from .corpus import load_corpus  # noqa: PLC0415

        engine = SearchEngine(load_corpus(corpus_dir))
        print(f"Корпус: {corpus_dir}")
    else:
        engine = SearchEngine()
    {"stats": cmd_stats, "search": cmd_search, "eval": cmd_eval, "shell": cmd_shell}[args.cmd](engine, args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
