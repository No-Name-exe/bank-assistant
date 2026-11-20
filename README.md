# Помощник по удержанию клиентов

Учебный RAG-проект: помогает менеджеру по удержанию понять,
почему клиент может уйти, и что с этим делать.

Приложение ищет похожие случаи в базе клиентов через BM25
и формирует рекомендацию с помощью LLM.

## Команда

- [Матвей Рябов] — BM25 и RAG
- [Губанов Андрей] — Интеграция
- [Королев Максим] — Продукт и интерфейс

## Стек

- HTML / CSS / JavaScript (без сборки и сервера)
- BM25 — собственная реализация (`app/bm25.js`)
- LLM — WebLLM (`@mlc-ai/web-llm`, локальная копия в `app/vendor/`), модель Qwen2.5-3B-Instruct-q4f16_1-MLC (WebGPU)
- Данные — Credit Card Customers (Kaggle)

## Запуск

Приложение — статический сайт, но корпус загружается через `fetch`,
поэтому нужен локальный сервер (открытие `index.html` двойным
кликом не сработает):

```bash
git clone https://github.com/No-Name-exe/bank-assistant
cd bank-assistant
npm run server        # статический сервер на Node.js (serve.js, без зависимостей)
# открыть http://localhost:8000/app/
```

Требования к браузеру: Chrome или Edge с поддержкой WebGPU
(модель ~2 ГБ скачивается при первом запуске, дальше кешируется).
Если WebLLM недоступна, приложение работает с локальной заглушкой ответов.

## Команды

```bash
node corpus.js         # пересобрать data/corpus.json из CSV
npm test               # тесты BM25
npm run benchmark      # Recall@5 / Precision@5 / MRR по benchmark-набору
```

## Повторить проверку

1. `npm test` — ожидается «pass 6 / fail 0».
2. `npm run benchmark` — результаты сохраняются в `benchmark/results.json`;
   эталонные значения (полный корпус, топ-5): Recall@5 ≈ 0.68,
   Precision@5 ≈ 0.84, MRR = 1.00. Эталоны релевантности —
   точное совпадение признаков клиента (`benchmark/questions.json`,
   поле `criteria`), relevance по каждому вопросу считается в `benchmark/run.js`.
3. `npm run server` → открыть `http://localhost:8000/app/` в Edge/Chrome,
   дождаться «Готово. В базе 10127 клиентов, модель загружена локально.»
   и отправить вопрос — ответ модели со списком источников BM25.

## Структура

- `app/` — интерфейс (`index.html`, `style.css`, `app.js`), модули (`bm25.js`, `llm.js`, `config.js`) и локальная копия библиотеки WebLLM (`vendor/web-llm.js`)
- `data/BankChurners.csv` — исходный датасет
- `data/corpus.json` — готовый корпус описаний клиентов (генерируется `corpus.js`)
- `corpus.js` — скрипт подготовки корпуса (Node.js, запускается один раз)
- `tests/`, `benchmark/` — проверки поиска и оценка качества
- `spec/` — продуктовая и техническая спецификация
