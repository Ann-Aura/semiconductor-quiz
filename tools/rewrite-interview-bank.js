const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const questionPath = path.join(root, "questions.json");
const dataPath = path.join(root, "data", "questions.js");

const DOMAIN_TERMS = [
  "准费米能级",
  "爱因斯坦关系",
  "Ebers-Moll",
  "内建电势",
  "耗尽区",
  "少数载流子",
  "多数载流子",
  "阈值电压",
  "表面态",
  "氧化层",
  "肖特基",
  "齐纳",
  "雪崩",
  "MOS",
  "BJT",
  "PN 结",
  "PN结",
  "费米能级",
  "迁移率",
  "扩散",
  "漂移",
  "复合",
  "产生",
  "禁带",
  "导带",
  "价带",
  "能带",
  "载流子",
  "电子",
  "空穴",
  "本征",
  "掺杂",
  "施主",
  "受主",
  "电场",
  "电流",
  "电导率",
  "温度",
  "光照",
  "沟道",
  "低注入",
  "高注入",
  "热平衡",
  "非平衡",
  "泊松方程",
  "GaAs",
  "Si",
  "Ge",
  "硅",
  "锗",
];

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；：、！？])/g, "$1")
    .replace(/([（(])\s+/g, "$1")
    .replace(/\s+([）)])/g, "$1")
    .trim();
}

function endSentence(value) {
  const text = cleanText(value).replace(/[。；;,.，]+$/g, "");
  return text ? `${text}。` : "";
}

function stripQuestion(value) {
  const text = cleanText(value);
  const interviewMatch = text.match(/老师问“(.+?)”/);
  return (interviewMatch ? interviewMatch[1] : text)
    .replace(/^\d+\s*[.、．]\s*/, "")
    .replace(/[？?]+$/g, "");
}

function splitSentences(value) {
  const text = cleanText(value);
  const matches = text.match(/[^。！？!?]+[。！？!?]?/g) || [];
  return matches.map((item) => cleanText(item)).filter(Boolean);
}

