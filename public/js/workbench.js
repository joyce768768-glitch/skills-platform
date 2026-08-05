let currentDate = new Date();
let selectedDate = new Date();
let calMonth = new Date();
let projects = [];
let scannedProjects = {};
let todayPlan = { tasks: [] };
let reminders = [];
let triggeredReminders = new Set();
let currentAlert = null;     // { taskId, type: 'start' | 'deadline' }
let lastSoundTime = 0;

// ===== Web Audio beep (no external file needed) =====
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playBeep() {
  // Primary: system sound via backend (bypasses browser autoplay restrictions)
  fetch('/api/workbench/beep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }).catch(() => {
    // Fallback: Web Audio if backend unavailable
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    const baseT = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 1200;
      osc.type = 'triangle';
      const t = baseT + i * 0.3;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.5, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    }
  });
}

// Unlock audio on first user interaction (browser autoplay policy)
document.addEventListener('click', function unlockAudio() {
  ensureAudioCtx();
  document.removeEventListener('click', unlockAudio);
}, { once: true });
document.addEventListener('keydown', function unlockAudioKb() {
  ensureAudioCtx();
  document.removeEventListener('keydown', unlockAudioKb);
}, { once: true });

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ===== Clock =====
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('clockTime').textContent = `${h}:${m}`;
  document.getElementById('clockDate').textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  document.getElementById('clockWeek').textContent = WEEKDAYS[now.getDay()];
}

setInterval(updateClock, 1000);
updateClock();

// ===== Calendar =====
function renderCalendar() {
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  document.getElementById('calMonthLabel').textContent = `${year}年${month + 1}月`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const prevMonthLastDay = new Date(year, month, 0).getDate();

  const container = document.getElementById('calDays');
  container.innerHTML = '';

  const todayK = dateKey(new Date());
  const selectedK = dateKey(selectedDate);

  // Read all plan dates to mark on calendar
  const wb = readWorkbenchLocal();

  for (let i = 0; i < 42; i++) {
    const dayEl = document.createElement('div');
    dayEl.className = 'wb-cal-day';

    let dayNum, dateObj;
    if (i < startWeekday) {
      dayNum = prevMonthLastDay - startWeekday + i + 1;
      dateObj = new Date(year, month - 1, dayNum);
      dayEl.classList.add('other-month');
    } else if (i >= startWeekday + daysInMonth) {
      dayNum = i - startWeekday - daysInMonth + 1;
      dateObj = new Date(year, month + 1, dayNum);
      dayEl.classList.add('other-month');
    } else {
      dayNum = i - startWeekday + 1;
      dateObj = new Date(year, month, dayNum);
    }

    dayEl.textContent = dayNum;
    const dk = dateKey(dateObj);
    if (dk === todayK) dayEl.classList.add('today');
    if (dk === selectedK) dayEl.classList.add('selected');

    // Check if has plan
    if (wb.plans && wb.plans[dk] && wb.plans[dk].tasks && wb.plans[dk].tasks.length > 0) {
      dayEl.classList.add('has-plan');
    }

    dayEl.addEventListener('click', () => {
      selectedDate = dateObj;
      loadPlan(dateObj);
      renderCalendar();
    });

    container.appendChild(dayEl);
  }
}

// Simple local storage cache for calendar rendering
function readWorkbenchLocal() {
  return { plans: {} }; // Will be populated by API calls
}

// ===== Plan =====
async function loadPlan(date) {
  const dk = dateKey(date);
  try {
    const res = await fetch(`/api/workbench/plans/${dk}`);
    todayPlan = await res.json();
    if (!todayPlan.tasks) todayPlan.tasks = [];
  } catch {
    todayPlan = { tasks: [] };
  }
  document.getElementById('planTitle').textContent =
    dk === dateKey(new Date()) ? '今日计划' : `${date.getMonth() + 1}月${date.getDate()}日计划`;
  document.getElementById('planDate').textContent = dk;
  renderTasks();
  loadDiary(date);
}

// ===== Diary =====
async function loadDiary(date) {
  const dk = dateKey(date);
  document.getElementById('diaryDate').textContent = dk;
  try {
    const res = await fetch(`/api/workbench/diary/${dk}`);
    const data = await res.json();
    document.getElementById('diaryContent').value = data.content || '';
  } catch {
    document.getElementById('diaryContent').value = '';
  }
}

