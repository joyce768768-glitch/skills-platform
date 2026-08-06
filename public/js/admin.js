// 包裹在 IIFE 中以避免与 app.js / auth.js 在 Skills 页面共载时的全局变量冲突
// (const API_BASE / let categories 等重复声明会导致整脚本解析失败)
(function() {
const API_BASE = '';
let categories = [];
let skills = [];
let editingSkillId = null;
let currentFetchedData = null;

async function init() {
  try {
    await Promise.all([loadCategories(), loadSkills(), loadTokenConfig(), loadRateLimit()]);
    renderCategoryList();
    renderCategoryOptions();
    renderSkillsList();
    updateStats();
  } catch (e) {
    console.error('Failed to initialize:', e);
    showToast('初始化失败', 'error');
  }
}

async function loadCategories() {
  const res = await fetch(`${API_BASE}/api/categories`);
  categories = await res.json();
}

async function loadSkills() {
  const res = await fetch(`${API_BASE}/api/skills`);
  skills = await res.json();
}

async function loadTokenConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/config/github-token`);
    const data = await res.json();
    const statusEl = document.getElementById('tokenStatus');
    if (data.hasToken) {
      statusEl.innerHTML = `<div style="padding: 10px 14px; background: #e8f5e9; border-radius: 8px; font-size: 13px; color: #2e7d32;">✓ GitHub Token 已配置 (${data.tokenMasked})</div>`;
    } else {
      statusEl.innerHTML = `<div style="padding: 10px 14px; background: #fff3e0; border-radius: 8px; font-size: 13px; color: #e65100;">⚠️ 未配置 GitHub Token，API 限制为 60 次/小时</div>`;
    }
  } catch {}
}

async function loadRateLimit() {
  try {
    const res = await fetch(`${API_BASE}/api/github/rate-limit`);
    const data = await res.json();
    const remaining = data.remaining;
    const limit = data.limit;
    const pct = Math.round((remaining / limit) * 100);
    
    document.getElementById('rateLimitValue').textContent = remaining;
    document.getElementById('rateLimitLabel').textContent = `剩余 / ${limit} 次 (重置: ${data.reset})`;
    
    const infoEl = document.getElementById('rateLimitInfo');
    infoEl.style.display = 'block';
    const color = remaining < 10 ? '#ff3b30' : remaining < 100 ? '#ff9500' : '#34c759';
    infoEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; font-size: 13px;">
        <span style="color: var(--text-secondary);">API 使用率:</span>
        <div style="flex: 1; height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden; max-width: 200px;">
          <div style="width: ${pct}%; height: 100%; background: ${color}; border-radius: 3px; transition: width 0.3s;"></div>
        </div>
        <span style="color: ${color}; font-weight: 600;">${remaining} / ${limit}</span>
      </div>
    `;
  } catch {}
}

async function saveToken() {
  const token = document.getElementById('githubToken').value.trim();
  if (!token) {
    showToast('请输入 Token', 'error');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/config/github-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (res.ok) {
      showToast('Token 保存成功');
      document.getElementById('githubToken').value = '';
      await loadTokenConfig();
      await loadRateLimit();
    }
  } catch (e) {
    showToast('保存失败', 'error');
  }
}

async function clearGithubToken() {
  if (!confirm('确定清除 GitHub Token 吗？清除后 API 限制将降为 60 次/小时。')) return;
  try {
    const res = await fetch(`${API_BASE}/api/config/github-token`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Token 已清除');
      document.getElementById('githubToken').value = '';
      await loadTokenConfig();
      await loadRateLimit();
    }
  } catch (e) {
    showToast('清除失败', 'error');
  }
}

function renderCategoryList() {
  const container = document.getElementById('categoryList');
  container.innerHTML = '';
  categories.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'category-item';
    item.innerHTML = `
      <input type="text" class="icon-input" value="${escapeHtml(cat.icon)}" data-id="${cat.id}" data-field="icon">
      <input type="text" value="${escapeHtml(cat.name)}" data-id="${cat.id}" data-field="name">
      <button onclick="deleteCategory('${cat.id}')" title="删除">🗑️</button>
    `;
    container.appendChild(item);
  });
  container.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', (e) => {
      updateCategory(e.target.dataset.id, e.target.dataset.field, e.target.value);
    });
  });
}

function renderCategoryOptions() {
  const selects = ['skillCategory', 'editCategory'];
  selects.forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = '<option value="">-- 选择分类 --</option>';
    categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = `${cat.icon} ${cat.name}`;
      select.appendChild(option);
    });
    select.value = currentValue;
  });
}

