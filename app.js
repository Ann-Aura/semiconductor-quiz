/* ==============================
   半导体器件物理 · 刷题 - 主程序
   ============================== */

// ===== 全局状态 =====
let questions = [];
let currentIndex = 0;
let currentIds = [];
let mode = 'choice';
let answered = {};
let wrongSet = new Set();
let xp = 0;
let level = 1;
let achievements = {};
let studyLog = {};
let sessionStart = Date.now();
let todayStr = '';
let started = false;
let currentTheme = 'day';
let searchTimer = null;

// ===== 初始化 =====
function init() {
  loadData();
  loadTheme();
  fetch('questions.json')
    .then(r => r.json())
    .then(data => {
      questions = data;
      document.getElementById('qText').textContent = '题库加载完成！';
      buildChapterFilter();
      applyFilters();
      renderCalendar();
      updateTodaySummary();
      updateAchievements();
      updateStats();
      checkIn();
      showWelcome();
    })
    .catch(err => {
      document.getElementById('qText').textContent = '⚠️ 题库加载失败，请检查 questions.json 是否存在。';
      console.error(err);
    });
}

// ===== 数据持久化 =====
function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem('semiquiz_data'));
    if (saved) {
      answered = saved.answered || {};
      wrongSet = new Set(saved.wrongList || []);
      xp = saved.xp || 0;
      level = saved.level || 1;
      achievements = saved.achievements || {};
      studyLog = saved.studyLog || {};
    }
  } catch (e) { console.warn('Load error', e); }
  todayStr = getTodayStr();
}

function saveData() {
  try {
    localStorage.setItem('semiquiz_data', JSON.stringify({
      answered,
      wrongList: [...wrongSet],
      xp,
      level,
      achievements,
      studyLog
    }));
  } catch (e) { console.warn('Save error', e); }
}

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function checkIn() {
  if (!studyLog[todayStr]) {
    studyLog[todayStr] = { count: 0, correct: 0, wrong: 0, time: 0 };
  }
  saveData();
}

// ===== 章节 & 筛选 =====
function buildChapterFilter() {
  const sel = document.getElementById('chapterFilter');
  const chNames = {
    1: '半导体物理基础与晶体结构',
    2: '载流子统计与热平衡',
    3: '载流子输运、复合与连续性方程',
    4: 'PN 结基础与结特性',
    5: '金属-半导体接触与肖特基器件',
    6: '双极型晶体管与结型器件',
    7: 'MOS 电容与表面物理',
    8: 'MOSFET 工作原理与电流模型',
    9: '先进 MOSFET、短沟道与可靠性',
    10: '光电子器件与太阳能电池',
    11: '功率器件、高频器件与异质结器件',
    12: '工艺、表征与综合分析'
  };
  const chapters = new Set(questions.map(q => q.chapter));
  [...chapters].sort((a, b) => a - b).forEach(ch => {
    const opt = document.createElement('option');
    opt.value = ch;
    opt.textContent = '第' + ch + '章 · ' + (chNames[ch] || '');
    sel.appendChild(opt);
  });
}

function applyFilters() {
  const ch = parseInt(document.getElementById('chapterFilter').value);
  const modeF = document.getElementById('modeFilter').value;
  let filtered = questions.filter(q => ch === 0 || q.chapter === ch);
  const searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();
  if (searchTerm) {
    filtered = filtered.filter(q =>
      q.question_text.toLowerCase().includes(searchTerm) ||
      q.explanation.toLowerCase().includes(searchTerm) ||
      q.formula.toLowerCase().includes(searchTerm) ||
      (q.tags && q.tags.some(t => t.toLowerCase().includes(searchTerm)))
    );
  }
  if (modeF === 'wrong') {
    const wrongIds = [...wrongSet];
    filtered = filtered.filter(q => wrongIds.includes(q.id));
    filtered.sort((a, b) => {
      const aCnt = answered[a.id] ? (answered[a.id].wrongCount || 0) : 0;
      const bCnt = answered[b.id] ? (answered[b.id].wrongCount || 0) : 0;
      return bCnt - aCnt;
    });
  } else if (modeF === 'random') {
    filtered = [...filtered];
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }
  }
  currentIds = filtered.map(q => q.id);
  currentIndex = 0;
  if (currentIds.length === 0) {
    document.getElementById('qText').textContent = '😅 没有符合条件的题目';
    document.getElementById('optionsContainer').innerHTML = '';
    return;
  }
  if (started) {
    showQuestion(currentIndex);
  } else {
    showWelcome();
  }
  updateStats();
}

