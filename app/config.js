// Конфигурация приложения. Ключи API не нужны: WebLLM работает локально в браузере.

export const CONFIG = {
  topK: 5,
  llmProvider: "webllm", // "webllm" | "mock"
  model: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
  fallbackModel: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  maxDocuments: 5,
  requestTimeoutMs: 60000,
  corpusUrl: "../data/corpus.json",
};