function renderSkillsList() {
  const container = document.getElementById('adminSkillsList');
  container.innerHTML = '';
  if (skills.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <h3>暂无 Skills</h3>
        <p>点击上方添加按钮来创建第一个 Skill</p>
      </div>
    `;
    return;
  }
  skills.forEach(skill => {
    const catName = getCategoryName(skill.categoryId);
    const item = document.createElement('div');
    item.className = 'admin-skill-item';
    item.innerHTML = `
      <div class="admin-skill-icon">${getSkillInitial(skill)}</div>
      <div class="admin-skill-content">
        <div class="admin-skill-name">${escapeHtml(skill.nameZh || skill.name)}</div>
        <div class="admin-skill-desc">${escapeHtml(skill.descriptionZh || skill.description || '暂无描述')}</div>
      </div>
      <span class="admin-skill-category">${catName || '未分类'}</span>
      <div class="admin-skill-actions">
        <button class="btn btn-sm btn-secondary" onclick="editSkill('${skill.id}')">编辑</button>
        <button class="btn btn-sm btn-outline" onclick="refreshSkill('${skill.id}')" title="从 GitHub 刷新">🔁</button>
        <button class="btn btn-sm btn-outline" onclick="deleteSkill('${skill.id}')" style="color: #ff3b30; border-color: #ff3b30;">删除</button>
      </div>
    `;
    container.appendChild(item);
  });
}

function updateStats() {
  document.getElementById('totalSkills').textContent = skills.length;
  document.getElementById('totalCategories').textContent = categories.length;
  document.getElementById('totalDownloads').textContent = skills.filter(s => s.downloadUrl).length;
}

function getCategoryName(categoryId) {
  const cat = categories.find(c => c.id === categoryId);
  return cat ? cat.name : '';
}

function getSkillInitial(skill) {
  const name = skill.nameZh || skill.name || '?';
  return name.charAt(0).toUpperCase();
}

async function addCategory() {
  const nameInput = document.getElementById('newCategoryName');
  const iconInput = document.getElementById('newCategoryIcon');
  const name = nameInput.value.trim();
  const icon = iconInput.value.trim() || '📁';
  if (!name) {
    showToast('请输入分类名称', 'error');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon })
    });
    if (res.ok) {
      await loadCategories();
      renderCategoryList();
      renderCategoryOptions();
      nameInput.value = '';
      iconInput.value = '';
      showToast('分类添加成功');
      updateStats();
    }
  } catch (e) {
    showToast('添加分类失败', 'error');
  }
}

async function updateCategory(id, field, value) {
  try {
    const body = field === 'icon' ? { icon: value } : { name: value };
    const res = await fetch(`${API_BASE}/api/categories/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      await loadCategories();
      renderCategoryOptions();
    }
  } catch (e) {
    showToast('更新分类失败', 'error');
  }
}

async function deleteCategory(id) {
  if (!confirm('确定删除这个分类吗？使用该分类的 Skills 将变为未分类。')) return;
  try {
    const res = await fetch(`${API_BASE}/api/categories/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await Promise.all([loadCategories(), loadSkills()]);
      renderCategoryList();
      renderCategoryOptions();
      renderSkillsList();
      updateStats();
      showToast('分类删除成功');
    }
  } catch (e) {
    showToast('删除分类失败', 'error');
  }
}

async function fetchGitHubMetadata(forceRefresh = false) {
  const url = document.getElementById('githubUrl').value.trim();
  const statusEl = document.getElementById('fetchStatus');
  if (!url) {
    showToast('请输入 GitHub URL', 'error');
    return;
  }
  statusEl.style.display = 'block';
  statusEl.className = 'fetch-status loading';
  statusEl.textContent = forceRefresh ? '正在强制刷新仓库信息...' : '正在抓取仓库信息...';
  try {
    const res = await fetch(`${API_BASE}/api/skills/fetch-github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, forceRefresh })
    });
    if (res.ok) {
      const data = await res.json();
      currentFetchedData = data;
      document.getElementById('skillName').value = data.name || '';
      document.getElementById('skillDescription').value = data.description || '';
      document.getElementById('skillDownloadUrl').value = data.downloadUrl || '';
      const cacheInfo = data.fromCache ? ' (来自缓存)' : '';
      const rateInfo = data.rateLimit ? ` | API剩余: ${data.rateLimit.remaining}/${data.rateLimit.limit}` : '';
      statusEl.className = 'fetch-status success';
      statusEl.textContent = `✓ 抓取成功${cacheInfo}！Stars: ${data.stars} | Language: ${data.language || 'N/A'}${rateInfo}`;
      showToast('仓库信息抓取成功');
    } else {
      const err = await res.json();
      statusEl.className = 'fetch-status error';
      statusEl.textContent = `✗ ${err.error}`;
      showToast(err.error, 'error');
    }
  } catch (e) {
    statusEl.className = 'fetch-status error';
    statusEl.textContent = '✗ 网络错误，请重试';
    showToast('网络错误', 'error');
  }
}