function applyFilterFromSettings() {
  document.getElementById('chapterFilter').value = document.getElementById('chapterFilterSettings').value;
  document.getElementById('modeFilter').value = document.getElementById('modeFilterSettings').value;
  applyFilters();
  if (!started) showWelcome();
}

// ===== 搜索 =====
function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    applyFilters();
    showSearchDropdown();
  }, 300);
}

function showSearchDropdown() {
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  const term = input.value.trim().toLowerCase();
  if (!term) { results.classList.remove('show'); return; }
  const matched = questions.filter(q =>
    q.question_text.toLowerCase().includes(term) ||
    q.explanation.toLowerCase().includes(term)
  ).slice(0, 10);
  if (matched.length === 0) { results.classList.remove('show'); return; }
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  results.innerHTML = matched.map(q => {
    const hl = q.question_text.replace(new RegExp(escaped, 'gi'), m => '<mark>' + m + '</mark>');
    return '<div class="sr-item" onclick="goToQuestion(' + q.id + ')"><span class="sr-num">#' + q.id + '</span>' + hl + '<span class="sr-chapter">第' + q.chapter + '章</span></div>';
  }).join('');
  results.classList.add('show');
}

document.addEventListener('click', function (e) {
  const box = document.querySelector('.search-box');
  if (box && !box.contains(e.target)) {
    document.getElementById('searchResults').classList.remove('show');
  }
});

function goToQuestion(id) {
  const idx = currentIds.indexOf(id);
  if (idx !== -1) {
    currentIndex = idx;
    showQuestion(currentIndex);
  }
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').classList.remove('show');
}

// ===== 渲染题目 =====
function showQuestion(index) {
  if (!currentIds.length) return;
  const id = currentIds[index];
  const q = questions.find(x => x.id === id);
  if (!q) return;
  document.getElementById('qNum').textContent = '第 ' + (index + 1) + ' / ' + currentIds.length + ' 题';
  document.getElementById('qChapter').textContent = q.chapter_name;
  document.getElementById('qText').textContent = q.question_text;
  if (mode === 'choice') {
    document.getElementById('choiceArea').style.display = 'block';
    document.getElementById('flipArea').style.display = 'none';
    renderOptions(q);
  } else {
    document.getElementById('choiceArea').style.display = 'none';
    document.getElementById('flipArea').style.display = 'block';
    renderFlip(q);
  }
  document.getElementById('prevBtn').disabled = index === 0;
  document.getElementById('nextBtn').disabled = index >= currentIds.length - 1;
  updateStats();
}

