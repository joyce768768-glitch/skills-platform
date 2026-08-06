// 前端认证工具 - token 管理、登录校验、导航栏更新
// 在需要登录的页面引入本脚本,调用 requireAuth() 进行登录校验

const TOKEN_KEY = 'gourdsprite_token';
const USER_KEY = 'gourdsprite_user';

// 读取 token
function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

// 保存 token
function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

// 清除 token
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// 解析 JWT payload (不校验签名,仅前端判断过期用)
function decodeToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch (e) {
    return null;
  }
}

// 是否已登录 (token 存在且未过期)
function isLoggedIn() {
  const token = getToken();
  if (!token) return false;
  const payload = decodeToken(token);
  if (!payload) return false;
  if (payload.exp && payload.exp * 1000 < Date.now()) return false;
  return true;
}

// 获取缓存的当前用户对象
function getCurrentUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// 缓存当前用户对象
function setCurrentUser(user) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}

// 登录校验 - 未登录则跳转登录页
function requireAuth() {
  if (!isLoggedIn()) {
    clearToken();
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

// 退出登录 - 调用后端登出接口,清除本地状态并跳转
async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: getAuthHeaders()
    });
  } catch (e) {
    // 即使后端调用失败也继续清除本地状态
  }
  clearToken();
  window.location.href = '/login.html';
}

// 返回带认证信息的请求头
function getAuthHeaders() {
  return {
    'Authorization': 'Bearer ' + getToken(),
    'Content-Type': 'application/json'
  };
}

// 更新导航栏认证区域
// 已登录: 显示用户名 + 退出按钮; 未登录: 显示登录链接
function updateNavAuth() {
  const navInner = document.querySelector('.nav-inner');
  if (!navInner) return;

  let authArea = document.getElementById('navAuthArea');
  if (!authArea) {
    authArea = document.createElement('div');
    authArea.id = 'navAuthArea';
    authArea.style.marginLeft = 'auto';
    authArea.style.display = 'flex';
    authArea.style.alignItems = 'center';
    authArea.style.gap = '10px';
    navInner.appendChild(authArea);
  }

  if (isLoggedIn()) {
    const user = getCurrentUser();
    const name = (user && user.name) || (user && user.phone) || '用户';
    const roleBadge = user && user.role === 'admin'
      ? '<span style="font-size:11px;color:#fff;background:#0071e3;padding:2px 6px;border-radius:8px;">管理员</span>'
      : '';
    authArea.innerHTML = `
      <span style="font-size:13px;color:var(--text-secondary);">${escapeHtml(name)}</span>
      ${roleBadge}
      <button id="navLogoutBtn" style="font-size:13px;color:#ff3b30;cursor:pointer;background:none;border:none;padding:4px 8px;">退出</button>
    `;
    const btn = document.getElementById('navLogoutBtn');
    if (btn) btn.addEventListener('click', logout);
  } else {
    authArea.innerHTML = `
      <a href="/login.html" style="font-size:13px;color:var(--text-primary);text-decoration:none;">登录</a>
    `;
  }
}

// 简单 HTML 转义
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 页面加载后自动更新导航栏
document.addEventListener('DOMContentLoaded', updateNavAuth);