async function saveDiary() {
  const dk = dateKey(selectedDate);
  const content = document.getElementById('diaryContent').value;
  try {
    await fetch(`/api/workbench/diary/${dk}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    showToast('日记已保存');
  } catch {
    showToast('保存失败', 'error');
  }
}

function renderTasks() {
  const container = document.getElementById('taskList');
  container.innerHTML = '';

  if (todayPlan.tasks.length === 0) {
    container.innerHTML = '<div class="wb-empty">还没有任务，点击「+ 任务」添加</div>';
    return;
  }

  const sorted = [...todayPlan.tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const pri = { high: 0, medium: 1, low: 2 };
    return (pri[a.priority] || 1) - (pri[b.priority] || 1);
  });

  sorted.forEach((task, index) => {
    const originalIndex = todayPlan.tasks.indexOf(task);
    const item = document.createElement('div');
    item.className = 'wb-task-item' + (task.done ? ' done' : '');

    // Status label: done (green) / overdue (red) / in-progress (blue)
    const now = new Date();
    let statusBadge = '';
    if (task.done) {
      statusBadge = `<span class="wb-task-status done">✓ 已完成</span>`;
    } else if (task.deadline && new Date(task.deadline) < now) {
      statusBadge = `<span class="wb-task-status overdue">未完成</span>`;
    } else if (task.started) {
      statusBadge = `<span class="wb-task-status progress">进行中</span>`;
    }

    // Time badges
    const fmtTime = (iso, icon, label) => {
      if (!iso) return '';
      const t = new Date(iso);
      const hh = String(t.getHours()).padStart(2, '0');
      const mm = String(t.getMinutes()).padStart(2, '0');
      const isOverdue = t < now && !task.done;
      return `<span class="wb-task-reminder${isOverdue ? ' overdue' : ''}" title="${label}">${icon} ${hh}:${mm}</span>`;
    };
    const timeBadges = fmtTime(task.startTime, '▶', '开始时间') + fmtTime(task.deadline, '⏹', '截止时间');

    const promptBadge = task.prompt
      ? `<span class="wb-task-prompt-tag" title="${escapeHtml(task.prompt)}">💬 提示词</span>`
      : '';

    item.innerHTML = `
      <div class="wb-task-checkbox" onclick="toggleTask(${originalIndex})"></div>
      <div class="wb-task-content">
        <div class="wb-task-text">${escapeHtml(task.text)}</div>
        <div class="wb-task-meta">
          <span class="wb-task-priority ${task.priority || 'medium'}">${priorityLabel(task.priority)}</span>
          ${statusBadge}
          ${timeBadges}
          ${task.project ? `<span class="wb-task-project">📁 ${escapeHtml(task.project)}</span>` : ''}
          ${promptBadge}
        </div>
      </div>
      <div class="wb-task-actions">
        <button class="wb-task-action danger" onclick="deleteTask(${originalIndex})">🗑️</button>
      </div>
    `;
    container.appendChild(item);
  });
}

function priorityLabel(p) {
  return { high: '高', medium: '中', low: '低' }[p] || '中';
}

function addTask() {
  document.getElementById('taskInput').style.display = 'flex';
  populateProjectSelect();
  document.getElementById('newTaskText').focus();
}

function populateProjectSelect() {
  const select = document.getElementById('newTaskProject');
  select.innerHTML = '<option value="">关联项目(可选)</option>';
  projects.forEach(p => {
    select.innerHTML += `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`;
  });
}

async function confirmAddTask() {
  const text = document.getElementById('newTaskText').value.trim();
  if (!text) return;
  const project = document.getElementById('newTaskProject').value;
  const priority = document.getElementById('newTaskPriority').value;
  const startStr = document.getElementById('newTaskStart').value;
  const deadlineStr = document.getElementById('newTaskDeadline').value;
  const prompt = document.getElementById('newTaskPrompt').value.trim();

  const task = {
    text, project, priority,
    done: false,
    started: false,
    startNotified: false,
    deadlineNotified: false,
    id: Date.now().toString()
  };
  if (startStr) task.startTime = new Date(startStr).toISOString();
  if (deadlineStr) task.deadline = new Date(deadlineStr).toISOString();
  if (prompt) task.prompt = prompt;

  todayPlan.tasks.push(task);
  await savePlan();
  cancelAddTask();
  renderTasks();
}

function cancelAddTask() {
  document.getElementById('taskInput').style.display = 'none';
  document.getElementById('newTaskText').value = '';
  document.getElementById('newTaskStart').value = '';
  document.getElementById('newTaskDeadline').value = '';
  document.getElementById('newTaskPrompt').value = '';
}

async function toggleTask(index) {
  const task = todayPlan.tasks[index];
  task.done = !task.done;
  if (task.done) {
    task.deadlineNotified = true;
    task.startNotified = true;
  }
  await savePlan();
  renderTasks();
}

async function deleteTask(index) {
  todayPlan.tasks.splice(index, 1);
  await savePlan();
  renderTasks();
}

async function savePlan() {
  const dk = dateKey(selectedDate);
  try {
    await fetch(`/api/workbench/plans/${dk}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(todayPlan)
    });
  } catch (e) {
    showToast('保存失败', 'error');
  }
}

