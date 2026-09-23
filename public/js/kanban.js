// ===== Kanban Board (项目看板) =====
// 从 workbench.js 迁移，复用 project.js 的 escapeHtml / showToast
let kanbanItems = [];

async function loadKanban() {
  try {
    const res = await fetch('/api/workbench/kanban');
    kanbanItems = await res.json();
    renderKanban();
  } catch {
    showToast('加载看板失败', 'error');
  }
}

function renderKanban() {
  const statuses = ['idea', 'todo', 'doing', 'done'];
  const labels = { idea: 'kbCountIdea', todo: 'kbCountTodo', doing: 'kbCountDoing', done: 'kbCountDone' };
  const lists = { idea: 'kbListIdea', todo: 'kbListTodo', doing: 'kbListDoing', done: 'kbListDone' };

  statuses.forEach(status => {
    const items = kanbanItems.filter(i => i.status === status);
    document.getElementById(labels[status]).textContent = items.length;
    const container = document.getElementById(lists[status]);
    container.innerHTML = '';

    if (items.length === 0) {
      container.innerHTML = '<div class="kb-empty">暂无项目</div>';
      return;
    }

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'kb-card';
      card.draggable = true;
      card.dataset.id = item.id;
      card.dataset.status = item.status;

      let metaHtml = '';

      let dirWarning = '';
      if (item.dirCreated === false) {
        dirWarning = `<div class="kb-card-meta" style="color:#ff9500;">⚠️ 目录未创建，需在终端手动 mkdir</div>`;
      }

      let promptHtml = '';
      if (item.prompt) {
        promptHtml = `<div class="kb-card-prompt">💬 ${escapeHtml(item.prompt)}</div>`;
      }

      let docHtml = '';
      if (item.docLink) {
        docHtml = `<div class="kb-card-doc">📄 <a href="${escapeHtml(item.docLink)}" target="_blank">需求文档</a></div>`;
      }

      let actionsHtml = '<div class="kb-card-actions">';
      if (item.status === 'idea') {
        actionsHtml += `<button class="kb-card-btn" onclick="reopenKanban('${item.id}')">Trae</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="editKanbanPrompt('${item.id}')">编辑</button>`;
        actionsHtml += `<button class="kb-card-btn danger" onclick="deleteKanbanItem('${item.id}')">🗑️</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('trae','${item.id}')">详情</button>`;
      } else if (item.status === 'todo') {
        actionsHtml += `<button class="kb-card-btn primary" onclick="startKanbanItem('${item.id}')">执行</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="reopenKanban('${item.id}')">Trae</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="editKanbanPrompt('${item.id}')">编辑</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('trae','${item.id}')">详情</button>`;
      } else if (item.status === 'doing') {
        actionsHtml += `<button class="kb-card-btn primary" onclick="reopenKanban('${item.id}')">Trae</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="completeKanbanItem('${item.id}')">完成</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('trae','${item.id}')">详情</button>`;
      } else if (item.status === 'done') {
        actionsHtml += `<button class="kb-card-btn" onclick="reopenKanban('${item.id}')">Trae</button>`;
        actionsHtml += `<button class="kb-card-btn primary" onclick="pushGithub('${item.id}')">push github</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('trae','${item.id}')">详情</button>`;
      }
      actionsHtml += '</div>';

      const descText = item.description || 'XXXXXXXXXXXXXXX';
      card.innerHTML = `
        <div class="kb-card-name">${escapeHtml(item.name)}</div>
        ${descText ? `<div class="kb-card-desc">${escapeHtml(descText)}</div>` : ''}
        ${metaHtml}
        ${dirWarning}
        ${promptHtml}
        ${docHtml}
        ${actionsHtml}
      `;

      // Drag events
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', item.id);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });

      container.appendChild(card);
    });
  });

  // Setup drop zones
  document.querySelectorAll('.kb-card-list').forEach(list => {
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      list.classList.add('drag-over');
    });
    list.addEventListener('dragleave', () => {
      list.classList.remove('drag-over');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const newStatus = list.closest('.kb-column').dataset.status;
      changeKanbanStatus(id, newStatus);
    });
  });
}

// ===== Project Modal (创建/编辑项目统一弹窗) =====
let pmMode = 'create';
let pmEditingId = null;

function showKanbanForm() {
  pmMode = 'create';
  pmEditingId = null;
  document.getElementById('pmTitle').textContent = '创建项目';
  document.getElementById('pmName').value = '';
  document.getElementById('pmDesc').value = '';
  document.getElementById('pmPrompt').value = '';
  document.getElementById('pmDocLink').value = '';
  document.getElementById('pmPromptGroup').style.display = 'block';
  document.getElementById('pmDocGroup').style.display = 'block';
  document.getElementById('projectModal').style.display = 'flex';
  document.getElementById('pmName').focus();
}

function closeProjectModal() {
  document.getElementById('projectModal').style.display = 'none';
}

async function confirmProjectModal() {
  const name = document.getElementById('pmName').value.trim();
  if (!name) return showToast('请输入项目名称', 'error');
  const description = document.getElementById('pmDesc').value.trim();

  if (pmMode === 'create') {
    const prompt = document.getElementById('pmPrompt').value.trim();
    const docLink = document.getElementById('pmDocLink').value.trim();
    try {
      const res = await fetch('/api/workbench/kanban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, prompt, docLink })
      });
      const item = await res.json();
      if (!res.ok) return showToast(item.error || '创建失败', 'error');
      closeProjectModal();
      await loadKanban();
      if (item.dirCreated === false) {
        showToast('项目已创建，但目录未生成，请在终端运行: mkdir ~/Trae/' + name);
      } else {
        showToast('项目已创建，目录已生成: ~/Trae/' + name);
      }
    } catch {
      showToast('创建失败', 'error');
    }
  } else {
    const prompt = document.getElementById('pmPrompt').value.trim();
    const docLink = document.getElementById('pmDocLink').value.trim();
    try {
      const res = await fetch(`/api/workbench/kanban/${pmEditingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, prompt, docLink })
      });
      if (!res.ok) {
        const err = await res.json();
        return showToast(err.error || '保存失败', 'error');
      }
      closeProjectModal();
      await loadKanban();
      showToast('已保存');
    } catch {
      showToast('保存失败', 'error');
    }
  }
}

async function changeKanbanStatus(id, newStatus) {
  const item = kanbanItems.find(i => i.id === id);
  if (!item || item.status === newStatus) return;

  // 移动到 doing 用 start API
  if (newStatus === 'doing') {
    return startKanbanItem(id);
  }

  // 直接更新状态（移动到 todo 可直接移动，提示词之后可编辑）
  try {
    const res = await fetch(`/api/workbench/kanban/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || '操作失败', 'error');
    }
    await loadKanban();

    // 完成后检查是否有待办项目
    if (newStatus === 'done') {
      checkPendingTodos();
    }
  } catch {
    showToast('操作失败', 'error');
  }
}

function editKanbanPrompt(id) {
  const item = kanbanItems.find(i => i.id === id);
  if (!item) return;
  pmMode = 'edit';
  pmEditingId = id;
  document.getElementById('pmTitle').textContent = '编辑项目';
  document.getElementById('pmName').value = item.name;
  document.getElementById('pmDesc').value = item.description || '';
  document.getElementById('pmPrompt').value = item.prompt || '';
  document.getElementById('pmDocLink').value = item.docLink || '';
  document.getElementById('pmPromptGroup').style.display = 'block';
  document.getElementById('pmDocGroup').style.display = 'block';
  document.getElementById('projectModal').style.display = 'flex';
  document.getElementById('pmPrompt').focus();
}

