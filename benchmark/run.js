// Прогон benchmark-набора по полному корпусу.
// Запуск: npm run benchmark
// Результат сохраняется в benchmark/results.json.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildIndex, search } from "../app/bm25.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOP_K = 5;

const corpus = JSON.parse(readFileSync(join(ROOT, "data", "corpus.json"), "utf8"));
const questions = JSON.parse(readFileSync(join(ROOT, "benchmark", "questions.json"), "utf8"));

buildIndex(corpus);

const results = questions.map(({ query, criteria }) => {
  const relevantIds = new Set(
    corpus.filter((doc) => Object.entries(criteria).every(([key, value]) => doc.meta[key] === value)).map((doc) => doc.id)
  );
  const top = search(query, TOP_K);

  const found = top.filter(({ doc }) => relevantIds.has(doc.id));
  const firstRelevantRank = top.findIndex(({ doc }) => relevantIds.has(doc.id)) + 1;

  return {
    query,
    relevant: relevantIds.size,
    topIds: top.map(({ doc }) => doc.id),
    recallAt5: relevantIds.size ? found.length / relevantIds.size : 0,
    precisionAt5: top.length ? found.length / top.length : 0,
    mrr: firstRelevantRank ? 1 / firstRelevantRank : 0,
  };
});

const average = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const summary = {
  date: new Date().toISOString(),
  docCount: corpus.length,
  topK: TOP_K,
  metrics: {
    recallAt5: average(results.map((r) => r.recallAt5)),
    precisionAt5: average(results.map((r) => r.precisionAt5)),
    mrr: average(results.map((r) => r.mrr)),
  },
  results,
};

writeFileSync(join(ROOT, "benchmark", "results.json"), JSON.stringify(summary, null, 2));

console.log(`Корпус: ${summary.docCount} документов, топ-${TOP_K}`);
for (const r of results) {
  console.log(
    `Recall@5 ${r.recallAt5.toFixed(2)} · Precision@5 ${r.precisionAt5.toFixed(2)} · MRR ${r.mrr.toFixed(2)} — ${r.query} (релевантных: ${r.relevant})`
  );
}
console.log(`Среднее — Recall@5: ${summary.metrics.recallAt5.toFixed(3)}, Precision@5: ${summary.metrics.precisionAt5.toFixed(3)}, MRR: ${summary.metrics.mrr.toFixed(3)}`);
