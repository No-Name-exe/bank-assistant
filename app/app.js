import { buildIndex, search } from "./bm25.js";
import { initLLM, ask } from "./llm.js";
import { CONFIG } from "./config.js";

const $chatList = document.getElementById("chat-list");
const $chatTitle = document.getElementById("chat-title");
const $messages = document.getElementById("messages");
const $form = document.getElementById("message-form");
const $messageInput = document.getElementById("message-input");
const $send = document.getElementById("send");
const $newChat = document.getElementById("new-chat");
const $mobileNewChat = document.getElementById("mobile-new-chat");
const $mobileChatToggle = document.getElementById("mobile-chat-toggle");
const $sidebarBackdrop = document.getElementById("sidebar-backdrop");
const $app = document.querySelector(".app");
const $clientPanel = document.getElementById("client-panel");
const formModeButtons = [...document.querySelectorAll("[data-form-mode]")];
const shortLabels = [...document.querySelectorAll("[data-short-label]")];
const compactLayout = window.matchMedia("(max-width: 560px)");
const $status = document.getElementById("status");
const $clientSummary = document.getElementById("client-summary");
const clientFields = [...document.querySelectorAll("[data-field]")];
const chats = [];
let activeChat = null;
let isLoading = false;
let isReady = false;
let corpusSize = 0;

function setStatus(text, isError = false) {
  $status.textContent = text;
  $status.classList.toggle("error", isError);
  // Дублируем в заголовок вкладки: удобно следить за загрузкой модели.
  document.title = text
    ? `${text.slice(0, 50)} — Помощник по удержанию клиентов`
    : "Помощник по удержанию клиентов";
}

function setReady(ready) {
  isReady = ready;
  $send.disabled = !ready || isLoading;
  $messageInput.disabled = !ready;
  $newChat.disabled = !ready;
  $mobileNewChat.disabled = !ready;
}

function closeChatMenu() {
  $app.classList.remove("chat-menu-open");
  $sidebarBackdrop.hidden = true;
  $mobileChatToggle.setAttribute("aria-expanded", "false");
}

function toggleChatMenu() {
  const isOpen = $app.classList.toggle("chat-menu-open");
  $sidebarBackdrop.hidden = !isOpen;
  $mobileChatToggle.setAttribute("aria-expanded", String(isOpen));
}