async function startKanbanItem(id) {
  try {
    const res = await fetch(`/api/workbench/kanban/${id}/start`, {
      method: 'POST'
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || '启动失败', 'error');
    }
    await loadKanban();
    showToast('已打开Trae并粘贴提示词，按⌘+Enter发送给Trae');
  } catch {
    showToast('启动失败', 'error');
  }
}

async function reopenKanban(id) {
  const item = kanbanItems.find(i => i.id === id);
  if (!item) return;
  try {
    await fetch('/api/workbench/open-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: item.path })
    });
    showToast('已在Trae打开: ' + item.name);
  } catch {}
}

async function completeKanbanItem(id) {
  await changeKanbanStatus(id, 'done');
}

async function deleteKanbanItem(id) {
  const item = kanbanItems.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`确定要删除项目「${item.name}」吗？`)) return;
  try {
    await fetch(`/api/workbench/kanban/${id}`, { method: 'DELETE' });
    await loadKanban();
    showToast('已删除');
  } catch {
    showToast('删除失败', 'error');
  }
}

function checkPendingTodos() {
  const todoCount = kanbanItems.filter(i => i.status === 'todo').length;
  if (todoCount > 0) {
    showToast(`还有 ${todoCount} 个待办项目`);
  }
}

// ===== Prompt Log =====
async function showPromptLog() {
  try {
    const res = await fetch('/api/workbench/prompt-log');
    const log = await res.json();
    const container = document.getElementById('promptLogList');

    if (log.length === 0) {
      container.innerHTML = '<div class="kb-empty">还没有提示词记录</div>';
    } else {
      container.innerHTML = log.map(entry => {
        const d = new Date(entry.time);
        const timeStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        let docHtml = '';
        if (entry.docLink) {
          docHtml = `<div class="kb-log-doc">📄 <a href="${escapeHtml(entry.docLink)}" target="_blank">需求文档</a></div>`;
        }
        return `
          <div class="kb-log-item">
            <div class="kb-log-header">
              <span class="kb-log-name">${escapeHtml(entry.projectName)}</span>
              <span class="kb-log-time">${timeStr}</span>
            </div>
            <div class="kb-log-prompt">${escapeHtml(entry.prompt || '(无提示词)')}</div>
            ${docHtml}
          </div>
        `;
      }).join('');
    }
    document.getElementById('promptLogModal').style.display = 'flex';
  } catch {
    showToast('加载日志失败', 'error');
  }
}

function closePromptLog() {
  document.getElementById('promptLogModal').style.display = 'none';
}

// ===== Push to GitHub =====
async function pushGithub(id) {
  const item = kanbanItems.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`确定推送「${item.name}」到 GitHub 吗？`)) return;
  showToast('正在推送...');
  try {
    const res = await fetch(`/api/workbench/kanban/${id}/push-github`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || '推送失败', 'error');
    showToast('已推送到 GitHub');
  } catch {
    showToast('推送失败', 'error');
  }
}

// ===== Auto Execute =====
let autoExecEnabled = false;
let autoExecTimer = null;

function toggleAutoExecute() {
  autoExecEnabled = !autoExecEnabled;
  const btn = document.getElementById('autoExecBtn');
  if (autoExecEnabled) {
    btn.classList.add('active');
    btn.textContent = '自动执行 ✓';
    showToast('已开启自动执行');
    autoExecCheck();
    autoExecTimer = setInterval(autoExecCheck, 30000);
  } else {
    btn.classList.remove('active');
    btn.textContent = '自动执行';
    showToast('已关闭自动执行');
    if (autoExecTimer) { clearInterval(autoExecTimer); autoExecTimer = null; }
  }
}

async function autoExecCheck() {
  if (!autoExecEnabled) return;
  const doingCount = kanbanItems.filter(i => i.status === 'doing').length;
  if (doingCount >= 5) return;
  const todoWithPrompt = kanbanItems.find(i => i.status === 'todo' && i.prompt);
  if (!todoWithPrompt) return;
  showToast(`自动执行: ${todoWithPrompt.name}`);
  await startKanbanItem(todoWithPrompt.id);
}

// ===== Open Trae Directory =====
async function openTraeDir() {
  try {
    const res = await fetch('/api/workbench/open-trae', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || '打开失败', 'error');
    showToast('已在 Finder 打开 ~/Trae/');
  } catch {
    showToast('打开失败', 'error');
  }
}

// ===== Sync Trae Projects =====
async function syncTraeProjects() {
  try {
    const res = await fetch('/api/workbench/kanban/sync-trae', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || '同步失败', 'error');
    await loadKanban();
    if (data.added > 0) {
      showToast(`已同步 ${data.added} 个项目到已完成列`);
    } else {
      showToast('没有新项目需要同步');
    }
  } catch {
    showToast('同步失败', 'error');
  }
}

// ===== Tab Switcher =====
let currentTab = 'trae';
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.kb-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('kbPanelTrae').classList.toggle('active', tab === 'trae');
  document.getElementById('kbPanelDeepseek').classList.toggle('active', tab === 'deepseek');
  document.getElementById('kbPanelAntigravity').classList.toggle('active', tab === 'antigravity');
  document.getElementById('kbPanelVscode').classList.toggle('active', tab === 'vscode');
  document.getElementById('kbPanelDoubao').classList.toggle('active', tab === 'doubao');

  const syncBtn = document.getElementById('syncBtn');
  const openDirBtn = document.getElementById('openDirBtn');
  const autoBtnTrae = document.getElementById('autoExecBtn');
  const autoBtnAg = document.getElementById('autoExecBtnAg');
  const autoBtnVs = document.getElementById('autoExecBtnVs');

  if (tab === 'doubao' || tab === 'deepseek') {
    syncBtn.style.display = 'none';
    openDirBtn.style.display = 'none';
  } else {
    syncBtn.style.display = '';
    openDirBtn.style.display = '';
    const dirMap = { trae: 'Trae', antigravity: 'Antigravity', vscode: 'VS-Code' };
    syncBtn.textContent = `🔄 同步 ${dirMap[tab]} 项目`;
    openDirBtn.textContent = `📂 打开 ${dirMap[tab]} 项目`;
  }

  // Auto-execute button visibility
  if (autoBtnTrae) autoBtnTrae.style.display = tab === 'trae' ? '' : 'none';
  if (autoBtnAg) autoBtnAg.style.display = tab === 'antigravity' ? '' : 'none';
  if (autoBtnVs) autoBtnVs.style.display = tab === 'vscode' ? '' : 'none';
}

// Init: load kanban on page load
loadKanban();
loadDoubaoKanban();
loadDeepSeekKanban();
loadAntigravityKanban();
loadVscodeKanban();
switchTab('trae');

// ===== Doubao Kanban =====
let doubaoItems = [];

async function loadDoubaoKanban() {
  try {
    const res = await fetch('/api/workbench/kanban-doubao');
    doubaoItems = await res.json();
    renderDoubaoKanban();
  } catch {
    showToast('加载豆包看板失败', 'error');
  }
}