// ===== Projects =====
async function loadProjects() {
  try {
    const res = await fetch('/api/workbench/projects');
    projects = await res.json();
    renderProjects();
  } catch {
    showToast('加载项目失败', 'error');
  }
}

function renderProjects() {
  const container = document.getElementById('projectList');
  container.innerHTML = '';

  if (projects.length === 0) {
    container.innerHTML = '<div class="wb-empty">~/Trae/ 下没有项目</div>';
    return;
  }

  projects.forEach(project => {
    const scan = scannedProjects[project.id];
    const item = document.createElement('div');
    item.className = 'wb-project-item' + (scan ? ' scanned' : '');

    let infoHtml = '';
    if (scan) {
      const tags = [];
      if (scan.git) {
        tags.push(`<span class="wb-project-tag">🌿 ${escapeHtml(scan.git.branch)}</span>`);
        if (scan.git.uncommitted > 0) {
          tags.push(`<span class="wb-project-tag warning">⚠️ ${scan.git.uncommitted} 改动</span>`);
        } else {
          tags.push(`<span class="wb-project-tag">✓ 干净</span>`);
        }
        if (scan.git.lastCommitDate) {
          tags.push(`<span class="wb-project-tag">📅 ${scan.git.lastCommitDate}</span>`);
        }
      }
      if (scan.techStack.length > 0) {
        tags.push(`<span class="wb-project-tag">⚡ ${scan.techStack.join(', ')}</span>`);
      }
      if (scan.stats.fileCount) {
        tags.push(`<span class="wb-project-tag">📄 ${scan.stats.fileCount} 文件</span>`);
      }
      infoHtml = `<div class="wb-project-info">${tags.join('')}</div>`;
    }

    item.innerHTML = `
      <div class="wb-project-name">
        ${escapeHtml(project.name)}
        <span class="wb-project-source">${escapeHtml(project.source)}</span>
      </div>
      ${infoHtml}
      <div class="wb-project-path">${escapeHtml(project.path)}</div>
    `;

    item.addEventListener('click', () => scanProject(project));
    container.appendChild(item);
  });
}

async function scanProject(project) {
  try {
    const res = await fetch(`/api/workbench/projects/${project.id}/scan`);
    if (!res.ok) return;
    scannedProjects[project.id] = await res.json();
    renderProjects();
    generateSuggestions();
  } catch {}
}

async function scanAllProjects() {
  const suggestionEl = document.getElementById('suggestionList');
  suggestionEl.innerHTML = '<div class="wb-empty">扫描中...</div>';

  for (const project of projects) {
    await scanProject(project);
  }

  generateSuggestions();
}

