// Одноразовый скрипт подготовки корпуса. Запуск: node corpus.js
// Читает data/BankChurners.csv и создаёт data/corpus.json —
// массив документов { id, text, meta } для поиска BM25.
// CSV парсится самостоятельно (без зависимостей), поддержаны
// кавычки и экранированные кавычки внутри полей.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(ROOT, "data", "BankChurners.csv");
const OUT_PATH = join(ROOT, "data", "corpus.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  return rows;
}

function plural(n, forms) {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 > 10 && mod100 < 20) return forms[2];
  if (mod10 > 1 && mod10 < 5) return forms[1];
  if (mod10 === 1) return forms[0];
  return forms[2];
}

function formatMoney(value) {
  return `$${Number(value).toLocaleString("en-US")}`;
}

function formatPercent(ratio) {
  const percent = Math.round((Number(ratio) - 1) * 100);
  return percent > 0 ? `+${percent}%` : `${percent}%`;
}

const GENDER = { M: "муж", F: "жен" };
const STATUS = { "Existing Customer": "остался", "Attrited Customer": "ушёл" };

function describeClient(r) {
  const parts = [
    `Клиент ${r.Customer_Age} ${plural(Number(r.Customer_Age), ["год", "года", "лет"])}, ${GENDER[r.Gender] || r.Gender}`,
    `доход ${r.Income_Category}`,
    `карта ${r.Card_Category}`,
    `с банком ${r.Months_on_book} ${plural(Number(r.Months_on_book), ["месяц", "месяца", "месяцев"])}`,
    `продуктов банка: ${r.Total_Relationship_Count}`,
    `без активности: ${r.Months_Inactive_12_mon} ${plural(Number(r.Months_Inactive_12_mon), ["месяц", "месяца", "месяцев"])} за год`,
    `транзакций за год: ${Number(r.Total_Trans_Ct).toLocaleString("en-US")}`,
    `сумма транзакций: ${formatMoney(r.Total_Trans_Amt)}`,
    `обращений в поддержку: ${r.Contacts_Count_12_mon}`,
    `изменение суммы транзакций Q4 к Q1: ${formatPercent(r.Total_Amt_Chng_Q4_Q1)}`,
    `изменение числа транзакций Q4 к Q1: ${formatPercent(r.Total_Ct_Chng_Q4_Q1)}`,
    `кредитный лимит: ${formatMoney(r.Credit_Limit)}`,
    `использовано от лимита: ${(Number(r.Avg_Utilization_Ratio) * 100).toFixed(1).replace(/\.0$/, "")}%`,
    `образование: ${r.Education_Level}`,
    `семейное положение: ${r.Marital_Status}`,
    `иждивенцев: ${r.Dependent_count}`,
    `статус: ${STATUS[r.Attrition_Flag] || r.Attrition_Flag}`,
  ];
  return parts.join(". ") + ".";
}

function main() {
  const rows = parseCsv(readFileSync(CSV_PATH, "utf8"));
  const [header, ...records] = rows;
  const columnIndex = Object.fromEntries(header.map((name, i) => [name, i]));

  const need = [
    "CLIENTNUM", "Attrition_Flag", "Customer_Age", "Gender", "Dependent_count",
    "Education_Level", "Marital_Status", "Income_Category", "Card_Category",
    "Months_on_book", "Total_Relationship_Count", "Months_Inactive_12_mon",
    "Contacts_Count_12_mon", "Credit_Limit", "Total_Revolving_Bal", "Avg_Open_To_Buy",
    "Total_Amt_Chng_Q4_Q1", "Total_Trans_Amt", "Total_Trans_Ct", "Total_Ct_Chng_Q4_Q1",
    "Avg_Utilization_Ratio",
  ];
  const missing = need.filter((name) => !(name in columnIndex));
  if (missing.length) {
    throw new Error(`В CSV не найдены колонки: ${missing.join(", ")}`);
  }

  // Последние две колонки — выходы наивного байесовского классификатора:
  // вероятность оттока и вероятность остаться.
  const probabilityColumns = header.filter((name) => name.startsWith("Naive_Bayes_Classifier"));

  const docs = records.map((record) => {
    const r = Object.fromEntries(need.map((name) => [name, record[columnIndex[name]]]));
    return {
      id: `C${r.CLIENTNUM}`,
      text: describeClient(r),
      meta: {
        status: STATUS[r.Attrition_Flag] || r.Attrition_Flag,
        age: Number(r.Customer_Age),
        gender: GENDER[r.Gender] || r.Gender,
        income: r.Income_Category,
        card: r.Card_Category,
        monthsOnBook: Number(r.Months_on_book),
        totalTransCt: Number(r.Total_Trans_Ct),
        totalTransAmt: Number(r.Total_Trans_Amt),
        contacts: Number(r.Contacts_Count_12_mon),
        creditLimit: Number(r.Credit_Limit),
        churnProbability: probabilityColumns.length
          ? Number(record[columnIndex[probabilityColumns[0]]])
          : null,
      },
    };
  });

  writeFileSync(OUT_PATH, JSON.stringify(docs));
  console.log(`Готово: ${docs.length} документов → ${OUT_PATH}`);
  console.log(`Пример: ${docs[0].text}`);
}

main();