function renderDoubaoKanban() {
  const statuses = ['idea', 'todo', 'doing', 'done'];
  const labels = { idea: 'dbCountIdea', todo: 'dbCountTodo', doing: 'dbCountDoing', done: 'dbCountDone' };
  const lists = { idea: 'dbListIdea', todo: 'dbListTodo', doing: 'dbListDoing', done: 'dbListDone' };

  statuses.forEach(status => {
    const items = doubaoItems.filter(i => i.status === status);
    document.getElementById(labels[status]).textContent = items.length;
    const container = document.getElementById(lists[status]);
    container.innerHTML = '';

    if (items.length === 0) {
      container.innerHTML = '<div class="kb-empty">暂无卡片</div>';
      return;
    }

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'kb-card';
      card.draggable = true;
      card.dataset.id = item.id;
      card.dataset.source = 'doubao';

      let summaryHtml = '';
      if (item.summary) {
        summaryHtml = `<div class="kb-card-summary">📝 ${escapeHtml(item.summary)}</div>`;
      }

      let promptHtml = '';
      if (item.prompt) {
        promptHtml = `<div class="kb-card-prompt">💬 ${escapeHtml(item.prompt)}</div>`;
      }

      let actionsHtml = '<div class="kb-card-actions">';
      if (item.status === 'idea') {
        actionsHtml += `<button class="kb-card-btn" onclick="openDoubaoUrl('${item.id}')">在豆包打开</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="editDoubaoItem('${item.id}')">编辑</button>`;
        actionsHtml += `<button class="kb-card-btn danger" onclick="deleteDoubaoItem('${item.id}')">🗑️</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('doubao','${item.id}')">详情</button>`;
      } else if (item.status === 'todo') {
        if (item.doubaoUrl) {
          actionsHtml += `<button class="kb-card-btn" onclick="openDoubaoUrl('${item.id}')">在豆包打开</button>`;
        }
        actionsHtml += `<button class="kb-card-btn" onclick="editDoubaoItem('${item.id}')">编辑</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('doubao','${item.id}')">详情</button>`;
      } else if (item.status === 'doing') {
        if (item.doubaoUrl) {
          actionsHtml += `<button class="kb-card-btn" onclick="openDoubaoUrl('${item.id}')">在豆包打开</button>`;
        }
        if (item.prompt) actionsHtml += `<button class="kb-card-btn" onclick="copyDoubaoPrompt('${item.id}')">📋 复制提示词</button>`;
        actionsHtml += `<button class="kb-card-btn primary" onclick="completeDoubaoItem('${item.id}')">完成</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('doubao','${item.id}')">详情</button>`;
      } else if (item.status === 'done') {
        if (item.doubaoUrl) {
          actionsHtml += `<button class="kb-card-btn" onclick="openDoubaoUrl('${item.id}')">在豆包打开</button>`;
        }
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('doubao','${item.id}')">详情</button>`;
      }
      actionsHtml += '</div>';

      const descText = item.description || '';
      card.innerHTML = `
        <div class="kb-card-name">${escapeHtml(item.name)}</div>
        ${descText ? `<div class="kb-card-desc">${escapeHtml(descText)}</div>` : ''}
        ${summaryHtml}
        ${promptHtml}
        ${actionsHtml}
      `;

      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', 'doubao:' + item.id);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });

      container.appendChild(card);
    });
  });

  // 豆包看板 drop zones
  document.querySelectorAll('#kbPanelDoubao .kb-card-list').forEach(list => {
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      list.classList.add('drag-over');
    });
    list.addEventListener('dragleave', () => {
      list.classList.remove('drag-over');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw || !raw.startsWith('doubao:')) return;
      const id = raw.slice('doubao:'.length);
      const newStatus = list.closest('.kb-column').dataset.status;
      changeDoubaoStatus(id, newStatus);
    });
  });
}

// 豆包弹窗
let dmMode = 'create';
let dmEditingId = null;

function showDoubaoForm() {
  dmMode = 'create';
  dmEditingId = null;
  document.getElementById('dmTitle').textContent = '创建豆包卡片';
  document.getElementById('dmName').value = '';
  document.getElementById('dmDesc').value = '';
  document.getElementById('dmUrl').value = '';
  document.getElementById('dmSummary').value = '';
  document.getElementById('dmPrompt').value = '';
  document.getElementById('doubaoModal').style.display = 'flex';
  document.getElementById('dmName').focus();
}

function closeDoubaoModal() {
  document.getElementById('doubaoModal').style.display = 'none';
}

async function confirmDoubaoModal() {
  const name = document.getElementById('dmName').value.trim();
  if (!name) return showToast('请输入标题', 'error');
  const description = document.getElementById('dmDesc').value.trim();
  const doubaoUrl = document.getElementById('dmUrl').value.trim();
  const summary = document.getElementById('dmSummary').value.trim();
  const prompt = document.getElementById('dmPrompt').value.trim();

  const payload = { name, description, doubaoUrl, summary, prompt };
  try {
    if (dmMode === 'create') {
      const res = await fetch('/api/workbench/kanban-doubao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || '创建失败', 'error');
      closeDoubaoModal();
      await loadDoubaoKanban();
      showToast('豆包卡片已创建');
    } else {
      const res = await fetch(`/api/workbench/kanban-doubao/${dmEditingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json();
        return showToast(err.error || '保存失败', 'error');
      }
      closeDoubaoModal();
      await loadDoubaoKanban();
      showToast('已保存');
    }
  } catch {
    showToast('操作失败', 'error');
  }
}

function editDoubaoItem(id) {
  const item = doubaoItems.find(i => i.id === id);
  if (!item) return;
  dmMode = 'edit';
  dmEditingId = id;
  document.getElementById('dmTitle').textContent = '编辑豆包卡片';
  document.getElementById('dmName').value = item.name;
  document.getElementById('dmDesc').value = item.description || '';
  document.getElementById('dmUrl').value = item.doubaoUrl || '';
  document.getElementById('dmSummary').value = item.summary || '';
  document.getElementById('dmPrompt').value = item.prompt || '';
  document.getElementById('doubaoModal').style.display = 'flex';
  document.getElementById('dmName').focus();
}

async function changeDoubaoStatus(id, newStatus) {
  const item = doubaoItems.find(i => i.id === id);
  if (!item || item.status === newStatus) return;
  if (newStatus === 'doing') {
    return startDoubaoItem(id);
  }
  try {
    const res = await fetch(`/api/workbench/kanban-doubao/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || '操作失败', 'error');
    }
    await loadDoubaoKanban();
  } catch {
    showToast('操作失败', 'error');
  }
}

async function startDoubaoItem(id) {
  try {
    const res = await fetch(`/api/workbench/kanban-doubao/${id}/start`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || '启动失败', 'error');
    await loadDoubaoKanban();
    const item = doubaoItems.find(i => i.id === id);
    if (item && item.prompt) {
      showToast('已打开豆包链接,Trae 提示词已复制到剪贴板');
    } else {
      showToast('已打开豆包链接');
    }
  } catch {
    showToast('启动失败', 'error');
  }
}

async function openDoubaoUrl(id) {
  const item = doubaoItems.find(i => i.id === id);
  if (!item) return showToast('卡片不存在', 'error');
  try {
    const res = await fetch(`/api/workbench/kanban-doubao/${id}/open`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || '打开失败', 'error');
    showToast('已打开豆包,标题已复制,去搜索吧');
  } catch {
    showToast('打开失败', 'error');
  }
}

async function copyDoubaoPrompt(id) {
  const item = doubaoItems.find(i => i.id === id);
  if (!item || !item.prompt) return showToast('无提示词', 'error');
  try {
    await navigator.clipboard.writeText(item.prompt);
    showToast('提示词已复制,可粘贴到 Trae');
  } catch {
    showToast('复制失败,请手动选择', 'error');
  }
}

async function completeDoubaoItem(id) {
  await changeDoubaoStatus(id, 'done');
}

async function deleteDoubaoItem(id) {
  const item = doubaoItems.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`确定删除豆包卡片「${item.name}」吗？`)) return;
  try {
    await fetch(`/api/workbench/kanban-doubao/${id}`, { method: 'DELETE' });
    await loadDoubaoKanban();
    showToast('已删除');
  } catch {
    showToast('删除失败', 'error');
  }
}