async function saveSkill() {
  const githubUrl = document.getElementById('githubUrl').value.trim();
  const name = document.getElementById('skillName').value.trim();
  const nameZh = document.getElementById('skillNameZh').value.trim();
  const description = document.getElementById('skillDescription').value.trim();
  const descriptionZh = document.getElementById('skillDescriptionZh').value.trim();
  const categoryId = document.getElementById('skillCategory').value;
  const downloadUrl = document.getElementById('skillDownloadUrl').value.trim();
  const topicsStr = document.getElementById('skillTopics').value.trim();
  if (!githubUrl) {
    showToast('请填写 GitHub URL', 'error');
    return;
  }
  try {
    const body = {
      githubUrl,
      name, nameZh, description, descriptionZh,
      categoryId: categoryId || null,
      downloadUrl,
      topics: topicsStr ? topicsStr.split(',').map(t => t.trim()).filter(Boolean) : []
    };
    if (currentFetchedData) {
      body.owner = currentFetchedData.owner;
      body.repo = currentFetchedData.repo;
      body.defaultBranch = currentFetchedData.defaultBranch;
      body.stars = currentFetchedData.stars;
      body.forks = currentFetchedData.forks;
      body.language = currentFetchedData.language;
    }
    const res = await fetch(`${API_BASE}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      await loadSkills();
      renderSkillsList();
      updateStats();
      resetForm();
      showToast('Skill 添加成功');
    } else {
      const err = await res.json();
      showToast(err.error || '添加失败', 'error');
    }
  } catch (e) {
    showToast('保存失败', 'error');
  }
}

function resetForm() {
  ['githubUrl', 'skillName', 'skillNameZh', 'skillDescription', 'skillDescriptionZh',
   'skillDownloadUrl', 'skillTopics'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('skillCategory').value = '';
  document.getElementById('fetchStatus').style.display = 'none';
  currentFetchedData = null;
}

async function editSkill(id) {
  const skill = skills.find(s => s.id === id);
  if (!skill) return;
  editingSkillId = id;
  document.getElementById('editName').value = skill.name || '';
  document.getElementById('editNameZh').value = skill.nameZh || '';
  document.getElementById('editCategory').value = skill.categoryId || '';
  document.getElementById('editDescription').value = skill.description || '';
  document.getElementById('editDescriptionZh').value = skill.descriptionZh || '';
  document.getElementById('editDownloadUrl').value = skill.downloadUrl || '';
  document.getElementById('editModal').classList.add('active');
}

async function saveEdit() {
  if (!editingSkillId) return;
  const body = {
    name: document.getElementById('editName').value.trim(),
    nameZh: document.getElementById('editNameZh').value.trim(),
    categoryId: document.getElementById('editCategory').value || null,
    description: document.getElementById('editDescription').value.trim(),
    descriptionZh: document.getElementById('editDescriptionZh').value.trim(),
    downloadUrl: document.getElementById('editDownloadUrl').value.trim()
  };
  try {
    const res = await fetch(`${API_BASE}/api/skills/${editingSkillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      await loadSkills();
      renderSkillsList();
      updateStats();
      document.getElementById('editModal').classList.remove('active');
      editingSkillId = null;
      showToast('修改保存成功');
    }
  } catch (e) {
    showToast('保存失败', 'error');
  }
}

async function refreshSkill(id) {
  if (!confirm('确定从 GitHub 刷新此 Skill 的数据吗？将更新名称、描述、Stars 等信息。')) return;
  try {
    const res = await fetch(`${API_BASE}/api/skills/${id}/refresh`, { method: 'POST' });
    if (res.ok) {
      await loadSkills();
      renderSkillsList();
      showToast('刷新成功');
    } else {
      const err = await res.json();
      showToast(err.error || '刷新失败', 'error');
    }
  } catch (e) {
    showToast('刷新失败', 'error');
  }
}

async function deleteSkill(id) {
  if (!confirm('确定删除这个 Skill 吗？')) return;
  try {
    const res = await fetch(`${API_BASE}/api/skills/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadSkills();
      renderSkillsList();
      updateStats();
      showToast('Skill 删除成功');
    }
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

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

// 暴露到全局，供 HTML 内联 onclick 使用
window.saveToken = saveToken;
window.clearGithubToken = clearGithubToken;
window.addCategory = addCategory;
window.deleteCategory = deleteCategory;
window.fetchGitHubMetadata = fetchGitHubMetadata;
window.saveSkill = saveSkill;
window.editSkill = editSkill;
window.saveEdit = saveEdit;
window.refreshSkill = refreshSkill;
window.deleteSkill = deleteSkill;
window.loadAdminSkills = init;
window.updateStats = updateStats;

// 不再自动 init, 由 openSkillsAdmin() 按需调用
})();
