let webProjects = [];
let currentFilter = 'all';
let editingId = null;

async function loadWebProjects() {
  try {
    const res = await fetch('/api/web-projects');
    webProjects = await res.json();
    renderFilter();
    renderGrid();
  } catch {
    showToast('加载失败', 'error');
  }
}

function renderFilter() {
  const categories = ['all', ...new Set(webProjects.map(p => p.category))];
  const labels = { all: '全部' };
  const filter = document.getElementById('projectFilter');
  filter.innerHTML = categories.map(c => {
    const label = labels[c] || c;
    const active = c === currentFilter ? ' active' : '';
    return `<button class="filter-chip${active}" onclick="setFilter('${c}')">${escapeHtml(label)}</button>`;
  }).join('');
}

function setFilter(cat) {
  currentFilter = cat;
  renderFilter();
  renderGrid();
}

function renderGrid() {
  const grid = document.getElementById('projectGrid');
  const empty = document.getElementById('emptyState');

  const filtered = currentFilter === 'all'
    ? webProjects
    : webProjects.filter(p => p.category === currentFilter);

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = filtered.map(p => {
    const safeUrl = escapeHtml(p.url);
    const safeName = escapeHtml(p.name);
    const safeDesc = escapeHtml(p.description || '');
    const safeCat = escapeHtml(p.category);
    const favicon = getFavicon(p.url);
    return `
      <div class="wp-card">
        <div class="wp-card-header">
          <img src="${favicon}" class="wp-favicon" alt="" onerror="this.style.display='none'">
          <div class="wp-card-title">
            <div class="wp-name">${safeName}</div>
            <span class="wp-category">${safeCat}</span>
          </div>
        </div>
        <div class="wp-desc">${safeDesc}</div>
        <div class="wp-url" title="${safeUrl}">${safeUrl}</div>
        <div class="wp-actions">
          <a class="btn btn-primary" href="${safeUrl}" target="_blank" rel="noopener">预览</a>
          <button class="btn btn-secondary" onclick="editProject('${p.id}')">编辑</button>
          <button class="wp-delete" onclick="deleteProject('${p.id}')">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function getFavicon(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
  } catch {
    return '';
  }
}

async function addWebProject() {
  const name = document.getElementById('wpName').value.trim();
  const url = document.getElementById('wpUrl').value.trim();
  const description = document.getElementById('wpDesc').value.trim();
  const category = document.getElementById('wpCategory').value.trim() || '其他';

  if (!name || !url) {
    showToast('名称和网址必填', 'error');
    return;
  }

  try {
    const res = await fetch('/api/web-projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url, description, category })
    });
    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || '添加失败', 'error');
      return;
    }
    document.getElementById('wpName').value = '';
    document.getElementById('wpUrl').value = '';
    document.getElementById('wpDesc').value = '';
    showToast('已添加');
    await loadWebProjects();
  } catch {
    showToast('添加失败', 'error');
  }
}

async function editProject(id) {
  const p = webProjects.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById('editName').value = p.name;
  document.getElementById('editUrl').value = p.url;
  document.getElementById('editDesc').value = p.description || '';
  document.getElementById('editCategory').value = p.category;
  document.getElementById('editModal').classList.add('active');
}

function closeEdit() {
  editingId = null;
  document.getElementById('editModal').classList.remove('active');
}

async function saveEdit() {
  if (!editingId) return;
  const name = document.getElementById('editName').value.trim();
  const url = document.getElementById('editUrl').value.trim();
  const description = document.getElementById('editDesc').value.trim();
  const category = document.getElementById('editCategory').value.trim();

  if (!name || !url) {
    showToast('名称和网址必填', 'error');
    return;
  }

  try {
    await fetch(`/api/web-projects/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url, description, category })
    });
    closeEdit();
    showToast('已更新');
    await loadWebProjects();
  } catch {
    showToast('更新失败', 'error');
  }
}

async function deleteProject(id) {
  if (!confirm('确定删除此项目？')) return;
  try {
    await fetch(`/api/web-projects/${id}`, { method: 'DELETE' });
    showToast('已删除');
    await loadWebProjects();
  } catch {
    showToast('删除失败', 'error');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = type === 'error' ? '#ff3b30' : '#1d1d1f';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

loadWebProjects();