// ===== DeepSeek Kanban =====
let deepseekItems = [];

async function loadDeepSeekKanban() {
  try {
    const res = await fetch('/api/workbench/kanban-deepseek');
    deepseekItems = await res.json();
    renderDeepSeekKanban();
  } catch {
    showToast('加载 DeepSeek 看板失败', 'error');
  }
}

function renderDeepSeekKanban() {
  const statuses = ['idea', 'todo', 'doing', 'done'];
  const labels = { idea: 'dsCountIdea', todo: 'dsCountTodo', doing: 'dsCountDoing', done: 'dsCountDone' };
  const lists = { idea: 'dsListIdea', todo: 'dsListTodo', doing: 'dsListDoing', done: 'dsListDone' };

  statuses.forEach(status => {
    const items = deepseekItems.filter(i => i.status === status);
    document.getElementById(labels[status]).textContent = items.length;
    const container = document.getElementById(lists[status]);
    container.innerHTML = '';

    if (items.length === 0) {
      container.innerHTML = '<div class="kb-empty">暂无项目</div>';
      return;
    }

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'kb-card';
      card.draggable = true;
      card.dataset.id = item.id;
      card.dataset.source = 'deepseek';

      let summaryHtml = '';
      if (item.summary) summaryHtml = `<div class="kb-card-summary">📝 ${escapeHtml(item.summary)}</div>`;

      let promptHtml = '';
      if (item.prompt) promptHtml = `<div class="kb-card-prompt">💬 ${escapeHtml(item.prompt)}</div>`;

      let actionsHtml = '<div class="kb-card-actions">';
      if (item.status === 'idea') {
        actionsHtml += `<button class="kb-card-btn" onclick="openDeepSeekUrl('${item.id}')">DeepSeek</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="editDeepSeekItem('${item.id}')">编辑</button>`;
        actionsHtml += `<button class="kb-card-btn danger" onclick="deleteDeepSeekItem('${item.id}')">🗑️</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('deepseek','${item.id}')">详情</button>`;
      } else if (item.status === 'todo') {
        if (item.deepseekUrl) actionsHtml += `<button class="kb-card-btn" onclick="openDeepSeekUrl('${item.id}')">DeepSeek</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="editDeepSeekItem('${item.id}')">编辑</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('deepseek','${item.id}')">详情</button>`;
      } else if (item.status === 'doing') {
        if (item.deepseekUrl) actionsHtml += `<button class="kb-card-btn" onclick="openDeepSeekUrl('${item.id}')">DeepSeek</button>`;
        if (item.prompt) actionsHtml += `<button class="kb-card-btn" onclick="copyDeepSeekPrompt('${item.id}')">📋 复制提示词</button>`;
        actionsHtml += `<button class="kb-card-btn primary" onclick="completeDeepSeekItem('${item.id}')">完成</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('deepseek','${item.id}')">详情</button>`;
      } else if (item.status === 'done') {
        if (item.deepseekUrl) actionsHtml += `<button class="kb-card-btn" onclick="openDeepSeekUrl('${item.id}')">DeepSeek</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('deepseek','${item.id}')">详情</button>`;
      }
      actionsHtml += '</div>';

      const descText = item.description || '';
      card.innerHTML = `
        <div class="kb-card-name">${escapeHtml(item.name)}</div>
        ${descText ? `<div class="kb-card-desc">${escapeHtml(descText)}</div>` : ''}
        ${summaryHtml}
        ${promptHtml}
        ${actionsHtml}
      `;

      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', 'deepseek:' + item.id);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });

      container.appendChild(card);
    });
  });

  // DeepSeek drop zones
  document.querySelectorAll('#kbPanelDeepseek .kb-card-list').forEach(list => {
    list.addEventListener('dragover', (e) => { e.preventDefault(); list.classList.add('drag-over'); });
    list.addEventListener('dragleave', () => { list.classList.remove('drag-over'); });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw || !raw.startsWith('deepseek:')) return;
      const id = raw.slice('deepseek:'.length);
      const newStatus = list.closest('.kb-column').dataset.status;
      changeDeepSeekStatus(id, newStatus);
    });
  });
}

// DeepSeek modal
let dsmMode = 'create';
let dsmEditingId = null;

function showDeepSeekForm() {
  dsmMode = 'create';
  dsmEditingId = null;
  document.getElementById('dsmTitle').textContent = '创建 DeepSeek 项目';
  document.getElementById('dsmId').value = '';
  document.getElementById('dsmName').value = '';
  document.getElementById('dsmDesc').value = '';
  document.getElementById('dsmUrl').value = '';
  document.getElementById('dsmSummary').value = '';
  document.getElementById('dsmPrompt').value = '';
  document.getElementById('deepseekModal').style.display = 'flex';
  document.getElementById('dsmName').focus();
}

function closeDeepSeekModal() {
  document.getElementById('deepseekModal').style.display = 'none';
}

async function confirmDeepSeekModal() {
  const name = document.getElementById('dsmName').value.trim();
  if (!name) return showToast('请输入标题', 'error');
  const description = document.getElementById('dsmDesc').value.trim();
  const deepseekUrl = document.getElementById('dsmUrl').value.trim();
  const summary = document.getElementById('dsmSummary').value.trim();
  const prompt = document.getElementById('dsmPrompt').value.trim();
  const payload = { name, description, deepseekUrl, summary, prompt };
  try {
    if (dsmMode === 'create') {
      const res = await fetch('/api/workbench/kanban-deepseek', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || '创建失败', 'error');
      closeDeepSeekModal();
      await loadDeepSeekKanban();
      showToast('DeepSeek 项目已创建');
    } else {
      const res = await fetch(`/api/workbench/kanban-deepseek/${dsmEditingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json();
        return showToast(err.error || '保存失败', 'error');
      }
      closeDeepSeekModal();
      await loadDeepSeekKanban();
      showToast('已保存');
    }
  } catch {
    showToast('操作失败', 'error');
  }
}

function editDeepSeekItem(id) {
  const item = deepseekItems.find(i => i.id === id);
  if (!item) return;
  dsmMode = 'edit';
  dsmEditingId = id;
  document.getElementById('dsmTitle').textContent = '编辑 DeepSeek 项目';
  document.getElementById('dsmId').value = item.id;
  document.getElementById('dsmName').value = item.name;
  document.getElementById('dsmDesc').value = item.description || '';
  document.getElementById('dsmUrl').value = item.deepseekUrl || '';
  document.getElementById('dsmSummary').value = item.summary || '';
  document.getElementById('dsmPrompt').value = item.prompt || '';
  document.getElementById('deepseekModal').style.display = 'flex';
  document.getElementById('dsmName').focus();
}

async function changeDeepSeekStatus(id, newStatus) {
  const item = deepseekItems.find(i => i.id === id);
  if (!item || item.status === newStatus) return;
  if (newStatus === 'doing') return startDeepSeekItem(id);
  try {
    const res = await fetch(`/api/workbench/kanban-deepseek/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || '操作失败', 'error');
    }
    await loadDeepSeekKanban();
  } catch {
    showToast('操作失败', 'error');
  }
}

