// Проверка BM25 на фиксированном корпусе.
// Запуск: npm test

import test from "node:test";
import assert from "node:assert/strict";

import { buildIndex, search, tokenize } from "../app/bm25.js";

const DOCS = [
  {
    id: "C1",
    text: "Клиент 45 лет, муж. доход $60K - $80K. карта Platinum. с банком 36 месяцев. транзакций за год: 45. обращений в поддержку: 3. статус: ушёл.",
    meta: { status: "ушёл" },
  },
  {
    id: "C2",
    text: "Клиент 44 года, жен. доход $60K - $80K. карта Platinum. с банком 34 месяца. транзакций за год: 52. обращений в поддержку: 2. статус: остался.",
    meta: { status: "остался" },
  },
  {
    id: "C3",
    text: "Клиент 50 лет, муж. доход $80K - $120K. карта Gold. с банком 60 месяцев. транзакций за год: 120. обращений в поддержку: 1. статус: остался.",
    meta: { status: "остался" },
  },
];

test("токенизация: нижний регистр, без пунктуации и стоп-слов", () => {
  assert.deepEqual(tokenize("Карта Platinum, и в на с!"), ["карта", "platinum"]);
  assert.ok(tokenize("Клиент 45 лет").includes("45"));
});

test("search возвращает топ-k по убыванию оценки", () => {
  buildIndex(DOCS);
  const results = search("карта Platinum транзакции упали", 2);
  assert.equal(results.length, 2);
  assert.ok(results[0].score >= results[1].score);
  assert.ok(["C1", "C2"].includes(results[0].doc.id));
});

test("релевантный документ ранжируется выше менее релевантного", () => {
  buildIndex(DOCS);
  const results = search("карта Gold транзакций за год: 120", 3);
  assert.equal(results[0].doc.id, "C3");
});

test("нормализация форм статуса: «ушли» находит «ушёл»", () => {
  buildIndex(DOCS);
  const results = search("клиенты, которые ушли", 5);
  assert.ok(results.some(({ doc }) => doc.id === "C1"));
});

test("пустой результат, когда терминов нет ни в одном документе", () => {
  buildIndex(DOCS);
  assert.deepEqual(search("несуществующее_слово_абракадабра", 5), []);
});

test("search не падает на пустом индексе", () => {
  buildIndex([]);
  assert.deepEqual(search("anything", 5), []);
});