// ===== Suggestions (rule engine) =====
function generateSuggestions() {
  const suggestions = [];
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  Object.entries(scannedProjects).forEach(([id, scan]) => {
    const project = projects.find(p => p.id === id);
    if (!project) return;

    if (scan.git) {
      // Uncommitted changes
      if (scan.git.uncommitted > 0) {
        suggestions.push({
          level: 'warning',
          icon: '⚠️',
          text: `${scan.git.uncommitted} 个未提交的改动，建议先提交或暂存`,
          project: project.name
        });
      }

      // Stale project
      if (scan.git.lastCommitDate) {
        const commitDate = new Date(scan.git.lastCommitDate);
        if (commitDate < threeDaysAgo) {
          const days = Math.floor((now - commitDate) / (24 * 60 * 60 * 1000));
          suggestions.push({
            level: 'danger',
            icon: '🔴',
            text: `已 ${days} 天没有提交，是否需要继续推进？`,
            project: project.name
          });
        }
      }
    }

    // Recently modified
    if (scan.stats.lastModifiedTime) {
      const modTime = new Date(scan.stats.lastModifiedTime);
      const hours = Math.floor((now - modTime) / (60 * 60 * 1000));
      if (hours < 24) {
        suggestions.push({
          level: 'normal',
          icon: '🔄',
          text: `最近 ${hours} 小时内有修改: ${scan.stats.lastModifiedFile || ''}`,
          project: project.name
        });
      }
    }
  });

  // "Start work" suggestions for today's tasks that have prompts (shown after scan)
  const startWorkSuggestions = [];
  todayPlan.tasks.forEach(task => {
    if (!task.prompt || task.done || task.started) return;
    startWorkSuggestions.push({
      type: 'startWork',
      level: 'normal',
      icon: '🚀',
      text: task.prompt.length > 50 ? task.prompt.slice(0, 50) + '…' : task.prompt,
      project: task.project || '',
      taskText: task.text,
      taskId: task.id
    });
  });
  // Start-work suggestions go to the very top
  suggestions.unshift(...startWorkSuggestions);

  // Check today's tasks
  const undoneTasks = todayPlan.tasks.filter(t => !t.done);
  if (undoneTasks.length > 0) {
    const highTasks = undoneTasks.filter(t => t.priority === 'high');
    if (highTasks.length > 0) {
      suggestions.push({
        level: 'warning',
        icon: '📌',
        text: `今日有 ${highTasks.length} 个高优先级任务待完成`,
        project: ''
      });
    }
  }

  const container = document.getElementById('suggestionList');
  if (suggestions.length === 0) {
    container.innerHTML = '<div class="wb-empty">一切正常，没有需要关注的事项</div>';
    return;
  }

  container.innerHTML = suggestions.map(s => {
    if (s.type === 'startWork') {
      return `
        <div class="wb-suggestion-item start-work">
          <span class="wb-suggestion-icon">${s.icon}</span>
          <div class="wb-suggestion-content">
            <div class="wb-suggestion-text">${escapeHtml(s.taskText)}</div>
            <div class="wb-suggestion-project">${s.project ? '📁 ' + escapeHtml(s.project) + ' · ' : ''}准备就绪</div>
          </div>
          <button class="wb-start-btn" onclick="startWork('${s.taskId}')">开始工作</button>
        </div>
      `;
    }
    return `
      <div class="wb-suggestion-item ${s.level !== 'normal' ? s.level : ''}">
        <span class="wb-suggestion-icon">${s.icon}</span>
        <div class="wb-suggestion-content">
          <div class="wb-suggestion-text">${escapeHtml(s.text)}</div>
          ${s.project ? `<div class="wb-suggestion-project">📁 ${escapeHtml(s.project)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ===== Custom Paths =====
function showPathForm() {
  const form = document.getElementById('pathForm');
  form.style.display = form.style.display === 'none' ? 'flex' : 'none';
}

async function addPath() {
  const p = document.getElementById('newPath').value.trim();
  if (!p) return;
  try {
    const res = await fetch('/api/workbench/paths', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p })
    });
    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || '添加失败', 'error');
      return;
    }
    document.getElementById('newPath').value = '';
    document.getElementById('pathForm').style.display = 'none';
    await loadProjects();
    showToast('路径已添加');
  } catch {
    showToast('添加失败', 'error');
  }
}

