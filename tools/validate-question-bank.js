const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const questions = JSON.parse(fs.readFileSync(path.join(root, "questions.json"), "utf8"));
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "data", "questions.js"), "utf8"), sandbox);
const bundled = sandbox.window.SEMICONDUCTOR_QUESTION_BANK;

const errors = [];
const warn = [];

function fail(message) {
  errors.push(message);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

if (!Array.isArray(questions)) fail("questions.json must be an array.");
if (!Array.isArray(bundled)) fail("data/questions.js must expose window.SEMICONDUCTOR_QUESTION_BANK.");
if (questions.length !== 300) fail(`Expected 300 questions, got ${questions.length}.`);
if (bundled.length !== questions.length) fail(`Bundled question count mismatch: ${bundled.length} vs ${questions.length}.`);

const chapters = new Set();
const ids = new Set();
const shortAnswers = new Map();

questions.forEach((question) => {
  if (ids.has(question.id)) fail(`Duplicate id ${question.id}.`);
  ids.add(question.id);
  chapters.add(question.chapter);
  if (question.short_answer) shortAnswers.set(clean(question.short_answer), question.id);
});

for (let id = 1; id <= questions.length; id += 1) {
  if (!ids.has(id)) fail(`Missing id ${id}.`);
}
if (chapters.size !== 12) fail(`Expected 12 chapters, got ${chapters.size}.`);

questions.forEach((question, index) => {
  const prefix = `#${question.id || index + 1}`;
  if (!question.id || question.id !== index + 1) fail(`${prefix}: id must be sequential.`);
  if (!question.chapter || !question.chapter_name) fail(`${prefix}: missing chapter metadata.`);
  if (!question.question_text || !/面试(官)?追问/.test(question.question_text)) fail(`${prefix}: question_text should be interview-oriented.`);
  if (!Array.isArray(question.options) || question.options.length !== 4) fail(`${prefix}: options must contain 4 items.`);
  if (!Number.isInteger(question.correct) || question.correct < 0 || question.correct > 3) fail(`${prefix}: invalid correct index.`);
  if (!question.short_answer) fail(`${prefix}: missing short_answer.`);
  if (question.options?.[question.correct] !== question.short_answer) fail(`${prefix}: correct option must equal short_answer.`);
  if (!question.card_question) fail(`${prefix}: missing card_question.`);
  if (!question.card_answer) fail(`${prefix}: missing card_answer.`);
  if (new Set((question.options || []).map(clean)).size !== 4) fail(`${prefix}: duplicate options.`);
  if (!Array.isArray(question.interview_points) || question.interview_points.length < 3 || question.interview_points.length > 5) {
    fail(`${prefix}: interview_points must contain 3-5 items.`);
  }
  (question.interview_points || []).forEach((point, pointIndex) => {
    if (clean(point).length < 12) fail(`${prefix}: interview point ${pointIndex + 1} is too short.`);
  });
  question.options?.forEach((option, optionIndex) => {
    if (clean(option).length < 12) fail(`${prefix}: option ${optionIndex + 1} is too short.`);
  });
  question.options?.forEach((option, optionIndex) => {
    if (optionIndex !== question.correct && shortAnswers.has(clean(option))) {
      warn.push(`${prefix}: distractor ${optionIndex + 1} exactly matches another short_answer.`);
    }
  });
  const bundledQuestion = bundled[index];
  if (!bundledQuestion || bundledQuestion.id !== question.id || bundledQuestion.question_text !== question.question_text) {
    fail(`${prefix}: data/questions.js is not synchronized.`);
  }
});

if (warn.length) {
  console.warn(warn.join("\n"));
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Question bank OK: ${questions.length} questions, ${chapters.size} chapters, ${warn.length} warnings.`);
