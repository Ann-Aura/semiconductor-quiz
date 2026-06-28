const STORAGE = {
  progress: "semiquiz-progress-v2",
  mistakes: "semiquiz-mistakes-v2",
  favorites: "semiquiz-favorites-v2",
  aiConfig: "semiquiz-ai-config-v2",
  aiCache: "semiquiz-ai-cache-v2",
  aiChats: "semiquiz-ai-chats-v1",
  practiceSession: "semiquiz-practice-session-v1",
  backupConfig: "semiquiz-backup-config-v2",
  theme: "semiquiz-theme-v2",
};

const BACKUP_FILENAME = "semiconductor-quiz-backup.json";
const LEGACY_DATA_KEY = "semiquiz_data";
const LEGACY_THEME_KEY = "semiquiz_theme";
const LABELS = ["A", "B", "C", "D", "E", "F"];
const DEFAULT_AI_CUSTOM_PROMPT =
  "先判断选择题：说明正确选项为什么对、错误选项错在哪里；再给出保研面试 30-60 秒口答框架；最后给记忆抓手、近似条件、适用范围和易错点。";
const FOLLOWUP_SUGGESTIONS = ["为什么选这个？", "公式怎么理解？", "考试怎么写？", "举个物理图像例子", "我还是没懂"];

let questions = [];
let chapters = [];
let progress = { answered: {}, xp: 0, level: 1, achievements: {}, studyLog: {} };
let mistakes = {};
let favorites = {};
let sessionStart = Date.now();
let todayStr = getTodayStr();

const state = {
  view: "home",
  practice: null,
  exam: null,
  timer: null,
  searchQuery: "",
  reviewFilter: "all",
  aiStatus: {},
  aiExpanded: {},
  aiFollowupDrafts: {},
  aiFollowupLoading: {},
  backupMessage: "",
  configMessage: "",
  backupInFlight: false,
};

