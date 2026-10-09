'use strict';

const STORAGE_KEY = 'keren-remedial-v1';
const ROUND_LENGTH = 10;
const LEVEL_UP_STREAK = 4;   // תשובות נכונות ברצף לעליית שלב
const LEVEL_DOWN_STREAK = 2; // טעויות ברצף לירידת שלב
const MAX_SESSIONS = 300;

// ---------- כלי עזר ----------

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// מחזיר את התשובה ועוד (count-1) מסיחים מתוך המאגר, בסדר אקראי.
function withDistractors(answer, pool, count) {
  const others = shuffle([...new Set(pool)].filter(x => x !== answer)).slice(0, count - 1);
  return shuffle([answer, ...others]);
}

const formatDate = ts => new Date(ts).toLocaleDateString('he-IL');
const percent = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- שמירת נתונים ----------

function loadData() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (d && Array.isArray(d.students)) {
      d.settings = Object.assign({ sound: true }, d.settings);
      return d;
    }
  } catch (e) { /* נתונים פגומים או אחסון חסום – מתחילים מחדש */ }
  return { students: [], settings: { sound: true } };
}

let data = loadData();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    toast('השמירה נכשלה – מומלץ לייצא גיבוי');
  }
}

const findStudent = id => data.students.find(s => s.id === id);

function getProgress(student, activityId) {
  student.progress = student.progress || {};
  if (!student.progress[activityId]) {
    student.progress[activityId] = { level: 1, streak: 0, miss: 0, attempts: 0, correct: 0 };
  }
  return student.progress[activityId];
}

// ---------- הקראה ----------

