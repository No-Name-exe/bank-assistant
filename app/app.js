const CONFIG = {
  topK: 5,
  llmProvider: "mock",
};

const MOCK_CORPUS = [
  {
    id: "C10001",
    text: "Клиент 46 лет, жен. Доход $60K–$80K. Карта Platinum. С банком 36 месяцев. Транзакций за год: 45. Сумма транзакций: $3200. Обращений в поддержку: 3. Статус: ушёл.",
    status: "ушёл",
  },
  {
    id: "C10002",
    text: "Клиент 44 года, муж. Доход $60K–$80K. Карта Platinum. С банком 34 месяца. Транзакций за год: 52. Сумма транзакций: $3700. Обращений в поддержку: 2. Статус: остался.",
    status: "остался",
  },
  {
    id: "C10003",
    text: "Клиент 50 лет, муж. Доход $80K–$120K. Карта Gold. С банком 60 месяцев. Транзакций за год: 120. Сумма транзакций: $9800. Обращений в поддержку: 1. Статус: остался.",
    status: "остался",
  },
  {
    id: "C10004",
    text: "Клиент 47 лет, жен. Доход $40K–$60K. Карта Blue. С банком 48 месяцев. Транзакций за год: 30. Сумма транзакций: $1800. Обращений в поддержку: 4. Статус: ушёл.",
    status: "ушёл",
  },
  {
    id: "C10005",
    text: "Клиент 45 лет, жен. Доход $60K–$80K. Карта Platinum. С банком 36 месяцев. Транзакций за год: 40. Сумма транзакций: $2900. Обращений в поддержку: 3. Статус: ушёл.",
    status: "ушёл",
  },
];

function search(query, k) {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  const scored = MOCK_CORPUS.map((doc) => {
    const text = doc.text.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (t.length < 3) continue;
      if (text.includes(t)) score += 1;
    }
    if (q.includes("ушёл") && doc.status === "ушёл") score += 0.5;
    return { doc, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

async function ask(query, documents, hasClientInformation) {
  if (!hasClientInformation) {
    return "Не удалось определить данные клиента в запросе. Заполните блок «Данные клиента» или добавьте в сообщение известные признаки — например возраст, тип карты, доход или активность.";
  }

  if (documents.length === 0) {
    return "Похожих клиентов не найдено. Попробуйте изменить формулировку.";
  }

  const gone = documents.filter((d) => d.doc.status === "ушёл").length;
  const stayed = documents.length - gone;

  return [
    `Найдено ${documents.length} похожих клиентов: ${gone} ушли, ${stayed} остались.`,
    ``,
    `Клиенты с похожими признаками (карта Platinum, падение транзакций, несколько обращений в поддержку) чаще уходят.`,
    `Рекомендация: связаться с клиентом, предложить персональное удержание и уточнить причины снижения активности.`,
    ``,
    `(Это заглушка ответа. После КТ1 здесь будет ответ LLM на основе найденных документов.)`,
  ].join("\n");
}

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

function setStatus(text, isError = false) {
  $status.textContent = text;
  $status.classList.toggle("error", isError);
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
      scoreLabel.textContent = `BM25: ${score.toFixed(2)} · ${doc.status}`;
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
  if (!message || isLoading) return;

  const chat = activeChat;
  const clientData = readClientData();
  const hasData = hasClientInformation(clientData, message);
  const prompt = buildPrompt(clientData, message);
  const title = message.length > 34 ? `${message.slice(0, 34)}…` : message;
  chat.clientData = clientData;
  chat.title = chat.messages.length === 0 ? title : chat.title;
  chat.messages.push({ role: "user", text: message });
  $messageInput.value = "";
  resizeMessageInput();
  isLoading = true;
  $send.disabled = true;
  $newChat.disabled = true;
  $mobileNewChat.disabled = true;
  setStatus(hasData ? "Идёт поиск похожих клиентов…" : "Проверяю данные запроса…");
  renderChat();

  try {
    const results = hasData ? search(prompt, CONFIG.topK) : [];
    if (hasData) setStatus("Формируется ответ…");
    const answer = await ask(prompt, results, hasData);
    chat.messages.push({ role: "assistant", text: answer, results, prompt });
    setStatus(
      !hasData
        ? "Данные клиента не указаны."
        : results.length
          ? `Найдено похожих клиентов: ${results.length}.`
          : "Похожих клиентов не найдено."
    );
  } catch (err) {
    console.error(err);
    chat.messages.push({
      role: "assistant",
      text: "Не удалось сформировать ответ, попробуйте позже.",
      results: [],
      prompt,
    });
    setStatus("Произошла ошибка. Попробуйте ещё раз.", true);
  } finally {
    isLoading = false;
    $send.disabled = false;
    $newChat.disabled = false;
    $mobileNewChat.disabled = false;
    renderChat();
  }
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