// ===== Start Work (task-based prompt) =====
async function startWork(taskId) {
  const task = todayPlan.tasks.find(t => t.id === taskId);
  if (!task || !task.prompt) {
    showToast('该任务未设置工作提示词', 'error');
    return;
  }
  // Find project path by project name
  const project = projects.find(p => p.name === task.project);
  const projectPath = project ? project.path : null;

  task.started = true;
  task.startNotified = true;
  await savePlan();
  renderTasks();
  closeBanner();

  // Call backend to auto-open Trae + paste prompt
  try {
    const res = await fetch('/api/workbench/start-work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, prompt: task.prompt })
    });
    const data = await res.json();
    showToast(projectPath ? `正在打开 ${task.project} 并自动粘贴提示词` : '已自动粘贴提示词到 Trae');
  } catch {
    // Fallback: copy to clipboard
    try { await navigator.clipboard.writeText(task.prompt); } catch {}
    showToast('提示词已复制，按 ⌘V 粘贴');
  }
}

// ===== Reminders =====
function showReminderForm() {
  const form = document.getElementById('reminderForm');
  form.style.display = form.style.display === 'none' ? 'flex' : 'none';
}

async function addReminder() {
  const title = document.getElementById('reminderTitle').value.trim();
  const time = document.getElementById('reminderTime').value;
  const sound = document.getElementById('reminderSound').checked;
  if (!title || !time) {
    showToast('内容和时间不能为空', 'error');
    return;
  }

  try {
    const res = await fetch('/api/workbench/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, time: new Date(time).toISOString(), sound })
    });
    const reminder = await res.json();
    reminders.push(reminder);
    document.getElementById('reminderTitle').value = '';
    document.getElementById('reminderTime').value = '';
    document.getElementById('reminderForm').style.display = 'none';
    renderReminders();
    showToast('提醒已设置');
  } catch {
    showToast('设置失败', 'error');
  }
}

async function loadReminders() {
  try {
    const res = await fetch('/api/workbench/reminders');
    reminders = await res.json();
    renderReminders();
  } catch {}
}

function renderReminders() {
  const container = document.getElementById('reminderList');
  container.innerHTML = '';

  // Fixed daily reminder: every 21:00 write tomorrow's plan
  const dailyItem = document.createElement('div');
  dailyItem.className = 'wb-reminder-item daily';
  dailyItem.innerHTML = `
    <span class="wb-reminder-time">每晚 21:00</span>
    <span class="wb-reminder-title">🌙 写明日计划</span>
    <span class="wb-reminder-badge">默认</span>
  `;
  dailyItem.title = '点击立即去写明日计划';
  dailyItem.addEventListener('click', goWriteTomorrowPlan);
  container.appendChild(dailyItem);

  const now = new Date();
  const sorted = [...reminders].sort((a, b) => new Date(a.time) - new Date(b.time));

  sorted.forEach(r => {
    const rTime = new Date(r.time);
    const isOverdue = rTime < now && !r.done;
    const item = document.createElement('div');
    item.className = 'wb-reminder-item' + (isOverdue ? ' overdue' : '') + (r.done ? ' done' : '');

    const hh = String(rTime.getHours()).padStart(2, '0');
    const mm = String(rTime.getMinutes()).padStart(2, '0');
    const isToday = dateKey(rTime) === dateKey(now);
    const timeLabel = isToday ? `${hh}:${mm}` : `${rTime.getMonth() + 1}/${rTime.getDate()} ${hh}:${mm}`;

    item.innerHTML = `
      <span class="wb-reminder-time">${timeLabel}</span>
      <span class="wb-reminder-title">${escapeHtml(r.title)}</span>
      <button class="wb-reminder-delete" onclick="deleteReminder('${r.id}')">✕</button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('wb-reminder-delete')) return;
      toggleReminderDone(r.id);
    });

    container.appendChild(item);
  });
}

async function toggleReminderDone(id) {
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  r.done = !r.done;
  await fetch(`/api/workbench/reminders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done: r.done })
  });
  renderReminders();
}

async function deleteReminder(id) {
  await fetch(`/api/workbench/reminders/${id}`, { method: 'DELETE' });
  reminders = reminders.filter(r => r.id !== id);
  renderReminders();
}