async function startDeepSeekItem(id) {
  try {
    const res = await fetch(`/api/workbench/kanban-deepseek/${id}/start`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || '启动失败', 'error');
    await loadDeepSeekKanban();
    const item = deepseekItems.find(i => i.id === id);
    if (item && item.prompt) {
      showToast('已打开 DeepSeek,提示词已复制到剪贴板');
    } else {
      showToast('已打开 DeepSeek');
    }
  } catch {
    showToast('启动失败', 'error');
  }
}

async function openDeepSeekUrl(id) {
  const item = deepseekItems.find(i => i.id === id);
  if (!item) return showToast('项目不存在', 'error');
  try {
    const res = await fetch(`/api/workbench/kanban-deepseek/${id}/open`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || '打开失败', 'error');
    showToast('已打开 DeepSeek,标题已复制');
  } catch {
    showToast('打开失败', 'error');
  }
}

async function copyDeepSeekPrompt(id) {
  const item = deepseekItems.find(i => i.id === id);
  if (!item || !item.prompt) return showToast('无提示词', 'error');
  try {
    await navigator.clipboard.writeText(item.prompt);
    showToast('提示词已复制');
  } catch {
    showToast('复制失败,请手动选择', 'error');
  }
}

async function completeDeepSeekItem(id) {
  await changeDeepSeekStatus(id, 'done');
}

async function deleteDeepSeekItem(id) {
  const item = deepseekItems.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`确定删除 DeepSeek 项目「${item.name}」吗？`)) return;
  try {
    await fetch(`/api/workbench/kanban-deepseek/${id}`, { method: 'DELETE' });
    await loadDeepSeekKanban();
    showToast('已删除');
  } catch {
    showToast('删除失败', 'error');
  }
}

// ===== Antigravity Kanban =====
let antigravityItems = [];

async function loadAntigravityKanban() {
  try {
    const res = await fetch('/api/workbench/kanban-antigravity');
    antigravityItems = await res.json();
    renderAntigravityKanban();
  } catch {
    showToast('加载 Antigravity 看板失败', 'error');
  }
}

function renderAntigravityKanban() {
  const statuses = ['idea', 'todo', 'doing', 'done'];
  const labels = { idea: 'agCountIdea', todo: 'agCountTodo', doing: 'agCountDoing', done: 'agCountDone' };
  const lists = { idea: 'agListIdea', todo: 'agListTodo', doing: 'agListDoing', done: 'agListDone' };

  statuses.forEach(status => {
    const items = antigravityItems.filter(i => i.status === status);
    document.getElementById(labels[status]).textContent = items.length;
    const container = document.getElementById(lists[status]);
    container.innerHTML = '';

    if (items.length === 0) {
      container.innerHTML = '<div class="kb-empty">暂无项目</div>';
      return;
    }

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'kb-card';
      card.draggable = true;
      card.dataset.id = item.id;
      card.dataset.source = 'antigravity';

      let dirWarning = '';
      if (item.dirCreated === false) {
        dirWarning = `<div class="kb-card-meta" style="color:#ff9500;">⚠️ 目录未创建</div>`;
      }

      let promptHtml = '';
      if (item.prompt) {
        promptHtml = `<div class="kb-card-prompt">💬 ${escapeHtml(item.prompt)}</div>`;
      }

      let docHtml = '';
      if (item.docLink) {
        docHtml = `<div class="kb-card-doc">📄 <a href="${escapeHtml(item.docLink)}" target="_blank">需求文档</a></div>`;
      }

      let actionsHtml = '<div class="kb-card-actions">';
      if (item.status === 'idea') {
        actionsHtml += `<button class="kb-card-btn" onclick="openAntigravityItem('${item.id}')">在Antigravity打开</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="editAntigravityItem('${item.id}')">编辑</button>`;
        actionsHtml += `<button class="kb-card-btn danger" onclick="deleteAntigravityItem('${item.id}')">🗑️</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('antigravity','${item.id}')">详情</button>`;
      } else if (item.status === 'todo') {
        actionsHtml += `<button class="kb-card-btn primary" onclick="startAntigravityItem('${item.id}')">执行</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="openAntigravityItem('${item.id}')">在Antigravity打开</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="editAntigravityItem('${item.id}')">编辑</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('antigravity','${item.id}')">详情</button>`;
      } else if (item.status === 'doing') {
        actionsHtml += `<button class="kb-card-btn primary" onclick="openAntigravityItem('${item.id}')">在Antigravity打开</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="completeAntigravityItem('${item.id}')">完成</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('antigravity','${item.id}')">详情</button>`;
      } else if (item.status === 'done') {
        actionsHtml += `<button class="kb-card-btn" onclick="openAntigravityItem('${item.id}')">在Antigravity打开</button>`;
        actionsHtml += `<button class="kb-card-btn primary" onclick="pushGithubAg('${item.id}')">push github</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('antigravity','${item.id}')">详情</button>`;
      }
      actionsHtml += '</div>';

      const descText = item.description || '';
      card.innerHTML = `
        <div class="kb-card-name">${escapeHtml(item.name)}</div>
        ${descText ? `<div class="kb-card-desc">${escapeHtml(descText)}</div>` : ''}
        ${dirWarning}
        ${promptHtml}
        ${docHtml}
        ${actionsHtml}
      `;

      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', 'antigravity:' + item.id);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });

      container.appendChild(card);
    });
  });

  document.querySelectorAll('#kbPanelAntigravity .kb-card-list').forEach(list => {
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      list.classList.add('drag-over');
    });
    list.addEventListener('dragleave', () => {
      list.classList.remove('drag-over');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw || !raw.startsWith('antigravity:')) return;
      const id = raw.slice('antigravity:'.length);
      const newStatus = list.closest('.kb-column').dataset.status;
      changeAntigravityStatus(id, newStatus);
    });
  });
}

let amMode = 'create';
let amEditingId = null;

function showAntigravityForm() {
  amMode = 'create';
  amEditingId = null;
  document.getElementById('amTitle').textContent = '创建 Antigravity 项目';
  document.getElementById('amName').value = '';
  document.getElementById('amDesc').value = '';
  document.getElementById('amPrompt').value = '';
  document.getElementById('amDocLink').value = '';
  document.getElementById('antigravityModal').style.display = 'flex';
  document.getElementById('amName').focus();
}

function closeAntigravityModal() {
  document.getElementById('antigravityModal').style.display = 'none';
}