let hebrewVoice = null;
function pickVoice() {
  if (!window.speechSynthesis) return;
  hebrewVoice = speechSynthesis.getVoices().find(v => v.lang && v.lang.toLowerCase().startsWith('he')) || null;
}
if (window.speechSynthesis) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function speak(text) {
  if (!data.settings.sound || !window.speechSynthesis || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'he-IL';
  u.rate = 0.85;
  if (hebrewVoice) u.voice = hebrewVoice;
  speechSynthesis.speak(u);
}

// ---------- מחוללי שאלות ----------

const LETTER_CHARS = LETTERS.map(l => l.char);
const ALL_LETTER_CHARS = LETTER_CHARS.concat(FINAL_LETTERS.map(l => l.char));
const LETTER_NAME = Object.fromEntries(LETTERS.concat(FINAL_LETTERS).map(l => [l.char, l.name]));

function confusableOptions(target, count) {
  const group = CONFUSABLE.find(g => g.includes(target));
  const base = group ? group.slice(0, count) : [target];
  if (!base.includes(target)) base[0] = target;
  const fill = shuffle(LETTER_CHARS.filter(c => !base.includes(c))).slice(0, count - base.length);
  return shuffle(base.concat(fill));
}

function genLetters(level) {
  let target, options;
  if (level === 1) {
    const pool = LETTER_CHARS.slice(0, 11);
    target = pick(pool);
    options = withDistractors(target, pool, 3);
  } else if (level === 2) {
    target = pick(LETTER_CHARS);
    options = withDistractors(target, LETTER_CHARS, 4);
  } else {
    const group = pick(CONFUSABLE);
    target = pick(group);
    const fill = shuffle(ALL_LETTER_CHARS.filter(c => !group.includes(c))).slice(0, Math.max(0, 4 - group.length));
    options = shuffle(group.concat(fill));
  }
  const name = LETTER_NAME[target];
  return {
    type: 'choice',
    prompt: `<p class="q-text">איפה האות <strong>${name}</strong>?</p>`,
    speak: `איפה האות ${name}?`,
    options: options.map(c => ({ label: c, value: c })),
    optionClass: 'letters',
    answer: target,
    answerLabel: target
  };
}

function genFirstSound(level) {
  const pool = level === 1 ? WORDS.filter(w => w.word.length <= 4) : WORDS;
  const w = pick(pool);
  const first = w.word[0];
  const options = level === 3 ? confusableOptions(first, 4) : withDistractors(first, LETTER_CHARS, level === 1 ? 3 : 4);
  const wordHtml = level === 1
    ? `<p class="word-hint"><span class="blank">?</span>${esc(w.word.slice(1))}</p>`
    : '';
  return {
    type: 'choice',
    prompt: `<div class="emoji-big">${w.emoji}</div>${wordHtml}<p class="q-text">באיזו אות מתחילה המילה?</p>`,
    speak: `באיזו אות מתחילה המילה ${w.word}?`,
    options: options.map(c => ({ label: c, value: c })),
    optionClass: 'letters',
    answer: first,
    answerLabel: first
  };
}

function genBuildWord(level) {
  const byLevel = { 1: w => w.word.length <= 3, 2: w => w.word.length === 4, 3: w => w.word.length >= 5 };
  const w = pick(WORDS.filter(byLevel[level]));
  const letters = w.word.split('');
  let tiles = shuffle(letters);
  for (let i = 0; i < 5 && tiles.join('') === w.word; i++) tiles = shuffle(letters);
  return {
    type: 'order',
    prompt: `<div class="emoji-big">${w.emoji}</div>` +
      (level === 1 ? `<p class="word-hint faint">${esc(w.word)}</p>` : '') +
      '<p class="q-text">סדרו את האותיות למילה</p>',
    speak: `סדרו את האותיות למילה ${w.word}`,
    tiles,
    answer: w.word,
    answerLabel: w.word
  };
}

function genReading(level) {
  const exact = READING.filter(r => r.level === level);
  const item = pick(exact.length ? exact : READING.filter(r => r.level <= level));
  return {
    type: 'choice',
    prompt: `<div class="reading-text">${esc(item.text)}</div><p class="q-text">${esc(item.question)}</p>`,
    speak: `${item.text} ${item.question}`,
    options: shuffle(item.options).map(o => ({ label: o, value: o })),
    optionClass: 'words',
    answer: item.options[0],
    answerLabel: item.options[0]
  };
}

function mathQuestion(a, op, b, answer) {
  const sym = { '+': '+', '-': '−', '*': '×' }[op];
  const word = { '+': 'ועוד', '-': 'פחות', '*': 'כפול' }[op];
  return {
    type: 'number',
    prompt: `<p class="expr" dir="ltr">${a} ${sym} ${b} = <span class="qmark">?</span></p>`,
    speak: `כמה זה ${a} ${word} ${b}?`,
    answer,
    answerLabel: String(answer)
  };
}

function genAddition(level) {
  let a, b;
  if (level === 1) { a = rand(0, 9); b = rand(1, 10 - a); }
  else if (level === 2) { a = rand(2, 15); b = rand(2, 20 - a); }
  else if (level === 3) { // דו-ספרתי ללא המרה
    const t1 = rand(1, 7), t2 = rand(1, 8 - t1), u1 = rand(0, 8), u2 = rand(0, 9 - u1);
    a = t1 * 10 + u1; b = t2 * 10 + u2;
  } else { a = rand(11, 89); b = rand(11, 100 - a); }
  return mathQuestion(a, '+', b, a + b);
}

function genSubtraction(level) {
  let a, b;
  if (level === 1) { a = rand(2, 10); b = rand(0, a); }
  else if (level === 2) { a = rand(10, 20); b = rand(1, a); }
  else if (level === 3) { // דו-ספרתי ללא פריטה
    const t1 = rand(2, 9), t2 = rand(1, t1 - 1), u1 = rand(0, 9), u2 = rand(0, u1);
    a = t1 * 10 + u1; b = t2 * 10 + u2;
  } else { a = rand(30, 100); b = rand(11, a - 1); }
  return mathQuestion(a, '-', b, a - b);
}

function genMultiplication(level) {
  const ranges = { 1: [1, 5], 2: [1, 10], 3: [2, 12] };
  const [min, max] = ranges[level];
  const a = rand(min, max), b = rand(min, max);
  return mathQuestion(a, '*', b, a * b);
}

function genCompare(level) {
  const max = { 1: 10, 2: 100, 3: 1000 }[level];
  const count = level === 3 ? 3 : 2;
  const nums = new Set();
  while (nums.size < count) nums.add(rand(0, max));
  const list = [...nums];
  const bigger = level === 1 || Math.random() < 0.5;
  const answer = bigger ? Math.max(...list) : Math.min(...list);
  const q = bigger ? 'איזה מספר גדול יותר?' : 'איזה מספר קטן יותר?';
  return {
    type: 'choice',
    prompt: `<p class="q-text">${q}</p>`,
    speak: q,
    options: list.map(n => ({ label: String(n), value: n })),
    optionClass: 'numbers',
    answer,
    answerLabel: String(answer)
  };
}

const SUBJECTS = [
  { id: 'reading', title: 'קריאה וכתיבה', icon: '📚' },
  { id: 'math', title: 'חשבון', icon: '🔢' }
];

const ACTIVITIES = [
  { id: 'letters', subject: 'reading', icon: '🔤', title: 'זיהוי אותיות', desc: 'מוצאים את האות לפי השם שלה', maxLevel: 3, generate: genLetters },
  { id: 'first-sound', subject: 'reading', icon: '👂', title: 'צליל פותח', desc: 'באיזו אות מתחילה המילה?', maxLevel: 3, generate: genFirstSound },
  { id: 'build-word', subject: 'reading', icon: '🧩', title: 'בונים מילה', desc: 'מסדרים אותיות למילה שלמה', maxLevel: 3, generate: genBuildWord },
  { id: 'reading', subject: 'reading', icon: '📖', title: 'הבנת הנקרא', desc: 'קוראים קטע ועונים על שאלה', maxLevel: 3, generate: genReading },
  { id: 'addition', subject: 'math', icon: '➕', title: 'חיבור', desc: 'עד 10, עד 20 ועד 100', maxLevel: 4, generate: genAddition },
  { id: 'subtraction', subject: 'math', icon: '➖', title: 'חיסור', desc: 'עד 10, עד 20 ועד 100', maxLevel: 4, generate: genSubtraction },
  { id: 'multiplication', subject: 'math', icon: '✖️', title: 'לוח הכפל', desc: 'תרגול עובדות כפל', maxLevel: 3, generate: genMultiplication },
  { id: 'compare', subject: 'math', icon: '⚖️', title: 'השוואת מספרים', desc: 'גדול או קטן?', maxLevel: 3, generate: genCompare }
];

const findActivity = id => ACTIVITIES.find(a => a.id === id);

// ---------- ניתוב ותצוגה ----------

const app = document.getElementById('app');
let view = { name: 'home' };
let round = null;

function go(name, params = {}) {
  if (window.speechSynthesis) speechSynthesis.cancel();
  clearTimeout(go.timer);
  view = Object.assign({ name }, params);
  render();
  window.scrollTo(0, 0);
}

function render() {
  const views = { home: renderHome, student: renderStudent, report: renderReport, play: renderPlay, summary: renderSummary };
  app.innerHTML = (views[view.name] || renderHome)();
}

function levelStars(level, max) {
  return `<span class="stars" aria-label="שלב ${level} מתוך ${max}">${'★'.repeat(level)}${'☆'.repeat(max - level)}</span>`;
}

function topbar(title, back) {
  return `<header class="topbar">
    ${back ? `<button class="btn ghost" data-action="${back}">→ חזרה</button>` : '<span></span>'}
    <h1>${title}</h1>
    <button class="btn ghost icon" data-action="toggle-sound" title="הקראה קולית">${data.settings.sound ? '🔊' : '🔇'}</button>
  </header>`;
}

function renderHome() {
  const cards = data.students.map(s => {
    const sessions = s.sessions || [];
    const last = sessions[sessions.length - 1];
    return `<article class="card student-card">
      <div class="avatar">${s.avatar}</div>
      <h2>${esc(s.name)}</h2>
      <p class="muted">${s.grade ? `כיתה ${esc(s.grade)} · ` : ''}${last ? `תרגול אחרון: ${formatDate(last.date)}` : 'עוד לא תרגל/ה'}</p>
      <div class="row">
        <button class="btn primary" data-action="open-student" data-id="${s.id}">לתרגול</button>
        <button class="btn" data-action="open-report" data-id="${s.id}">התקדמות</button>
      </div>
    </article>`;
  }).join('');

  return `${topbar('הוראה מתקנת')}
  <section class="intro">
    <p>תרגול מותאם אישית בקריאה ובחשבון. רמת הקושי עולה ויורדת אוטומטית לפי ההצלחה של כל תלמיד/ה.</p>
  </section>
  <section class="grid">${cards || '<p class="empty">עדיין אין תלמידים. הוסיפו תלמיד/ה ראשון/ה כדי להתחיל.</p>'}</section>
  <section class="card">
    <h2>הוספת תלמיד/ה</h2>
    <form id="add-student" class="form-row">
      <input name="name" placeholder="שם" required maxlength="30" aria-label="שם">
      <select name="grade" aria-label="כיתה">
        <option value="">כיתה</option>
        ${GRADES.map(g => `<option>${g}</option>`).join('')}
      </select>
      <button class="btn primary" type="submit">הוספה</button>
    </form>
  </section>
  <section class="card backup">
    <h2>גיבוי</h2>
    <p class="muted">הנתונים נשמרים בדפדפן הזה בלבד. כדאי לייצא גיבוי מדי פעם או כדי להעביר למחשב אחר.</p>
    <div class="row">
      <button class="btn" data-action="export">ייצוא גיבוי</button>
      <label class="btn">ייבוא גיבוי<input type="file" accept="application/json,.json" id="import-file" hidden></label>
    </div>
  </section>`;
}

function renderStudent() {
  const s = findStudent(view.id);
  if (!s) return renderHome();
  const subject = view.subject || 'reading';
  const tabs = SUBJECTS.map(sub =>
    `<button class="tab ${sub.id === subject ? 'active' : ''}" data-action="subject" data-subject="${sub.id}">${sub.icon} ${sub.title}</button>`
  ).join('');
  const cards = ACTIVITIES.filter(a => a.subject === subject).map(a => {
    const p = getProgress(s, a.id);
    return `<button class="card activity-card" data-action="start" data-activity="${a.id}">
      <span class="activity-icon">${a.icon}</span>
      <strong>${a.title}</strong>
      <span class="muted">${a.desc}</span>
      ${levelStars(p.level, a.maxLevel)}
    </button>`;
  }).join('');
  return `${topbar(`שלום ${esc(s.name)}! ${s.avatar}`, 'home')}
    <nav class="tabs">${tabs}</nav>
    <section class="grid">${cards}</section>`;
}

function renderReport() {
  const s = findStudent(view.id);
  if (!s) return renderHome();
  const sessions = s.sessions || [];
  const rows = ACTIVITIES.map(a => {
    const p = getProgress(s, a.id);
    const pct = percent(p.correct, p.attempts);
    return `<tr>
      <td>${a.icon} ${a.title}</td>
      <td>${levelStars(p.level, a.maxLevel)}</td>
      <td>${p.attempts}</td>
      <td><div class="bar" title="${pct}%"><span style="width:${pct}%" class="${pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'low'}"></span></div> ${p.attempts ? pct + '%' : '—'}</td>
    </tr>`;
  }).join('');

  const recent = sessions.slice(-15).reverse().map(x => {
    const a = findActivity(x.activity);
    return `<tr><td>${formatDate(x.date)}</td><td>${a ? a.title : x.activity}</td><td>${x.correct}/${x.total}</td><td>${x.level}</td></tr>`;
  }).join('');

  const weak = ACTIVITIES
    .map(a => ({ a, p: getProgress(s, a.id) }))
    .filter(({ p }) => p.attempts >= 5 && percent(p.correct, p.attempts) < 60)
    .map(({ a }) => a.title);

  return `${topbar(`התקדמות – ${esc(s.name)}`, 'home')}
  <section class="card">
    <div class="report-head">
      <div class="avatar">${s.avatar}</div>
      <div>
        <h2>${esc(s.name)}</h2>
        <p class="muted">${s.grade ? `כיתה ${esc(s.grade)} · ` : ''}${sessions.length} סבבי תרגול · נוסף/ה ב-${formatDate(s.createdAt)}</p>
      </div>
    </div>
    ${weak.length ? `<p class="alert">דורש חיזוק: ${weak.join(', ')}</p>` : ''}
    <table class="table">
      <thead><tr><th>תרגיל</th><th>שלב</th><th>שאלות</th><th>הצלחה</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>
  <section class="card">
    <h2>סבבים אחרונים</h2>
    ${recent ? `<table class="table"><thead><tr><th>תאריך</th><th>תרגיל</th><th>נכונות</th><th>שלב</th></tr></thead><tbody>${recent}</tbody></table>` : '<p class="muted">עדיין אין סבבי תרגול.</p>'}
  </section>
  <section class="card">
    <h2>הערות המורה</h2>
    <textarea id="notes" rows="5" placeholder="תצפיות, מטרות, קשיים, שיחות עם הורים...">${esc(s.notes || '')}</textarea>
  </section>
  <div class="row no-print">
    <button class="btn" data-action="print">הדפסת דוח</button>
    <button class="btn danger" data-action="reset-progress" data-id="${s.id}">איפוס התקדמות</button>
    <button class="btn danger" data-action="delete-student" data-id="${s.id}">מחיקת תלמיד/ה</button>
  </div>`;
}

// ---------- סבב תרגול ----------

function startRound(studentId, activityId) {
  round = { studentId, activityId, index: 0, correct: 0, leveledUp: false };
  nextQuestion();
}

function nextQuestion() {
  const s = findStudent(round.studentId);
  const act = findActivity(round.activityId);
  const p = getProgress(s, act.id);
  round.question = act.generate(p.level);
  round.tries = 0;
  round.done = false;
  round.input = '';
  round.placed = [];
  go('play');
  setTimeout(() => speak(round.question.speak), 250);
}

function renderPlay() {
  const s = findStudent(round.studentId);
  const act = findActivity(round.activityId);
  const p = getProgress(s, act.id);
  const q = round.question;
  const progressPct = (round.index / ROUND_LENGTH) * 100;

  let answerArea = '';
  if (q.type === 'choice') {
    answerArea = `<div class="options ${q.optionClass || ''}">${q.options.map((o, i) =>
      `<button class="option" data-action="choose" data-i="${i}">${esc(o.label)}</button>`).join('')}</div>`;
  } else if (q.type === 'number') {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
    answerArea = `<div class="number-display" dir="ltr">${round.input || '&nbsp;'}</div>
      <div class="keypad" dir="ltr">${keys.map(k =>
        `<button class="key ${k === 'ok' ? 'ok' : ''}" data-action="key" data-key="${k}">${k === 'del' ? '⌫' : k === 'ok' ? '✓' : k}</button>`).join('')}</div>`;
  } else if (q.type === 'order') {
    const slots = q.answer.split('').map((_, i) => {
      const t = round.placed[i];
      return `<button class="slot ${t !== undefined ? 'filled' : ''}" data-action="unplace" data-i="${i}">${t !== undefined ? q.tiles[t] : ''}</button>`;
    }).join('');
    const tiles = q.tiles.map((c, i) =>
      `<button class="tile" data-action="place" data-i="${i}" ${round.placed.includes(i) ? 'disabled' : ''}>${c}</button>`).join('');
    answerArea = `<div class="slots">${slots}</div><div class="tiles">${tiles}</div>`;
  }

  return `<header class="topbar play-bar">
      <button class="btn ghost" data-action="quit">✕ יציאה</button>
      <div class="progress" aria-label="שאלה ${round.index + 1} מתוך ${ROUND_LENGTH}"><span style="width:${progressPct}%"></span></div>
      <span class="level-badge">${act.icon} שלב ${p.level}</span>
    </header>
    <section class="card question">
      <button class="btn ghost icon speak-btn" data-action="speak" title="השמעה">🔊</button>
      ${q.prompt}
      ${answerArea}
      <div id="feedback" class="feedback"></div>
    </section>`;
}

function setFeedback(html, cls) {
  const el = document.getElementById('feedback');
  if (el) { el.className = `feedback ${cls}`; el.innerHTML = html; }
}

function submitAnswer(isCorrect, onRetry) {
  if (round.done) return;
  const s = findStudent(round.studentId);
  const act = findActivity(round.activityId);
  const p = getProgress(s, act.id);
  round.tries++;

  if (isCorrect) {
    round.done = true;
    // רק הצלחה בניסיון הראשון נחשבת לצורך הסטטיסטיקה והשלבים
    if (round.tries === 1) {
      round.correct++;
      p.correct++;
      p.streak++;
      p.miss = 0;
    }
    p.attempts++;
    let msg = pick(PRAISE);
    if (p.streak >= LEVEL_UP_STREAK && p.level < act.maxLevel) {
      p.level++;
      p.streak = 0;
      round.leveledUp = true;
      msg += ' עלית שלב! 🎉';
    }
    save();
    setFeedback(`✓ ${msg}`, 'good');
    speak(msg);
    go.timer = setTimeout(advance, 1300);
    return;
  }

  if (round.tries === 1) {
    p.streak = 0;
    p.miss++;
    if (p.miss >= LEVEL_DOWN_STREAK && p.level > 1) {
      p.level--; // ירידה שקטה – בלי להציג לתלמיד/ה
      p.miss = 0;
    }
    save();
    const msg = pick(TRY_AGAIN);
    setFeedback(msg, 'retry');
    speak(msg);
    if (onRetry) onRetry();
    return;
  }

  round.done = true;
  p.attempts++;
  save();
  setFeedback(`התשובה הנכונה: <strong>${esc(round.question.answerLabel)}</strong>
    <button class="btn primary" data-action="next">הבא ←</button>`, 'bad');
  revealAnswer();
}

function revealAnswer() {
  const q = round.question;
  if (q.type === 'choice') {
    document.querySelectorAll('.option').forEach((b, i) => {
      if (q.options[i].value === q.answer) b.classList.add('correct');
      b.disabled = true;
    });
  }
}

function advance() {
  round.index++;
  if (round.index >= ROUND_LENGTH) finishRound();
  else nextQuestion();
}

function finishRound() {
  const s = findStudent(round.studentId);
  const p = getProgress(s, round.activityId);
  s.sessions = s.sessions || [];
  s.sessions.push({ activity: round.activityId, date: Date.now(), correct: round.correct, total: ROUND_LENGTH, level: p.level });
  if (s.sessions.length > MAX_SESSIONS) s.sessions = s.sessions.slice(-MAX_SESSIONS);
  save();
  go('summary');
}

function renderSummary() {
  const s = findStudent(round.studentId);
  const act = findActivity(round.activityId);
  const pct = percent(round.correct, ROUND_LENGTH);
  const stars = pct >= 90 ? 3 : pct >= 60 ? 2 : 1;
  const title = stars === 3 ? 'מדהים!' : stars === 2 ? 'עבודה טובה!' : 'כל הכבוד על המאמץ!';
  setTimeout(() => speak(title), 200);
  return `${topbar(act.title)}
  <section class="card summary">
    <div class="big-stars">${'⭐'.repeat(stars)}</div>
    <h2>${title}</h2>
    <p>ענית נכון על <strong>${round.correct}</strong> מתוך ${ROUND_LENGTH} שאלות בניסיון הראשון.</p>
    ${round.leveledUp ? '<p class="alert good">עלית שלב בסבב הזה! 🎉</p>' : ''}
    <p>שלב נוכחי: ${levelStars(getProgress(s, act.id).level, act.maxLevel)}</p>
    <div class="row center">
      <button class="btn primary" data-action="again">עוד סבב</button>
      <button class="btn" data-action="open-student" data-id="${s.id}">לתרגילים אחרים</button>
    </div>
  </section>`;
}

// ---------- קלט ----------

function handleKey(key) {
  if (!round || round.done || view.name !== 'play' || round.question.type !== 'number') return;
  if (key === 'del') round.input = round.input.slice(0, -1);
  else if (key === 'ok') {
    if (!round.input) return;
    const ok = Number(round.input) === round.question.answer;
    submitAnswer(ok, () => { round.input = ''; updateNumberDisplay(); });
    return;
  } else if (round.input.length < 5) round.input += key;
  updateNumberDisplay();
}

function updateNumberDisplay() {
  const el = document.querySelector('.number-display');
  if (el) el.innerHTML = round.input || '&nbsp;';
}

function rerenderOrder() {
  const fb = document.getElementById('feedback');
  const saved = fb ? [fb.className, fb.innerHTML] : null;
  render();
  if (saved) { const el = document.getElementById('feedback'); el.className = saved[0]; el.innerHTML = saved[1]; }
}

function checkOrder() {
  const q = round.question;
  if (round.placed.length !== q.answer.length || round.placed.includes(undefined)) return;
  const word = round.placed.map(i => q.tiles[i]).join('');
  submitAnswer(word === q.answer, () => { round.placed = []; rerenderOrder(); });
  if (round.done && word !== q.answer) {
    // הצגת המילה הנכונה במשבצות
    document.querySelectorAll('.slot').forEach((el, i) => { el.textContent = q.answer[i]; el.classList.add('correct'); });
  }
}

const actions = {
  'home': () => go('home'),
  'toggle-sound': () => {
    data.settings.sound = !data.settings.sound;
    save();
    if (!data.settings.sound && window.speechSynthesis) speechSynthesis.cancel();
    render();
  },
  'open-student': el => go('student', { id: el.dataset.id }),
  'open-report': el => go('report', { id: el.dataset.id }),
  'subject': el => go('student', { id: view.id, subject: el.dataset.subject }),
  'start': el => startRound(view.id, el.dataset.activity),
  'again': () => startRound(round.studentId, round.activityId),
  'quit': () => {
    if (round.index === 0 || confirm('לצאת מהסבב? ההתקדמות בשלבים נשמרה.')) go('student', { id: round.studentId, subject: findActivity(round.activityId).subject });
  },
  'speak': () => speak(round.question.speak),
  'next': () => advance(),
  'choose': el => {
    if (round.done) return;
    const opt = round.question.options[Number(el.dataset.i)];
    const ok = opt.value === round.question.answer;
    if (ok) el.classList.add('correct');
    else { el.classList.add('wrong'); el.disabled = true; }
    submitAnswer(ok);
  },
  'key': el => handleKey(el.dataset.key),
  'place': el => {
    if (round.done) return;
    const i = Number(el.dataset.i);
    const slot = round.question.answer.split('').findIndex((_, k) => round.placed[k] === undefined);
    if (slot === -1) return;
    round.placed[slot] = i;
    rerenderOrder();
    checkOrder();
  },
  'unplace': el => {
    if (round.done) return;
    round.placed[Number(el.dataset.i)] = undefined;
    rerenderOrder();
  },
  'export': () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `keren-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  'print': () => window.print(),
  'reset-progress': el => {
    const s = findStudent(el.dataset.id);
    if (confirm(`לאפס את כל ההתקדמות של ${s.name}?`)) {
      s.progress = {};
      s.sessions = [];
      save();
      render();
    }
  },
  'delete-student': el => {
    const s = findStudent(el.dataset.id);
    if (confirm(`למחוק את ${s.name} וכל הנתונים שלו/ה? לא ניתן לבטל.`)) {
      data.students = data.students.filter(x => x.id !== s.id);
      save();
      go('home');
    }
  }
};

app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el);
});

app.addEventListener('submit', e => {
  if (e.target.id !== 'add-student') return;
  e.preventDefault();
  const form = new FormData(e.target);
  const name = String(form.get('name') || '').trim();
  if (!name) return;
  const used = data.students.map(s => s.avatar);
  const avatar = pick(AVATARS.filter(a => !used.includes(a)).length ? AVATARS.filter(a => !used.includes(a)) : AVATARS);
  data.students.push({ id: uid(), name, grade: String(form.get('grade') || ''), avatar, createdAt: Date.now(), notes: '', progress: {}, sessions: [] });
  save();
  toast(`${name} נוסף/ה`);
  render();
});

app.addEventListener('input', e => {
  if (e.target.id === 'notes' && view.name === 'report') {
    const s = findStudent(view.id);
    s.notes = e.target.value;
    save();
  }
});

app.addEventListener('change', e => {
  if (e.target.id !== 'import-file' || !e.target.files[0]) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!imported || !Array.isArray(imported.students)) throw new Error('bad format');
      if (!confirm(`לייבא ${imported.students.length} תלמידים? הנתונים הקיימים יוחלפו.`)) return;
      imported.settings = Object.assign({ sound: true }, imported.settings);
      data = imported;
      save();
      toast('הגיבוי יובא בהצלחה');
      go('home');
    } catch (err) {
      toast('הקובץ אינו גיבוי תקין');
    }
  };
  reader.readAsText(e.target.files[0]);
});

document.addEventListener('keydown', e => {
  if (view.name !== 'play' || !round) return;
  // מניעת ברירת המחדל כדי ש-Enter לא "ילחץ" גם על הכפתור שבפוקוס
  if (e.key === 'Enter') e.preventDefault();
  if (round.done && e.key === 'Enter' && document.querySelector('[data-action="next"]')) { advance(); return; }
  if (/^[0-9]$/.test(e.key)) handleKey(e.key);
  else if (e.key === 'Backspace') handleKey('del');
  else if (e.key === 'Enter') handleKey('ok');
});

render();