function setFormMode(mode) {
  const isDetailed = mode === "detailed" && !compactLayout.matches;
  $clientPanel.classList.toggle("show-advanced", isDetailed);
  for (const button of formModeButtons) {
    const isActive = button.dataset.formMode === (isDetailed ? "detailed" : "basic");
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
  if (activeChat) activeChat.formMode = isDetailed ? "detailed" : "basic";
}

function updateFieldLabels() {
  for (const label of shortLabels) {
    const fullLabel = label.dataset.fullLabel;
    label.textContent = compactLayout.matches ? label.dataset.shortLabel : fullLabel;
    label.title = compactLayout.matches ? fullLabel : "";
  }
  if (compactLayout.matches) setFormMode("basic");
}

function readClientData() {
  return Object.fromEntries(clientFields.map((field) => [
    field.dataset.field,
    field.value.trim(),
  ]));
}

function formatFieldValue(field, value) {
  if (field.dataset.format === "currency") {
    return `$${Number(value).toLocaleString("en-US")}`;
  }
  if (field.dataset.unit === "%") return `${value}%`;
  return `${value}${field.dataset.unit ? ` ${field.dataset.unit}` : ""}`;
}

function updateClientSummary() {
  const filledFields = clientFields.filter((field) => field.value.trim());
  const preferredSummaryFields = ["age", "income", "card", "transactionCount", "contacts"];
  const orderedFields = [...filledFields].sort((left, right) => {
    const leftPriority = preferredSummaryFields.indexOf(left.dataset.field);
    const rightPriority = preferredSummaryFields.indexOf(right.dataset.field);
    return (leftPriority < 0 ? preferredSummaryFields.length : leftPriority)
      - (rightPriority < 0 ? preferredSummaryFields.length : rightPriority);
  });
  const previewFields = orderedFields.slice(0, 4).map((field) => (
    `${field.dataset.summaryLabel}: ${formatFieldValue(field, field.value.trim())}`
  ));
  const remainingCount = filledFields.length - previewFields.length;
  if (remainingCount > 0) previewFields.push(`+${remainingCount}`);
  $clientSummary.textContent = previewFields.join(" · ") || "Данные не указаны";
  $clientSummary.title = filledFields.length
    ? filledFields.map((field) => `${field.dataset.promptLabel}: ${formatFieldValue(field, field.value.trim())}`).join(" · ")
    : "Данные не указаны";
}

function buildPrompt(data, message) {
  const facts = clientFields
    .filter((field) => data[field.dataset.field])
    .map((field) => `${field.dataset.promptLabel}: ${formatFieldValue(field, data[field.dataset.field])}`);
  return [
    facts.length ? `Данные клиента: ${facts.join(". ")}.` : "",
    `Вопрос менеджера: ${message}`,
  ].filter(Boolean).join("\n");
}

function hasClientInformation(data, message) {
  if (Object.values(data).some(Boolean)) return true;

  const customerAttribute = /(?:\d{2}\s*(?:лет|года|год|years?\s*old)|возраст.{0,12}\d{2})|(?:blue|silver|gold|platinum)\b|(?:доход|заработок|income).{0,30}\d|(?:женщина|мужчина|в браке|в разводе|колледж|докторская степень)/i;
  const numericFeature = /\d.{0,25}(?:транзакц|покуп|обращен|контакт|месяц|иждивен|продукт|кредитн.{0,12}лимит)|(?:транзакц|покуп|обращен|контакт|месяц|иждивен|продукт|кредитн.{0,12}лимит).{0,25}\d/i;
  const percentageFeature = /(?:транзакц|покуп|сумм).{0,30}\d+\s*%/i;
  return customerAttribute.test(message)
    || numericFeature.test(message)
    || percentageFeature.test(message);
}

function renderChatList() {
  $chatList.replaceChildren();
  for (const chat of chats) {
    const entry = document.createElement("div");
    entry.className = "chat-entry";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chat-item${chat === activeChat ? " active" : ""}`;
    button.textContent = chat.title;
    button.title = chat.title;
    button.disabled = isLoading;
    button.addEventListener("click", () => selectChat(chat));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-chat";
    deleteButton.textContent = "×";
    deleteButton.setAttribute("aria-label", `Удалить чат: ${chat.title}`);
    deleteButton.title = "Удалить чат";
    deleteButton.disabled = isLoading;
    deleteButton.addEventListener("click", () => deleteChat(chat));

    entry.append(button, deleteButton);
    $chatList.appendChild(entry);
  }
}

function deleteChat(chat) {
  if (isLoading) return;
  const index = chats.indexOf(chat);
  if (index === -1) return;

  chats.splice(index, 1);
  if (chat === activeChat) {
    const nextChat = chats[index] || chats[index - 1];
    if (nextChat) {
      selectChat(nextChat);
    } else {
      createChat();
    }
  } else {
    renderChatList();
  }
}

function resizeMessageInput() {
  $messageInput.style.height = "auto";
  const maxHeight = Number.parseFloat(getComputedStyle($messageInput).maxHeight);
  $messageInput.style.height = `${Math.min($messageInput.scrollHeight, maxHeight)}px`;
  $messageInput.style.overflowY = $messageInput.scrollHeight > maxHeight ? "auto" : "hidden";
  $form.classList.toggle("compact-send", $messageInput.scrollHeight > 80);
}

function appendMessage(role, text, results = [], prompt = "") {
  const wrapper = document.createElement("article");
  wrapper.className = `message ${role}`;

  const label = document.createElement("p");
  label.className = "message-label";
  label.textContent = role === "user" ? "Вы" : "Помощник";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrapper.append(label, bubble);

  if (role === "assistant" && prompt) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Показать сформированный запрос";
    const preview = document.createElement("pre");
    preview.textContent = prompt;
    details.append(summary, preview);
    wrapper.appendChild(details);
  }

  if (role === "assistant" && results.length) {
    const sources = document.createElement("div");
    sources.className = "sources";
    for (const { doc, score } of results) {
      const source = document.createElement("article");
      source.className = "source";
      const top = document.createElement("div");
      top.className = "source-top";
      const id = document.createElement("strong");
      id.textContent = doc.id;
      const scoreLabel = document.createElement("span");
      scoreLabel.className = "source-score";
      const risk = doc.meta.churnProbability != null
        ? ` · оценка оттока: ${(doc.meta.churnProbability * 100).toFixed(0)}%`
        : "";
      scoreLabel.textContent = `BM25: ${score.toFixed(2)} · ${doc.meta.status}${risk}`;
      const textContent = document.createElement("div");
      textContent.className = "source-text";
      textContent.textContent = doc.text;
      top.append(id, scoreLabel);
      source.append(top, textContent);
      sources.appendChild(source);
    }
    wrapper.appendChild(sources);
  }

  $messages.appendChild(wrapper);
  $messages.scrollTop = $messages.scrollHeight;
}

function updateLastAssistantText(text) {
  const bubbles = $messages.querySelectorAll(".message.assistant .bubble");
  const last = bubbles[bubbles.length - 1];
  if (last) last.textContent = text;
  $messages.scrollTop = $messages.scrollHeight;
}

function renderChat() {
  $messages.replaceChildren();
  $chatTitle.textContent = activeChat.title;
  for (const message of activeChat.messages) {
    appendMessage(message.role, message.text, message.results, message.prompt);
  }
  if (activeChat.messages.length === 0) {
    const welcome = document.createElement("div");
    welcome.className = "welcome";
    const heading = document.createElement("strong");
    heading.textContent = "Чем помочь по клиенту?";
    const text = document.createElement("span");
    text.textContent = "Опишите ситуацию в сообщении или добавьте известные признаки клиента. Поля формы необязательны.";
    welcome.append(heading, text);
    $messages.appendChild(welcome);
  }
  renderChatList();
}

function selectChat(chat) {
  if (isLoading) return;
  activeChat = chat;
  for (const field of clientFields) {
    field.value = chat.clientData[field.dataset.field] || "";
  }
  setFormMode(chat.formMode || "basic");
  updateClientSummary();
  setStatus("");
  closeChatMenu();
  renderChat();
}

function createChat() {
  const chat = {
    id: `${Date.now()}-${Math.random()}`,
    title: "Новый запрос",
    clientData: {},
    messages: [],
  };
  chats.unshift(chat);
  selectChat(chat);
  $messageInput.focus();
}

async function handleSubmit(event) {
  event.preventDefault();
  const message = $messageInput.value.trim();
  if (!message || isLoading || !isReady || !activeChat) return;

  const chat = activeChat;
  const clientData = readClientData();
  const hasData = hasClientInformation(clientData, message);
  const prompt = buildPrompt(clientData, message);
  const title = message.length > 34 ? `${message.slice(0, 34)}…` : message;
  chat.clientData = clientData;
  chat.title = chat.messages.length === 0 ? title : chat.title;
  chat.messages.push({ role: "user", text: message });

  let assistantMessage;
  if (!hasData) {
    assistantMessage = {
      role: "assistant",
      text: "Не удалось определить данные клиента в запросе. Заполните блок «Данные клиента» или добавьте в сообщение известные признаки — например возраст, тип карты, доход или активность.",
      results: [],
      prompt,
    };
    chat.messages.push(assistantMessage);
  } else {
    const results = search(prompt, CONFIG.topK);
    assistantMessage = { role: "assistant", text: "", results, prompt };
    chat.messages.push(assistantMessage);
  }

  $messageInput.value = "";
  resizeMessageInput();
  isLoading = true;
  $send.disabled = true;
  $newChat.disabled = true;
  $mobileNewChat.disabled = true;
  renderChat();

  if (!hasData) {
    setStatus("Данные клиента не указаны.");
    finishLoading();
    return;
  }

  const results = assistantMessage.results;
  if (!results.length) {
    assistantMessage.text = "Похожих клиентов не найдено. Попробуйте изменить формулировку.";
    setStatus("Похожих клиентов не найдено.");
    finishLoading();
    return;
  }

  setStatus("Формируется ответ…");
  try {
    const answer = await ask(prompt, results, {
      onToken: (text) => {
        assistantMessage.text = text;
        updateLastAssistantText(text);
      },
    });
    assistantMessage.text = answer;
    setStatus(`Найдено похожих клиентов: ${results.length}.`);
  } catch (err) {
    console.error(err);
    // Альтернативный сценарий 2: LLM недоступна — показываем источники без ответа.
    // Если модель успела выдать часть ответа до обрыва/таймаута — не прячем её.
    assistantMessage.text = assistantMessage.text
      ? `${assistantMessage.text}\n\n— ответ не завершён: ${err.message || "ошибка вызова модели"}.`
      : "Не удалось сформировать ответ, попробуйте позже.";
    assistantMessage.llmError = true;
    setStatus("Не удалось сформировать ответ, попробуйте позже", true);
  }
  finishLoading();
}

function finishLoading() {
  isLoading = false;
  setReady(isReady);
}

async function init() {
  setReady(false);
  setStatus("Загружается корпус клиентов…");
  try {
    const response = await fetch(CONFIG.corpusUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const corpus = await response.json();
    const stats = buildIndex(corpus);
    corpusSize = stats.docCount;
    console.log(`Индекс BM25 построен: ${stats.docCount} документов, ${stats.terms} терминов`);
  } catch (err) {
    console.error(err);
    setStatus("Не удалось загрузить корпус клиентов. Запустите сайт через локальный сервер из корня проекта (см. README).", true);
    return;
  }

  setStatus("Загружается модель… Первый запуск может занять несколько минут.");
  const provider = await initLLM((text) => setStatus(text || "Загружается модель…"));
  setReady(true);
  setStatus(
    provider === "webllm"
      ? `Готово. В базе ${corpusSize} клиентов, модель загружена локально.`
      : "Готово. WebLLM недоступна — ответы даёт локальная заглушка."
  );
}

$newChat.addEventListener("click", createChat);
$mobileNewChat.addEventListener("click", createChat);
$mobileChatToggle.addEventListener("click", toggleChatMenu);
$sidebarBackdrop.addEventListener("click", closeChatMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeChatMenu();
});
$form.addEventListener("submit", handleSubmit);
$messageInput.addEventListener("input", resizeMessageInput);
for (const button of formModeButtons) {
  button.addEventListener("click", () => setFormMode(button.dataset.formMode));
}
for (const label of shortLabels) {
  label.dataset.fullLabel = label.textContent.trim();
}
compactLayout.addEventListener("change", updateFieldLabels);
updateFieldLabels();
clientFields.forEach((field) => {
  field.addEventListener("input", () => {
    activeChat.clientData[field.dataset.field] = field.value.trim();
    updateClientSummary();
  });
  field.addEventListener("change", () => {
    activeChat.clientData[field.dataset.field] = field.value.trim();
    updateClientSummary();
  });
});
$messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $form.requestSubmit();
  }
});

createChat();
init();
