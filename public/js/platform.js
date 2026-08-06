// 平台管理页 JS - 看板指标 + 租户管理
// 依赖: auth.js (getAuthHeaders, requireAuth, getCurrentUser, isLoggedIn, clearToken)

// ===== 本地工具函数 fallback =====

// XSS 防护 - 若全局未定义则使用本地实现
function _escapeHtmlLocal(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
var escapeHtml = (typeof window.escapeHtml === 'function') ? window.escapeHtml : _escapeHtmlLocal;

// Toast 通知 - 若全局未定义则使用本地实现
function _showToastLocal(message, type) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = type === 'error' ? '#ff3b30' : '#1d1d1f';
  toast.classList.add('show');
  setTimeout(function () { toast.classList.remove('show'); }, 2500);
}
var showToast = (typeof window.showToast === 'function') ? window.showToast : _showToastLocal;

// ===== 格式化工具 =====

// 秒数格式化为 "Xh Ym" 或 "Xm"
function formatDuration(seconds) {
  if (!seconds || seconds < 0 || isNaN(seconds)) return '0m';
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

// ISO/SQLite 日期格式化为可读中文格式 "YYYY-MM-DD HH:MM"
function formatDate(dateStr) {
  if (!dateStr) return '—';
  var d;
  if (typeof dateStr === 'string') {
    // SQLite datetime('now') 格式: "YYYY-MM-DD HH:MM:SS" (UTC)
    if (dateStr.indexOf(' ') !== -1 && dateStr.indexOf('T') === -1) {
      d = new Date(dateStr.replace(' ', 'T') + 'Z');
    } else {
      d = new Date(dateStr);
    }
  } else {
    d = new Date(dateStr);
  }
  if (isNaN(d.getTime())) return '—';
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  var h = String(d.getHours()).padStart(2, '0');
  var min = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + day + ' ' + h + ':' + min;
}

// 手机号脱敏 (中间 4 位)
function maskPhone(phone) {
  if (!phone || phone.length < 11) return escapeHtml(phone || '');
  return escapeHtml(phone.slice(0, 3) + '****' + phone.slice(7));
}

// ===== Tab 切换 =====

function switchTab(tab) {
  var tabs = document.querySelectorAll('.pf-tab');
  tabs.forEach(function (t) { t.classList.remove('active'); });

  var dashboard = document.getElementById('tabDashboard');
  var tenants = document.getElementById('tabTenants');

  if (tab === 'dashboard') {
    var btn1 = document.querySelector('.pf-tab[data-tab="dashboard"]');
    if (btn1) btn1.classList.add('active');
    if (dashboard) dashboard.style.display = '';
    if (tenants) tenants.style.display = 'none';
  } else if (tab === 'tenants') {
    var btn2 = document.querySelector('.pf-tab[data-tab="tenants"]');
    if (btn2) btn2.classList.add('active');
    if (dashboard) dashboard.style.display = 'none';
    if (tenants) tenants.style.display = '';
  }
}

// ===== 看板指标 =====

async function loadMetrics() {
  var grid = document.getElementById('metricsGrid');
  if (!grid) return;
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-tertiary);padding:40px;">加载中...</div>';

  try {
    var res = await fetch('/api/platform/metrics', { headers: getAuthHeaders() });
    if (res.status === 403) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#ff3b30;padding:40px;">无权限查看</div>';
      return;
    }
    if (!res.ok) throw new Error('加载失败');
    var data = await res.json();
    renderMetrics(data);
    renderRecentUsers(data.recentUsers || []);
  } catch (e) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#ff3b30;padding:40px;">指标加载失败</div>';
    showToast('指标加载失败', 'error');
  }
}

