// Модуль LLM. Формирует промпт по spec/tech/rag.md и вызывает WebLLM
// (модель работает локально в браузере через WebGPU, ключ не нужен).
// Библиотека подключена локально (app/vendor/web-llm.js) — CDN используется
// только как запасной вариант. Если WebLLM недоступна (нет WebGPU, нет сети),
// используется mock-провайдер, чтобы интерфейс и поиск оставались работоспособными.

import { CONFIG } from "./config.js";

// Локальная копия @mlc-ai/web-llm 0.2.89 (пакет переименован из @mlc-ai/webllm).
const WEBLLM_SOURCES = [
  "./vendor/web-llm.js",
  "https://esm.run/@mlc-ai/web-llm",
  "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.89/+esm",
  "https://unpkg.com/@mlc-ai/web-llm@0.2.89/lib/index.js",
];

const SYSTEM_PROMPT = `Ты — помощник менеджера по удержанию клиентов банка.
Ответь на вопрос пользователя, опираясь только на факты из приведённых документов.
Если данных недостаточно, скажи об этом прямо.
Отвечай на русском языке, кратко и по делу: сначала причины риска оттока,
затем рекомендации по удержанию.`;

function formatDocuments(documents) {
  return documents
    .slice(0, CONFIG.maxDocuments)
    .map(({ doc }, index) => `${index + 1}. ${doc.text}`)
    .join("\n");
}

export function buildPrompt(query, documents) {
  return [
    SYSTEM_PROMPT,
    "",
    "Документы:",
    documents.length ? formatDocuments(documents) : "(похожие клиенты не найдены)",
    "",
    `Вопрос менеджера: ${query}`,
  ].join("\n");
}

let engine = null;
let activeProvider = CONFIG.llmProvider === "webllm" ? null : "mock";

export function llmProvider() {
  return activeProvider;
}

export async function initLLM(onProgress = () => {}) {
  if (activeProvider === "mock") return "mock";

  let webllm = null;
  try {
    for (const source of WEBLLM_SOURCES) {
      try {
        webllm = await import(/* @vite-ignore */ source);
        break;
      } catch (err) {
        console.warn(`WebLLM не загрузилась из ${source}:`, err);
      }
    }
    if (!webllm) throw new Error("все источники недоступны");

    for (const model of [CONFIG.model, CONFIG.fallbackModel]) {
      try {
        onProgress(`Загружается модель ${model}…`);
        engine = await webllm.CreateMLCEngine(model, {
          initProgressCallback: (report) => onProgress(report.text || "Загрузка модели…"),
        });
        activeProvider = "webllm";
        onProgress("");
        return "webllm";
      } catch (err) {
        console.warn(`Модель ${model} не загрузилась:`, err);
      }
    }
  } catch (err) {
    console.warn("WebLLM недоступна (нужен WebGPU и доступ к Hugging Face):", err);
  }

  activeProvider = "mock";
  onProgress("");
  return "mock";
}

async function askWebLLM(query, documents, onToken) {
  const userContent = [
    "Документы:",
    documents.length ? formatDocuments(documents) : "(похожие клиенты не найдены)",
    "",
    `Вопрос менеджера: ${query}`,
  ].join("\n");
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
  const completion = await engine.chat.completions.create({
    messages,
    temperature: 0.3,
    max_tokens: 600,
    stream: true,
  });

  let answer = "";
  for await (const chunk of completion) {
    const delta = chunk.choices[0]?.delta?.content || "";
    answer += delta;
    onToken(answer);
  }
  return answer.trim();
}

function askMock(query, documents) {
  if (!documents.length) {
    return "Похожих клиентов не найдено. Попробуйте изменить формулировку.";
  }
  const gone = documents.filter(({ doc }) => doc.meta.status === "ушёл").length;
  const stayed = documents.length - gone;
  return [
    `Найдено ${documents.length} похожих клиентов: ${gone} ушли, ${stayed} остались.`,
    "",
    "Это ответ локальной заглушки: WebLLM недоступна в этом браузере.",
    "Установите Chrome/Edge с поддержкой WebGPU и подключением к сети,",
    "чтобы получать ответы модели на основе найденных документов.",
  ].join("\n");
}

export async function ask(query, documents, { onToken = () => {} } = {}) {
  const limited = documents.slice(0, CONFIG.maxDocuments);

  if (activeProvider !== "webllm" || !engine) {
    const answer = askMock(query, limited);
    onToken(answer);
    return answer;
  }

  const timeout = new Promise((_, reject) => {
    setTimeout(() => {
      // Останавливаем генерацию, чтобы движок не оставался занят
      // фоновым запросом и следующий вопрос не ждал его завершения.
      try { engine.interruptGenerate(); } catch { /* движок уже свободен */ }
      reject(new Error("превышен таймаут ответа модели"));
    }, CONFIG.requestTimeoutMs);
  });
  return Promise.race([askWebLLM(query, limited, onToken), timeout]);
}