// ===== Task Time-based Reminder Check (continuous until handled) =====
function checkReminders() {
  const now = new Date();
  let activeAlert = null;

  // 1. Check task start/deadline alerts
  for (const task of todayPlan.tasks) {
    if (task.done) continue;
    // Start time alert: reached and not started, not dismissed
    if (task.startTime && !task.started && !task.startNotified) {
      if (new Date(task.startTime) <= now) {
        activeAlert = { type: 'start', taskId: task.id };
        break;
      }
    }
    // Deadline alert: reached and not done, not dismissed
    if (task.deadline && !task.deadlineNotified) {
      if (new Date(task.deadline) <= now) {
        activeAlert = { type: 'deadline', taskId: task.id };
        break;
      }
    }
  }

  // 2. Check standalone reminders (left sidebar)
  if (!activeAlert) {
    for (const r of reminders) {
      if (r.done) continue;
      if (new Date(r.time) <= now) {
        activeAlert = { type: 'reminder', reminderId: r.id };
        break;
      }
    }
  }

  if (activeAlert) {
    // Update banner content if alert changed
    const key = (a) => a ? `${a.type}-${a.taskId || a.reminderId}` : '';
    if (key(currentAlert) !== key(activeAlert)) {
      currentAlert = activeAlert;
      showAlertBanner(activeAlert);
    }
    // Repeat ringing every 5 seconds while alert is active
    if (now.getTime() - lastSoundTime > 5000) {
      lastSoundTime = now.getTime();
      playBeep();
    }
  } else {
    // No active alert: hide banner if it was an alert banner
    if (currentAlert) {
      currentAlert = null;
      closeBanner();
    }
  }
}

function showAlertBanner(alert) {
  const banner = document.getElementById('reminderBanner');

  // Standalone reminder (left sidebar)
  if (alert.type === 'reminder') {
    const r = reminders.find(x => x.id === alert.reminderId);
    if (!r) return;
    banner.innerHTML = `
      <div class="reminder-banner-content" style="gap:14px;">
        <span class="reminder-banner-text">⏰ ${escapeHtml(r.title)}</span>
        <div style="display:flex;gap:8px;">
          <button class="reminder-banner-btn primary" onclick="completeReminderAlert('${r.id}')">完成</button>
          <button class="reminder-banner-btn" onclick="dismissReminderAlert('${r.id}')">忽略</button>
        </div>
        <button class="reminder-banner-close" onclick="dismissAlertTemp()" title="暂时关闭(仍会再提醒)">✕</button>
      </div>
    `;
    banner.classList.add('active');
    banner.style.background = 'linear-gradient(135deg, #ff9500, #ff6b00)';
    return;
  }

  // Task start/deadline
  const task = todayPlan.tasks.find(t => t.id === alert.taskId);
  if (!task) return;
  const isStart = alert.type === 'start';

  const fmt = (iso) => {
    if (!iso) return '';
    const t = new Date(iso);
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  };

  const label = isStart
    ? `▶ 开始时间到 · ${escapeHtml(task.text)}`
    : `⏹ 截止时间到 · ${escapeHtml(task.text)}`;

  const buttons = isStart
    ? `<button class="reminder-banner-btn primary" onclick="startTaskNow('${task.id}')">开始工作</button>
       <button class="reminder-banner-btn" onclick="dismissStart('${task.id}')">忽略</button>`
    : `<button class="reminder-banner-btn primary" onclick="completeTaskNow('${task.id}')">标记完成</button>
       <button class="reminder-banner-btn" onclick="dismissDeadline('${task.id}')">忽略</button>`;

  banner.innerHTML = `
    <div class="reminder-banner-content" style="gap:14px;">
      <span class="reminder-banner-text">${label}</span>
      <div style="display:flex;gap:8px;">
        ${buttons}
      </div>
      <button class="reminder-banner-close" onclick="dismissAlertTemp()" title="暂时关闭(仍会再提醒)">✕</button>
    </div>
  `;
  banner.classList.add('active');
  banner.style.background = isStart
    ? 'linear-gradient(135deg, #0071e3, #00a2ff)'
    : 'linear-gradient(135deg, #ff3b30, #ff6b00)';
}

// Start alert: mark started + copy prompt if present
async function startTaskNow(taskId) {
  const task = todayPlan.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.started = true;
  task.startNotified = true;
  await savePlan();
  renderTasks();
  closeBanner();
  if (task.prompt) {
    try { await navigator.clipboard.writeText(task.prompt); } catch {}
    showToast('提示词已复制，按 ⌘V 粘贴到 Trae 对话开始工作');
  } else {
    showToast('已标记为开始');
  }
}