async function confirmAntigravityModal() {
  const name = document.getElementById('amName').value.trim();
  if (!name) return showToast('请输入项目名称', 'error');
  const description = document.getElementById('amDesc').value.trim();
  const prompt = document.getElementById('amPrompt').value.trim();
  const docLink = document.getElementById('amDocLink').value.trim();

  if (amMode === 'create') {
    try {
      const res = await fetch('/api/workbench/kanban-antigravity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, prompt, docLink })
      });
      const item = await res.json();
      if (!res.ok) return showToast(item.error || '创建失败', 'error');
      closeAntigravityModal();
      await loadAntigravityKanban();
      if (item.dirCreated === false) {
        showToast('项目已创建，但目录未生成，请在终端运行: mkdir ~/Antigravity/' + name);
      } else {
        showToast('项目已创建: ~/Antigravity/' + name);
      }
    } catch {
      showToast('创建失败', 'error');
    }
  } else {
    try {
      const res = await fetch(`/api/workbench/kanban-antigravity/${amEditingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, prompt, docLink })
      });
      if (!res.ok) {
        const err = await res.json();
        return showToast(err.error || '保存失败', 'error');
      }
      closeAntigravityModal();
      await loadAntigravityKanban();
      showToast('已保存');
    } catch {
      showToast('保存失败', 'error');
    }
  }
}

function editAntigravityItem(id) {
  const item = antigravityItems.find(i => i.id === id);
  if (!item) return;
  amMode = 'edit';
  amEditingId = id;
  document.getElementById('amTitle').textContent = '编辑 Antigravity 项目';
  document.getElementById('amName').value = item.name;
  document.getElementById('amDesc').value = item.description || '';
  document.getElementById('amPrompt').value = item.prompt || '';
  document.getElementById('amDocLink').value = item.docLink || '';
  document.getElementById('antigravityModal').style.display = 'flex';
  document.getElementById('amPrompt').focus();
}

async function changeAntigravityStatus(id, newStatus) {
  const item = antigravityItems.find(i => i.id === id);
  if (!item || item.status === newStatus) return;
  if (newStatus === 'doing') return startAntigravityItem(id);

  try {
    const res = await fetch(`/api/workbench/kanban-antigravity/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || '操作失败', 'error');
    }
    await loadAntigravityKanban();
  } catch {
    showToast('操作失败', 'error');
  }
}

async function startAntigravityItem(id) {
  try {
    const res = await fetch(`/api/workbench/kanban-antigravity/${id}/start`, {
      method: 'POST'
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || '启动失败', 'error');
    }
    await loadAntigravityKanban();
    showToast('已打开Antigravity并粘贴提示词');
  } catch {
    showToast('启动失败', 'error');
  }
}

async function openAntigravityItem(id) {
  const item = antigravityItems.find(i => i.id === id);
  if (!item) return;
  try {
    const res = await fetch(`/api/workbench/kanban-antigravity/${id}/open`, {
      method: 'POST'
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || '打开失败', 'error');
    }
    showToast('已在Antigravity打开: ' + item.name);
  } catch {
    showToast('打开失败', 'error');
  }
}

async function completeAntigravityItem(id) {
  await changeAntigravityStatus(id, 'done');
}

async function deleteAntigravityItem(id) {
  const item = antigravityItems.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`确定删除项目「${item.name}」吗？`)) return;
  try {
    await fetch(`/api/workbench/kanban-antigravity/${id}`, { method: 'DELETE' });
    await loadAntigravityKanban();
    showToast('已删除');
  } catch {
    showToast('删除失败', 'error');
  }
}

async function pushGithubAg(id) {
  const item = antigravityItems.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`确定推送「${item.name}」到 GitHub 吗？`)) return;
  showToast('正在推送...');
  try {
    const res = await fetch(`/api/workbench/kanban-antigravity/${id}/push-github`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || '推送失败', 'error');
    showToast('已推送到 GitHub');
  } catch {
    showToast('推送失败', 'error');
  }
}

let autoExecEnabledAg = false;
let autoExecTimerAg = null;

function toggleAutoExecuteAg() {
  autoExecEnabledAg = !autoExecEnabledAg;
  const btn = document.getElementById('autoExecBtnAg');
  if (autoExecEnabledAg) {
    btn.classList.add('active');
    btn.textContent = '自动执行 ✓';
    showToast('已开启 Antigravity 自动执行');
    autoExecCheckAg();
    autoExecTimerAg = setInterval(autoExecCheckAg, 30000);
  } else {
    btn.classList.remove('active');
    btn.textContent = '自动执行';
    showToast('已关闭自动执行');
    if (autoExecTimerAg) { clearInterval(autoExecTimerAg); autoExecTimerAg = null; }
  }
}

async function autoExecCheckAg() {
  if (!autoExecEnabledAg) return;
  const doingCount = antigravityItems.filter(i => i.status === 'doing').length;
  if (doingCount >= 5) return;
  const todoWithPrompt = antigravityItems.find(i => i.status === 'todo' && i.prompt);
  if (!todoWithPrompt) return;
  showToast(`自动执行: ${todoWithPrompt.name}`);
  await startAntigravityItem(todoWithPrompt.id);
}

// ===== VSCode Kanban =====
let vscodeItems = [];

async function loadVscodeKanban() {
  try {
    const res = await fetch('/api/workbench/kanban-vscode');
    vscodeItems = await res.json();
    renderVscodeKanban();
  } catch {
    showToast('加载 VSCode 看板失败', 'error');
  }
}

function renderVscodeKanban() {
  const statuses = ['idea', 'todo', 'doing', 'done'];
  const labels = { idea: 'vsCountIdea', todo: 'vsCountTodo', doing: 'vsCountDoing', done: 'vsCountDone' };
  const lists = { idea: 'vsListIdea', todo: 'vsListTodo', doing: 'vsListDoing', done: 'vsListDone' };

  statuses.forEach(status => {
    const items = vscodeItems.filter(i => i.status === status);
    document.getElementById(labels[status]).textContent = items.length;
    const container = document.getElementById(lists[status]);
    container.innerHTML = '';

    if (items.length === 0) {
      container.innerHTML = '<div class="kb-empty">暂无项目</div>';
      return;
    }

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'kb-card';
      card.draggable = true;
      card.dataset.id = item.id;
      card.dataset.source = 'vscode';

      let dirWarning = '';
      if (item.dirCreated === false) {
        dirWarning = `<div class="kb-card-meta" style="color:#ff9500;">⚠️ 目录未创建</div>`;
      }

      let promptHtml = '';
      if (item.prompt) {
        promptHtml = `<div class="kb-card-prompt">💬 ${escapeHtml(item.prompt)}</div>`;
      }

      let docHtml = '';
      if (item.docLink) {
        docHtml = `<div class="kb-card-doc">📄 <a href="${escapeHtml(item.docLink)}" target="_blank">需求文档</a></div>`;
      }

      let actionsHtml = '<div class="kb-card-actions">';
      if (item.status === 'idea') {
        actionsHtml += `<button class="kb-card-btn" onclick="openVscodeItem('${item.id}')">在VSCode打开</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="editVscodeItem('${item.id}')">编辑</button>`;
        actionsHtml += `<button class="kb-card-btn danger" onclick="deleteVscodeItem('${item.id}')">🗑️</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('vscode','${item.id}')">详情</button>`;
      } else if (item.status === 'todo') {
        actionsHtml += `<button class="kb-card-btn primary" onclick="startVscodeItem('${item.id}')">执行</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="openVscodeItem('${item.id}')">在VSCode打开</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="editVscodeItem('${item.id}')">编辑</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('vscode','${item.id}')">详情</button>`;
      } else if (item.status === 'doing') {
        actionsHtml += `<button class="kb-card-btn primary" onclick="openVscodeItem('${item.id}')">在VSCode打开</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="completeVscodeItem('${item.id}')">完成</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('vscode','${item.id}')">详情</button>`;
      } else if (item.status === 'done') {
        actionsHtml += `<button class="kb-card-btn" onclick="openVscodeItem('${item.id}')">在VSCode打开</button>`;
        actionsHtml += `<button class="kb-card-btn primary" onclick="pushGithubVs('${item.id}')">push github</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="showDetail('vscode','${item.id}')">详情</button>`;
      }
      actionsHtml += '</div>';

      const descText = item.description || '';
      card.innerHTML = `
        <div class="kb-card-name">${escapeHtml(item.name)}</div>
        ${descText ? `<div class="kb-card-desc">${escapeHtml(descText)}</div>` : ''}
        ${dirWarning}
        ${promptHtml}
        ${docHtml}
        ${actionsHtml}
      `;

      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', 'vscode:' + item.id);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });

      container.appendChild(card);
    });
  });

  document.querySelectorAll('#kbPanelVscode .kb-card-list').forEach(list => {
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      list.classList.add('drag-over');
    });
    list.addEventListener('dragleave', () => {
      list.classList.remove('drag-over');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw || !raw.startsWith('vscode:')) return;
      const id = raw.slice('vscode:'.length);
      const newStatus = list.closest('.kb-column').dataset.status;
      changeVscodeStatus(id, newStatus);
    });
  });
}