const $ = (selector) => document.querySelector(selector);

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeQuestion(raw) {
  const id = Number(raw.id);
  const correct = Number(raw.correct);
  return {
    id,
    chapter: Number(raw.chapter) || 0,
    chapterName: raw.chapter_name || `第 ${raw.chapter || ""} 章`,
    question: raw.question_text || raw.question || "",
    options: Array.isArray(raw.options) ? raw.options : [],
    correct: Number.isFinite(correct) ? correct : 0,
    formula: raw.formula || "",
    explanation: raw.explanation || "",
    shortAnswer: raw.short_answer || raw.explanation || "",
    interviewPoints: Array.isArray(raw.interview_points) ? raw.interview_points.filter((point) => typeof point === "string") : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}

async function loadQuestionBank() {
  if (Array.isArray(window.SEMICONDUCTOR_QUESTION_BANK)) {
    return window.SEMICONDUCTOR_QUESTION_BANK;
  }
  const response = await fetch("questions.json");
  if (!response.ok) throw new Error(`题库读取失败：HTTP ${response.status}`);
  return response.json();
}

async function init() {
  loadTheme();
  loadData();
  try {
    const bank = await loadQuestionBank();
    questions = bank.map(normalizeQuestion).filter((q) => q.id && q.question);
    buildChapters();
    checkIn();
    bindEvents();
    updateGlobalStats();
    showView("home");
  } catch (error) {
    $("#homeView").innerHTML = `<div class="empty">题库加载失败：${escapeHtml(error.message || String(error))}</div>`;
  }
}

function buildChapters() {
  const map = new Map();
  questions.forEach((q) => {
    if (!map.has(q.chapter)) map.set(q.chapter, { id: q.chapter, name: q.chapterName, count: 0 });
    map.get(q.chapter).count += 1;
  });
  chapters = [...map.values()].sort((a, b) => a.id - b.id);
  $("#bankMeta").textContent = `${questions.length} 题 · ${chapters.length} 个章节`;
}

function loadData() {
  const hasV2 = localStorage.getItem(STORAGE.progress);
  if (!hasV2) migrateLegacyData();
  progress = sanitizeProgress(readJson(STORAGE.progress, progress));
  mistakes = sanitizeObject(readJson(STORAGE.mistakes, {}));
  favorites = sanitizeObject(readJson(STORAGE.favorites, {}));
}

function sanitizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sanitizeProgress(value) {
  const source = sanitizeObject(value);
  return {
    answered: sanitizeObject(source.answered),
    xp: Number(source.xp) || 0,
    level: Number(source.level) || 1,
    achievements: sanitizeObject(source.achievements),
    studyLog: sanitizeObject(source.studyLog),
  };
}

function migrateLegacyData() {
  const old = readJson(LEGACY_DATA_KEY, null);
  if (!old || typeof old !== "object") return;
  const migratedProgress = {
    answered: sanitizeObject(old.answered),
    xp: Number(old.xp) || 0,
    level: Number(old.level) || 1,
    achievements: sanitizeObject(old.achievements),
    studyLog: sanitizeObject(old.studyLog),
  };
  const migratedMistakes = {};
  (old.wrongList || []).forEach((id) => {
    const record = migratedProgress.answered[id] || {};
    migratedMistakes[id] = {
      wrongCount: Number(record.wrongCount) || 1,
      lastWrongAt: record.timestamp ? new Date(record.timestamp).toISOString() : new Date().toISOString(),
    };
  });
  writeJson(STORAGE.progress, migratedProgress);
  writeJson(STORAGE.mistakes, migratedMistakes);
  const oldTheme = localStorage.getItem(LEGACY_THEME_KEY);
  if (oldTheme && !localStorage.getItem(STORAGE.theme)) localStorage.setItem(STORAGE.theme, oldTheme);
}

function saveProgress() {
  writeJson(STORAGE.progress, progress);
}

function saveMistakes() {
  const valid = Object.fromEntries(Object.entries(mistakes).filter(([id]) => questionById(id)));
  mistakes = valid;
  writeJson(STORAGE.mistakes, mistakes);
}

function saveFavorites() {
  const valid = Object.fromEntries(Object.entries(favorites).filter(([id]) => questionById(id)));
  favorites = valid;
  writeJson(STORAGE.favorites, favorites);
}

function sanitizePracticeRecords(records) {
  const source = sanitizeObject(records);
  const clean = {};
  Object.entries(source).forEach(([id, record]) => {
    if (!questionById(id)) return;
    const item = sanitizeObject(record);
    clean[id] = {
      checked: item.checked === true,
      selected: Number.isInteger(item.selected) ? item.selected : null,
      correct: item.correct === true,
      selfEval: typeof item.selfEval === "string" ? item.selfEval : "",
    };
  });
  return clean;
}

function practiceToSession(practice = state.practice) {
  if (!practice?.questions?.length) return null;
  return {
    title: practice.title || "未命名练习",
    questionIds: practice.questions.map((question) => question.id),
    index: Math.max(0, Math.min(Number(practice.index) || 0, practice.questions.length - 1)),
    records: sanitizePracticeRecords(practice.records),
    mode: practice.mode === "flip" ? "flip" : "choice",
    flipped: practice.flipped === true,
    removeOnCorrect: practice.removeOnCorrect === true,
    returnView: practice.returnView || "chapter",
    kind: practice.kind || "practice",
    savedAt: new Date().toISOString(),
  };
}

function getPracticeSession() {
  const saved = sanitizeObject(readJson(STORAGE.practiceSession, {}));
  if (!Array.isArray(saved.questionIds) || !saved.questionIds.length) return null;
  if (!questions.length) return null;
  const questionsFromSession = Array.isArray(saved.questionIds) ? saved.questionIds.map(questionById).filter(Boolean) : [];
  if (!questionsFromSession.length) {
    if (localStorage.getItem(STORAGE.practiceSession)) clearPracticeSession();
    return null;
  }
  return {
    title: typeof saved.title === "string" && saved.title ? saved.title : "上次练习",
    questions: questionsFromSession,
    index: Math.max(0, Math.min(Number(saved.index) || 0, questionsFromSession.length - 1)),
    records: sanitizePracticeRecords(saved.records),
    mode: saved.mode === "flip" ? "flip" : "choice",
    flipped: saved.flipped === true,
    removeOnCorrect: saved.removeOnCorrect === true,
    returnView: typeof saved.returnView === "string" && saved.returnView ? saved.returnView : "chapter",
    kind: typeof saved.kind === "string" && saved.kind ? saved.kind : "practice",
    savedAt: typeof saved.savedAt === "string" ? saved.savedAt : "",
  };
}

function savePracticeSession() {
  const session = practiceToSession();
  if (session) writeJson(STORAGE.practiceSession, session);
}

function clearPracticeSession() {
  localStorage.removeItem(STORAGE.practiceSession);
}

function getRestorablePracticeSummary() {
  const session = getPracticeSession();
  if (!session) return null;
  const answered = Object.values(session.records).filter((record) => record.checked).length;
  return {
    title: session.title,
    current: session.index + 1,
    total: session.questions.length,
    answered,
    mode: session.mode === "flip" ? "翻转卡片" : "选择题",
    savedAt: session.savedAt,
    returnView: session.returnView,
  };
}

function restorePracticeSession() {
  const session = getPracticeSession();
  if (!session) {
    showToast("没有可恢复的练习。");
    return;
  }
  state.practice = {
    title: session.title,
    questions: session.questions,
    index: session.index,
    records: session.records,
    mode: session.mode,
    flipped: session.flipped,
    removeOnCorrect: session.removeOnCorrect,
    returnView: session.returnView,
    kind: session.kind,
  };
  showPractice();
}

function renderPracticeResumeCta(compact = false) {
  const summary = getRestorablePracticeSummary();
  if (!summary) return "";
  return `
    <section class="practice-resume ${compact ? "compact" : ""}">
      <div>
        <strong>继续上次练习</strong>
        <p>${escapeHtml(summary.title)} · ${summary.mode} · 第 ${summary.current}/${summary.total} 题 · 已答 ${summary.answered}</p>
      </div>
      <button class="button" data-action="continue-practice">继续答题</button>
    </section>
  `;
}

function checkIn() {
  if (!progress.studyLog[todayStr]) progress.studyLog[todayStr] = { count: 0, correct: 0, wrong: 0, time: 0 };
  saveProgress();
}

function questionById(id) {
  const numeric = Number(id);
  return questions.find((q) => q.id === numeric);
}

function questionsByChapter(chapterId) {
  const numeric = Number(chapterId);
  return numeric ? questions.filter((q) => q.chapter === numeric) : questions;
}

function completedCount(sourceQuestions) {
  return sourceQuestions.filter((q) => progress.answered[q.id]).length;
}

function isFavorite(question) {
  return Boolean(favorites[question.id]);
}

function favoriteButton(question) {
  const saved = isFavorite(question);
  return `<button class="button secondary ${saved ? "favorited" : ""}" data-action="toggle-favorite" data-question-id="${question.id}">${
    saved ? "已收藏" : "收藏"
  }</button>`;
}

function toggleFavorite(question) {
  if (!question) return;
  if (favorites[question.id]) delete favorites[question.id];
  else favorites[question.id] = { savedAt: new Date().toISOString() };
  saveFavorites();
  updateGlobalStats();
  renderActiveView();
}

function selectedLabel(index) {
  return Number.isInteger(index) && LABELS[index] ? LABELS[index] : "未作答";
}

function correctLabel(question) {
  return selectedLabel(question.correct);
}

function recordAnswer(question, correct, payload = {}) {
  const previous = progress.answered[question.id] || {};
  progress.answered[question.id] = {
    ...previous,
    ...payload,
    correct,
    timestamp: Date.now(),
    wrongCount: correct ? Number(previous.wrongCount) || 0 : (Number(previous.wrongCount) || 0) + 1,
  };
  if (correct) {
    if (state.practice?.removeOnCorrect) delete mistakes[question.id];
  } else {
    mistakes[question.id] = {
      wrongCount: progress.answered[question.id].wrongCount,
      lastWrongAt: new Date().toISOString(),
    };
  }
  logStudy(correct);
  addXP(correct ? 10 : 2);
  saveProgress();
  saveMistakes();
  updateGlobalStats();
}

function logStudy(correct) {
  if (!progress.studyLog[todayStr]) progress.studyLog[todayStr] = { count: 0, correct: 0, wrong: 0, time: 0 };
  progress.studyLog[todayStr].count += 1;
  if (correct) progress.studyLog[todayStr].correct += 1;
  else progress.studyLog[todayStr].wrong += 1;
}

function addXP(amount) {
  progress.xp += amount;
  const nextLevel = Math.floor(Math.sqrt(progress.xp / 50)) + 1;
  if (nextLevel > progress.level) {
    progress.level = nextLevel;
    showToast(`升级到 Lv.${progress.level}`);
    spawnConfetti();
  } else {
    progress.level = nextLevel;
  }
  updateAchievements();
}

function updateAchievements() {
  const totalAnswered = Object.keys(progress.answered).length;
  const totalCorrect = Object.values(progress.answered).filter((item) => item.correct === true).length;
  const streak = calcStreak();
  const all = achievementDefinitions();
  all.forEach((ach) => {
    if (!progress.achievements[ach.id] && ach.check({ totalAnswered, totalCorrect, streak, level: progress.level })) {
      progress.achievements[ach.id] = Date.now();
      showToast(`解锁成就：${ach.name}`);
      spawnConfetti();
    }
  });
}

function achievementDefinitions() {
  return [
    { id: "first", name: "初出茅庐", check: (s) => s.totalAnswered >= 1 },
    { id: "ten", name: "小试牛刀", check: (s) => s.totalAnswered >= 10 },
    { id: "fifty", name: "渐入佳境", check: (s) => s.totalAnswered >= 50 },
    { id: "hundred", name: "百题斩", check: (s) => s.totalAnswered >= 100 },
    { id: "all", name: "全题通关", check: (s) => s.totalAnswered >= questions.length },
    { id: "streak3", name: "三日不辍", check: (s) => s.streak >= 3 },
    { id: "streak7", name: "持之以恒", check: (s) => s.streak >= 7 },
    { id: "perfect", name: "十连全对", check: (s) => s.totalCorrect >= 10 && s.totalCorrect === s.totalAnswered },
    { id: "level5", name: "Lv.5 达人", check: (s) => s.level >= 5 },
    { id: "level10", name: "Lv.10 大师", check: (s) => s.level >= 10 },
  ];
}

function showView(name) {
  state.view = name;
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  const target = document.getElementById(name === "chapter" ? "chapterView" : `${name}View`);
  if (target) target.classList.add("active-view");
  $("#sidebar").classList.remove("open");
  renderActiveView();
}

function renderActiveView() {
  updateGlobalStats();
  if (state.view === "home") renderHome();
  if (state.view === "chapter") renderChapterPicker();
  if (state.view === "practice") renderPractice();
  if (state.view === "exam") renderExamSetup();
  if (state.view === "mistakes") renderMistakes();
  if (state.view === "favorites") renderFavorites();
  if (state.view === "search") renderSearch();
  if (state.view === "backup") renderBackup();
  if (state.view === "config") renderConfigSafe();
  if (state.view === "result") renderPracticeResult();
}

function updateGlobalStats() {
  $("#statTotal").textContent = String(questions.length);
  $("#statMistakes").textContent = String(Object.keys(mistakes).length);
  $("#statFavorites").textContent = String(Object.keys(favorites).length);
  $("#statLevel").textContent = `Lv.${progress.level}`;
}

function renderHome() {
  const answeredCount = Object.keys(progress.answered).length;
  const correctCount = Object.values(progress.answered).filter((item) => item.correct === true).length;
  const rate = answeredCount ? Math.round((correctCount / answeredCount) * 100) : 0;
  const xpForNext = progress.level * progress.level * 50;
  const xpForCurrent = (progress.level - 1) * (progress.level - 1) * 50;
  const xpRate = Math.max(0, Math.min(100, ((progress.xp - xpForCurrent) / (xpForNext - xpForCurrent)) * 100));
  $("#homeView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>今天刷哪一块？</h2>
        <p>按章节补基础，用随机考试查漏，翻转卡适合背公式和概念。</p>
      </div>
      <div class="top-actions">
        <button class="button secondary" data-action="set-theme" data-theme="day">白天</button>
        <button class="button secondary" data-action="set-theme" data-theme="night">夜晚</button>
      </div>
    </div>
    <div class="grid stats-grid" style="margin-bottom:14px">
      <section class="card stat-card"><div><h3>已完成</h3><strong>${answeredCount}/${questions.length}</strong><p>累计做过的题目</p></div></section>
      <section class="card stat-card"><div><h3>正确率</h3><strong>${rate}%</strong><p>${correctCount} 道答对</p></div></section>
      <section class="card stat-card"><div><h3>经验等级</h3><strong>Lv.${progress.level}</strong><p>${progress.xp} XP</p></div></section>
      <section class="card stat-card"><div><h3>错题收藏</h3><strong>${Object.keys(mistakes).length}/${Object.keys(favorites).length}</strong><p>错题 / 收藏</p></div></section>
    </div>
    <section class="panel xp-line" style="margin-bottom:14px">
      <div class="chapter-meta">
        <span class="pill">当前 XP ${progress.xp}</span>
        <span class="pill">下一级 ${xpForNext}</span>
        <span class="pill">连续学习 ${calcStreak()} 天</span>
      </div>
      <div class="progress-track"><span style="width:${xpRate}%"></span></div>
    </section>
    ${renderPracticeResumeCta()}
    <div class="grid mode-grid">
      <article class="card mode-card">
        <h3>章节刷题</h3>
        <p>按半导体器件物理章节推进，选择题即时反馈，也可以切到翻转卡复习。</p>
        <div class="chapter-meta"><span class="pill">${chapters.length} 个章节</span><span class="pill">${questions.length} 题</span></div>
        <button class="button" data-action="go-chapter">开始章节刷题</button>
      </article>
      <article class="card mode-card">
        <h3>随机考试</h3>
        <p>随机抽题、计时交卷，结束后统一看错题和答案解析。</p>
        <div class="chapter-meta"><span class="pill">可选题量</span><span class="pill">答题卡</span></div>
        <button class="button" data-action="go-exam">进入考试</button>
      </article>
      <article class="card mode-card">
        <h3>错题本</h3>
        <p>答错或卡片标记“不会”的题会自动收进来，答对可移出。</p>
        <div class="chapter-meta"><span class="pill">${Object.keys(mistakes).length} 道错题</span></div>
        <button class="button" data-action="go-mistakes">查看错题</button>
      </article>
      <article class="card mode-card">
        <h3>收藏题库</h3>
        <p>把公式、概念、易混题收起来，考前集中重做。</p>
        <div class="chapter-meta"><span class="pill">${Object.keys(favorites).length} 道收藏</span></div>
        <button class="button" data-action="go-favorites">查看收藏</button>
      </article>
      <article class="card mode-card">
        <h3>学习面板</h3>
        <p>查看今日总结、学习日历和成就，适合每天收尾复盘。</p>
        <button class="button" data-action="show-study-panel">查看统计</button>
      </article>
      <article class="card mode-card">
        <h3>AI 与备份</h3>
        <p>配置 AI 解析题目；导出本地备份或同步到 GitHub Gist。</p>
        <div class="chapter-meta"><span class="pill">${getAiConfig().model || "AI 未配置"}</span></div>
        <button class="button" data-action="go-config">配置 AI</button>
      </article>
    </div>
    <div class="grid mode-grid" style="margin-top:14px">
      ${renderStudyPanel()}
    </div>
  `;
}

function renderStudyPanel() {
  const today = progress.studyLog[todayStr] || { count: 0, correct: 0, wrong: 0, time: 0 };
  const elapsed = Math.floor((Date.now() - sessionStart) / 60000);
  const totalTime = (today.time || 0) + elapsed;
  const todayRate = today.count ? Math.round((today.correct / today.count) * 100) : 0;
  return `
    <section class="card">
      <h3>今日总结</h3>
      <div class="summary-list">
        <div class="summary-item"><span class="label">答题</span><span class="value">${today.count} 题</span></div>
        <div class="summary-item"><span class="label">正确</span><span class="value">${today.correct} 题</span></div>
        <div class="summary-item"><span class="label">正确率</span><span class="value">${todayRate}%</span></div>
        <div class="summary-item"><span class="label">新增错题</span><span class="value">${today.wrong} 题</span></div>
        <div class="summary-item"><span class="label">学习时长</span><span class="value">${totalTime} 分钟</span></div>
      </div>
    </section>
    <section class="card">
      <h3>学习日历</h3>
      ${renderCalendar()}
    </section>
    <section class="card">
      <h3>成就</h3>
      <div class="achievements">
        ${achievementDefinitions()
          .map((ach) => `<span class="ach ${progress.achievements[ach.id] ? "" : "locked"}">${progress.achievements[ach.id] ? ach.name : "未解锁"}</span>`)
          .join("")}
      </div>
    </section>
  `;
}

function renderCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let html = `<table class="calendar"><tr><th>日</th><th>一</th><th>二</th><th>三</th><th>四</th><th>五</th><th>六</th></tr><tr>`;
  for (let i = 0; i < firstDay; i += 1) html += "<td></td>";
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const hasStudy = progress.studyLog[dateStr]?.count > 0;
    const isToday = dateStr === todayStr;
    html += `<td class="${hasStudy ? "learned" : ""} ${isToday ? "today" : ""}">${day}</td>`;
    if ((firstDay + day) % 7 === 0) html += "</tr><tr>";
  }
  html += "</tr></table>";
  html += `<p class="muted">本月学习 ${Object.keys(progress.studyLog).filter((d) => progress.studyLog[d]?.count > 0).length} 天 · 连续 ${calcStreak()} 天</p>`;
  return html;
}

function calcStreak() {
  let streak = 0;
  const d = new Date();
  while (true) {
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (progress.studyLog[ds]?.count > 0) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function renderChapterPicker() {
  const cards = [{ id: 0, name: "全部章节", count: questions.length }, ...chapters].map((chapter) => {
    const pool = questionsByChapter(chapter.id);
    return { ...chapter, count: pool.length, completed: completedCount(pool), mistakes: pool.filter((q) => mistakes[q.id]).length };
  });
  $("#chapterView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>章节刷题</h2>
        <p>选择一个章节后，可以做选择题，也可以用翻转卡片背诵概念、公式和结论。</p>
      </div>
    </div>
    ${renderPracticeResumeCta(true)}
    <div class="grid chapter-grid">
      ${cards
        .map(
          (chapter) => `
        <article class="card chapter-card">
          <h3>${escapeHtml(chapter.name)}</h3>
          <p>已刷 ${chapter.completed} / ${chapter.count} 题</p>
          <div class="chapter-meta">
            <span class="pill">错题 ${chapter.mistakes}</span>
            <span class="pill">${chapter.id ? `第 ${chapter.id} 章` : "全题库"}</span>
          </div>
          <div class="chapter-actions">
            <button class="button" data-action="start-chapter" data-chapter="${chapter.id}" data-mode="choice">选择练习</button>
            <button class="button secondary" data-action="start-chapter" data-chapter="${chapter.id}" data-mode="flip">卡片复习</button>
            <button class="button secondary" data-action="start-chapter" data-chapter="${chapter.id}" data-mode="random">随机刷</button>
          </div>
        </article>
      `
        )
        .join("")}
    </div>
  `;
}

function startChapterPractice(chapterId, practiceMode) {
  let pool = questionsByChapter(chapterId);
  if (practiceMode === "random") pool = shuffle(pool);
  const chapter = chapterId ? chapters.find((item) => item.id === Number(chapterId))?.name : "全部章节";
  startPractice(`${chapter || "章节"} · ${practiceMode === "flip" ? "卡片复习" : "选择练习"}`, pool, {
    mode: practiceMode === "flip" ? "flip" : "choice",
    returnView: "chapter",
    kind: "chapter",
  });
}

function startPractice(title, sourceQuestions, options = {}) {
  state.practice = {
    title,
    questions: [...sourceQuestions],
    index: 0,
    records: {},
    mode: options.mode || "choice",
    flipped: false,
    removeOnCorrect: Boolean(options.removeOnCorrect),
    returnView: options.returnView || "chapter",
    kind: options.kind || "practice",
  };
  showPractice();
}

function showPractice() {
  state.view = "practice";
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.remove("active"));
  $("#practiceView").classList.add("active-view");
  renderPractice();
}

function getPracticeRecord(question) {
  if (!state.practice.records[question.id]) state.practice.records[question.id] = { checked: false, selected: null, correct: false, selfEval: "" };
  return state.practice.records[question.id];
}

function renderPractice() {
  const practice = state.practice;
  if (!practice || !practice.questions.length) {
    $("#practiceView").innerHTML = `<div class="empty">这里暂时没有题目。</div>`;
    return;
  }
  savePracticeSession();
  const question = practice.questions[practice.index];
  const record = getPracticeRecord(question);
  const progressPct = Math.round(((practice.index + 1) / practice.questions.length) * 100);
  $("#practiceView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>${escapeHtml(practice.title)}</h2>
        <p>第 ${practice.index + 1} / ${practice.questions.length} 题 · ${escapeHtml(question.chapterName)}</p>
      </div>
      <button class="button secondary" data-action="back-practice">返回</button>
    </div>
    <div class="panel question-shell">
      <div class="progress-track"><span style="width:${progressPct}%"></span></div>
      <div class="mode-switch" role="group" aria-label="刷题模式">
        <button class="filter-button ${practice.mode === "choice" ? "active" : ""}" data-action="set-practice-mode" data-mode="choice">选择题</button>
        <button class="filter-button ${practice.mode === "flip" ? "active" : ""}" data-action="set-practice-mode" data-mode="flip">翻转卡片</button>
      </div>
      ${practice.mode === "flip" ? renderFlipQuestion(question, record) : renderChoiceQuestion(question, record)}
      <div class="answer-actions">
        <button class="button secondary" data-action="prev-practice" ${practice.index === 0 ? "disabled" : ""}>上一题</button>
        ${practice.mode === "choice" ? `<button class="button" data-action="check-practice" ${record.checked ? "disabled" : ""}>提交本题</button>` : ""}
        ${favoriteButton(question)}
        <button class="button secondary" data-action="ai-explain" data-question-id="${question.id}">${aiActionLabel(question)}</button>
        ${aiRedoButton(question)}
        <button class="button secondary" data-action="next-practice">${practice.index + 1 === practice.questions.length ? "完成" : "下一题"}</button>
      </div>
      ${renderAiPanel(question, practice.mode === "choice" ? selectedLabel(record.selected) : record.selfEval || "未自评")}
    </div>
  `;
}

function renderChoiceQuestion(question, record) {
  return `
    <div class="question-top"><span>第 ${question.chapter} 章</span><span>正确答案 ${correctLabel(question)}</span></div>
    <h3 class="question-title">${escapeHtml(question.question)}</h3>
    <div class="options">
      ${question.options
        .map((option, index) => {
          const classes = ["option"];
          if (record.selected === index) classes.push("selected");
          if (record.checked && index === question.correct) classes.push("correct");
          if (record.checked && record.selected === index && index !== question.correct) classes.push("wrong");
          return `
            <label class="${classes.join(" ")}">
              <input type="radio" name="practice-answer-${question.id}" value="${index}" ${record.selected === index ? "checked" : ""} ${record.checked ? "disabled" : ""}>
              <span><strong>${LABELS[index]}.</strong> ${escapeHtml(option)}</span>
            </label>
          `;
        })
        .join("")}
    </div>
    <div class="feedback ${record.checked ? "show" : ""} ${record.correct ? "ok" : "bad"}">
      ${record.checked ? feedbackHtml(question, record.correct, selectedLabel(record.selected)) : ""}
    </div>
  `;
}

function renderFlipQuestion(question, record) {
  return `
    <div class="flip-card ${state.practice.flipped ? "flipped" : ""}" id="flipCard">
      <div class="flip-card-inner">
        <div class="flip-card-front">
          <div class="question-top"><span>第 ${question.chapter} 章</span><span>${escapeHtml(question.chapterName)}</span></div>
          <h3 class="question-title">${escapeHtml(question.question)}</h3>
          <div class="flip-hint" data-action="flip-card">点击翻转 · 查看答案</div>
        </div>
        <div class="flip-card-back">
          <div class="answer-label">答案要点</div>
          <div class="answer-text">${escapeHtml(question.shortAnswer || question.options[question.correct] || "")}</div>
          ${question.formula ? `<div class="formula-box">${escapeHtml(question.formula)}</div>` : ""}
          <p>${escapeHtml(question.explanation)}</p>
          ${renderInterviewPoints(question)}
          <div class="self-eval">
            <button class="review-button ${record.selfEval === "easy" ? "active" : ""}" data-action="self-eval" data-level="easy">会了</button>
            <button class="review-button ${record.selfEval === "medium" ? "active" : ""}" data-action="self-eval" data-level="medium">模糊</button>
            <button class="review-button ${record.selfEval === "hard" ? "active" : ""}" data-action="self-eval" data-level="hard">不会</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderInterviewPoints(question) {
  if (!question.interviewPoints?.length) return "";
  return `
    <div class="interview-points">
      <div class="answer-label">面试口答要点</div>
      <ul>
        ${question.interviewPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function feedbackHtml(question, correct, selected) {
  return `
    <strong>${correct ? "回答正确" : "回答错误"}</strong>
    <p>你的答案：${escapeHtml(selected)} · 正确答案：${correctLabel(question)}</p>
    ${question.formula ? `<div class="formula-box">${escapeHtml(question.formula)}</div>` : ""}
    <p>${escapeHtml(question.explanation)}</p>
    ${renderInterviewPoints(question)}
  `;
}

function checkPracticeAnswer() {
  const practice = state.practice;
  if (!practice) return;
  const question = practice.questions[practice.index];
  const record = getPracticeRecord(question);
  if (record.checked) return;
  const selected = document.querySelector(`input[name="practice-answer-${question.id}"]:checked`);
  if (!selected) {
    showToast("请先选择一个答案。");
    return;
  }
  record.selected = Number(selected.value);
  record.correct = record.selected === question.correct;
  record.checked = true;
  recordAnswer(question, record.correct, { selected: record.selected });
  if (record.correct) showToast("回答正确，+10 XP");
  else showToast("答错了，已加入错题本。");
  renderPractice();
}

function selfEval(level) {
  const practice = state.practice;
  if (!practice) return;
  const question = practice.questions[practice.index];
  const record = getPracticeRecord(question);
  const correct = level !== "hard";
  record.selfEval = level;
  record.checked = true;
  record.correct = correct;
  recordAnswer(question, correct, { selfEval: level });
  const messages = { easy: "已掌握，+10 XP", medium: "继续巩固，+10 XP", hard: "已加入错题本。" };
  showToast(messages[level]);
  renderPractice();
}

function nextPractice() {
  const practice = state.practice;
  if (!practice) return;
  if (practice.index + 1 >= practice.questions.length) {
    showPracticeResult();
    return;
  }
  practice.index += 1;
  practice.flipped = false;
  renderPractice();
}

function prevPractice() {
  const practice = state.practice;
  if (!practice || practice.index === 0) return;
  practice.index -= 1;
  practice.flipped = false;
  renderPractice();
}

function showPracticeResult() {
  clearPracticeSession();
  state.view = "result";
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  $("#resultView").classList.add("active-view");
  renderPracticeResult();
}

function renderPracticeResult() {
  const practice = state.practice;
  if (!practice) return;
  const records = Object.values(practice.records);
  const answered = records.filter((r) => r.checked).length;
  const correct = records.filter((r) => r.checked && r.correct).length;
  const wrongQuestions = practice.questions.filter((q) => practice.records[q.id]?.checked && !practice.records[q.id].correct);
  $("#resultView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>练习完成</h2>
        <p>完成 ${answered} / ${practice.questions.length} 题，答对 ${correct} 题。</p>
      </div>
      <button class="button" data-action="${practice.returnView === "mistakes" ? "go-mistakes" : practice.returnView === "favorites" ? "go-favorites" : "go-chapter"}">返回</button>
    </div>
    <div class="result-list">
      ${
        wrongQuestions.length
          ? wrongQuestions
              .map(
                (q) => `
          <div class="result-row">
            <div>
              <strong>#${q.id} · ${escapeHtml(q.chapterName)}</strong>
              <p class="muted">${escapeHtml(q.question)}</p>
              <p>正确答案：${correctLabel(q)}</p>
            </div>
            <button class="button secondary" data-action="start-single-review" data-question-id="${q.id}">重做</button>
          </div>
        `
              )
              .join("")
          : `<div class="empty">这组题没有错题。</div>`
      }
    </div>
  `;
}

function renderExamSetup() {
  const max = questions.length;
  $("#examView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>随机考试</h2>
        <p>从指定范围随机抽题，交卷后统一判分并记录错题。</p>
      </div>
    </div>
    <div class="panel">
      <div class="grid setup-grid">
        <div class="field">
          <label for="examCount">题目数量</label>
          <select id="examCount">
            <option value="10">10 题</option>
            <option value="20" selected>20 题</option>
            <option value="50">50 题</option>
            <option value="${max}">全部 ${max} 题</option>
          </select>
        </div>
        <div class="field">
          <label for="examMinutes">考试时间</label>
          <input id="examMinutes" type="number" min="1" max="180" value="20">
        </div>
        <div class="field">
          <label for="examChapter">范围</label>
          <select id="examChapter">
            <option value="0">全部章节</option>
            ${chapters.map((chapter) => `<option value="${chapter.id}">第 ${chapter.id} 章 · ${escapeHtml(chapter.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="answer-actions" style="margin-top:16px">
        <button class="button" data-action="start-exam">开始考试</button>
      </div>
    </div>
  `;
}

function startExam() {
  const count = Number($("#examCount").value);
  const minutes = Number($("#examMinutes").value);
  const chapter = Number($("#examChapter").value);
  const pool = shuffle(questionsByChapter(chapter)).slice(0, Math.min(count, questionsByChapter(chapter).length));
  state.exam = { questions: pool, index: 0, answers: {}, endsAt: Date.now() + minutes * 60 * 1000, submitted: false };
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(tickExam, 1000);
  renderExam();
}

function tickExam() {
  if (!state.exam) return;
  if (Date.now() >= state.exam.endsAt) {
    submitExam();
    return;
  }
  const timer = $("#examTimer");
  if (timer) timer.textContent = formatRemaining(state.exam.endsAt - Date.now());
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function renderExam() {
  const exam = state.exam;
  if (!exam || !exam.questions.length) {
    $("#examView").innerHTML = `<div class="empty">没有可用于考试的题目。</div>`;
    return;
  }
  state.view = "exam";
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  $("#examView").classList.add("active-view");
  const question = exam.questions[exam.index];
  const selected = exam.answers[question.id];
  const answeredCount = Object.keys(exam.answers).filter((id) => exam.answers[id] !== undefined).length;
  $("#examView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>随机考试</h2>
        <p>已答 ${answeredCount} / ${exam.questions.length}</p>
      </div>
      <strong id="examTimer">${formatRemaining(exam.endsAt - Date.now())}</strong>
    </div>
    <div class="exam-layout">
      <div class="panel question-shell">
        <div class="question-top"><span>${escapeHtml(question.chapterName)}</span><span>第 ${exam.index + 1} 题</span></div>
        <h3 class="question-title">${escapeHtml(question.question)}</h3>
        <div class="options">
          ${question.options
            .map(
              (option, index) => `
            <label class="option ${selected === index ? "selected" : ""}">
              <input type="radio" name="exam-answer-${question.id}" value="${index}" ${selected === index ? "checked" : ""}>
              <span><strong>${LABELS[index]}.</strong> ${escapeHtml(option)}</span>
            </label>
          `
            )
            .join("")}
        </div>
        <div class="exam-actions">
          <button class="button secondary" data-action="prev-exam" ${exam.index === 0 ? "disabled" : ""}>上一题</button>
          <button class="button secondary" data-action="next-exam" ${exam.index + 1 === exam.questions.length ? "disabled" : ""}>下一题</button>
          ${favoriteButton(question)}
          <button class="button secondary" data-action="ai-explain" data-question-id="${question.id}">${aiActionLabel(question)}</button>
          ${aiRedoButton(question)}
          <button class="button" data-action="submit-exam">交卷</button>
        </div>
        ${renderAiPanel(question, selectedLabel(selected))}
      </div>
      <aside class="panel">
        <h3>答题卡</h3>
        <div class="answer-sheet">
          ${exam.questions
            .map(
              (item, index) =>
                `<button class="sheet-button ${exam.answers[item.id] !== undefined ? "answered" : ""} ${index === exam.index ? "current" : ""}" data-action="jump-exam" data-index="${index}">${index + 1}</button>`
            )
            .join("")}
        </div>
      </aside>
    </div>
  `;
}

function handleExamAnswer(input) {
  const exam = state.exam;
  if (!exam) return;
  const question = exam.questions[exam.index];
  exam.answers[question.id] = Number(input.value);
  renderExam();
}

function submitExam() {
  const exam = state.exam;
  if (!exam || exam.submitted) return;
  exam.submitted = true;
  if (state.timer) clearInterval(state.timer);
  let correct = 0;
  const rows = exam.questions.map((question, index) => {
    const selected = exam.answers[question.id];
    const ok = selected === question.correct;
    if (ok) correct += 1;
    recordAnswer(question, ok, { selected });
    return { question, index, selected, ok };
  });
  const rate = Math.round((correct / exam.questions.length) * 100);
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  $("#resultView").classList.add("active-view");
  $("#resultView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>考试结果</h2>
        <p>得分 ${correct} / ${exam.questions.length}，正确率 ${rate}%</p>
      </div>
      <button class="button" data-action="go-exam">再考一次</button>
    </div>
    <div class="result-list">
      ${
        rows
          .filter((row) => !row.ok)
          .map(
            (row) => `
        <div class="result-row">
          <div>
            <strong>第 ${row.index + 1} 题 · ${escapeHtml(row.question.chapterName)}</strong>
            <p class="muted">${escapeHtml(row.question.question)}</p>
            <p>你的答案：${selectedLabel(row.selected)} · 正确答案：${correctLabel(row.question)}</p>
            ${row.question.formula ? `<div class="formula-box">${escapeHtml(row.question.formula)}</div>` : ""}
            ${renderInterviewPoints(row.question)}
          </div>
          <button class="button secondary" data-action="start-single-review" data-question-id="${row.question.id}">重做</button>
        </div>
      `
          )
          .join("") || `<div class="empty">这次没有错题。</div>`
      }
    </div>
  `;
  updateGlobalStats();
}

function renderMistakes() {
  const all = Object.keys(mistakes).map(questionById).filter(Boolean);
  const chapterOptions = [{ id: 0, name: "全部章节" }, ...chapters];
  $("#mistakesView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>错题本</h2>
        <p>共 ${all.length} 道错题。答对后可以从错题本移出。</p>
      </div>
      <button class="button danger" data-action="clear-mistakes" ${all.length ? "" : "disabled"}>清空错题</button>
    </div>
    ${renderPracticeResumeCta(true)}
    ${
      all.length
        ? `<div class="toolbar" style="margin-bottom:14px">
            <div class="field">
              <label for="mistakeChapter">章节筛选</label>
              <select id="mistakeChapter">${chapterOptions.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select>
            </div>
            <button class="button" data-action="start-mistakes">开始重练</button>
            <button class="button secondary" data-action="start-mistakes-flip">卡片复习</button>
          </div>
          <div class="result-list">
            ${all
              .map(
                (question) => `
              <div class="result-row">
                <div>
                  <strong>错 ${mistakes[question.id]?.wrongCount || 1} 次 · ${escapeHtml(question.chapterName)}</strong>
                  <p class="muted">${escapeHtml(question.question)}</p>
                </div>
                <div class="mistake-row-actions">
                  <button class="button secondary" data-action="start-single-review" data-question-id="${question.id}">做这题</button>
                  ${favoriteButton(question)}
                </div>
              </div>
            `
              )
              .join("")}
          </div>`
        : `<div class="empty">暂时没有错题。选择题答错或卡片标记“不会”后会出现在这里。</div>`
    }
  `;
}

function startMistakePractice(mode = "choice") {
  const chapter = Number($("#mistakeChapter")?.value || 0);
  let pool = Object.keys(mistakes).map(questionById).filter(Boolean);
  if (chapter) pool = pool.filter((q) => q.chapter === chapter);
  startPractice(`错题重练 · ${chapter ? `第 ${chapter} 章` : "全部章节"}`, pool, { mode, removeOnCorrect: true, returnView: "mistakes", kind: "mistakes" });
}

function renderFavorites() {
  const all = Object.keys(favorites).map(questionById).filter(Boolean);
  const chapterOptions = [{ id: 0, name: "全部章节" }, ...chapters];
  $("#favoritesView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>收藏题库</h2>
        <p>共 ${all.length} 道收藏题，适合收公式、概念和易混点。</p>
      </div>
      <button class="button danger" data-action="clear-favorites" ${all.length ? "" : "disabled"}>清空收藏</button>
    </div>
    ${renderPracticeResumeCta(true)}
    ${
      all.length
        ? `<div class="toolbar" style="margin-bottom:14px">
            <div class="field">
              <label for="favoriteChapter">章节筛选</label>
              <select id="favoriteChapter">${chapterOptions.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select>
            </div>
            <button class="button" data-action="start-favorites">重做收藏</button>
            <button class="button secondary" data-action="start-favorites-flip">卡片复习</button>
          </div>
          <div class="result-list">
            ${all
              .map(
                (question) => `
              <div class="result-row">
                <div>
                  <strong>${escapeHtml(question.chapterName)}</strong>
                  <p class="muted">${escapeHtml(question.question)}</p>
                </div>
                <div class="mistake-row-actions">
                  <button class="button secondary" data-action="start-single-favorite" data-question-id="${question.id}">做这题</button>
                  <button class="button ghost" data-action="toggle-favorite" data-question-id="${question.id}">取消收藏</button>
                </div>
              </div>
            `
              )
              .join("")}
          </div>`
        : `<div class="empty">暂时没有收藏题。做题时点击“收藏”，题目就会出现在这里。</div>`
    }
  `;
}

function startFavoritePractice(mode = "choice") {
  const chapter = Number($("#favoriteChapter")?.value || 0);
  let pool = Object.keys(favorites).map(questionById).filter(Boolean);
  if (chapter) pool = pool.filter((q) => q.chapter === chapter);
  startPractice(`收藏重练 · ${chapter ? `第 ${chapter} 章` : "全部章节"}`, pool, { mode, returnView: "favorites", kind: "favorites" });
}

function searchQuestions(query) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return questions.filter((q) => {
    const searchable = [q.question, q.explanation, q.formula, q.shortAnswer, q.chapterName, ...(q.tags || []), ...(q.interviewPoints || []), ...q.options]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

function renderSearch() {
  const query = state.searchQuery.trim();
  const results = searchQuestions(query);
  $("#searchView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>搜索题目</h2>
        <p>可以搜题干、解析、公式、章节名或标签。</p>
      </div>
    </div>
    ${renderPracticeResumeCta(true)}
    <div class="panel search-panel">
      <div class="search-toolbar">
        <div class="field">
          <label for="searchInput">关键词</label>
          <input id="searchInput" type="search" value="${escapeAttr(query)}" placeholder="例如：PN 结 费米能级">
        </div>
        <button class="button" data-action="run-search">搜索</button>
      </div>
    </div>
    ${
      query
        ? `<div class="search-summary" style="margin-bottom:14px">找到 ${results.length} 道相关题目</div>
           ${
             results.length
               ? `<div class="result-list">
                  ${results
                    .map(
                      (question) => `
                    <div class="result-row">
                      <div>
                        <strong>#${question.id} · ${escapeHtml(question.chapterName)}</strong>
                        <p class="muted">${escapeHtml(question.question)}</p>
                      </div>
                      <div class="mistake-row-actions">
                        <button class="button secondary" data-action="start-single-search" data-question-id="${question.id}">做这题</button>
                        ${favoriteButton(question)}
                      </div>
                    </div>
                  `
                    )
                    .join("")}
                </div>`
               : `<div class="empty">没有找到相关题目。换一个更核心的关键词试试。</div>`
           }`
        : `<div class="empty">输入关键词开始搜索。</div>`
    }
  `;
}

function buildBackupPayload() {
  const aiConfig = getAiConfig();
  return {
    app: "semiconductor-physics-quiz",
    version: 2,
    exportedAt: new Date().toISOString(),
    questionBank: { total: questions.length, chapters: chapters.length },
    data: {
      progress,
      mistakes,
      favorites,
      aiConfig: { apiBase: aiConfig.apiBase, model: aiConfig.model, models: aiConfig.models, customPrompt: aiConfig.customPrompt },
      aiCache: getAiCache(),
      aiChats: getAiChats(),
      theme: localStorage.getItem(STORAGE.theme) || "day",
    },
  };
}

function applyBackupPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("备份文件格式不正确。");
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
  progress = sanitizeProgress(data.progress || data);
  mistakes = sanitizeObject(data.mistakes);
  favorites = sanitizeObject(data.favorites);
  const importedAiConfig = sanitizeObject(data.aiConfig);
  const currentAiConfig = getAiConfig();
  saveAiConfig({
    ...currentAiConfig,
    apiBase: typeof importedAiConfig.apiBase === "string" ? importedAiConfig.apiBase : currentAiConfig.apiBase,
    model: typeof importedAiConfig.model === "string" ? importedAiConfig.model : currentAiConfig.model,
    models: Array.isArray(importedAiConfig.models) ? importedAiConfig.models.filter((item) => typeof item === "string") : currentAiConfig.models,
    customPrompt: typeof importedAiConfig.customPrompt === "string" ? importedAiConfig.customPrompt : currentAiConfig.customPrompt,
    apiKey: currentAiConfig.apiKey,
  });
  saveAiCache(sanitizeObject(data.aiCache));
  if (data.aiChats && typeof data.aiChats === "object") saveAiChats(sanitizeObject(data.aiChats));
  if (data.theme === "day" || data.theme === "night") setTheme(data.theme);
  saveProgress();
  saveMistakes();
  saveFavorites();
  state.aiStatus = {};
  state.aiExpanded = {};
  state.aiFollowupDrafts = {};
  state.aiFollowupLoading = {};
}

function renderBackup() {
  const config = getBackupConfig();
  $("#backupView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>数据备份</h2>
        <p>备份学习进度、错题、收藏、XP、成就、AI 配置和解析缓存；AI key 与 GitHub token 不写进备份文件。</p>
      </div>
    </div>
    <div class="grid backup-grid">
      <section class="panel config-panel">
        <h3>本地文件</h3>
        <p class="muted">适合手动迁移，下载 JSON 后可在另一台设备导入。</p>
        <div class="answer-actions" style="margin-top:14px">
          <button class="button" data-action="export-backup">导出备份文件</button>
          <label class="button secondary file-button" for="backupFile">导入备份文件</label>
        </div>
      </section>
      <section class="panel config-panel">
        <h3>GitHub Gist 同步</h3>
        <p class="muted">GitHub token 需要 gist 权限，只保存在当前浏览器。</p>
        <div class="grid setup-grid" style="margin-top:14px">
          <div class="field"><label for="backupToken">GitHub token</label><input id="backupToken" type="password" value="${escapeAttr(config.token)}" placeholder="ghp_..."></div>
          <div class="field"><label for="backupGistId">Gist ID</label><input id="backupGistId" value="${escapeAttr(config.gistId)}" placeholder="首次备份后自动生成"></div>
          <div class="field"><label for="backupFilename">文件名</label><input id="backupFilename" value="${escapeAttr(config.filename)}"></div>
        </div>
        <div class="auto-backup-box">
          <label class="checkbox-field" for="backupAutoEnabled">
            <input id="backupAutoEnabled" type="checkbox" ${config.autoEnabled ? "checked" : ""}>
            <span>启用自动备份</span>
          </label>
          <div class="field">
            <label for="backupAutoInterval">自动备份间隔（分钟）</label>
            <input id="backupAutoInterval" type="number" min="5" max="1440" step="5" value="${config.autoIntervalMinutes}">
          </div>
          <p class="muted">${autoBackupSummary(config)}</p>
        </div>
        <div class="answer-actions" style="margin-top:14px">
          <button class="button secondary" data-action="save-backup-config">保存 GitHub 配置</button>
          <button class="button" data-action="backup-to-github">备份到 GitHub</button>
          <button class="button secondary" data-action="restore-from-github">从 GitHub 导入</button>
        </div>
      </section>
    </div>
    <div class="panel backup-summary">
      <strong>当前本地数据</strong>
      <div class="chapter-meta" style="margin-top:10px">
        <span class="pill">已刷 ${Object.keys(progress.answered).length}</span>
        <span class="pill">错题 ${Object.keys(mistakes).length}</span>
        <span class="pill">收藏 ${Object.keys(favorites).length}</span>
        <span class="pill">AI 缓存 ${Object.keys(getAiCache()).length}</span>
        <span class="pill">AI 追问 ${Object.keys(getAiChats()).length}</span>
        <span class="pill">模型 ${getAiConfig().model || "未配置"}</span>
      </div>
      <div class="notice ${state.backupMessage ? "show" : ""}" style="margin-top:12px">${escapeHtml(state.backupMessage)}</div>
    </div>
  `;
}

function exportBackupFile() {
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `semiconductor-quiz-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  state.backupMessage = "备份文件已导出。";
  renderBackup();
}

async function importBackupFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!window.confirm("导入会覆盖当前刷题数据，确定继续吗？")) {
    input.value = "";
    return;
  }
  try {
    applyBackupPayload(JSON.parse(await file.text()));
    state.backupMessage = "备份已导入。";
  } catch (error) {
    state.backupMessage = `导入失败：${error.message || String(error)}`;
  }
  input.value = "";
  renderBackup();
  updateGlobalStats();
}

function getBackupConfig() {
  const saved = sanitizeObject(readJson(STORAGE.backupConfig, {}));
  return {
    token: typeof saved.token === "string" ? saved.token : "",
    gistId: typeof saved.gistId === "string" ? saved.gistId : "",
    filename: typeof saved.filename === "string" && saved.filename ? saved.filename : BACKUP_FILENAME,
    autoEnabled: saved.autoEnabled === true,
    autoIntervalMinutes: normalizeAutoBackupInterval(saved.autoIntervalMinutes),
    lastAutoBackupAt: typeof saved.lastAutoBackupAt === "string" ? saved.lastAutoBackupAt : "",
    lastAutoBackupStatus: typeof saved.lastAutoBackupStatus === "string" ? saved.lastAutoBackupStatus : "",
  };
}

function normalizeAutoBackupInterval(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return 30;
  return Math.max(5, Math.min(1440, Math.round(minutes)));
}

function formatLocalTime(isoValue) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function nextAutoBackupAt(config) {
  if (!config.autoEnabled || !config.lastAutoBackupAt) return "";
  const last = new Date(config.lastAutoBackupAt).getTime();
  if (Number.isNaN(last)) return "";
  return new Date(last + config.autoIntervalMinutes * 60 * 1000).toISOString();
}

function autoBackupSummary(config) {
  if (!config.autoEnabled) return `自动备份未启用。启用后默认每 ${config.autoIntervalMinutes || 30} 分钟备份一次。`;
  const parts = [`已启用，每 ${config.autoIntervalMinutes} 分钟自动备份一次`];
  const last = formatLocalTime(config.lastAutoBackupAt);
  const next = formatLocalTime(nextAutoBackupAt(config));
  if (last) parts.push(`上次：${last}`);
  if (next) parts.push(`下次预计：${next}`);
  if (config.lastAutoBackupStatus) parts.push(`状态：${config.lastAutoBackupStatus}`);
  if (!config.token) parts.push("请先填写 GitHub token，否则自动备份会跳过");
  return parts.join("；") + "。";
}

function saveBackupConfig(config) {
  writeJson(STORAGE.backupConfig, config);
}

function readBackupForm() {
  const current = getBackupConfig();
  return {
    token: $("#backupToken")?.value || current.token,
    gistId: ($("#backupGistId")?.value || current.gistId).trim(),
    filename: ($("#backupFilename")?.value || current.filename || BACKUP_FILENAME).trim(),
    autoEnabled: Boolean($("#backupAutoEnabled")?.checked),
    autoIntervalMinutes: normalizeAutoBackupInterval($("#backupAutoInterval")?.value || current.autoIntervalMinutes),
    lastAutoBackupAt: current.lastAutoBackupAt,
    lastAutoBackupStatus: current.lastAutoBackupStatus,
  };
}

function githubHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };
}

async function githubErrorMessage(response, actionName) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = payload.message ? `（${payload.message}）` : "";
  } catch {
    detail = "";
  }
  if (response.status === 401) return `${actionName}失败：GitHub token 无效或已过期。${detail}`;
  if (response.status === 403) return `${actionName}失败：token 权限不足，需要 gist 读写权限。${detail}`;
  if (response.status === 404) return `${actionName}失败：没有找到这个 Gist，或 token 无权访问。${detail}`;
  return `${actionName}失败：HTTP ${response.status}${detail}`;
}

function renderBackupIfActive() {
  if ($("#backupView")?.classList.contains("active-view")) renderBackup();
}

function markAutoBackupAttempt(config, status) {
  saveBackupConfig({
    ...config,
    lastAutoBackupAt: new Date().toISOString(),
    lastAutoBackupStatus: status,
  });
}

async function backupToGithub(options = {}) {
  if (state.backupInFlight) {
    if (!options.auto) {
      state.backupMessage = "已有备份正在进行，请稍后再试。";
      renderBackupIfActive();
    }
    return;
  }
  const config = options.config || (options.auto ? getBackupConfig() : readBackupForm());
  if (!config.token) {
    const message = options.auto ? "自动备份跳过：请先填写 GitHub token。" : "请先填写 GitHub token。";
    state.backupMessage = message;
    if (options.auto) markAutoBackupAttempt(config, message);
    renderBackupIfActive();
    return;
  }
  const filename = config.filename || BACKUP_FILENAME;
  const body = {
    description: "半导体物理刷题软件数据备份",
    public: false,
    files: { [filename]: { content: JSON.stringify(buildBackupPayload(), null, 2) } },
  };
  state.backupInFlight = true;
  state.backupMessage = options.auto ? "正在自动备份到 GitHub..." : "正在备份到 GitHub...";
  renderBackupIfActive();
  try {
    const url = config.gistId ? `https://api.github.com/gists/${config.gistId}` : "https://api.github.com/gists";
    const response = await fetch(url, { method: config.gistId ? "PATCH" : "POST", headers: githubHeaders(config.token), body: JSON.stringify(body) });
    if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub 备份"));
    const gist = await response.json();
    const successMessage = options.auto ? `自动备份成功：${gist.id}` : `已备份到 GitHub Gist：${gist.id}`;
    saveBackupConfig({
      ...config,
      gistId: gist.id,
      filename,
      lastAutoBackupAt: options.auto ? new Date().toISOString() : config.lastAutoBackupAt,
      lastAutoBackupStatus: options.auto ? successMessage : config.lastAutoBackupStatus,
    });
    state.backupMessage = successMessage;
  } catch (error) {
    const message = explainNetworkError(error);
    state.backupMessage = options.auto ? `自动备份失败：${message}` : message;
    if (options.auto) markAutoBackupAttempt(config, state.backupMessage);
  } finally {
    state.backupInFlight = false;
  }
  renderBackupIfActive();
}

async function restoreFromGithub() {
  const config = readBackupForm();
  if (!config.token || !config.gistId) {
    state.backupMessage = "请填写 GitHub token 和 Gist ID。";
    renderBackup();
    return;
  }
  if (!window.confirm("从 GitHub 导入会覆盖当前刷题数据，确定继续吗？")) return;
  state.backupMessage = "正在从 GitHub 导入...";
  renderBackup();
  try {
    const response = await fetch(`https://api.github.com/gists/${config.gistId}`, { headers: githubHeaders(config.token) });
    if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub 导入"));
    const gist = await response.json();
    const files = Object.values(gist.files || {});
    const file = files.find((item) => item.filename === config.filename) || files[0];
    if (!file?.content) throw new Error("Gist 中没有找到备份内容。");
    applyBackupPayload(JSON.parse(file.content));
    saveBackupConfig({ ...config, filename: file.filename || config.filename });
    state.backupMessage = "已从 GitHub 导入备份。";
  } catch (error) {
    state.backupMessage = explainNetworkError(error);
  }
  renderBackup();
}

function getAiConfig() {
  const saved = sanitizeObject(readJson(STORAGE.aiConfig, {}));
  const customPrompt =
    typeof saved.customPrompt === "string" && saved.customPrompt.trim() ? saved.customPrompt.trim() : DEFAULT_AI_CUSTOM_PROMPT;
  return {
    apiBase: typeof saved.apiBase === "string" ? saved.apiBase : "https://gcli.ggchan.dev",
    apiKey: typeof saved.apiKey === "string" ? saved.apiKey : "",
    model: typeof saved.model === "string" ? saved.model : "",
    models: Array.isArray(saved.models) ? saved.models.filter((model) => typeof model === "string") : [],
    customPrompt,
  };
}

function saveAiConfig(config) {
  writeJson(STORAGE.aiConfig, config);
}

function getAiCache() {
  return sanitizeObject(readJson(STORAGE.aiCache, {}));
}

function saveAiCache(cache) {
  writeJson(STORAGE.aiCache, cache);
}

function getAiChats() {
  return sanitizeObject(readJson(STORAGE.aiChats, {}));
}

function saveAiChats(chats) {
  writeJson(STORAGE.aiChats, sanitizeObject(chats));
}

function chatKeyForQuestion(question, model) {
  return aiCacheKey(question, model || getAiConfig().model);
}

function sanitizeChatMessages(messages) {
  return Array.isArray(messages)
    ? messages
        .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
        .map((item) => ({
          role: item.role,
          content: item.content,
          createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        }))
    : [];
}

function getQuestionChat(question, model) {
  const entry = getAiChats()[chatKeyForQuestion(question, model)];
  return sanitizeChatMessages(Array.isArray(entry) ? entry : entry?.messages);
}

function saveQuestionChat(question, model, messages) {
  const chats = getAiChats();
  const cleanMessages = sanitizeChatMessages(messages);
  const key = chatKeyForQuestion(question, model);
  if (cleanMessages.length) chats[key] = { messages: cleanMessages, updatedAt: new Date().toISOString() };
  else delete chats[key];
  saveAiChats(chats);
}

function appendQuestionChat(question, model, userText, assistantText) {
  const createdAt = new Date().toISOString();
  const messages = getQuestionChat(question, model);
  messages.push({ role: "user", content: userText, createdAt }, { role: "assistant", content: assistantText, createdAt });
  saveQuestionChat(question, model, messages);
}

function clearQuestionChat(question, model = getAiConfig().model) {
  saveQuestionChat(question, model, []);
  const key = aiStatusKey(question, model);
  delete state.aiFollowupDrafts[key];
  delete state.aiFollowupLoading[key];
  renderActiveQuestion();
}

function normalizeApiBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function buildApiUrl(apiBase, path) {
  return `${normalizeApiBase(apiBase)}/${path.replace(/^\/+/, "")}`;
}

function renderConfigSafe() {
  try {
    renderConfig();
  } catch (error) {
    $("#configView").innerHTML = `<div class="empty">AI 配置页加载失败：${escapeHtml(error.message || String(error))}</div>`;
  }
}

function renderConfig() {
  const config = getAiConfig();
  const cacheCount = Object.keys(getAiCache()).length;
  $("#configView").innerHTML = `
    <div class="page-head">
      <div>
        <h2>AI 配置</h2>
        <p>API key 只保存在当前浏览器本地，不会写进题库文件、备份文件或 GitHub 仓库。</p>
      </div>
    </div>
    <div class="panel config-panel">
      <div class="grid setup-grid">
        <div class="field"><label for="aiApiBase">API 地址</label><input id="aiApiBase" type="url" value="${escapeAttr(config.apiBase)}" placeholder="https://gcli.ggchan.dev"></div>
        <div class="field"><label for="aiApiKey">API key</label><input id="aiApiKey" type="password" value="${escapeAttr(config.apiKey)}" placeholder="sk-..."></div>
        <div class="field">
          <label for="aiModel">模型</label>
          <select id="aiModel">
            <option value="">先拉取模型</option>
            ${config.models.map((model) => `<option value="${escapeAttr(model)}" ${model === config.model ? "selected" : ""}>${escapeHtml(model)}</option>`).join("")}
          </select>
        </div>
        <div class="field wide-field">
          <label for="aiCustomPrompt">自定义回答要求</label>
          <textarea id="aiCustomPrompt" rows="5" placeholder="${escapeAttr(DEFAULT_AI_CUSTOM_PROMPT)}">${escapeHtml(config.customPrompt)}</textarea>
        </div>
      </div>
      <div class="answer-actions" style="margin-top:14px">
        <button class="button" data-action="fetch-models">拉取模型</button>
        <button class="button secondary" data-action="save-ai-config">保存配置</button>
        <button class="button secondary" data-action="clear-ai-cache">清除解析缓存（${cacheCount}）</button>
        <button class="button ghost" data-action="clear-ai-config">清除配置</button>
      </div>
      <div class="notice ${state.configMessage ? "show" : ""}" style="margin-top:12px">${escapeHtml(state.configMessage)}</div>
    </div>
  `;
}

function readConfigForm() {
  const current = getAiConfig();
  return {
    apiBase: normalizeApiBase($("#aiApiBase")?.value || current.apiBase),
    apiKey: $("#aiApiKey")?.value || "",
    model: $("#aiModel")?.value || current.model || "",
    models: current.models || [],
    customPrompt: ($("#aiCustomPrompt")?.value || DEFAULT_AI_CUSTOM_PROMPT).trim() || DEFAULT_AI_CUSTOM_PROMPT,
  };
}

async function fetchModels() {
  const config = readConfigForm();
  if (!config.apiBase || !config.apiKey) {
    state.configMessage = "请先填写 API 地址和 key。";
    renderConfigSafe();
    return;
  }
  state.configMessage = "正在拉取模型...";
  saveAiConfig(config);
  renderConfigSafe();
  try {
    const response = await fetch(buildApiUrl(config.apiBase, "models"), { headers: { Authorization: `Bearer ${config.apiKey}` } });
    if (!response.ok) throw new Error(`模型拉取失败：HTTP ${response.status}`);
    const payload = await response.json();
    const models = (payload.data || []).map((item) => item.id).filter(Boolean);
    if (!models.length) throw new Error("没有在返回结果中找到模型 id。");
    saveAiConfig({ ...config, models, model: models.includes(config.model) ? config.model : models[0] });
    state.configMessage = `已拉取 ${models.length} 个模型，并保存配置。`;
  } catch (error) {
    state.configMessage = explainNetworkError(error);
  }
  renderConfigSafe();
}

function aiCacheKey(question, model) {
  return `${model || "model"}:${question.id}`;
}

function aiStatusKey(question, model) {
  return model ? aiCacheKey(question, model) : `unconfigured:${question.id}`;
}

function aiActionLabel(question) {
  const config = getAiConfig();
  const key = aiStatusKey(question, config.model);
  const status = state.aiStatus[key] || {};
  const cached = config.model ? getAiCache()[aiCacheKey(question, config.model)] : "";
  if (status.loading) return "解析中...";
  if (status.content || cached) return state.aiExpanded[key] ? "收起解析" : "展开解析";
  return "AI 解析";
}

function aiRedoButton(question) {
  const config = getAiConfig();
  const status = state.aiStatus[aiStatusKey(question, config.model)] || {};
  return `<button class="icon-button" data-action="redo-ai-explain" data-question-id="${question.id}" title="重新生成解析" aria-label="重新生成解析" ${status.loading ? "disabled" : ""}>↻</button>`;
}

function renderAiFollowupPanel(question, statusKey) {
  const config = getAiConfig();
  const chat = getQuestionChat(question, config.model);
  const loading = Boolean(state.aiFollowupLoading[statusKey]);
  const draft = state.aiFollowupDrafts[statusKey] || "";
  const chatHtml = chat.length
    ? `<div class="ai-chat-list">
        ${chat
          .map(
            (message) => `
              <div class="ai-chat-message ${message.role}">
                <strong>${message.role === "user" ? "你" : "AI"}</strong>
                <div>${renderMarkdown(message.content)}</div>
              </div>`
          )
          .join("")}
      </div>`
    : `<p class="muted">追问只围绕当前题目保存，不会变成全局聊天窗口。</p>`;
  return `
    <div class="ai-followup">
      <div class="ai-followup-head">
        <strong>本题追问</strong>
        <button class="button ghost" data-action="clear-ai-chat" data-question-id="${question.id}" ${chat.length ? "" : "disabled"}>清空本题对话</button>
      </div>
      ${chatHtml}
      <div class="followup-suggestions">
        ${FOLLOWUP_SUGGESTIONS.map(
          (text) =>
            `<button class="filter-button" data-action="use-followup-suggestion" data-question-id="${question.id}" data-text="${escapeAttr(text)}">${escapeHtml(text)}</button>`
        ).join("")}
      </div>
      <div class="followup-input-row">
        <textarea data-followup-input="${question.id}" rows="2" placeholder="继续问这一题，例如：这个近似条件为什么成立？" ${loading ? "disabled" : ""}>${escapeHtml(
          draft
        )}</textarea>
        <button class="button" data-action="send-ai-followup" data-question-id="${question.id}" ${loading ? "disabled" : ""}>${
    loading ? "发送中..." : "发送"
  }</button>
      </div>
    </div>
  `;
}

function renderAiPanel(question, userAnswer) {
  const config = getAiConfig();
  const key = aiStatusKey(question, config.model);
  const cache = getAiCache();
  const status = state.aiStatus[key] || {};
  const cached = config.model ? cache[aiCacheKey(question, config.model)] : "";
  const content = status.content || cached || "";
  const expanded = Boolean(state.aiExpanded[key]);
  if (!status.loading && !status.error && (!content || !expanded)) return "";
  const body = status.loading ? "正在请求 AI 解析..." : content || status.error || "";
  const classes = ["ai-panel"];
  if (status.error && !content) classes.push("error");
  if (content) classes.push("ready");
  return `
    <section class="${classes.join(" ")}">
      <div class="ai-panel-head">
        <strong>AI 解析</strong>
        <span>你的答案：${escapeHtml(userAnswer || "未作答")}</span>
      </div>
      ${status.error && content ? `<div class="notice show">${escapeHtml(status.error)}；已保留上次解析。</div>` : ""}
      <div class="ai-content">${renderMarkdown(body)}</div>
      ${content ? renderAiFollowupPanel(question, key) : ""}
    </section>
  `;
}

function buildPrompt(question, userAnswer) {
  const options = question.options.map((text, index) => `${LABELS[index]}. ${text}`).join("\n");
  const config = getAiConfig();
  const interviewPoints = question.interviewPoints?.length ? question.interviewPoints.map((point) => `- ${point}`).join("\n") : "无";
  return `你正在帮助我准备保研/夏令营面试中的半导体器件物理问答。请把选择题判断和面试口答分开讲。

课程：半导体器件物理
章节：${question.chapterName}
题目：${question.question}
选择题选项：
${options}
选择题正确选项：${correctLabel(question)}. ${question.options[question.correct] || ""}
简答标准答案：${question.shortAnswer || question.options[question.correct] || "无"}
公式：${question.formula || "无"}
题库解析：${question.explanation || "无"}
面试口答要点：
${interviewPoints}
用户答案或自评：${userAnswer || "未作答"}
自定义回答要求：${config.customPrompt || DEFAULT_AI_CUSTOM_PROMPT}

请严格用 Markdown 输出，并使用这三个二级标题：
## 选择题判断
说明为什么正确选项对，并逐条指出其他选项的典型误区。
## 面试简答回答
给出一段适合 30-60 秒开口回答的组织方式，不要只背选择题选项。
## 记忆抓手与易错点
给出记忆抓手、近似条件、适用范围和最容易被追问的点。`;
}

function buildFollowupPrompt(question, userAnswer, firstAiContent, chatHistory, followupText) {
  const config = getAiConfig();
  const options = question.options.map((text, index) => `${LABELS[index]}. ${text}`).join("\n");
  const interviewPoints = question.interviewPoints?.length ? question.interviewPoints.map((point) => `- ${point}`).join("\n") : "无";
  const history = chatHistory.length
    ? chatHistory.map((message) => `${message.role === "user" ? "用户" : "AI"}：${message.content}`).join("\n")
    : "无";
  return `你正在回答一道半导体器件物理题的题内追问。请只围绕本题和相关物理概念展开，不要扩展成全局闲聊。

课程：半导体器件物理
章节：${question.chapterName}
题目：${question.question}
选择题选项：
${options}
选择题正确选项：${correctLabel(question)}. ${question.options[question.correct] || ""}
简答标准答案：${question.shortAnswer || question.options[question.correct] || "无"}
公式：${question.formula || "无"}
题库解析：${question.explanation || "无"}
面试口答要点：
${interviewPoints}
用户答案或自评：${userAnswer || "未作答"}
首次 AI 解析：${firstAiContent || "尚无"}
本题已有追问历史：
${history}

自定义回答要求：${config.customPrompt || DEFAULT_AI_CUSTOM_PROMPT}

用户本次追问：${followupText}

请直接回答本次追问。若追问偏“为什么选这个”，优先解释选择题判断；若追问偏“简答怎么答/怎么记”，优先给面试口答结构。若用户说“没懂”，请换一种更直观的物理图像重新解释，并指出最容易混淆的地方。`;
}

function renderActiveQuestion() {
  if ($("#practiceView").classList.contains("active-view")) renderPractice();
  if ($("#examView").classList.contains("active-view")) renderExam();
}

async function requestAiExplanation(questionId, options = {}) {
  const question = questionById(questionId);
  if (!question) return;
  const config = getAiConfig();
  const statusKey = aiStatusKey(question, config.model);
  const cacheKey = aiCacheKey(question, config.model);
  const cache = getAiCache();
  const currentStatus = state.aiStatus[statusKey] || {};
  if (currentStatus.loading) return;

  if (!options.force && (cache[cacheKey] || currentStatus.content)) {
    state.aiExpanded[statusKey] = !state.aiExpanded[statusKey];
    renderActiveQuestion();
    return;
  }

  if (!config.apiBase || !config.apiKey || !config.model) {
    state.aiStatus[statusKey] = { error: "请先到“AI 配置”填写 API 地址、key，并选择模型。" };
    state.aiExpanded[statusKey] = true;
    renderActiveQuestion();
    return;
  }

  const userAnswer = currentUserAnswer(question);
  state.aiExpanded[statusKey] = true;
  state.aiStatus[statusKey] = { loading: true, content: options.force ? currentStatus.content || cache[cacheKey] || "" : "" };
  renderActiveQuestion();

  try {
    const response = await fetch(buildApiUrl(config.apiBase, "chat/completions"), {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "你是一名严谨的模拟 IC 与半导体器件物理保研面试助教，解释要准确、分层，并明确区分选择题判断和面试口答。",
          },
          { role: "user", content: buildPrompt(question, userAnswer) },
        ],
        temperature: 0.2,
      }),
    });
    if (!response.ok) throw new Error(`AI 请求失败：HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("AI 返回为空。");
    cache[cacheKey] = content;
    saveAiCache(cache);
    state.aiStatus[statusKey] = { content };
  } catch (error) {
    state.aiStatus[statusKey] = { error: explainNetworkError(error), content: cache[cacheKey] || currentStatus.content || "" };
  }
  renderActiveQuestion();
}

async function requestAiFollowup(questionId, text) {
  const question = questionById(questionId);
  if (!question) return;
  const config = getAiConfig();
  const content = String(text || "").trim();
  const statusKey = aiStatusKey(question, config.model);
  if (!content || state.aiFollowupLoading[statusKey]) return;
  if (!config.apiBase || !config.apiKey || !config.model) {
    state.aiStatus[statusKey] = { ...(state.aiStatus[statusKey] || {}), error: "请先到“AI 配置”填写 API 地址、key，并选择模型。" };
    state.aiExpanded[statusKey] = true;
    renderActiveQuestion();
    return;
  }

  const cache = getAiCache();
  const cacheKey = aiCacheKey(question, config.model);
  const currentStatus = state.aiStatus[statusKey] || {};
  const firstAiContent = currentStatus.content || cache[cacheKey] || "";
  const userAnswer = currentUserAnswer(question);
  const chatHistory = getQuestionChat(question, config.model);
  state.aiExpanded[statusKey] = true;
  state.aiFollowupLoading[statusKey] = true;
  state.aiFollowupDrafts[statusKey] = content;
  renderActiveQuestion();

  try {
    const response = await fetch(buildApiUrl(config.apiBase, "chat/completions"), {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: `你是一名严谨的模拟 IC 与半导体器件物理保研面试助教。回答要准确、分层，并围绕当前题目区分选择题判断和面试口答。${
              config.customPrompt || DEFAULT_AI_CUSTOM_PROMPT
            }`,
          },
          { role: "user", content: buildFollowupPrompt(question, userAnswer, firstAiContent, chatHistory, content) },
        ],
        temperature: 0.25,
      }),
    });
    if (!response.ok) throw new Error(`AI 追问请求失败：HTTP ${response.status}`);
    const payload = await response.json();
    const reply = payload.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error("AI 返回为空。");
    appendQuestionChat(question, config.model, content, reply);
    delete state.aiFollowupDrafts[statusKey];
    state.aiStatus[statusKey] = { ...currentStatus, content: firstAiContent, error: "" };
  } catch (error) {
    state.aiStatus[statusKey] = { ...currentStatus, content: firstAiContent, error: explainNetworkError(error) };
  } finally {
    state.aiFollowupLoading[statusKey] = false;
    renderActiveQuestion();
  }
}

function currentUserAnswer(question) {
  if (state.exam && $("#examView").classList.contains("active-view")) return selectedLabel(state.exam.answers[question.id]);
  if (state.practice?.questions[state.practice.index]?.id === question.id) {
    const record = getPracticeRecord(question);
    return state.practice.mode === "flip" ? record.selfEval || "未自评" : selectedLabel(record.selected);
  }
  return "未作答";
}

function explainNetworkError(error) {
  const message = error?.message || String(error);
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) return "请求失败：浏览器可能被 CORS 拦截，或 API 地址不可访问。";
  return message;
}

function renderInlineMarkdown(value) {
  const placeholders = [];
  const stash = (html) => {
    const token = `\u0000${placeholders.length}\u0000`;
    placeholders.push(html);
    return token;
  };
  let text = String(value || "")
    .replace(/`([^`]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`))
    .replace(/\\\((.+?)\\\)/g, (_, math) => stash(`<span class="math-inline">${escapeHtml(math)}</span>`))
    .replace(/\$([^$\n]+)\$/g, (_, math) => stash(`<span class="math-inline">${escapeHtml(math)}</span>`));
  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  placeholders.forEach((html, index) => {
    text = text.replace(new RegExp(`\\u0000${index}\\u0000`, "g"), html);
  });
  return text;
}

function renderMarkdown(value) {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let listType = "";
  let inCode = false;
  let codeLines = [];
  let inMath = false;
  let mathLines = [];
  let quoteLines = [];
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = "";
    }
  };
  const closeQuote = () => {
    if (quoteLines.length) {
      html.push(`<blockquote>${quoteLines.map((line) => `<p>${renderInlineMarkdown(line)}</p>`).join("")}</blockquote>`);
      quoteLines = [];
    }
  };
  const openList = (type) => {
    closeQuote();
    if (listType !== type) {
      closeList();
      listType = type;
      html.push(`<${type}>`);
    }
  };
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      closeList();
      closeQuote();
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    if (trimmed === "$$" || trimmed === "\\[" || trimmed === "\\]") {
      closeList();
      closeQuote();
      if (inMath) {
        html.push(`<div class="math-block">${escapeHtml(mathLines.join("\n"))}</div>`);
        mathLines = [];
        inMath = false;
      } else {
        inMath = true;
      }
      return;
    }
    if (inMath) {
      mathLines.push(line);
      return;
    }
    if (!trimmed) {
      closeList();
      closeQuote();
      return;
    }
    if (/^---+$/.test(trimmed)) {
      closeList();
      closeQuote();
      html.push("<hr>");
      return;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      closeQuote();
      const level = heading[1].length + 2;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      return;
    }
    const quote = trimmed.match(/^>\s?(.+)$/);
    if (quote) {
      closeList();
      quoteLines.push(quote[1]);
      return;
    }
    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      openList("ul");
      html.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
      return;
    }
    const ordered = trimmed.match(/^\d+[.)、]\s+(.+)$/);
    if (ordered) {
      openList("ol");
      html.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`);
      return;
    }
    closeList();
    closeQuote();
    const blockMath = trimmed.match(/^\$\$(.+)\$\$$/) || trimmed.match(/^\\\[(.+)\\\]$/);
    if (blockMath) {
      html.push(`<div class="math-block">${escapeHtml(blockMath[1])}</div>`);
      return;
    }
    html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  });
  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  if (inMath) html.push(`<div class="math-block">${escapeHtml(mathLines.join("\n"))}</div>`);
  closeList();
  closeQuote();
  return html.join("");
}

function setTheme(theme) {
  if (theme === "night") document.documentElement.setAttribute("data-theme", "night");
  else document.documentElement.removeAttribute("data-theme");
  localStorage.setItem(STORAGE.theme, theme);
  if (state.view === "home") renderHome();
}

function loadTheme() {
  const saved = localStorage.getItem(STORAGE.theme) || localStorage.getItem(LEGACY_THEME_KEY) || "day";
  setTheme(saved === "night" ? "night" : "day");
}

function resetData() {
  if (!window.confirm("确定要重置所有学习数据吗？建议先导出备份。")) return;
  if (!window.confirm("再次确认：重置后将丢失全部学习进度，此操作不可撤销。")) return;
  [STORAGE.progress, STORAGE.mistakes, STORAGE.favorites, STORAGE.aiCache, STORAGE.aiChats, STORAGE.practiceSession].forEach((key) =>
    localStorage.removeItem(key)
  );
  progress = { answered: {}, xp: 0, level: 1, achievements: {}, studyLog: {} };
  mistakes = {};
  favorites = {};
  state.aiStatus = {};
  state.aiExpanded = {};
  state.aiFollowupDrafts = {};
  state.aiFollowupLoading = {};
  checkIn();
  showToast("学习数据已重置。");
  showView("home");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function spawnConfetti() {
  const colors = ["#24786c", "#ffd166", "#2f5f98", "#b42318", "#66c2a5"];
  for (let i = 0; i < 24; i += 1) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.top = `${Math.random() * 42 + 22}vh`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = `${Math.random() * 8 + 4}px`;
    piece.style.height = `${Math.random() * 8 + 4}px`;
    piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
    piece.style.animationDuration = `${Math.random() * 0.8 + 0.8}s`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 1800);
  }
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "go-chapter") showView("chapter");
    if (action === "go-exam") showView("exam");
    if (action === "go-mistakes") showView("mistakes");
    if (action === "go-favorites") showView("favorites");
    if (action === "go-search") showView("search");
    if (action === "go-backup") showView("backup");
    if (action === "go-config") showView("config");
    if (action === "continue-practice") restorePracticeSession();
    if (action === "set-theme") setTheme(target.dataset.theme);
    if (action === "start-chapter") startChapterPractice(Number(target.dataset.chapter), target.dataset.mode);
    if (action === "back-practice") showView(state.practice?.returnView || "chapter");
    if (action === "set-practice-mode") {
      state.practice.mode = target.dataset.mode;
      state.practice.flipped = false;
      renderPractice();
    }
    if (action === "check-practice") checkPracticeAnswer();
    if (action === "prev-practice") prevPractice();
    if (action === "next-practice") nextPractice();
    if (action === "flip-card") {
      state.practice.flipped = !state.practice.flipped;
      if (state.practice.flipped) addXP(1);
      saveProgress();
      renderPractice();
    }
    if (action === "self-eval") selfEval(target.dataset.level);
    if (action === "toggle-favorite") toggleFavorite(questionById(target.dataset.questionId));
    if (action === "start-exam") startExam();
    if (action === "prev-exam" && state.exam?.index > 0) {
      state.exam.index -= 1;
      renderExam();
    }
    if (action === "next-exam" && state.exam?.index + 1 < state.exam.questions.length) {
      state.exam.index += 1;
      renderExam();
    }
    if (action === "jump-exam") {
      state.exam.index = Number(target.dataset.index);
      renderExam();
    }
    if (action === "submit-exam") submitExam();
    if (action === "clear-mistakes" && window.confirm("确定清空错题本吗？")) {
      mistakes = {};
      saveMistakes();
      renderMistakes();
      updateGlobalStats();
    }
    if (action === "start-mistakes") startMistakePractice("choice");
    if (action === "start-mistakes-flip") startMistakePractice("flip");
    if (action === "start-single-review") {
      const question = questionById(target.dataset.questionId);
      if (question) startPractice("单题重练", [question], { removeOnCorrect: true, returnView: "mistakes" });
    }
    if (action === "clear-favorites" && window.confirm("确定清空收藏题库吗？")) {
      favorites = {};
      saveFavorites();
      renderFavorites();
      updateGlobalStats();
    }
    if (action === "start-favorites") startFavoritePractice("choice");
    if (action === "start-favorites-flip") startFavoritePractice("flip");
    if (action === "start-single-favorite" || action === "start-single-search") {
      const question = questionById(target.dataset.questionId);
      if (question) startPractice("单题练习", [question], { returnView: action === "start-single-search" ? "search" : "favorites" });
    }
    if (action === "run-search") {
      state.searchQuery = $("#searchInput")?.value || "";
      renderSearch();
    }
    if (action === "export-backup") exportBackupFile();
    if (action === "save-backup-config") {
      const previous = getBackupConfig();
      const next = readBackupForm();
      if (next.autoEnabled && !previous.autoEnabled && !next.lastAutoBackupAt) {
        next.lastAutoBackupAt = new Date().toISOString();
        next.lastAutoBackupStatus = "自动备份已启用，等待下次到点执行";
      }
      if (!next.autoEnabled) {
        next.lastAutoBackupStatus = previous.lastAutoBackupStatus;
      }
      saveBackupConfig(next);
      state.backupMessage = "GitHub 配置已保存。";
      renderBackup();
    }
    if (action === "backup-to-github") backupToGithub();
    if (action === "restore-from-github") restoreFromGithub();
    if (action === "fetch-models") fetchModels();
    if (action === "save-ai-config") {
      saveAiConfig(readConfigForm());
      state.configMessage = "配置已保存。";
      renderConfigSafe();
    }
    if (action === "clear-ai-cache" && window.confirm("确定清除 AI 解析缓存吗？")) {
      saveAiCache({});
      state.configMessage = "解析缓存已清除。";
      renderConfigSafe();
    }
    if (action === "clear-ai-config" && window.confirm("确定清除 AI 配置吗？")) {
      localStorage.removeItem(STORAGE.aiConfig);
      state.configMessage = "AI 配置已清除。";
      renderConfigSafe();
    }
    if (action === "ai-explain") requestAiExplanation(target.dataset.questionId);
    if (action === "redo-ai-explain") requestAiExplanation(target.dataset.questionId, { force: true });
    if (action === "use-followup-suggestion") {
      const question = questionById(target.dataset.questionId);
      if (!question) return;
      const key = aiStatusKey(question, getAiConfig().model);
      state.aiFollowupDrafts[key] = target.dataset.text || "";
      const input = document.querySelector(`[data-followup-input="${question.id}"]`);
      if (input) {
        input.value = state.aiFollowupDrafts[key];
        input.focus();
      }
    }
    if (action === "send-ai-followup") {
      const input = document.querySelector(`[data-followup-input="${target.dataset.questionId}"]`);
      requestAiFollowup(target.dataset.questionId, input?.value || "");
    }
    if (action === "clear-ai-chat") {
      const question = questionById(target.dataset.questionId);
      if (question && window.confirm("确定清空这道题的追问历史吗？AI 解析缓存不会被清除。")) clearQuestionChat(question);
    }
    if (action === "show-study-panel") showView("home");
  });

  document.addEventListener("input", (event) => {
    const input = event.target;
    if (!input.matches("[data-followup-input]")) return;
    const question = questionById(input.dataset.followupInput);
    if (!question) return;
    state.aiFollowupDrafts[aiStatusKey(question, getAiConfig().model)] = input.value;
  });

  document.addEventListener("change", (event) => {
    const input = event.target;
    if (input.matches('input[name^="exam-answer-"]')) handleExamAnswer(input);
    if (input.id === "backupFile") importBackupFile(input);
  });

  document.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
    if ($("#practiceView").classList.contains("active-view")) {
      if (event.key === "ArrowLeft") prevPractice();
      if (event.key === "ArrowRight") nextPractice();
      if (event.key.toLowerCase() === "f" && state.practice?.mode === "flip") {
        state.practice.flipped = !state.practice.flipped;
        renderPractice();
      }
      if (/^[1-6]$/.test(event.key)) {
        const input = document.querySelector(`input[name^="practice-answer-"][value="${Number(event.key) - 1}"]`);
        if (input && !input.disabled) input.checked = true;
      }
    }
  });

  $("#mobileMenuButton").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
}

function autoBackupDue(config) {
  if (!config.autoEnabled) return false;
  if (!config.lastAutoBackupAt) return true;
  const last = new Date(config.lastAutoBackupAt).getTime();
  if (Number.isNaN(last)) return true;
  return Date.now() - last >= config.autoIntervalMinutes * 60 * 1000;
}

async function runAutoBackupIfDue() {
  const config = getBackupConfig();
  if (!autoBackupDue(config) || state.backupInFlight) return;
  if (!config.token) {
    markAutoBackupAttempt(config, "自动备份跳过：请先填写 GitHub token");
    renderBackupIfActive();
    return;
  }
  await backupToGithub({ auto: true, config });
}

setInterval(() => {
  if (progress.studyLog[todayStr]) {
    progress.studyLog[todayStr].time = (progress.studyLog[todayStr].time || 0) + 1;
    saveProgress();
    if (state.view === "home") renderHome();
  }
  runAutoBackupIfDue();
}, 60000);

init();