function pickTerms(question) {
  const highSignal = [stripQuestion(question.question_text || question.question), question.short_answer, ...(question.tags || [])].join(" ");
  const mediumSignal = [question.formula, question.chapter_name].join(" ");
  const lowSignal = question.explanation || "";
  const scored = DOMAIN_TERMS.map((term) => {
    let score = 0;
    if (highSignal.includes(term)) score += 100;
    if (mediumSignal.includes(term)) score += 35;
    if (lowSignal.includes(term)) score += 10;
    return { term, score };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.term.length - a.term.length)
    .map((item) => item.term);
  const unique = [...new Set(scored)];
  if (unique.length >= 2) return unique;
  const fallback = cleanText(question.tags?.[0] || question.chapter_name || "半导体物理");
  return [...unique, fallback].filter(Boolean);
}

function safeSlice(value, size) {
  return Array.from(value).slice(0, size).join("");
}

function formulaBrief(value) {
  const formula = cleanText(value);
  if (!formula) return "";
  return Array.from(formula).length > 42 ? `${safeSlice(formula, 42)}...` : formula;
}

function devicePoint(question) {
  const text = [question.question_text, question.chapter_name, ...(question.tags || [])].join(" ");
  if (/MOS|阈值|沟道|氧化层|表面/.test(text)) return "器件联系：可以联系 MOS 结构中的表面势、沟道形成或阈值条件。";
  if (/PN|耗尽|内建|正向|反向|二极管/.test(text)) return "器件联系：可以联系 PN 结的耗尽区、电势分布和偏置下的载流子输运。";
  if (/BJT|双极|发射|基区|集电/.test(text)) return "器件联系：可以联系 BJT 中少子注入、基区输运和电流放大。";
  if (/光|复合|产生|LED|太阳能|光电/.test(text)) return "器件联系：可以联系光电器件中载流子的产生、复合和收集过程。";
  return "";
}

function inferContext(question) {
  const text = [question.question_text, question.short_answer, question.explanation, question.chapter_name, ...(question.tags || [])].join(" ");
  if (/MOS|阈值|沟道|氧化层|表面|栅/.test(text)) return "mos";
  if (/BJT|双极|发射|基区|集电|少子存储/.test(text)) return "bjt";
  if (/PN|耗尽|内建|正向|反向|二极管|击穿/.test(text)) return "pn";
  if (/光|复合|产生|LED|太阳能|光电|辐射/.test(text)) return "opto";
  if (/能带|禁带|导带|价带|费米/.test(text)) return "band";
  if (/漂移|扩散|迁移率|电流|电导率|电阻率/.test(text)) return "transport";
  return "general";
}

function makeInterviewPoints(question, correct, terms) {
  const sentences = splitSentences(question.explanation);
  const first = endSentence(sentences[0] || correct);
  const points = [
    `物理图像：${first}`,
    question.formula
      ? `公式联系：${formulaBrief(question.formula)} 中的物理量要和题干条件对应，不能只背符号。`
      : `表达重点：先说明核心概念，再说它影响哪类能带、载流子或电场过程。`,
    "适用条件：回答时要主动交代材料、温度、掺杂、偏置以及热平衡/非平衡条件。",
    `易错点：不要只背${terms[0] || "关键词"}这个词，要说明它和题干条件之间的因果关系。`,
  ];
  const device = devicePoint(question);
  if (device) points.push(device);
  return points.slice(0, 5);
}

function makeDistractors(question, terms) {
  const primary = terms[0] || "该概念";
  const hasFormula = Boolean(cleanText(question.formula));
  const context = inferContext(question);
  const contextMistakes = {
    band: [
      "只从电子是否自由运动来判断材料性质，而不讨论价带、导带和禁带宽度的相对位置。",
      "认为能带图只是定性示意，不能用来解释载流子浓度、费米能级或导电能力的变化。",
    ],
    transport: [
      "只看载流子浓度大小即可判断电流，迁移率、扩散系数和电场方向通常不会影响结论。",
      "把漂移和扩散都理解成外电场驱动的同一种运动，因此不需要区分浓度梯度和电场。",
    ],
    pn: [
      "把 PN 结看成两个中性半导体简单接触，忽略空间电荷区、内建电场和边界条件。",
      "认为正向偏置和反向偏置只是电压符号不同，不会改变势垒、注入和耗尽区宽度。",
    ],
    mos: [
      "把 MOSFET 的沟道形成只归因于几何尺寸，忽略表面势、氧化层电场和阈值条件。",
      "认为栅压只改变漏端电流大小，不会改变半导体表面的能带弯曲和载流子分布。",
    ],
    bjt: [
      "把 BJT 电流放大理解成多数载流子在三个区中串联流动，忽略少子注入和基区输运。",
      "认为发射区、基区和集电区只影响电阻大小，不会改变注入效率和复合损失。",
    ],
    opto: [
      "把光照或复合只看成能量变化，忽略电子空穴对的产生、寿命和空间分离过程。",
      "认为直接带隙和间接带隙只影响禁带宽度大小，不会影响辐射复合概率。",
    ],
    general: [
      "把题目中的关键词当成固定定义即可，不需要解释物理机制、边界条件和材料参数。",
      "只要最终结论记对，就不需要区分材料、结构、工艺条件或具体器件场景。",
    ],
  };
  const candidates = [
    ...(contextMistakes[context] || contextMistakes.general),
    hasFormula
      ? `看到公式时只需要代入数值，公式中各物理量的方向、符号和近似条件不会改变物理判断。`
      : `这主要是一个名词定义，通常不需要联系能带、载流子或电场的物理图像。`,
    `这个结论可以从热平衡直接推广到非平衡、低注入和强场情况，不必重新判断适用范围。`,
    `面试时应优先背出${primary}这个关键词，背后的因果关系和适用范围一般不是重点。`,
    `只要最终结论记对，就不需要区分本征/掺杂、热平衡/非平衡或具体器件结构。`,
  ];
  return candidates.map(endSentence);
}

function rewriteQuestion(question) {
  const originalQuestion = stripQuestion(question.question_text || question.question);
  const correct = endSentence(question.short_answer || question.options?.[question.correct] || question.explanation);
  const terms = pickTerms(question);
  const questionText = `面试追问：如果老师问“${originalQuestion}”，哪种回答最准确？`;
  const options = new Array(4);
  options[question.correct] = correct;
  const distractors = makeDistractors(question, terms).filter((item) => item && item !== correct);
  let cursor = 0;
  for (let index = 0; index < 4; index += 1) {
    if (index === question.correct) continue;
    while (distractors[cursor] && options.includes(distractors[cursor])) cursor += 1;
    options[index] = distractors[cursor] || `把${terms[0] || "该概念"}当成固定结论即可，不必讨论条件和物理机制。`;
    cursor += 1;
  }
  return {
    ...question,
    question: `${question.id}. ${questionText}`,
    question_text: questionText,
    short_answer: correct,
    options,
    interview_points: makeInterviewPoints(question, correct, terms),
  };
}

const questions = JSON.parse(fs.readFileSync(questionPath, "utf8"));
const rewritten = questions.map(rewriteQuestion);

fs.writeFileSync(questionPath, `${JSON.stringify(rewritten, null, 2)}\n`, "utf8");
fs.writeFileSync(dataPath, `window.SEMICONDUCTOR_QUESTION_BANK = ${JSON.stringify(rewritten, null, 2)};\n`, "utf8");

console.log(`Rewrote ${rewritten.length} interview-oriented questions.`);
