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
        actionsHtml += `<button class="kb-card-btn" onclick="reopenKanban('${item.id}')">在Trae打开</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="editKanbanPrompt('${item.id}')">编辑</button>`;
        actionsHtml += `<button class="kb-card-btn danger" onclick="deleteKanbanItem('${item.id}')">🗑️</button>`;
      } else if (item.status === 'todo') {
        actionsHtml += `<button class="kb-card-btn primary" onclick="startKanbanItem('${item.id}')">执行</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="reopenKanban('${item.id}')">在Trae打开</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="editKanbanPrompt('${item.id}')">编辑</button>`;
      } else if (item.status === 'doing') {
        actionsHtml += `<button class="kb-card-btn primary" onclick="reopenKanban('${item.id}')">在Trae打开</button>`;
        actionsHtml += `<button class="kb-card-btn" onclick="completeKanbanItem('${item.id}')">完成</button>`;
      } else if (item.status === 'done') {
        actionsHtml += `<button class="kb-card-btn" onclick="reopenKanban('${item.id}')">在Trae打开</button>`;
        actionsHtml += `<button class="kb-card-btn primary" onclick="pushGithub('${item.id}')">push github</button>`;
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

// Init: load kanban on page load
loadKanban();