// ===== 选择题模式 =====
function renderOptions(q) {
  const container = document.getElementById('optionsContainer');
  const feedback = document.getElementById('feedback');
  feedback.classList.remove('show', 'correct', 'wrong');
  const labels = ['A', 'B', 'C', 'D'];
  const answeredInfo = answered[q.id];
  container.innerHTML = q.options.map((opt, idx) => {
    let cls = 'option-btn';
    let disabled = '';
    if (answeredInfo) {
      disabled = 'disabled';
      if (idx === q.correct) cls += ' correct';
      else if (idx === answeredInfo.selected) cls += ' wrong';
      else cls += ' disabled';
    }
    return '<button class="' + cls + '" ' + disabled + ' onclick="selectOption(' + q.id + ',' + idx + ')"><span class="label">' + labels[idx] + '.</span>' + escapeHtml(opt) + '</button>';
  }).join('');
  if (answeredInfo && answeredInfo.selected !== undefined) {
    showFeedback(q, answeredInfo.selected === q.correct);
  }
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function selectOption(qId, selectedIdx) {
  const q = questions.find(x => x.id === qId);
  if (!q || answered[qId]) return;
  const isCorrect = selectedIdx === q.correct;
  answered[qId] = {
    selected: selectedIdx,
    correct: isCorrect,
    timestamp: Date.now(),
    wrongCount: answered[qId] ? (answered[qId].wrongCount || 0) : 0
  };
  if (!isCorrect) {
    answered[qId].wrongCount = (answered[qId].wrongCount || 0) + 1;
    wrongSet.add(qId);
  }
  logStudy(isCorrect);
  addXP(isCorrect ? 10 : 2);
  renderOptions(q);
  updateStats();
  saveData();
  if (isCorrect) {
    showToast('✅ 回答正确！+10 XP');
    if (Math.random() < 0.1) spawnConfetti();
  } else {
    showToast('❌ 答错了，看看解析吧 +2 XP');
  }
}

function showFeedback(q, isCorrect) {
  const fb = document.getElementById('feedback');
  fb.className = 'feedback show ' + (isCorrect ? 'correct' : 'wrong');
  document.getElementById('fbTitle').textContent = isCorrect ? '✅ 回答正确！' : '❌ 回答错误';
  document.getElementById('fbFormula').textContent = '📐 ' + q.formula;
  document.getElementById('fbExplanation').textContent = '📖 ' + q.explanation;
}

// ===== 翻转卡片模式 =====
function renderFlip(q) {
  const card = document.getElementById('flipCard');
  card.classList.remove('flipped');
  document.getElementById('flipQText').textContent = q.question_text;
  document.getElementById('flipAnswer').textContent = q.short_answer;
  document.getElementById('flipFormula').textContent = '📐 ' + q.formula;
  document.getElementById('flipExplanation').textContent = '📖 ' + q.explanation;
}

function flipCard() {
  const card = document.getElementById('flipCard');
  card.classList.toggle('flipped');
  if (card.classList.contains('flipped')) addXP(1);
}

function selfEval(level) {
  if (!currentIds.length) return;
  const qId = currentIds[currentIndex];
  if (!answered[qId]) {
    answered[qId] = { selfEval: level, timestamp: Date.now(), wrongCount: 0 };
  } else {
    answered[qId].selfEval = level;
  }
  if (level === 'hard') { wrongSet.add(qId); answered[qId].correct = false; }
  else if (level === 'easy') { answered[qId].correct = true; }
  const xpGain = level === 'easy' ? 5 : level === 'medium' ? 3 : 1;
  addXP(xpGain);
  logStudy(level !== 'hard');
  saveData();
  updateStats();
  const msgs = {
    easy: '😊 已掌握！+5 XP',
    medium: '🤔 继续加油！+3 XP',
    hard: '😵 标记为不会，已加入错题本 +1 XP'
  };
  showToast(msgs[level]);
}

// ===== 导航 =====
function navigate(dir) {
  const newIdx = currentIndex + dir;
  if (newIdx < 0 || newIdx >= currentIds.length) return;
  currentIndex = newIdx;
  showQuestion(currentIndex);
}

function setMode(m) {
  mode = m;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  if (currentIds.length) showQuestion(currentIndex);
}

// ===== 学习记录 & XP =====
function logStudy(isCorrect) {
  if (!studyLog[todayStr]) studyLog[todayStr] = { count: 0, correct: 0, wrong: 0, time: 0 };
  studyLog[todayStr].count++;
  if (isCorrect) studyLog[todayStr].correct++;
  else studyLog[todayStr].wrong++;
  saveData();
  updateTodaySummary();
}

function addXP(amount) {
  xp += amount;
  const newLevel = Math.floor(Math.sqrt(xp / 50)) + 1;
  if (newLevel > level) {
    level = newLevel;
    showToast('🎉 升级！达到 Lv.' + level);
    spawnConfetti();
  }
  level = newLevel;
  updateXPBar();
  saveData();
}

function updateXPBar() {
  const xpForNext = level * level * 50;
  const xpForCurrent = (level - 1) * (level - 1) * 50;
  const progress = (xp - xpForCurrent) / (xpForNext - xpForCurrent) * 100;
  document.getElementById('xpFill').style.width = Math.min(100, Math.max(0, progress)) + '%';
  document.getElementById('xpText').textContent = xp + ' XP';
  document.getElementById('levelBadge').textContent = 'Lv.' + level;
}

// ===== 统计更新 =====
function updateStats() {
  const total = currentIds.length;
  const done = currentIds.filter(id => answered[id] && (answered[id].correct !== undefined || answered[id].selfEval)).length;
  const correct = currentIds.filter(id => answered[id] && answered[id].correct === true).length;
  const rate = done > 0 ? Math.round(correct / done * 100) : 0;
  document.getElementById('progressNum').textContent = done + ' / ' + total;
  document.getElementById('correctNum').textContent = correct;
  document.getElementById('rateNum').textContent = rate + '%';
  document.getElementById('progressFill').style.width = (total > 0 ? done / total * 100 : 0) + '%';
  document.getElementById('wrongCount').textContent = wrongSet.size;
  updateWrongList();
  updateXPBar();
  updateAchievements();
}

function updateWrongList() {
  const list = document.getElementById('wrongList');
  const wrongIds = [...wrongSet];
  if (wrongIds.length === 0) {
    list.innerHTML = '<li style="color:var(--text2);text-align:center;padding:20px">🎉 暂无错题，太棒了！</li>';
    return;
  }
  list.innerHTML = wrongIds.slice(0, 30).map(id => {
    const q = questions.find(x => x.id === id);
    if (!q) return '';
    return '<li onclick="goToQuestion(' + id + ')">#' + id + ' ' + q.question_text.slice(0, 40) + '...</li>';
  }).join('');
  if (wrongIds.length > 30) {
    list.innerHTML += '<li style="text-align:center;color:var(--text2)">还有更多...</li>';
  }
}

// ===== 学习日历 =====
function renderCalendar() {
  const container = document.getElementById('calendarContainer');
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  let html = '<div style="text-align:center;font-weight:700;margin-bottom:8px">' + year + '年 ' + monthNames[month] + '</div>';
  html += '<table class="calendar"><tr><th>日</th><th>一</th><th>二</th><th>三</th><th>四</th><th>五</th><th>六</th></tr><tr>';
  for (let i = 0; i < firstDay; i++) html += '<td class="empty"></td>';
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const isToday = dateStr === todayStr;
    const hasStudy = studyLog[dateStr] && studyLog[dateStr].count > 0;
    let cls = '';
    if (hasStudy) cls += ' learned';
    if (isToday) cls += ' today';
    html += '<td class="' + cls + '">' + day + '</td>';
    if ((firstDay + day) % 7 === 0) html += '</tr><tr>';
  }
  html += '</tr></table>';
  const studyDays = Object.keys(studyLog).filter(d => studyLog[d].count > 0).length;
  const streak = calcStreak();
  html += '<div style="text-align:center;margin-top:8px;font-size:.85em;color:var(--text2)">📆 本月学习 ' + studyDays + ' 天 · 连续 ' + streak + ' 天</div>';
  container.innerHTML = html;
}