// Start alert: dismiss without starting
async function dismissStart(taskId) {
  const task = todayPlan.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.startNotified = true;
  await savePlan();
  renderTasks();
  closeBanner();
}

// Deadline alert: mark done
async function completeTaskNow(taskId) {
  const task = todayPlan.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.done = true;
  task.deadlineNotified = true;
  await savePlan();
  renderTasks();
  closeBanner();
  showToast('已标记完成');
}

// Deadline alert: dismiss without completing (task stays undone → red overdue tag)
async function dismissDeadline(taskId) {
  const task = todayPlan.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.deadlineNotified = true;
  await savePlan();
  renderTasks();
  closeBanner();
}

// Temporarily close alert banner (it will re-trigger on next check if still active)
function dismissAlertTemp() {
  currentAlert = null;
  closeBanner();
}

// Standalone reminder alert: mark done
async function completeReminderAlert(reminderId) {
  await toggleReminderDone(reminderId);
  currentAlert = null;
  closeBanner();
  showToast('提醒已完成');
}

// Standalone reminder alert: dismiss (mark done so it stops ringing)
async function dismissReminderAlert(reminderId) {
  const r = reminders.find(x => x.id === reminderId);
  if (!r) return;
  r.done = true;
  try {
    await fetch(`/api/workbench/reminders/${reminderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: true })
    });
  } catch {}
  renderReminders();
  currentAlert = null;
  closeBanner();
}

function closeBanner() {
  const banner = document.getElementById('reminderBanner');
  banner.classList.remove('active');
  banner.innerHTML = '';
}

// ===== Daily 21:00 reminder to write tomorrow's plan =====
function checkDailyPlanReminder() {
  const now = new Date();
  if (now.getHours() < 21) return;
  const dk = dateKey(now);
  let triggered = false;
  try { triggered = localStorage.getItem('dailyPlan_' + dk) === '1'; } catch {}
  if (triggered) return;
  // Wait if a task alert is currently active (task alert has priority)
  if (currentAlert) return;
  try { localStorage.setItem('dailyPlan_' + dk, '1'); } catch {}
  showDailyPlanBanner();
}

function showDailyPlanBanner() {
  const banner = document.getElementById('reminderBanner');
  banner.innerHTML = `
    <div class="reminder-banner-content" style="gap:14px;">
      <span class="reminder-banner-text">🌙 该写明日计划了</span>
      <div style="display:flex;gap:8px;">
        <button class="reminder-banner-btn primary" onclick="goWriteTomorrowPlan()">去写明日计划</button>
        <button class="reminder-banner-btn" onclick="dismissDailyPlan()">稍后</button>
      </div>
      <button class="reminder-banner-close" onclick="dismissDailyPlan()">✕</button>
    </div>
  `;
  banner.classList.add('active');
  banner.style.background = 'linear-gradient(135deg, #5e5ce6, #0071e3)';
  document.getElementById('reminderAudio').play().catch(() => {});
}

function goWriteTomorrowPlan() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  selectedDate = tomorrow;
  calMonth = new Date(tomorrow);
  loadPlan(tomorrow);
  renderCalendar();
  dismissDailyPlan();
  document.getElementById('planTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('已切换到明日计划，开始规划吧');
}

function dismissDailyPlan() {
  closeBanner();
}

setInterval(checkReminders, 1000);
setInterval(checkDailyPlanReminder, 1000);

// ===== Calendar Navigation =====
document.getElementById('calPrev').addEventListener('click', () => {
  calMonth.setMonth(calMonth.getMonth() - 1);
  renderCalendar();
});

document.getElementById('calNext').addEventListener('click', () => {
  calMonth.setMonth(calMonth.getMonth() + 1);
  renderCalendar();
});

// ===== Helpers =====
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = type === 'error' ? '#ff3b30' : '#1d1d1f';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ===== Init =====
async function init() {
  renderCalendar();
  await loadPlan(selectedDate);
  await loadProjects();
  await loadReminders();
  checkReminders();
}

init();