let vmMode = 'create';
let vmEditingId = null;

function showVscodeForm() {
  vmMode = 'create';
  vmEditingId = null;
  document.getElementById('vmTitle').textContent = '创建 VSCode 项目';
  document.getElementById('vmName').value = '';
  document.getElementById('vmDesc').value = '';
  document.getElementById('vmPrompt').value = '';
  document.getElementById('vmDocLink').value = '';
  document.getElementById('vscodeModal').style.display = 'flex';
  document.getElementById('vmName').focus();
}

function closeVscodeModal() {
  document.getElementById('vscodeModal').style.display = 'none';
}

async function confirmVscodeModal() {
  const name = document.getElementById('vmName').value.trim();
  if (!name) return showToast('请输入项目名称', 'error');
  const description = document.getElementById('vmDesc').value.trim();
  const prompt = document.getElementById('vmPrompt').value.trim();
  const docLink = document.getElementById('vmDocLink').value.trim();

  if (vmMode === 'create') {
    try {
      const res = await fetch('/api/workbench/kanban-vscode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, prompt, docLink })
      });
      const item = await res.json();
      if (!res.ok) return showToast(item.error || '创建失败', 'error');
      closeVscodeModal();
      await loadVscodeKanban();
      if (item.dirCreated === false) {
        showToast('项目已创建，但目录未生成，请在终端运行: mkdir ~/VS-Code/' + name);
      } else {
        showToast('项目已创建: ~/VS-Code/' + name);
      }
    } catch {
      showToast('创建失败', 'error');
    }
  } else {
    try {
      const res = await fetch(`/api/workbench/kanban-vscode/${vmEditingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, prompt, docLink })
      });
      if (!res.ok) {
        const err = await res.json();
        return showToast(err.error || '保存失败', 'error');
      }
      closeVscodeModal();
      await loadVscodeKanban();
      showToast('已保存');
    } catch {
      showToast('保存失败', 'error');
    }
  }
}

function editVscodeItem(id) {
  const item = vscodeItems.find(i => i.id === id);
  if (!item) return;
  vmMode = 'edit';
  vmEditingId = id;
  document.getElementById('vmTitle').textContent = '编辑 VSCode 项目';
  document.getElementById('vmName').value = item.name;
  document.getElementById('vmDesc').value = item.description || '';
  document.getElementById('vmPrompt').value = item.prompt || '';
  document.getElementById('vmDocLink').value = item.docLink || '';
  document.getElementById('vscodeModal').style.display = 'flex';
  document.getElementById('vmPrompt').focus();
}

async function changeVscodeStatus(id, newStatus) {
  const item = vscodeItems.find(i => i.id === id);
  if (!item || item.status === newStatus) return;
  if (newStatus === 'doing') return startVscodeItem(id);

  try {
    const res = await fetch(`/api/workbench/kanban-vscode/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || '操作失败', 'error');
    }
    await loadVscodeKanban();
  } catch {
    showToast('操作失败', 'error');
  }
}

async function startVscodeItem(id) {
  try {
    const res = await fetch(`/api/workbench/kanban-vscode/${id}/start`, {
      method: 'POST'
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || '启动失败', 'error');
    }
    await loadVscodeKanban();
    showToast('已打开VSCode并粘贴提示词');
  } catch {
    showToast('启动失败', 'error');
  }
}

async function openVscodeItem(id) {
  const item = vscodeItems.find(i => i.id === id);
  if (!item) return;
  try {
    const res = await fetch(`/api/workbench/kanban-vscode/${id}/open`, {
      method: 'POST'
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || '打开失败', 'error');
    }
    showToast('已在VSCode打开: ' + item.name);
  } catch {
    showToast('打开失败', 'error');
  }
}

async function completeVscodeItem(id) {
  await changeVscodeStatus(id, 'done');
}

async function deleteVscodeItem(id) {
  const item = vscodeItems.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`确定删除项目「${item.name}」吗？`)) return;
  try {
    await fetch(`/api/workbench/kanban-vscode/${id}`, { method: 'DELETE' });
    await loadVscodeKanban();
    showToast('已删除');
  } catch {
    showToast('删除失败', 'error');
  }
}

async function pushGithubVs(id) {
  const item = vscodeItems.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`确定推送「${item.name}」到 GitHub 吗？`)) return;
  showToast('正在推送...');
  try {
    const res = await fetch(`/api/workbench/kanban-vscode/${id}/push-github`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || '推送失败', 'error');
    showToast('已推送到 GitHub');
  } catch {
    showToast('推送失败', 'error');
  }
}

let autoExecEnabledVs = false;
let autoExecTimerVs = null;

function toggleAutoExecuteVs() {
  autoExecEnabledVs = !autoExecEnabledVs;
  const btn = document.getElementById('autoExecBtnVs');
  if (autoExecEnabledVs) {
    btn.classList.add('active');
    btn.textContent = '自动执行 ✓';
    showToast('已开启 VSCode 自动执行');
    autoExecCheckVs();
    autoExecTimerVs = setInterval(autoExecCheckVs, 30000);
  } else {
    btn.classList.remove('active');
    btn.textContent = '自动执行';
    showToast('已关闭自动执行');
    if (autoExecTimerVs) { clearInterval(autoExecTimerVs); autoExecTimerVs = null; }
  }
}

async function autoExecCheckVs() {
  if (!autoExecEnabledVs) return;
  const doingCount = vscodeItems.filter(i => i.status === 'doing').length;
  if (doingCount >= 5) return;
  const todoWithPrompt = vscodeItems.find(i => i.status === 'todo' && i.prompt);
  if (!todoWithPrompt) return;
  showToast(`自动执行: ${todoWithPrompt.name}`);
  await startVscodeItem(todoWithPrompt.id);
}

