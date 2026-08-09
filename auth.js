// 认证模块 - 基于 JWT 的身份验证
// 提供 token 生成/校验以及 Express 中间件
const jwt = require('jsonwebtoken');
const { getUserById } = require('./db');

// JWT 密钥与有效期（从环境变量读取，本地启动时自动生成随机密钥）
const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomUUID();
const JWT_EXPIRES_IN = '7d';

// 生成 JWT
function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// 校验 JWT, 返回 payload 或 null
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// 认证中间件 - 解析 Authorization: Bearer <token>, 设置 req.user
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: '未登录' });
  }
  const payload = verifyToken(match[1]);
  if (!payload) {
    return res.status(401).json({ error: '登录已过期,请重新登录' });
  }
  const user = getUserById(payload.userId);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }
  if (user.status === 'disabled') {
    return res.status(403).json({ error: '账号已被禁用' });
  }
  req.user = user;
  next();
}

// 管理员中间件 - 必须在 authMiddleware 之后使用
function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

module.exports = {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  generateToken,
  verifyToken,
  authMiddleware,
  adminMiddleware
};
