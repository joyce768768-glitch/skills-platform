// 数据库模块 - 基于 better-sqlite3 的 SQLite 数据层
// 提供 users / tenants / verify_codes / sessions 四张表及辅助函数
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// 数据目录与数据库文件路径
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'gourdsprite.db');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化数据库实例
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

// ===== 建表 =====
db.exec(`
  -- 用户表
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    role TEXT DEFAULT 'user',
    tenant_id TEXT,
    avatar TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT,
    online_duration INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active'
  );

  -- 租户表 (一个用户对应一个租户)
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- 验证码表 (用于短信验证码 mock 登录)
  CREATE TABLE IF NOT EXISTS verify_codes (
    phone TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- 会话表 (记录登录/登出,用于统计在线时长)
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    login_at TEXT NOT NULL,
    logout_at TEXT,
    duration INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// 生成唯一 ID
function genId(prefix) {
  return (prefix || '') + crypto.randomUUID();
}

// ===== 用户相关辅助函数 =====

// 根据手机号查询用户
function getUserByPhone(phone) {
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
}

// 根据 ID 查询用户
function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// 创建用户
function createUser({ id, phone, name, role, avatar, tenantId, tenant_id, status }) {
  const userId = id || genId('u_');
  db.prepare(`
    INSERT INTO users (id, phone, name, role, avatar, tenant_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, phone, name || '', role || 'user', avatar || '', tenantId || tenant_id || null, status || 'active');
  return getUserById(userId);
}

// 更新用户字段 (传入需要更新的字段)
function updateUser(id, fields) {
  const user = getUserById(id);
  if (!user) return null;
  const allowed = ['name', 'role', 'tenant_id', 'avatar', 'last_login', 'online_duration', 'status'];
  const sets = [];
  const values = [];
  allowed.forEach(field => {
    if (fields[field] !== undefined) {
      sets.push(`${field} = ?`);
      values.push(fields[field]);
    }
  });
  if (sets.length === 0) return user;
  values.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getUserById(id);
}

// 获取全部用户
function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
}

// ===== 租户相关辅助函数 =====

// 创建租户
function createTenant({ id, userId, user_id, name }) {
  const tenantId = id || genId('t_');
  const uid = userId || user_id;
  db.prepare(`
    INSERT INTO tenants (id, user_id, name)
    VALUES (?, ?, ?)
  `).run(tenantId, uid, name || '');
  return db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
}

// 根据用户 ID 查询租户
function getTenantByUserId(userId) {
  return db.prepare('SELECT * FROM tenants WHERE user_id = ?').get(userId);
}

// ===== 验证码相关辅助函数 =====

// 存储/更新验证码 (同一手机号覆盖)
function storeVerifyCode(phone, code, expiresAt) {
  db.prepare(`
    INSERT INTO verify_codes (phone, code, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at
  `).run(phone, code, expiresAt);
  return { phone, code, expiresAt };
}

// 获取验证码
function getVerifyCode(phone) {
  return db.prepare('SELECT * FROM verify_codes WHERE phone = ?').get(phone);
}

// 删除验证码
function deleteVerifyCode(phone) {
  db.prepare('DELETE FROM verify_codes WHERE phone = ?').run(phone);
}

// ===== 会话相关辅助函数 =====

// 创建会话 (登录时调用)
function createSession({ id, userId, user_id, login_at }) {
  const sessionId = id || genId('s_');
  const uid = userId || user_id;
  const loginAt = login_at || new Date().toISOString();
  db.prepare(`
    INSERT INTO sessions (id, user_id, login_at)
    VALUES (?, ?, ?)
  `).run(sessionId, uid, loginAt);
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
}

// 更新会话登出时间 (登出时调用,并计算时长)
function updateSessionLogout(sessionId) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return null;
  const logoutAt = new Date().toISOString();
  const duration = Math.floor((new Date(logoutAt).getTime() - new Date(session.login_at).getTime()) / 1000);
  db.prepare(`
    UPDATE sessions SET logout_at = ?, duration = ? WHERE id = ?
  `).run(logoutAt, duration, sessionId);
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
}

// 获取用户所有会话
function getUserSessions(userId) {
  return db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY login_at DESC').all(userId);
}

// ===== 默认管理员初始化 =====
// 如果没有任何用户,自动创建默认管理员 (手机号 13800000000, 角色 admin)
(function initDefaultAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (count.c === 0) {
    const admin = createUser({
      phone: '13800000000',
      name: '管理员',
      role: 'admin',
      avatar: ''
    });
    // 为管理员创建默认租户
    createTenant({ userId: admin.id, name: '默认租户' });
    updateUser(admin.id, { tenantId: admin.id });
    console.log('已创建默认管理员账号: 13800000000');
  }
})();

module.exports = {
  db,
  getUserByPhone,
  getUserById,
  createUser,
  updateUser,
  getAllUsers,
  createTenant,
  getTenantByUserId,
  storeVerifyCode,
  getVerifyCode,
  deleteVerifyCode,
  createSession,
  updateSessionLogout,
  getUserSessions
};