// ===== Generic Sync & Open Dir =====
async function syncCurrentProjects() {
  const tab = currentTab;
  const apiMap = {
    trae: '/api/workbench/kanban/sync-trae',
    antigravity: '/api/workbench/kanban-antigravity/sync',
    vscode: '/api/workbench/kanban-vscode/sync'
  };
  const loadMap = {
    trae: loadKanban,
    antigravity: loadAntigravityKanban,
    vscode: loadVscodeKanban
  };
  const url = apiMap[tab];
  if (!url) return showToast('当前标签不支持同步', 'error');
  try {
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || '同步失败', 'error');
    await loadMap[tab]();
    if (data.added > 0) {
      showToast(`已同步 ${data.added} 个项目到已完成列`);
    } else {
      showToast('没有新项目需要同步');
    }
  } catch {
    showToast('同步失败', 'error');
  }
}

async function openCurrentDir() {
  const tab = currentTab;
  const dirMap = {
    trae: '~/Trae/',
    antigravity: '~/Antigravity/',
    vscode: '~/VS-Code/'
  };
  const dir = dirMap[tab];
  if (!dir) return showToast('当前标签不支持打开目录', 'error');
  try {
    const res = await fetch('/api/workbench/open-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir })
    });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || '打开失败', 'error');
    showToast('已在 Finder 打开 ' + dir);
  } catch {
    showToast('打开失败', 'error');
  }
}

// ===== Project Detail View (二级页面) =====
let detailState = { tool: null, id: null };
let detailDirty = false;
let detailScrollHandler = null;

const DETAIL_SECTIONS = ['background', 'marketAnalysis', 'competitiveAnalysis', 'userAnalysis', 'businessModel', 'specification'];

const TOOL_LABELS = {
  trae: 'Trae',
  doubao: '豆包',
  deepseek: 'DeepSeek',
  antigravity: 'Antigravity',
  vscode: 'VSCode'
};

const STATUS_LABELS = {
  idea: '构想',
  todo: '待办',
  doing: '执行中',
  done: '已完成'
};

function getDetailItem(tool, id) {
  if (tool === 'trae') return kanbanItems.find(i => i.id === id);
  if (tool === 'doubao') return doubaoItems.find(i => i.id === id);
  if (tool === 'deepseek') return deepseekItems.find(i => i.id === id);
  if (tool === 'antigravity') return antigravityItems.find(i => i.id === id);
  if (tool === 'vscode') return vscodeItems.find(i => i.id === id);
  return null;
}

function showDetail(tool, id) {
  const item = getDetailItem(tool, id);
  if (!item) return showToast('项目不存在', 'error');
  detailState = { tool, id };
  detailDirty = false;

  const toolLabel = TOOL_LABELS[tool] || tool;
  const statusLabel = STATUS_LABELS[item.status] || item.status;

  document.getElementById('kbContainer').style.display = 'none';
  document.getElementById('detailView').style.display = 'block';
  document.getElementById('detailView').scrollTop = 0;

  // Reset tabs
  document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
  const firstTab = document.querySelector('.detail-tab[data-section="background"]');
  if (firstTab) firstTab.classList.add('active');

  document.getElementById('detailToolBadge').textContent = toolLabel;
  document.getElementById('detailStatusBadge').textContent = statusLabel;
  document.getElementById('detailName').value = item.name || '';
  document.getElementById('detailDesc').value = item.description || '';
  document.getElementById('detailId').textContent = item.id || '';
  document.getElementById('detailCreatedAt').textContent = item.createdAt || '';

  fetch(`/api/workbench/kanban-detail/${tool}/${id}`)
    .then(r => r.json())
    .then(data => {
      document.getElementById('detailBackground').value = data.background || '';
      document.getElementById('detailMarketAnalysis').value = data.marketAnalysis || '';
      document.getElementById('detailCompetitiveAnalysis').value = data.competitiveAnalysis || '';
      document.getElementById('detailUserAnalysis').value = data.userAnalysis || '';
      document.getElementById('detailBusinessModel').value = data.businessModel || '';
      document.getElementById('detailSpecification').value = data.specification || '';
    })
    .catch(() => {
      showToast('加载详情失败', 'error');
    });

  ['detailName','detailDesc','detailBackground','detailMarketAnalysis',
   'detailCompetitiveAnalysis','detailUserAnalysis','detailBusinessModel','detailSpecification']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => { detailDirty = true; });
    });

  // Add scroll listener for tab activation
  if (detailScrollHandler) {
    document.getElementById('detailView').removeEventListener('scroll', detailScrollHandler);
  }
  detailScrollHandler = updateActiveTabOnScroll;
  document.getElementById('detailView').addEventListener('scroll', detailScrollHandler);
}

function scrollToSection(sectionId) {
  const section = document.getElementById(`section-${sectionId}`);
  const view = document.getElementById('detailView');
  if (section && view) {
    view.scrollTo({ top: section.offsetTop - 130, behavior: 'smooth' });
  }
  // Update active tab
  document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
  const tab = document.querySelector(`.detail-tab[data-section="${sectionId}"]`);
  if (tab) tab.classList.add('active');
}

function updateActiveTabOnScroll() {
  const view = document.getElementById('detailView');
  if (!view) return;
  const scrollPos = view.scrollTop + 160;
  let currentSection = DETAIL_SECTIONS[0];
  for (const sectionId of DETAIL_SECTIONS) {
    const section = document.getElementById(`section-${sectionId}`);
    if (section && section.offsetTop <= scrollPos) {
      currentSection = sectionId;
    }
  }
  document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
  const tab = document.querySelector(`.detail-tab[data-section="${currentSection}"]`);
  if (tab) tab.classList.add('active');
}

async function saveDetailView() {
  const { tool, id } = detailState;
  if (!tool || !id) return;
  const payload = {
    name: document.getElementById('detailName').value.trim(),
    description: document.getElementById('detailDesc').value.trim(),
    background: document.getElementById('detailBackground').value,
    marketAnalysis: document.getElementById('detailMarketAnalysis').value,
    competitiveAnalysis: document.getElementById('detailCompetitiveAnalysis').value,
    userAnalysis: document.getElementById('detailUserAnalysis').value,
    businessModel: document.getElementById('detailBusinessModel').value,
    specification: document.getElementById('detailSpecification').value
  };
  try {
    const res = await fetch(`/api/workbench/kanban-detail/${tool}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || '保存失败', 'error');
    }
    detailDirty = false;
    showToast('已保存');
    await loadKanban();
    if (tool === 'doubao') await loadDoubaoKanban();
    else if (tool === 'antigravity') await loadAntigravityKanban();
    else if (tool === 'vscode') await loadVscodeKanban();
  } catch {
    showToast('保存失败', 'error');
  }
}

function closeDetailView() {
  if (detailDirty) {
    if (!confirm('有未保存的修改，确定返回吗？')) return;
  }
  // Remove scroll listener
  if (detailScrollHandler) {
    const view = document.getElementById('detailView');
    if (view) view.removeEventListener('scroll', detailScrollHandler);
    detailScrollHandler = null;
  }
  document.getElementById('detailView').style.display = 'none';
  document.getElementById('kbContainer').style.display = '';
  detailState = { tool: null, id: null };
  detailDirty = false;
}
