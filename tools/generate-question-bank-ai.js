const fs = require("fs");
const path = require("path");
const readline = require("readline");

const root = path.resolve(__dirname, "..");
const questionPath = path.join(root, "questions.json");
const dataPath = path.join(root, "data", "questions.js");
const cacheDir = path.join(root, ".cache");
const cachePath = path.join(cacheDir, "ai-question-bank-cache.json");

const DEFAULT_API_BASE = "https://gcli.ggchan.dev";
const DEFAULT_MODEL = "gemini-3-flash-preview";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function boolArg(name) {
  return process.argv.includes(`--${name}`);
}

const requestTimes = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleRequests(maxPerMinute) {
  if (!maxPerMinute || maxPerMinute <= 0) return;
  const now = Date.now();
  while (requestTimes.length && now - requestTimes[0] >= 60_000) requestTimes.shift();
  if (requestTimes.length < maxPerMinute) {
    requestTimes.push(now);
    return;
  }
  const waitMs = Math.max(0, 60_000 - (now - requestTimes[0]) + 250);
  console.log(`Rate limit: waiting ${Math.ceil(waitMs / 1000)}s...`);
  await sleep(waitMs);
  return throttleRequests(maxPerMinute);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；：、！？])/g, "$1")
    .trim();
}

function endSentence(value) {
  const text = cleanText(value).replace(/[。；;,.，]+$/g, "");
  return text ? `${text}。` : "";
}