function renderMetrics(data) {
  var grid = document.getElementById('metricsGrid');
  if (!grid) return;

  var cards = [
    { icon: '👥', label: '总用户数', value: data.totalUsers || 0, bg: 'rgba(0, 113, 227, 0.08)' },
    { icon: '🔥', label: '今日活跃', value: data.todayActive || 0, bg: 'rgba(255, 159, 10, 0.1)' },
    { icon: '📁', label: '项目总数', value: data.projectCount || 0, bg: 'rgba(52, 199, 89, 0.1)' },
    { icon: '🧩', label: 'Skills 总数', value: data.skillsCount || 0, bg: 'rgba(175, 82, 222, 0.1)' }
  ];

  grid.innerHTML = cards.map(function (c) {
    return '<div class="pf-metric-card" style="background:' + c.bg + ';">' +
      '<div class="pf-metric-icon">' + c.icon + '</div>' +
      '<div class="pf-metric-value">' + escapeHtml(String(c.value)) + '</div>' +
      '<div class="pf-metric-label">' + escapeHtml(c.label) + '</div>' +
      '</div>';
  }).join('');
}

function renderRecentUsers(users) {
  var container = document.getElementById('recentUsersList');
  if (!container) return;

  if (!users || users.length === 0) {
    container.innerHTML = '<div class="pf-empty">暂无注册用户</div>';
    return;
  }

  container.innerHTML = users.map(function (u) {
    var name = u.name || '未设置';
    var phone = u.phone || '';
    var roleBadge = u.role === 'admin'
      ? '<span class="pf-badge pf-badge-admin">管理员</span>'
      : '<span class="pf-badge pf-badge-user">普通用户</span>';
    return '<div class="pf-recent-item">' +
      '<div class="pf-recent-info">' +
      '<div class="pf-recent-name">' + escapeHtml(name) + ' ' + roleBadge + '</div>' +
      '<div class="pf-recent-phone">' + maskPhone(phone) + '</div>' +
      '</div>' +
      '<div class="pf-recent-time">' + formatDate(u.created_at) + '</div>' +
      '</div>';
  }).join('');
}

// ===== 租户管理 =====

async function loadUsers() {
  var tbody = document.getElementById('usersTbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:40px;">加载中...</td></tr>';

  try {
    var res = await fetch('/api/platform/users', { headers: getAuthHeaders() });
    if (res.status === 403) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#ff3b30;padding:40px;">无权限查看</td></tr>';
      return;
    }
    if (!res.ok) throw new Error('加载失败');
    var users = await res.json();
    renderUsers(users);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#ff3b30;padding:40px;">用户列表加载失败</td></tr>';
    showToast('用户列表加载失败', 'error');
  }
}

function renderUsers(users) {
  var tbody = document.getElementById('usersTbody');
  if (!tbody) return;

  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:40px;">暂无用户</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(function (u) {
    var isAdmin = u.role === 'admin';
    var isActive = u.status !== 'disabled';

    var roleBadge = isAdmin
      ? '<span class="pf-badge pf-badge-admin">管理员</span>'
      : '<span class="pf-badge pf-badge-user">普通用户</span>';

    var statusBadge = isActive
      ? '<span class="pf-badge pf-badge-active">正常</span>'
      : '<span class="pf-badge pf-badge-disabled">禁用</span>';

    // 姓名 - 可点击编辑
    var nameCell = '<span class="pf-editable-name" onclick="editUserName(\'' + escapeHtml(u.id) + '\', \'' + escapeHtml(u.name || '') + '\')" title="点击修改">' +
      escapeHtml(u.name || '未设置') + ' <span class="pf-edit-icon">✏️</span></span>';

    // 操作按钮
    var actions = '';
    // 切换角色
    actions += '<button class="btn btn-secondary btn-sm" onclick="toggleUserRole(\'' + escapeHtml(u.id) + '\', \'' + escapeHtml(u.role) + '\')">切换角色</button> ';
    // 启用/禁用
    if (isActive) {
      actions += '<button class="btn btn-secondary btn-sm" onclick="toggleUserStatus(\'' + escapeHtml(u.id) + '\', \'' + escapeHtml(u.status) + '\')">禁用</button> ';
    } else {
      actions += '<button class="btn btn-secondary btn-sm" onclick="toggleUserStatus(\'' + escapeHtml(u.id) + '\', \'' + escapeHtml(u.status) + '\')">启用</button> ';
    }
    // 删除 (仅非管理员)
    if (!isAdmin) {
      actions += '<button class="btn btn-sm pf-btn-danger" onclick="deleteUser(\'' + escapeHtml(u.id) + '\', \'' + escapeHtml(u.name || u.phone || '') + '\')">删除</button>';
    }

    return '<tr>' +
      '<td>' + maskPhone(u.phone) + '</td>' +
      '<td>' + nameCell + '</td>' +
      '<td>' + roleBadge + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td>' + formatDuration(u.online_duration) + '</td>' +
      '<td>' + formatDate(u.last_login) + '</td>' +
      '<td class="pf-actions">' + actions + '</td>' +
      '</tr>';
  }).join('');
}

