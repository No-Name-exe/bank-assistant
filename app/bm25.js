// Модуль поиска BM25. Работает и в браузере, и в Node.js (для тестов и benchmark).
//
// Интерфейс:
//   buildIndex(docs) — построить индекс по массиву { id, text, meta }
//   search(query, k) — вернуть топ-k документов [{ doc, score }]
//
// Параметры и предобработка — по spec/tech/rag.md:
// k1 = 1.5, b = 0.75, нижний регистр, без пунктуации, русские стоп-слова.

const K1 = 1.5;
const B = 0.75;

const STOP_WORDS = new Set([
  "и", "в", "на", "с", "по", "не", "что", "я", "от", "до", "за", "из",
  "к", "о", "у", "со", "а", "но", "да", "или", "же", "уже", "для", "как",
  "это", "клиент", "клиента", "лет",
]);

// Лёгкая нормализация без полноценного стемминга:
// ё→е, чтобы «ушёл» совпадал с «ушел» в запросе,
// и словарь форм слов со статусом — самый частый признак в вопросах менеджера.
const TOKEN_FORMS = new Map([
  ["ушел", "ушел"], ["ушла", "ушел"], ["ушли", "ушел"],
  ["ушедший", "ушел"], ["ушедшие", "ушел"], ["ушедшая", "ушел"],
  ["уходит", "ушел"], ["уходят", "ушел"], ["уходил", "ушел"], ["уходила", "ушел"],
  ["остался", "остался"], ["осталась", "остался"], ["остались", "остался"],
  ["остается", "остался"], ["остаются", "остался"],
]);

function normalizeToken(token) {
  const folded = token.replace(/ё/g, "е");
  return TOKEN_FORMS.get(folded) || folded;
}

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

// Состояние индекса.
let docs = [];
let docCount = 0;
let averageLength = 0;
let docLengths = new Float32Array(0);
let postings = new Map(); // term -> { df, docIds: Int32Array, tfs: Float32Array }

export function buildIndex(documents) {
  docs = documents;
  docCount = documents.length;

  const frequencies = documents.map((doc) => {
    const freq = new Map();
    let length = 0;
    for (const term of tokenize(doc.text)) {
      freq.set(term, (freq.get(term) || 0) + 1);
      length++;
    }
    return { freq, length };
  });

  docLengths = new Float32Array(docCount);
  let totalLength = 0;
  frequencies.forEach(({ length }, i) => {
    docLengths[i] = length;
    totalLength += length;
  });
  averageLength = totalLength / Math.max(docCount, 1);

  // Собираем постинг-листы: term -> плоский массив [docIndex, tf, docIndex, tf, ...]
  const lists = new Map();
  frequencies.forEach(({ freq }, docIndex) => {
    for (const [term, tf] of freq) {
      let list = lists.get(term);
      if (!list) lists.set(term, (list = []));
      list.push(docIndex, tf);
    }
  });

  postings = new Map();
  for (const [term, list] of lists) {
    const pairCount = list.length / 2;
    const docIds = new Int32Array(pairCount);
    const tfs = new Float32Array(pairCount);
    for (let i = 0; i < pairCount; i++) {
      docIds[i] = list[i * 2];
      tfs[i] = list[i * 2 + 1];
    }
    postings.set(term, { df: pairCount, docIds, tfs });
  }

  return { docCount, averageLength, terms: postings.size };
}

export function search(query, k = 5) {
  const scores = new Float64Array(docCount);
  const tokens = tokenize(query);

  for (const term of new Set(tokens)) {
    const posting = postings.get(term);
    if (!posting) continue;

    // IDF по формуле Robertson: idf = ln((N - df + 0.5) / (df + 0.5) + 1)
    const idf = Math.log((docCount - posting.df + 0.5) / (posting.df + 0.5) + 1);
    for (let i = 0; i < posting.df; i++) {
      const tf = posting.tfs[i];
      const norm = 1 - B + (B * docLengths[posting.docIds[i]]) / averageLength;
      scores[posting.docIds[i]] += idf * ((tf * (K1 + 1)) / (tf + K1 * norm));
    }
  }

  const top = [];
  for (let docIndex = 0; docIndex < docCount; docIndex++) {
    if (scores[docIndex] > 0) top.push({ doc: docs[docIndex], score: scores[docIndex] });
  }
  top.sort((a, b) => b.score - a.score);
  return top.slice(0, k);
}