function calcStreak() {
  let streak = 0;
  const d = new Date();
  while (true) {
    const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (studyLog[ds] && studyLog[ds].count > 0) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

// ===== 今日总结 =====
function updateTodaySummary() {
  const today = studyLog[todayStr] || { count: 0, correct: 0, wrong: 0, time: 0 };
  document.getElementById('sTodayCount').textContent = today.count + ' 题';
  document.getElementById('sTodayCorrect').textContent = today.correct + ' 题';
  const rate = today.count > 0 ? Math.round(today.correct / today.count * 100) : 0;
  document.getElementById('sTodayRate').textContent = rate + '%';
  document.getElementById('sTodayWrong').textContent = today.wrong + ' 题';
  const elapsed = Math.floor((Date.now() - sessionStart) / 60000);
  const totalTime = (today.time || 0) + elapsed;
  document.getElementById('sTodayTime').textContent = totalTime + ' 分钟';
  renderCalendar();
}

setInterval(updateTodaySummary, 60000);

// ===== 成就系统 =====
function updateAchievements() {
  const list = document.getElementById('achievementList');
  const totalAnswered = Object.keys(answered).length;
  const totalCorrect = Object.values(answered).filter(a => a.correct === true).length;
  const streak = calcStreak();
  const allAch = [
    { id: 'first', name: '🎯 初出茅庐', check: () => totalAnswered >= 1 },
    { id: 'ten', name: '💪 小试牛刀', check: () => totalAnswered >= 10 },
    { id: 'fifty', name: '🔥 渐入佳境', check: () => totalAnswered >= 50 },
    { id: 'hundred', name: '⚡ 百题斩', check: () => totalAnswered >= 100 },
    { id: 'all', name: '👑 满腹经纶', check: () => totalAnswered >= 300 },
    { id: 'streak3', name: '📆 三日不辍', check: () => streak >= 3 },
    { id: 'streak7', name: '📆 持之以恒', check: () => streak >= 7 },
    { id: 'perfect', name: '🌟 完美无缺', check: () => totalCorrect >= 10 && Math.abs(totalCorrect / (totalAnswered || 1) - 1) < 0.01 },
    { id: 'level5', name: '🌈 Lv.5 达人', check: () => level >= 5 },
    { id: 'level10', name: '🏅 Lv.10 大师', check: () => level >= 10 },
  ];
  allAch.forEach(ach => {
    if (!achievements[ach.id] && ach.check()) {
      achievements[ach.id] = Date.now();
      showToast('🏆 解锁成就：' + ach.name);
      spawnConfetti();
    }
  });
  list.innerHTML = allAch.map(ach => {
    const unlocked = !!achievements[ach.id];
    return '<span class="ach ' + (unlocked ? '' : 'locked') + '">' + (unlocked ? ach.name : '🔒 ???') + '</span>';
  }).join('');
  saveData();
}

// ===== 欢迎页 & 开始学习 =====
function showWelcome() {
  document.getElementById('welcomeCard').style.display = 'flex';
  document.getElementById('questionCard').style.display = 'none';
  started = false;
  const q = questions;
  document.getElementById('welcomeTotal').textContent = '📚 ' + q.length + ' 道题目';
  const ch = parseInt(document.getElementById('chapterFilter').value);
  const chNames = {
    1: '半导体物理基础', 2: '载流子统计', 3: '载流子输运',
    4: 'PN 结', 5: '肖特基接触', 6: 'BJT',
    7: 'MOS 电容', 8: 'MOSFET', 9: '先进 MOSFET',
    10: '光电子', 11: '功率器件', 12: '工艺表征'
  };
  document.getElementById('welcomeChapter').textContent = ch === 0 ? '📂 全部章节' : '📂 第' + ch + '章 ' + (chNames[ch] || '');
}

function startLearning() {
  started = true;
  document.getElementById('welcomeCard').style.display = 'none';
  document.getElementById('questionCard').style.display = 'block';
  if (currentIds.length > 0) showQuestion(0);
}

// ===== 主题切换 =====
function setTheme(theme) {
  currentTheme = theme;
  if (theme === 'night') {
    document.documentElement.setAttribute('data-theme', 'night');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('semiquiz_theme', theme);
  const sel = document.getElementById('themeSelect');
  if (sel) sel.value = theme;
}

function loadTheme() {
  const saved = localStorage.getItem('semiquiz_theme');
  if (saved) setTheme(saved);
}

// ===== UI 控制 =====
function toggleMenu() {
  const controls = document.getElementById('topControls');
  const toggle = document.getElementById('menuToggle');
  controls.classList.toggle('open');
  toggle.textContent = controls.classList.contains('open') ? '✕' : '☰';
}

function toggleSettings() {
  const overlay = document.getElementById('settingsOverlay');
  overlay.classList.toggle('open');
  if (overlay.classList.contains('open')) {
    populateSettingsFilters();
  }
}

function populateSettingsFilters() {
  const mainFilter = document.getElementById('chapterFilter');
  const settingsFilter = document.getElementById('chapterFilterSettings');
  settingsFilter.innerHTML = mainFilter.innerHTML;
  settingsFilter.value = mainFilter.value;
  document.getElementById('modeFilterSettings').value = document.getElementById('modeFilter').value;
  document.getElementById('themeSelect').value = currentTheme;
}

function togglePanel() {
  document.getElementById('sidePanel').classList.toggle('open');
  updateTodaySummary();
}

// ===== 数据管理 =====
function exportData() {
  try {
    const data = localStorage.getItem('semiquiz_data');
    if (!data) { showToast('⚠️ 没有可导出的数据'); return; }
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = '半导体物理_学习数据_' + today + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('✅ 数据导出成功');
  } catch (e) { showToast('⚠️ 导出失败：' + e.message); }
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      localStorage.setItem('semiquiz_data', JSON.stringify(data));
      location.reload();
    } catch (err) { showToast('⚠️ 文件格式错误，请选择正确的备份文件'); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function resetData() {
  if (!confirm('⚠️ 确定要重置所有学习数据吗？\n\n此操作将清除：\n· 所有答题记录\n· XP 经验值和等级\n· 成就和错题本\n· 学习日历和统计数据\n\n建议先导出数据备份！')) return;
  if (!confirm('🚨 再次确认：重置后将丢失全部学习进度，此操作不可撤销！\n\n确定要继续吗？')) return;
  localStorage.removeItem('semiquiz_data');
  showToast('🗑️ 数据已重置，即将刷新页面');
  setTimeout(() => location.reload(), 1000);
}

// ===== 快捷键 =====
document.addEventListener('keydown', function (e) {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft') navigate(-1);
  else if (e.key === 'ArrowRight') navigate(1);
  else if (e.key === 'f' || e.key === 'F') flipCard();
  else if (e.key === '1') { const btns = document.querySelectorAll('.option-btn:not(.disabled)'); if (btns[0]) btns[0].click(); }
  else if (e.key === '2') { const btns = document.querySelectorAll('.option-btn:not(.disabled)'); if (btns[1]) btns[1].click(); }
  else if (e.key === '3') { const btns = document.querySelectorAll('.option-btn:not(.disabled)'); if (btns[2]) btns[2].click(); }
  else if (e.key === '4') { const btns = document.querySelectorAll('.option-btn:not(.disabled)'); if (btns[3]) btns[3].click(); }
});

// ===== 工具函数 =====
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2500);
}

function spawnConfetti() {
  const colors = ['#4CAF50', '#FFD700', '#FF5722', '#2196F3', '#E91E63', '#9C27B0'];
  for (let i = 0; i < 30; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.top = Math.random() * 50 + 20 + 'vh';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.width = (Math.random() * 8 + 4) + 'px';
    el.style.height = (Math.random() * 8 + 4) + 'px';
    el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    el.style.animationDuration = (Math.random() * 1 + 0.8) + 's';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }
}

// ===== 启动 =====
init();