// ===== 用户操作 =====

// 切换用户角色 (admin <-> user)
async function toggleUserRole(id, currentRole) {
  var newRole = currentRole === 'admin' ? 'user' : 'admin';
  var label = newRole === 'admin' ? '管理员' : '普通用户';
  if (!confirm('确定将该用户角色切换为「' + label + '」？')) return;

  try {
    var res = await fetch('/api/platform/users/' + id, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ role: newRole })
    });
    if (!res.ok) {
      var err = await res.json();
      showToast(err.error || '操作失败', 'error');
      return;
    }
    showToast('角色已更新');
    loadUsers();
    loadMetrics();
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

// 切换用户状态 (active <-> disabled)
async function toggleUserStatus(id, currentStatus) {
  var newStatus = currentStatus === 'disabled' ? 'active' : 'disabled';
  var label = newStatus === 'disabled' ? '禁用' : '启用';
  if (!confirm('确定' + label + '该用户？')) return;

  try {
    var res = await fetch('/api/platform/users/' + id, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) {
      var err = await res.json();
      showToast(err.error || '操作失败', 'error');
      return;
    }
    showToast('状态已更新');
    loadUsers();
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

// 删除用户 (仅非管理员)
async function deleteUser(id, name) {
  if (!confirm('确定删除用户「' + (name || '') + '」？此操作不可撤销。')) return;

  try {
    var res = await fetch('/api/platform/users/' + id, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      var err = await res.json();
      showToast(err.error || '删除失败', 'error');
      return;
    }
    showToast('用户已删除');
    loadUsers();
    loadMetrics();
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

// 编辑用户姓名
async function editUserName(id, name) {
  var newName = prompt('请输入新的姓名', name || '');
  if (newName === null) return; // 用户取消
  newName = newName.trim();
  if (!newName) {
    showToast('姓名不能为空', 'error');
    return;
  }

  try {
    var res = await fetch('/api/platform/users/' + id, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name: newName })
    });
    if (!res.ok) {
      var err = await res.json();
      showToast(err.error || '修改失败', 'error');
      return;
    }
    showToast('姓名已更新');
    loadUsers();
    loadMetrics();
  } catch (e) {
    showToast('修改失败', 'error');
  }
}

// ===== 心跳 =====

function startHeartbeat() {
  // 立即发一次
  sendHeartbeat();
  // 每 30 秒一次
  setInterval(sendHeartbeat, 30000);
}

async function sendHeartbeat() {
  try {
    await fetch('/api/auth/heartbeat', {
      method: 'POST',
      headers: getAuthHeaders()
    });
  } catch (e) {
    // 静默失败
  }
}

// ===== 页面初始化 =====

(function init() {
  // 登录校验
  if (!requireAuth()) return;

  // 管理员权限校验
  var user = getCurrentUser();
  if (!user || user.role !== 'admin') {
    var main = document.querySelector('main');
    if (main) {
      main.innerHTML =
        '<div style="text-align:center;padding:80px 24px;">' +
        '<div style="font-size:64px;margin-bottom:16px;">🔒</div>' +
        '<h2 style="font-size:24px;font-weight:600;color:var(--text);margin-bottom:8px;">无权限</h2>' +
        '<p style="color:var(--text-secondary);font-size:15px;">仅管理员可访问平台管理页面</p>' +
        '<a href="/" style="display:inline-block;margin-top:24px;color:var(--primary);text-decoration:none;font-size:14px;">← 返回首页</a>' +
        '</div>';
    }
    return;
  }

  // 加载数据
  loadMetrics();
  loadUsers();

  // 启动心跳
  startHeartbeat();
})();