function stripQuestion(value) {
  const text = cleanText(value);
  const interviewMatch = text.match(/老师问“(.+?)”/);
  return (interviewMatch ? interviewMatch[1] : text).replace(/^\d+\s*[.、．]\s*/, "").replace(/[？?]+$/g, "");
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = cleanText(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const parseLoose = (value) => {
    try {
      return JSON.parse(value);
    } catch (error) {
      const repaired = value.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
      return JSON.parse(repaired);
    }
  };
  try {
    return parseLoose(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return parseLoose(fenced[1]);
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return parseLoose(raw.slice(start, end + 1));
    throw new Error("模型返回不是可解析 JSON。");
  }
}

function promptForKey() {
  if (process.env.AI_API_KEY) return Promise.resolve(process.env.AI_API_KEY);
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    return new Promise((resolve) => {
      let value = "";
      const stdin = process.stdin;
      const onData = (chunk) => {
        for (const text of Array.from(String(chunk))) {
          if (text === "\u0003") process.exit(130);
          if (text === "\r" || text === "\n") {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off("data", onData);
            process.stdout.write("\n");
            resolve(value.trim());
            return;
          }
          if (text === "\b" || text === "\u007f") {
            value = value.slice(0, -1);
          } else {
            value += text;
          }
        }
      };
      process.stdout.write("AI_API_KEY: ");
      stdin.setEncoding("utf8");
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
    });
  }
  const rl = readline.createInterface({ input: process.stdin, output: undefined });
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function sourceForModel(question) {
  return {
    id: question.id,
    chapter: question.chapter,
    chapter_name: question.chapter_name,
    original_question: stripQuestion(question.question_text || question.question),
    correct_answer: cleanText(question.short_answer || question.options?.[question.correct] || ""),
    formula: cleanText(question.formula),
    explanation: cleanText(question.explanation),
    tags: question.tags || [],
  };
}

function buildPrompt(batch) {
  const sources = batch.map(sourceForModel);
  return `你是一名严谨的模拟 IC / 半导体器件物理保研面试教练。请根据给定题目资料，为每题生成“保研面试概念追问型选择题”内容。

严格要求：
1. 只输出 JSON，不要 Markdown，不要解释。
2. 返回格式：
{
  "items": [
    {
      "id": 题号,
      "question_text": "面试追问式题干",
      "short_answer": "正确选项，一句话，适合面试口答",
      "distractors": ["错误选项1", "错误选项2", "错误选项3"],
      "interview_points": ["口答要点1", "口答要点2", "口答要点3"]
    }
  ]
}
3. question_text 要像老师追问，比如“面试追问：如果老师问……，哪种回答最准确？”
4. short_answer 必须与原 correct_answer 语义一致，可以润色，但不能改变正确知识。
5. distractors 必须是同一题语境下真实可能犯的错误理解，不能随机搬其他题答案；要有迷惑性但明确错误。
6. interview_points 为 3-5 条，每条适合开口回答，覆盖物理图像、公式含义/变量、适用条件/近似、易错点，必要时联系 PN 结、MOS、BJT 或光电器件。
7. 不要写“以上都对/都错”，不要出现空泛口号，不要让错误选项比正确选项明显短很多。
8. 不要使用 LaTeX 反斜杠命令，例如不要写 \\text、\\mu、\\frac；公式请用普通中文、Unicode 字符或题目原公式表达，避免 JSON 转义错误。

题目资料：
${JSON.stringify(sources, null, 2)}`;
}

async function requestBatch({ apiBase, apiKey, model, batch }) {
  const url = `${apiBase.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "你是半导体器件物理和模拟 IC 保研面试题库专家。你只返回严格 JSON，内容必须专业、可校验、适合中文面试训练。",
        },
        { role: "user", content: buildPrompt(batch) },
      ],
      temperature: 0.45,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型返回为空。");
  return extractJson(content);
}

function normalizeGenerated(question, generated) {
  const shortAnswer = endSentence(generated.short_answer || question.short_answer || question.options?.[question.correct]);
  const distractors = uniqueItems((generated.distractors || []).map(endSentence).filter((item) => item !== shortAnswer));
  if (distractors.length !== 3) throw new Error(`#${question.id}: distractors 必须正好 3 个。`);
  const points = uniqueItems((generated.interview_points || []).map(endSentence)).slice(0, 5);
  if (points.length < 3) throw new Error(`#${question.id}: interview_points 至少 3 条。`);
  const questionText = cleanText(generated.question_text || `面试追问：如果老师问“${stripQuestion(question.question_text || question.question)}”，哪种回答最准确？`);
  const options = new Array(4);
  options[question.correct] = shortAnswer;
  let cursor = 0;
  for (let index = 0; index < 4; index += 1) {
    if (index === question.correct) continue;
    options[index] = distractors[cursor];
    cursor += 1;
  }
  if (new Set(options.map(cleanText)).size !== 4) throw new Error(`#${question.id}: 选项重复。`);
  return {
    ...question,
    question: `${question.id}. ${questionText}`,
    question_text: questionText,
    short_answer: shortAnswer,
    options,
    interview_points: points,
  };
}

function loadCache() {
  if (!fs.existsSync(cachePath)) return {};
  return JSON.parse(fs.readFileSync(cachePath, "utf8"));
}

function saveCache(cache) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function writeBank(questions) {
  fs.writeFileSync(questionPath, `${JSON.stringify(questions, null, 2)}\n`, "utf8");
  fs.writeFileSync(dataPath, `window.SEMICONDUCTOR_QUESTION_BANK = ${JSON.stringify(questions, null, 2)};\n`, "utf8");
}

async function main() {
  const apiBase = argValue("api-base", process.env.AI_API_BASE || DEFAULT_API_BASE);
  const model = argValue("model", process.env.AI_MODEL || DEFAULT_MODEL);
  const batchSize = Math.max(1, Math.min(8, Number(argValue("batch-size", "3")) || 3));
  const rateLimit = Math.max(1, Number(argValue("rate-limit", process.env.AI_RATE_LIMIT || "20")) || 20);
  const limit = Number(argValue("limit", "0")) || 0;
  const dryRun = boolArg("dry-run");
  const apiKey = await promptForKey();
  if (!apiKey) throw new Error("缺少 API key。");

  const questions = JSON.parse(fs.readFileSync(questionPath, "utf8"));
  const cache = loadCache();
  const targets = questions.filter((question) => !cache[question.id]).slice(0, limit || questions.length);
  console.log(`Model: ${model}`);
  console.log(`Pending: ${targets.length}, cached: ${Object.keys(cache).length}, batchSize: ${batchSize}, rateLimit: ${rateLimit}/min`);

  for (let start = 0; start < targets.length; start += batchSize) {
    const batch = targets.slice(start, start + batchSize);
    let generated;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await throttleRequests(rateLimit);
        generated = await requestBatch({ apiBase, apiKey, model, batch });
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        console.warn(`Batch ${batch[0].id}-${batch[batch.length - 1].id} failed attempt ${attempt}: ${error.message}`);
        await sleep(1200 * attempt);
      }
    }
    const items = Array.isArray(generated?.items) ? generated.items : [];
    for (const question of batch) {
      const item = items.find((entry) => Number(entry.id) === Number(question.id));
      if (!item) throw new Error(`#${question.id}: 模型未返回该题。`);
      cache[question.id] = item;
    }
    saveCache(cache);
    console.log(`Cached ${Object.keys(cache).length}/${questions.length}`);
    await sleep(250);
  }

  const rewritten = questions.map((question) => {
    if (!cache[question.id]) return question;
    return normalizeGenerated(question, cache[question.id]);
  });
  if (!dryRun) writeBank(rewritten);
  console.log(dryRun ? "Dry run complete." : `Wrote ${rewritten.length} questions.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
