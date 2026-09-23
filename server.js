const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { Octokit } = require('@octokit/rest');

// 认证与数据库模块
const db = require('./db');
const { generateToken, verifyToken, authMiddleware, adminMiddleware } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 默认首页指向项目页面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'project.html'));
});

// 发现页（Skills 承载页面）
app.get('/discover', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 开发期：HTML/JS/CSS 不缓存，避免浏览器残留旧代码导致点击/样式异常
app.use((req, res, next) => {
  if (/\.(html|js|css)(\?|$)/.test(req.url)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const SKILLS_FILE = path.join(DATA_DIR, 'skills.json');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CACHE_DIR = path.join(DATA_DIR, 'cache');

const CACHE_TTL = 3600;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(SKILLS_FILE)) fs.writeFileSync(SKILLS_FILE, '[]');
  if (!fs.existsSync(CATEGORIES_FILE)) {
    const defaultCategories = [
      { id: 'design', name: '设计类', icon: '🎨' },
      { id: 'video', name: '视频剪辑类', icon: '🎬' },
      { id: 'ppt', name: 'PPT类', icon: '📊' },
      { id: 'ai', name: 'AI工具类', icon: '🤖' },
      { id: 'dev', name: '开发工具类', icon: '🔧' }
    ];
    fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(defaultCategories, null, 2));
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ githubToken: '' }, null, 2));
  }
}

function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return filePath === SKILLS_FILE || filePath === CATEGORIES_FILE ? [] : {}; }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

ensureDataDir();

function readConfig() {
  return readJSON(CONFIG_FILE);
}

function writeConfig(config) {
  writeJSON(CONFIG_FILE, config);
}

function createOctokit() {
  const config = readConfig();
  const options = {
    userAgent: 'SkillsPlatform/v1.0',
    timeZone: 'Asia/Shanghai'
  };
  if (config.githubToken) {
    options.auth = config.githubToken;
  }
  return new Octokit(options);
}

function getCachePath(owner, repo) {
  return path.join(CACHE_DIR, `${owner}_${repo}.json`);
}

function getCachedRepo(owner, repo) {
  try {
    const cachePath = getCachePath(owner, repo);
    if (!fs.existsSync(cachePath)) return null;
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    const age = Date.now() - cache.cachedAt;
    if (age > CACHE_TTL * 1000) return null;
    return cache.data;
  } catch {
    return null;
  }
}

function setCachedRepo(owner, repo, data) {
  try {
    const cachePath = getCachePath(owner, repo);
    fs.writeFileSync(cachePath, JSON.stringify({
      data,
      cachedAt: Date.now()
    }, null, 2));
  } catch {}
}

function clearCache(owner, repo) {
  try {
    const cachePath = getCachePath(owner, repo);
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch {}
}

async function fetchGitHubRepo(url, options = {}) {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) throw new Error('无效的GitHub URL');
  const [, owner, repo] = match;

  if (!options.forceRefresh) {
    const cached = getCachedRepo(owner, repo);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  const octokit = createOctokit();

  try {
    const { data: repoData, headers } = await octokit.repos.get({ owner, repo });

    const result = {
      name: repoData.name,
      description: repoData.description || '暂无描述',
      owner: owner,
      repo: repo,
      defaultBranch: repoData.default_branch || 'main',
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      language: repoData.language || '',
      topics: repoData.topics || [],
      size: repoData.size || 0,
      license: repoData.license ? repoData.license.spdx_id : '',
      updatedAt: repoData.updated_at || '',
      homepage: repoData.homepage || '',
      openIssues: repoData.open_issues_count || 0,
      hasWiki: repoData.has_wiki || false,
      hasPages: repoData.has_pages || false
    };

    setCachedRepo(owner, repo, result);

    result.fromCache = false;
    result.rateLimit = {
      remaining: parseInt(headers['x-ratelimit-remaining'] || '0'),
      limit: parseInt(headers['x-ratelimit-limit'] || '0'),
      reset: parseInt(headers['x-ratelimit-reset'] || '0')
    };

    return result;
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const rateLimit = error.response.headers || {};
      
      if (status === 403 && (rateLimit['x-ratelimit-remaining'] === '0' || rateLimit['x-ratelimit-remaining'] === 0)) {
        const resetTime = new Date(parseInt(rateLimit['x-ratelimit-reset']) * 1000);
        const config = readConfig();
        if (!config.githubToken) {
          throw new Error(`GitHub API 速率限制已用完（未认证: 60次/小时）。请在后台配置 GitHub Token 以获得更高限额（5000次/小时）。重置时间: ${resetTime.toLocaleString('zh-CN')}`);
        } else {
          throw new Error(`GitHub API 速率限制已用完。请稍后再试或更换 Token。重置时间: ${resetTime.toLocaleString('zh-CN')}`);
        }
      }
      if (status === 404) {
        throw new Error('仓库不存在或已被删除');
      }
      if (status === 401) {
        throw new Error('GitHub Token 无效或已过期，请在后台重新配置');
      }
      throw new Error(`GitHub API 错误: HTTP ${status}`);
    }
    throw new Error(`网络错误: ${error.message}`);
  }
}

app.get('/api/config/github-token', (req, res) => {
  const config = readConfig();
  res.json({
    hasToken: !!config.githubToken,
    tokenMasked: config.githubToken ? config.githubToken.substring(0, 4) + '****' : '',
    rateLimit: null
  });
});

app.post('/api/config/github-token', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token不能为空' });
  }
  const config = readConfig();
  config.githubToken = token.trim();
  writeConfig(config);
  res.json({ success: true });
});

app.delete('/api/config/github-token', (req, res) => {
  writeConfig({ githubToken: '' });
  res.json({ success: true });
});

app.post('/api/github/rate-limit', async (req, res) => {
  try {
    const octokit = createOctokit();
    const { data } = await octokit.rateLimit.get();
    res.json({
      limit: data.rate.limit,
      remaining: data.rate.remaining,
      reset: new Date(data.rate.reset * 1000).toLocaleString('zh-CN'),
      used: data.rate.used
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Categories API
app.get('/api/categories', (req, res) => {
  const categories = readJSON(CATEGORIES_FILE);
  res.json(categories);
});

app.post('/api/categories', (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: '分类名称不能为空' });
  const categories = readJSON(CATEGORIES_FILE);
  const newCategory = { id: 'cat_' + Date.now(), name, icon: icon || '📁' };
  categories.push(newCategory);
  writeJSON(CATEGORIES_FILE, categories);
  res.json(newCategory);
});

app.put('/api/categories/:id', (req, res) => {
  const { id } = req.params;
  const { name, icon } = req.body;
  const categories = readJSON(CATEGORIES_FILE);
  const category = categories.find(c => c.id === id);
  if (!category) return res.status(404).json({ error: '分类不存在' });
  if (name) category.name = name;
  if (icon) category.icon = icon;
  writeJSON(CATEGORIES_FILE, categories);
  res.json(category);
});

app.delete('/api/categories/:id', (req, res) => {
  const { id } = req.params;
  const categories = readJSON(CATEGORIES_FILE);
  const index = categories.findIndex(c => c.id === id);
  if (index === -1) return res.status(404).json({ error: '分类不存在' });
  categories.splice(index, 1);
  writeJSON(CATEGORIES_FILE, categories);
  const skills = readJSON(SKILLS_FILE);
  skills.forEach(s => { if (s.categoryId === id) s.categoryId = null; });
  writeJSON(SKILLS_FILE, skills);
  res.json({ success: true });
});

// Skills API
app.get('/api/skills', (req, res) => {
  const skills = readJSON(SKILLS_FILE);
  const { categoryId, search } = req.query;
  let filtered = skills;
  if (categoryId) filtered = filtered.filter(s => s.categoryId === categoryId);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(s =>
      (s.nameZh && s.nameZh.toLowerCase().includes(q)) ||
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.descriptionZh && s.descriptionZh.toLowerCase().includes(q)) ||
      (s.description && s.description.toLowerCase().includes(q))
    );
  }
  res.json(filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.get('/api/skills/:id', (req, res) => {
  const skills = readJSON(SKILLS_FILE);
  const skill = skills.find(s => s.id === req.params.id);
  if (!skill) return res.status(404).json({ error: 'Skill不存在' });
  res.json(skill);
});

app.post('/api/skills/fetch-github', async (req, res) => {
  const { url, forceRefresh } = req.body;
  if (!url) return res.status(400).json({ error: 'GitHub URL不能为空' });
  try {
    const repoData = await fetchGitHubRepo(url, { forceRefresh });
    res.json({
      ...repoData,
      downloadUrl: `https://github.com/${repoData.owner}/${repoData.repo}/archive/refs/heads/${repoData.defaultBranch}.zip`
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/skills', (req, res) => {
  const {
    githubUrl, name, nameZh, description, descriptionZh,
    categoryId, downloadUrl, owner, repo, defaultBranch,
    stars, forks, language, topics
  } = req.body;
  if (!githubUrl) return res.status(400).json({ error: 'GitHub URL不能为空' });
  const skills = readJSON(SKILLS_FILE);
  const newSkill = {
    id: 'skill_' + Date.now(),
    githubUrl,
    name: name || '',
    nameZh: nameZh || '',
    description: description || '',
    descriptionZh: descriptionZh || '',
    categoryId: categoryId || null,
    downloadUrl: downloadUrl || '',
    owner: owner || '',
    repo: repo || '',
    defaultBranch: defaultBranch || 'main',
    stars: stars || 0,
    forks: forks || 0,
    language: language || '',
    topics: topics || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  skills.push(newSkill);
  writeJSON(SKILLS_FILE, skills);
  res.json(newSkill);
});

app.put('/api/skills/:id', (req, res) => {
  const { id } = req.params;
  const skills = readJSON(SKILLS_FILE);
  const index = skills.findIndex(s => s.id === id);
  if (index === -1) return res.status(404).json({ error: 'Skill不存在' });
  const allowedFields = ['name', 'nameZh', 'description', 'descriptionZh', 'categoryId', 'downloadUrl', 'stars', 'forks', 'language', 'topics'];
  allowedFields.forEach(field => {
    if (req.body[field] !== undefined) skills[index][field] = req.body[field];
  });
  skills[index].updatedAt = new Date().toISOString();
  writeJSON(SKILLS_FILE, skills);
  res.json(skills[index]);
});

app.delete('/api/skills/:id', (req, res) => {
  const { id } = req.params;
  const skills = readJSON(SKILLS_FILE);
  const index = skills.findIndex(s => s.id === id);
  if (index === -1) return res.status(404).json({ error: 'Skill不存在' });
  skills.splice(index, 1);
  writeJSON(SKILLS_FILE, skills);
  res.json({ success: true });
});

app.post('/api/skills/:id/refresh', async (req, res) => {
  const { id } = req.params;
  const skills = readJSON(SKILLS_FILE);
  const index = skills.findIndex(s => s.id === id);
  if (index === -1) return res.status(404).json({ error: 'Skill不存在' });
  try {
    const repoData = await fetchGitHubRepo(skills[index].githubUrl, { forceRefresh: true });
    const allowedFields = ['name', 'description', 'downloadUrl', 'owner', 'repo', 'defaultBranch', 'stars', 'forks', 'language', 'topics'];
    allowedFields.forEach(field => {
      if (repoData[field] !== undefined) skills[index][field] = repoData[field];
    });
    skills[index].downloadUrl = `https://github.com/${repoData.owner}/${repoData.repo}/archive/refs/heads/${repoData.defaultBranch}.zip`;
    skills[index].updatedAt = new Date().toISOString();
    writeJSON(SKILLS_FILE, skills);
    res.json(skills[index]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Chrome Bookmarks API =====
const CHROME_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  'Library', 'Application Support', 'Google', 'Chrome'
);

function findChromeProfiles() {
  const profiles = [];
  if (!fs.existsSync(CHROME_DIR)) return profiles;

  try {
    const entries = fs.readdirSync(CHROME_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const isProfile = entry.name === 'Default' || entry.name.startsWith('Profile ');
      if (!isProfile) continue;
      const bookmarksFile = path.join(CHROME_DIR, entry.name, 'Bookmarks');
      if (fs.existsSync(bookmarksFile)) {
        let profileName = entry.name;
        let displayName = entry.name === 'Default' ? '默认用户' : entry.name;
        try {
          const localState = JSON.parse(fs.readFileSync(path.join(CHROME_DIR, 'Local State'), 'utf-8'));
          const info = localState?.profile?.info_cache?.[entry.name];
          if (info?.name) displayName = info.name;
        } catch {}
        profiles.push({ id: entry.name, displayName, bookmarksFile });
      }
    }
  } catch {}
  return profiles;
}

function readChromeBookmarks(profileId) {
  const profiles = findChromeProfiles();
  const profile = profiles.find(p => p.id === profileId) || profiles[0];
  if (!profile) throw new Error('未找到 Chrome 书签文件');

  const raw = fs.readFileSync(profile.bookmarksFile, 'utf-8');
  const data = JSON.parse(raw);
  return data;
}

function writeChromeBookmarks(profileId, bookmarkData) {
  const profiles = findChromeProfiles();
  const profile = profiles.find(p => p.id === profileId) || profiles[0];
  if (!profile) throw new Error('未找到 Chrome 书签文件');

  // Remove checksum so Chrome recalculates it on load
  delete bookmarkData.checksum;

  // Atomic write: write to temp file first, then rename
  const tmpFile = profile.bookmarksFile + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(bookmarkData, null, 3));
  fs.renameSync(tmpFile, profile.bookmarksFile);
}

// File watcher for real-time sync
let bookmarkWatchers = {};
function startBookmarkWatcher(profileId, bookmarksFile) {
  if (bookmarkWatchers[profileId]) {
    bookmarkWatchers[profileId].close();
  }
  try {
    bookmarkWatchers[profileId] = fs.watch(bookmarksFile, { persistent: false }, (eventType) => {
      if (eventType === 'change') {
        // Debounce: Chrome may write multiple times in quick succession
        clearTimeout(bookmarkWatchers[profileId + '_debounce']);
        bookmarkWatchers[profileId + '_debounce'] = setTimeout(() => {
          // Notify connected clients via SSE
        }, 500);
      }
    });
  } catch {}
}

app.get('/api/bookmarks/profiles', (req, res) => {
  const profiles = findChromeProfiles();
  res.json(profiles.map(p => ({ id: p.id, displayName: p.displayName })));
});

app.get('/api/bookmarks', (req, res) => {
  const { profile } = req.query;
  try {
    const profiles = findChromeProfiles();
    if (profiles.length === 0) {
      return res.status(404).json({ error: '未找到 Chrome 安装' });
    }
    const profileId = profile || profiles[0].id;
    const data = readChromeBookmarks(profileId);
    const targetProfile = profiles.find(p => p.id === profileId) || profiles[0];

    // Start watcher if not already watching
    startBookmarkWatcher(profileId, targetProfile.bookmarksFile);

    res.json({ profile: profileId, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/bookmarks', (req, res) => {
  const { profile } = req.query;
  const bookmarkData = req.body;
  try {
    const profiles = findChromeProfiles();
    const profileId = profile || profiles[0]?.id;
    if (!profileId) {
      return res.status(404).json({ error: '未找到 Chrome 安装' });
    }
    writeChromeBookmarks(profileId, bookmarkData);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Favicon Proxy =====
const FAVICON_CACHE_DIR = path.join(DATA_DIR, 'favicons');
if (!fs.existsSync(FAVICON_CACHE_DIR)) fs.mkdirSync(FAVICON_CACHE_DIR, { recursive: true });

const FAVICON_SOURCES = [
  (domain, size) => `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`,
  (domain, size) => `https://icon.horse/icon/${domain}?size=${size}`,
];

function fetchFaviconFromUrl(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.get(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          fetchFaviconFromUrl(new URL(redirectUrl, url).href).then(resolve).catch(reject);
          return;
        }
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size > 65536) {
          req.destroy();
          reject(new Error('Too large'));
        }
      });
      res.on('end', () => {
        resolve({ data: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/x-icon' });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function getCachePath(domain) {
  return path.join(FAVICON_CACHE_DIR, domain.replace(/[^a-z0-9.-]/gi, '_') + '.bin');
}

function getCachedFavicon(domain) {
  try {
    const cachePath = getCachePath(domain);
    if (!fs.existsSync(cachePath)) return null;
    const stat = fs.statSync(cachePath);
    const age = Date.now() - stat.mtimeMs;
    if (age > 7 * 24 * 3600 * 1000) return null; // 7-day cache
    return fs.readFileSync(cachePath);
  } catch { return null; }
}

function setCachedFavicon(domain, data) {
  try {
    const cachePath = getCachePath(domain);
    fs.writeFileSync(cachePath, data);
  } catch {}
}

async function fetchFavicon(domain) {
  // Try Google first
  for (const source of FAVICON_SOURCES) {
    try {
      const url = source(domain, 64);
      const { data, contentType } = await fetchFaviconFromUrl(url);
      if (data && data.length > 0 && data.length < 65536) {
        // Verify it's actually an image (not HTML error page)
        if (isValidImage(data, contentType)) {
          return { data, contentType };
        }
      }
    } catch {}
  }

  // Try direct favicon.ico
  try {
    const faviconUrl = `https://${domain}/favicon.ico`;
    const { data, contentType } = await fetchFaviconFromUrl(faviconUrl);
    if (data && data.length > 0 && data.length < 65536 && isValidImage(data, contentType)) {
      return { data, contentType };
    }
  } catch {}

  // Try root /favicon.ico
  try {
    const rootUrl = `https://${domain}/`;
    const { data } = await fetchFaviconFromUrl(rootUrl);
    if (data) {
      // Check if HTML page has icon links - skip this complex parsing
      // Just return null for fallback
    }
  } catch {}

  return null;
}

function isValidImage(data, contentType) {
  if (!data || data.length < 4) return false;
  // Check image signatures
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) return true; // PNG
  if (data[0] === 0xFF && data[1] === 0xD8) return true; // JPEG
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return true; // GIF
  if (data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x01 && data[3] === 0x00) return true; // ICO
  if (data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x02 && data[3] === 0x00) return true; // CUR
  if (contentType && (contentType.startsWith('image/'))) return true;
  return false;
}

app.get('/api/favicon', async (req, res) => {
  const { domain } = req.query;
  if (!domain) return res.status(400).json({ error: 'domain required' });

  const cleanDomain = domain.replace(/^www\./, '').trim();

  // Check cache first
  const cached = getCachedFavicon(cleanDomain);
  if (cached) {
    res.setHeader('Content-Type', 'image/x-icon');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.send(cached);
  }

  try {
    const result = await fetchFavicon(cleanDomain);
    if (result && result.data) {
      setCachedFavicon(cleanDomain, result.data);
      res.setHeader('Content-Type', result.contentType || 'image/x-icon');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.send(result.data);
    }
  } catch {}

  // Generate SVG fallback with first letter
  const letter = (cleanDomain.charAt(0) || '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#e8e8ed"/><text x="16" y="22" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="16" font-weight="600" fill="#86868b" text-anchor="middle">${letter}</text></svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Fallback', 'letter');
  res.send(svg);
});

// ===== Workbench API =====
const WORKBENCH_FILE = path.join(DATA_DIR, 'workbench.json');
const { execSync, exec } = require('child_process');
const os = require('os');

function readWorkbench() {
  return readJSON(WORKBENCH_FILE);
}

function writeWorkbench(data) {
  writeJSON(WORKBENCH_FILE, data);
}

if (!fs.existsSync(WORKBENCH_FILE)) {
  writeWorkbench({ projects: [], plans: {}, reminders: [], customPaths: [], prompts: {} });
}

const TRAE_DIR = path.join(os.homedir(), 'Trae');
const ANTIGRAVITY_DIR = path.join(os.homedir(), 'Antigravity');
const VSCODE_DIR = path.join(os.homedir(), 'VS-Code');

// List projects from ~/Trae/ + custom paths
app.get('/api/workbench/projects', (req, res) => {
  const wb = readWorkbench();
  const prompts = wb.prompts || {};
  const scanPaths = [TRAE_DIR, ...wb.customPaths];
  const projects = [];

  scanPaths.forEach(scanPath => {
    if (!fs.existsSync(scanPath)) return;
    let entries;
    try { entries = fs.readdirSync(scanPath, { withFileTypes: true }); }
    catch { return; }

    entries.forEach(entry => {
      if (!entry.isDirectory() || entry.name.startsWith('.')) return;
      const projectPath = path.join(scanPath, entry.name);
      const isCustom = scanPath !== TRAE_DIR;
      const id = Buffer.from(projectPath).toString('base64');
      projects.push({
        id,
        name: entry.name,
        path: projectPath,
        source: isCustom ? path.basename(scanPath) : 'Trae',
        custom: isCustom,
        prompt: prompts[id] || ''
      });
    });
  });

  res.json(projects);
});

// Scan a single project (git status, tech stack, last modified)
app.get('/api/workbench/projects/:id/scan', (req, res) => {
  const wb = readWorkbench();
  const scanPaths = [TRAE_DIR, ...wb.customPaths];
  let targetPath = null;

  scanPaths.forEach(scanPath => {
    if (!fs.existsSync(scanPath)) return;
    try {
      fs.readdirSync(scanPath, { withFileTypes: true }).forEach(entry => {
        if (!entry.isDirectory()) return;
        const p = path.join(scanPath, entry.name);
        const id = Buffer.from(p).toString('base64');
        if (id === req.params.id) targetPath = p;
      });
    } catch {}
  });

  if (!targetPath) return res.status(404).json({ error: '项目不存在' });

  const result = { path: targetPath, git: null, techStack: [], stats: {} };

  // Git info
  try {
    const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: targetPath, timeout: 5000, encoding: 'utf-8' }).trim();
    let gitStatus = '';
    try {
      gitStatus = execSync('git status --porcelain', { cwd: targetPath, timeout: 5000, encoding: 'utf-8' }).trim();
    } catch {}
    const changes = gitStatus ? gitStatus.split('\n').filter(Boolean) : [];
    let lastCommit = '';
    let lastCommitDate = '';
    try {
      lastCommit = execSync('git log -1 --format=%s', { cwd: targetPath, timeout: 5000, encoding: 'utf-8' }).trim();
      lastCommitDate = execSync('git log -1 --format=%cd --date=short', { cwd: targetPath, timeout: 5000, encoding: 'utf-8' }).trim();
    } catch {}
    result.git = { branch: gitBranch, uncommitted: changes.length, changes, lastCommit, lastCommitDate };
  } catch { result.git = null; }

  // Tech stack detection
  const stackFiles = {
    'package.json': 'Node.js',
    'requirements.txt': 'Python',
    'pyproject.toml': 'Python',
    'Cargo.toml': 'Rust',
    'go.mod': 'Go',
    'pom.xml': 'Java',
    'build.gradle': 'Java',
    'Gemfile': 'Ruby',
    'composer.json': 'PHP',
    'index.html': 'HTML',
    'SKILL.md': 'Trae Skill'
  };
  Object.entries(stackFiles).forEach(([file, stack]) => {
    if (fs.existsSync(path.join(targetPath, file))) result.techStack.push(stack);
  });

  // File stats
  try {
    const fileCount = execSync(`find "${targetPath}" -not -path '*/node_modules/*' -not -path '*/.git/*' -type f | wc -l`, { timeout: 5000, encoding: 'utf-8' }).trim();
    result.stats.fileCount = parseInt(fileCount);
  } catch { result.stats.fileCount = 0; }

  // Last modified
  try {
    const lastMod = execSync(`find "${targetPath}" -not -path '*/node_modules/*' -not -path '*/.git/*' -type f -exec stat -f '%m %N' {} + | sort -rn | head -1`, { timeout: 5000, encoding: 'utf-8' }).trim();
    if (lastMod) {
      const [ts, ...nameParts] = lastMod.split(' ');
      result.stats.lastModifiedFile = nameParts.join(' ').replace(targetPath + '/', '');
      result.stats.lastModifiedTime = new Date(parseInt(ts) * 1000).toISOString();
    }
  } catch {}

  res.json(result);
});

// Custom paths CRUD
app.get('/api/workbench/paths', (req, res) => {
  res.json(readWorkbench().customPaths);
});

app.post('/api/workbench/paths', (req, res) => {
  const wb = readWorkbench();
  const p = req.body.path;
  if (!p) return res.status(400).json({ error: '路径不能为空' });
  if (!fs.existsSync(p)) return res.status(400).json({ error: '路径不存在' });
  if (!wb.customPaths.includes(p)) wb.customPaths.push(p);
  writeWorkbench(wb);
  res.json(wb.customPaths);
});

app.delete('/api/workbench/paths', (req, res) => {
  const wb = readWorkbench();
  wb.customPaths = wb.customPaths.filter(p => p !== req.body.path);
  writeWorkbench(wb);
  res.json(wb.customPaths);
});

// Plans CRUD (keyed by date YYYY-MM-DD)
app.get('/api/workbench/plans/:date', (req, res) => {
  const wb = readWorkbench();
  res.json(wb.plans[req.params.date] || { tasks: [] });
});

app.post('/api/workbench/plans/:date', (req, res) => {
  const wb = readWorkbench();
  wb.plans[req.params.date] = req.body;
  writeWorkbench(wb);
  res.json(req.body);
});

// Reminders CRUD
app.get('/api/workbench/reminders', (req, res) => {
  res.json(readWorkbench().reminders);
});

app.post('/api/workbench/reminders', (req, res) => {
  const wb = readWorkbench();
  const reminder = {
    id: Date.now().toString(),
    title: req.body.title || '提醒',
    time: req.body.time, // ISO string
    sound: req.body.sound !== false,
    done: false
  };
  wb.reminders.push(reminder);
  writeWorkbench(wb);
  res.json(reminder);
});

app.put('/api/workbench/reminders/:id', (req, res) => {
  const wb = readWorkbench();
  const idx = wb.reminders.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '提醒不存在' });
  Object.assign(wb.reminders[idx], req.body);
  writeWorkbench(wb);
  res.json(wb.reminders[idx]);
});

app.delete('/api/workbench/reminders/:id', (req, res) => {
  const wb = readWorkbench();
  wb.reminders = wb.reminders.filter(r => r.id !== req.params.id);
  writeWorkbench(wb);
  res.json({ ok: true });
});

// Web Projects (user's web project entries for preview)
app.get('/api/web-projects', (req, res) => {
  const wb = readWorkbench();
  res.json(wb.webProjects || []);
});

app.post('/api/web-projects', (req, res) => {
  const wb = readWorkbench();
  if (!wb.webProjects) wb.webProjects = [];
  const { name, url, description, category } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: '名称和网址必填' });
  const entry = {
    id: Date.now().toString(),
    name: name.trim(),
    url: url.trim(),
    description: (description || '').trim(),
    category: (category || '其他').trim(),
    createdAt: new Date().toISOString()
  };
  wb.webProjects.push(entry);
  writeWorkbench(wb);
  res.json(entry);
});

app.put('/api/web-projects/:id', (req, res) => {
  const wb = readWorkbench();
  if (!wb.webProjects) return res.status(404).json({ error: '不存在' });
  const idx = wb.webProjects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '不存在' });
  const { name, url, description, category } = req.body || {};
  if (name !== undefined) wb.webProjects[idx].name = name.trim();
  if (url !== undefined) wb.webProjects[idx].url = url.trim();
  if (description !== undefined) wb.webProjects[idx].description = description.trim();
  if (category !== undefined) wb.webProjects[idx].category = category.trim();
  writeWorkbench(wb);
  res.json(wb.webProjects[idx]);
});

app.delete('/api/web-projects/:id', (req, res) => {
  const wb = readWorkbench();
  if (!wb.webProjects) return res.json({ ok: true });
  wb.webProjects = wb.webProjects.filter(p => p.id !== req.params.id);
  writeWorkbench(wb);
  res.json({ ok: true });
});

// Diary (per-date text notes)
app.get('/api/workbench/diary/:date', (req, res) => {
  const wb = readWorkbench();
  const diaries = wb.diaries || {};
  res.json({ content: diaries[req.params.date] || '' });
});

app.post('/api/workbench/diary/:date', (req, res) => {
  const wb = readWorkbench();
  if (!wb.diaries) wb.diaries = {};
  wb.diaries[req.params.date] = req.body.content || '';
  writeWorkbench(wb);
  res.json({ ok: true });
});

// Open Obsidian app
app.post('/api/workbench/open-obsidian', (req, res) => {
  exec('open -a "Obsidian"', (err) => {
    if (err) {
      console.error('open obsidian error', err);
      return res.status(500).json({ error: '打开失败' });
    }
    res.json({ ok: true });
  });
});

// Play system sound (macOS afplay) — bypasses browser autoplay restrictions
app.post('/api/workbench/beep', (req, res) => {
  const sound = req.body && req.body.sound ? req.body.sound : 'Glass';
  // Play 3 times for continuous ringing effect
  const cmd = `afplay /System/Library/Sounds/${sound}.aiff && afplay /System/Library/Sounds/${sound}.aiff && afplay /System/Library/Sounds/${sound}.aiff`;
  exec(cmd, (err) => {
    if (err) {
      // Fallback: try say command (voice)
      exec('say "提醒时间到"', () => {});
    }
  });
  res.json({ ok: true });
});

// Auto open project in Trae CN + paste prompt via osascript (requires Accessibility permission)
app.post('/api/workbench/start-work', (req, res) => {
  const { projectPath, prompt } = req.body || {};
  // 1. Open project in Trae CN
  if (projectPath) {
    exec(`open -a "Trae CN" "${projectPath}"`, (err) => {
      if (err) console.error('open trae error', err);
    });
  }
  // 2. After Trae opens, set clipboard then simulate Cmd+V paste
  const wait = projectPath ? 2500 : 500;
  setTimeout(() => {
    const copy = exec('pbcopy');
    copy.stdin.write(prompt || '');
    copy.stdin.end();
    copy.on('exit', () => {
      exec(`osascript -e 'tell application "Trae CN" to activate' -e 'delay 1' -e 'tell application "System Events" to keystroke "v" using command down'`, (err) => {
        if (err) console.error('paste error', err);
      });
    });
  }, wait);
  res.json({ ok: true, note: '若未自动粘贴，请在 系统设置→隐私与安全→辅助功能 中授权' });
});

// Open project in Trae CN or Finder
app.post('/api/workbench/open-project', (req, res) => {
  const { path: projectPath, app } = req.body || {};
  if (!projectPath) return res.status(400).json({ error: '缺少路径' });
  const cmd = app === 'finder' ? `open "${projectPath}"` : `open -a "Trae CN" "${projectPath}"`;
  exec(cmd, (err) => {
    if (err) {
      console.error('open project error', err);
      return res.status(500).json({ error: '打开失败' });
    }
    res.json({ ok: true });
  });
});

// Project work prompts (per-project)
app.get('/api/workbench/projects/:id/prompt', (req, res) => {
  const wb = readWorkbench();
  const prompts = wb.prompts || {};
  res.json({ prompt: prompts[req.params.id] || '' });
});

app.put('/api/workbench/projects/:id/prompt', (req, res) => {
  const wb = readWorkbench();
  if (!wb.prompts) wb.prompts = {};
  wb.prompts[req.params.id] = (req.body.prompt || '').trim();
  writeWorkbench(wb);
  res.json({ prompt: wb.prompts[req.params.id] });
});

app.delete('/api/workbench/projects/:id/prompt', (req, res) => {
  const wb = readWorkbench();
  if (!wb.prompts) wb.prompts = {};
  delete wb.prompts[req.params.id];
  writeWorkbench(wb);
  res.json({ ok: true });
});

// ===== Kanban Board API (项目看板: 构想/待办/执行中/已完成) =====
const PROMPT_LOG_FILE = path.join(DATA_DIR, 'prompt-log.json');

function readPromptLog() {
  return readJSON(PROMPT_LOG_FILE);
}

function writePromptLog(data) {
  writeJSON(PROMPT_LOG_FILE, data);
}

if (!fs.existsSync(PROMPT_LOG_FILE)) {
  writePromptLog([]);
}

// 获取看板所有项目
app.get('/api/workbench/kanban', (req, res) => {
  const wb = readWorkbench();
  if (!wb.kanban) wb.kanban = [];
  // 同步清理：~/Trae/ 下已删除目录的项目从看板移除
  const before = wb.kanban.length;
  wb.kanban = wb.kanban.filter(item => {
    if (!item.path || item.dirCreated === false) return true; // 无路径或目录从未创建成功，保留
    return fs.existsSync(item.path); // 目录曾创建成功，检查是否还存在
  });
  if (wb.kanban.length !== before) {
    writeWorkbench(wb);
  }
  res.json(wb.kanban);
});

// 创建构想项目（自动创建目录）
app.post('/api/workbench/kanban', (req, res) => {
  const { name, description, prompt, docLink } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '项目名称不能为空' });
  const wb = readWorkbench();
  if (!wb.kanban) wb.kanban = [];

  const projectName = name.trim();
  const projectPath = path.join(TRAE_DIR, projectName);

  // 检查重名
  if (wb.kanban.some(p => p.name === projectName)) {
    return res.status(400).json({ error: '已存在同名项目' });
  }

  // 创建目录（失败不阻止创建项目，只标注）
  let dirCreated = true;
  try {
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }
  } catch (e) {
    // Fallback: 子进程 mkdir，应用最新沙箱规则
    try {
      execSync(`mkdir -p "${projectPath}"`);
    } catch (e2) {
      dirCreated = false;
      console.warn('创建目录失败(可在系统终端手动创建):', e2.message);
    }
  }

  const item = {
    id: 'kb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name: projectName,
    description: (description || '').trim(),
    path: projectPath,
    status: 'idea',
    createdAt: new Date().toISOString(),
    prompt: (prompt || '').trim(),
    docLink: (docLink || '').trim(),
    startedAt: null,
    completedAt: null,
    dirCreated
  };
  wb.kanban.push(item);
  writeWorkbench(wb);
  res.json(item);
});

// 推送项目到 GitHub
app.post('/api/workbench/kanban/:id/push-github', (req, res) => {
  const wb = readWorkbench();
  const item = wb.kanban.find(p => p.id === req.params.id);
  if (!item || !item.path) return res.status(404).json({ error: '项目不存在或无路径' });
  try {
    const { execSync } = require('child_process');
    const ts = new Date().toLocaleString('zh-CN');
    const cmd = `cd "${item.path}" && git add -A && git commit -m "update: ${ts}" && git push 2>&1`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
    res.json({ success: true, output });
  } catch (e) {
    res.status(500).json({ error: (e.stdout || e.message || '').slice(0, 500) });
  }
});

// 打开 ~/Trae/ 目录（macOS Finder）
app.post('/api/workbench/open-trae', (req, res) => {
  try {
    require('child_process').exec(`open "${TRAE_DIR}"`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '打开失败: ' + e.message });
  }
});

// 同步 ~/Trae/ 下所有项目目录到看板已完成列
app.post('/api/workbench/kanban/sync-trae', (req, res) => {
  const wb = readWorkbench();
  if (!wb.kanban) wb.kanban = [];
  const existingPaths = new Set(wb.kanban.map(p => p.path));
  let added = 0;
  const addedNames = [];
  try {
    const entries = fs.readdirSync(TRAE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(TRAE_DIR, entry.name);
      if (existingPaths.has(dirPath)) continue;
      const item = {
        id: 'kb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name: entry.name,
        description: '',
        path: dirPath,
        status: 'done',
        createdAt: new Date().toISOString(),
        prompt: '',
        docLink: '',
        startedAt: null,
        completedAt: new Date().toISOString(),
        dirCreated: true
      };
      wb.kanban.push(item);
      addedNames.push(entry.name);
      added++;
    }
    if (added > 0) writeWorkbench(wb);
  } catch (e) {
    return res.status(500).json({ error: '扫描目录失败: ' + e.message });
  }
  res.json({ added, addedNames, total: wb.kanban.length });
});

// 更新看板项目（流转状态、编辑信息）
app.put('/api/workbench/kanban/:id', (req, res) => {
  const wb = readWorkbench();
  if (!wb.kanban) wb.kanban = [];
  const idx = wb.kanban.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '项目不存在' });

  const item = wb.kanban[idx];
  const { status, prompt, docLink, description, name } = req.body || {};

  // 检查执行中数量上限
  if (status === 'doing' && item.status !== 'doing') {
    const doingCount = wb.kanban.filter(p => p.status === 'doing').length;
    if (doingCount >= 5) {
      return res.status(400).json({ error: '执行中项目已达上限(5个)，请先完成部分项目' });
    }
  }

  if (name !== undefined) item.name = name.trim();
  if (description !== undefined) item.description = description.trim();
  if (prompt !== undefined) item.prompt = prompt.trim();
  if (docLink !== undefined) item.docLink = docLink.trim();
  if (status && status !== item.status) {
    item.status = status;
    if (status === 'doing' && !item.startedAt) item.startedAt = new Date().toISOString();
    if (status === 'done') item.completedAt = new Date().toISOString();
  }

  wb.kanban[idx] = item;
  writeWorkbench(wb);
  res.json(item);
});

// 删除看板项目
app.delete('/api/workbench/kanban/:id', (req, res) => {
  const wb = readWorkbench();
  if (!wb.kanban) wb.kanban = [];
  const idx = wb.kanban.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '项目不存在' });
  wb.kanban.splice(idx, 1);
  writeWorkbench(wb);
  res.json({ ok: true });
});

// 开始执行：打开Trae + 粘贴提示词 + 记录日志
app.post('/api/workbench/kanban/:id/start', (req, res) => {
  const wb = readWorkbench();
  if (!wb.kanban) wb.kanban = [];
  const item = wb.kanban.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: '项目不存在' });

  // 检查执行中数量
  const doingCount = wb.kanban.filter(p => p.status === 'doing').length;
  if (item.status !== 'doing' && doingCount >= 5) {
    return res.status(400).json({ error: '执行中项目已达上限(5个)' });
  }

  // 打开Trae + 粘贴
  exec(`open -a "Trae CN" "${item.path}"`, (err) => {
    if (err) console.error('open trae error', err);
  });

  setTimeout(() => {
    const copy = exec('pbcopy');
    copy.stdin.write(item.prompt || '');
    copy.stdin.end();
    copy.on('exit', () => {
      exec(`osascript -e 'tell application "Trae CN" to activate' -e 'delay 1' -e 'tell application "System Events" to keystroke "v" using command down'`, (err) => {
        if (err) console.error('paste error', err);
      });
    });
  }, 2500);

  // 更新状态
  item.status = 'doing';
  if (!item.startedAt) item.startedAt = new Date().toISOString();
  writeWorkbench(wb);

  // 记录提示词日志
  const log = readPromptLog();
  log.push({
    id: 'log_' + Date.now(),
    projectName: item.name,
    projectId: item.id,
    prompt: item.prompt || '',
    docLink: item.docLink || '',
    time: new Date().toISOString()
  });
  // 保留最近200条
  if (log.length > 200) log.splice(0, log.length - 200);
  writePromptLog(log);

  res.json({ ok: true, item });
});

// ===== 豆包看板 API (独立存储,卡片含 doubaoUrl/summary) =====

// 打开豆包桌面 APP(不带 deep link,豆包不支持外部定位对话)
function openDoubaoApp() {
  exec('open -a "Doubao"', (err) => {
    if (err) console.error('open Doubao app error', err);
  });
}

// 获取豆包看板所有卡片
app.get('/api/workbench/kanban-doubao', (req, res) => {
  const wb = readWorkbench();
  if (!wb.doubaoKanban) wb.doubaoKanban = [];
  res.json(wb.doubaoKanban);
});

// 创建豆包卡片
app.post('/api/workbench/kanban-doubao', (req, res) => {
  const { name, description, doubaoUrl, summary, prompt } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '标题不能为空' });
  const wb = readWorkbench();
  if (!wb.doubaoKanban) wb.doubaoKanban = [];

  const item = {
    id: 'db_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name: name.trim(),
    description: (description || '').trim(),
    doubaoUrl: (doubaoUrl || '').trim(),
    summary: (summary || '').trim(),
    prompt: (prompt || '').trim(),
    status: 'idea',
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null
  };
  wb.doubaoKanban.push(item);
  writeWorkbench(wb);
  res.json(item);
});

// 更新豆包卡片(状态流转/编辑)
app.put('/api/workbench/kanban-doubao/:id', (req, res) => {
  const wb = readWorkbench();
  if (!wb.doubaoKanban) wb.doubaoKanban = [];
  const idx = wb.doubaoKanban.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '卡片不存在' });

  const item = wb.doubaoKanban[idx];
  const { status, prompt, doubaoUrl, summary, description, name } = req.body || {};

  // 执行中数量上限(豆包卡片通常不真正占用 Trae,但也限制避免泛滥)
  if (status === 'doing' && item.status !== 'doing') {
    const doingCount = wb.doubaoKanban.filter(p => p.status === 'doing').length;
    if (doingCount >= 5) {
      return res.status(400).json({ error: '执行中卡片已达上限(5个)' });
    }
  }

  if (name !== undefined) item.name = name.trim();
  if (description !== undefined) item.description = description.trim();
  if (doubaoUrl !== undefined) item.doubaoUrl = doubaoUrl.trim();
  if (summary !== undefined) item.summary = summary.trim();
  if (prompt !== undefined) item.prompt = prompt.trim();
  if (status && status !== item.status) {
    item.status = status;
    if (status === 'doing' && !item.startedAt) item.startedAt = new Date().toISOString();
    if (status === 'done') item.completedAt = new Date().toISOString();
  }

  wb.doubaoKanban[idx] = item;
  writeWorkbench(wb);
  res.json(item);
});

// 删除豆包卡片
app.delete('/api/workbench/kanban-doubao/:id', (req, res) => {
  const wb = readWorkbench();
  if (!wb.doubaoKanban) wb.doubaoKanban = [];
  const idx = wb.doubaoKanban.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '卡片不存在' });
  wb.doubaoKanban.splice(idx, 1);
  writeWorkbench(wb);
  res.json({ ok: true });
});

// 开始执行豆包卡片:打开豆包链接 + (若有 prompt)复制到剪贴板提示去 Trae 执行
app.post('/api/workbench/kanban-doubao/:id/start', (req, res) => {
  const wb = readWorkbench();
  if (!wb.doubaoKanban) wb.doubaoKanban = [];
  const item = wb.doubaoKanban.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: '卡片不存在' });

  // 检查执行中数量
  const doingCount = wb.doubaoKanban.filter(p => p.status === 'doing').length;
  if (item.status !== 'doing' && doingCount >= 5) {
    return res.status(400).json({ error: '执行中卡片已达上限(5个)' });
  }

  // 打开豆包桌面 APP
  openDoubaoApp();

  // 若有 Trae 提示词,复制到剪贴板(不自动打开 Trae,避免误触发;用户手动切换)
  if (item.prompt) {
    setTimeout(() => {
      const copy = exec('pbcopy');
      copy.stdin.write(item.prompt);
      copy.stdin.end();
    }, 500);
  }

  // 更新状态
  item.status = 'doing';
  if (!item.startedAt) item.startedAt = new Date().toISOString();
  writeWorkbench(wb);

  res.json({ ok: true, item });
});

// 仅打开豆包桌面 APP(不改状态,用于"在豆包打开"按钮)
app.post('/api/workbench/kanban-doubao/:id/open', (req, res) => {
  const wb = readWorkbench();
  if (!wb.doubaoKanban) wb.doubaoKanban = [];
  const item = wb.doubaoKanban.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: '卡片不存在' });
  openDoubaoApp();
  // 复制标题到剪贴板(供在 APP 内搜索对话)
  if (item.name) {
    setTimeout(() => {
      const copy = exec('pbcopy');
      copy.stdin.write(item.name);
      copy.stdin.end();
    }, 300);
  }
  res.json({ ok: true });
});

// ===== DeepSeek 看板 API =====

function openDeepSeekApp(chatLink) {
  if (chatLink && /^https?:\/\//i.test(chatLink)) {
    exec(`open "${chatLink}"`, (err) => { if (err) console.error('open deepseek link error', err); });
    return;
  }
  exec('open -a "DeepSeek"', (err) => {
    if (err) exec('open "https://chat.deepseek.com"', (e2) => { if (e2) console.error('open deepseek error', e2); });
  });
}

app.get('/api/workbench/kanban-deepseek', (req, res) => {
  const wb = readWorkbench();
  if (!wb.deepseekKanban) wb.deepseekKanban = [];
  res.json(wb.deepseekKanban);
});

app.post('/api/workbench/kanban-deepseek', (req, res) => {
  const { name, description, deepseekUrl, summary, prompt } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '标题不能为空' });
  const wb = readWorkbench();
  if (!wb.deepseekKanban) wb.deepseekKanban = [];

  const item = {
    id: 'ds_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name: name.trim(),
    description: (description || '').trim(),
    deepseekUrl: (deepseekUrl || '').trim(),
    summary: (summary || '').trim(),
    prompt: (prompt || '').trim(),
    status: 'idea',
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null
  };
  wb.deepseekKanban.push(item);
  writeWorkbench(wb);
  res.json(item);
});

app.put('/api/workbench/kanban-deepseek/:id', (req, res) => {
  const wb = readWorkbench();
  if (!wb.deepseekKanban) wb.deepseekKanban = [];
  const idx = wb.deepseekKanban.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '卡片不存在' });

  const item = wb.deepseekKanban[idx];
  const { status, prompt, deepseekUrl, summary, description, name } = req.body || {};

  if (status === 'doing' && item.status !== 'doing') {
    const doingCount = wb.deepseekKanban.filter(p => p.status === 'doing').length;
    if (doingCount >= 5) return res.status(400).json({ error: '执行中卡片已达上限(5个)' });
  }

  if (name !== undefined) item.name = name.trim();
  if (description !== undefined) item.description = description.trim();
  if (deepseekUrl !== undefined) item.deepseekUrl = deepseekUrl.trim();
  if (summary !== undefined) item.summary = summary.trim();
  if (prompt !== undefined) item.prompt = prompt.trim();
  if (status && status !== item.status) {
    item.status = status;
    if (status === 'doing' && !item.startedAt) item.startedAt = new Date().toISOString();
    if (status === 'done') item.completedAt = new Date().toISOString();
  }

  wb.deepseekKanban[idx] = item;
  writeWorkbench(wb);
  res.json(item);
});

app.delete('/api/workbench/kanban-deepseek/:id', (req, res) => {
  const wb = readWorkbench();
  if (!wb.deepseekKanban) wb.deepseekKanban = [];
  const idx = wb.deepseekKanban.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '卡片不存在' });
  wb.deepseekKanban.splice(idx, 1);
  writeWorkbench(wb);
  res.json({ ok: true });
});

app.post('/api/workbench/kanban-deepseek/:id/start', (req, res) => {
  const wb = readWorkbench();
  if (!wb.deepseekKanban) wb.deepseekKanban = [];
  const item = wb.deepseekKanban.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: '卡片不存在' });

  const doingCount = wb.deepseekKanban.filter(p => p.status === 'doing').length;
  if (item.status !== 'doing' && doingCount >= 5) {
    return res.status(400).json({ error: '执行中卡片已达上限(5个)' });
  }

  openDeepSeekApp(item.deepseekUrl);
  if (item.prompt) {
    setTimeout(() => {
      const copy = exec('pbcopy');
      copy.stdin.write(item.prompt);
      copy.stdin.end();
    }, 500);
  }

  item.status = 'doing';
  if (!item.startedAt) item.startedAt = new Date().toISOString();
  writeWorkbench(wb);
  res.json({ ok: true, item });
});

app.post('/api/workbench/kanban-deepseek/:id/open', (req, res) => {
  const wb = readWorkbench();
  if (!wb.deepseekKanban) wb.deepseekKanban = [];
  const item = wb.deepseekKanban.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: '卡片不存在' });
  openDeepSeekApp(item.deepseekUrl);
  if (item.name) {
    setTimeout(() => {
      const copy = exec('pbcopy');
      copy.stdin.write(item.name);
      copy.stdin.end();
    }, 300);
  }
  res.json({ ok: true });
});

// ===== Antigravity IDE 看板 API =====

function openAntigravityApp(projectPath) {
  if (projectPath) {
    exec(`open -a "Antigravity IDE" "${projectPath}"`, (err) => {
      if (err) console.error('open antigravity error', err);
    });
  } else {
    exec('open -a "Antigravity IDE"', (err) => {
      if (err) console.error('open antigravity error', err);
    });
  }
}

app.get('/api/workbench/kanban-antigravity', (req, res) => {
  const wb = readWorkbench();
  if (!wb.antigravityKanban) wb.antigravityKanban = [];
  // 同步清理：已删除目录的项目移除
  const before = wb.antigravityKanban.length;
  wb.antigravityKanban = wb.antigravityKanban.filter(item => {
    if (!item.path || item.dirCreated === false) return true;
    return fs.existsSync(item.path);
  });
  if (wb.antigravityKanban.length !== before) writeWorkbench(wb);
  res.json(wb.antigravityKanban);
});

app.post('/api/workbench/kanban-antigravity', (req, res) => {
  const { name, description, prompt, docLink } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '项目名称不能为空' });
  const wb = readWorkbench();
  if (!wb.antigravityKanban) wb.antigravityKanban = [];

  const projectName = name.trim();
  const projectPath = path.join(ANTIGRAVITY_DIR, projectName);

  if (wb.antigravityKanban.some(p => p.name === projectName)) {
    return res.status(400).json({ error: '已存在同名项目' });
  }

  let dirCreated = true;
  try {
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }
  } catch (e) {
    try {
      execSync(`mkdir -p "${projectPath}"`);
    } catch (e2) {
      dirCreated = false;
      console.warn('创建目录失败:', e2.message);
    }
  }

  const item = {
    id: 'ag_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name: projectName,
    description: (description || '').trim(),
    path: projectPath,
    status: 'idea',
    createdAt: new Date().toISOString(),
    prompt: (prompt || '').trim(),
    docLink: (docLink || '').trim(),
    startedAt: null,
    completedAt: null,
    dirCreated
  };
  wb.antigravityKanban.push(item);
  writeWorkbench(wb);
  res.json(item);
});

app.put('/api/workbench/kanban-antigravity/:id', (req, res) => {
  const wb = readWorkbench();
  if (!wb.antigravityKanban) wb.antigravityKanban = [];
  const idx = wb.antigravityKanban.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '项目不存在' });

  const item = wb.antigravityKanban[idx];
  const { status, prompt, docLink, description, name } = req.body || {};

  if (status === 'doing' && item.status !== 'doing') {
    const doingCount = wb.antigravityKanban.filter(p => p.status === 'doing').length;
    if (doingCount >= 5) {
      return res.status(400).json({ error: '执行中项目已达上限(5个)' });
    }
  }

  if (name !== undefined) item.name = name.trim();
  if (description !== undefined) item.description = description.trim();
  if (prompt !== undefined) item.prompt = prompt.trim();
  if (docLink !== undefined) item.docLink = docLink.trim();
  if (status && status !== item.status) {
    item.status = status;
    if (status === 'doing' && !item.startedAt) item.startedAt = new Date().toISOString();
    if (status === 'done') item.completedAt = new Date().toISOString();
  }

  wb.antigravityKanban[idx] = item;
  writeWorkbench(wb);
  res.json(item);
});

app.delete('/api/workbench/kanban-antigravity/:id', (req, res) => {
  const wb = readWorkbench();
  if (!wb.antigravityKanban) wb.antigravityKanban = [];
  const idx = wb.antigravityKanban.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '项目不存在' });
  wb.antigravityKanban.splice(idx, 1);
  writeWorkbench(wb);
  res.json({ ok: true });
});

app.post('/api/workbench/kanban-antigravity/:id/start', (req, res) => {
  const wb = readWorkbench();
  if (!wb.antigravityKanban) wb.antigravityKanban = [];
  const item = wb.antigravityKanban.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: '项目不存在' });

  const doingCount = wb.antigravityKanban.filter(p => p.status === 'doing').length;
  if (item.status !== 'doing' && doingCount >= 5) {
    return res.status(400).json({ error: '执行中项目已达上限(5个)' });
  }

  openAntigravityApp(item.path);

  if (item.prompt) {
    setTimeout(() => {
      const copy = exec('pbcopy');
      copy.stdin.write(item.prompt);
      copy.stdin.end();
      copy.on('exit', () => {
        exec(`osascript -e 'tell application "Antigravity IDE" to activate' -e 'delay 1' -e 'tell application "System Events" to keystroke "v" using command down'`, (err) => {
          if (err) console.error('paste error', err);
        });
      });
    }, 2500);
  }

  item.status = 'doing';
  if (!item.startedAt) item.startedAt = new Date().toISOString();
  writeWorkbench(wb);

  const log = readPromptLog();
  log.push({
    id: 'log_' + Date.now(),
    projectName: item.name,
    projectId: item.id,
    prompt: item.prompt || '',
    docLink: item.docLink || '',
    time: new Date().toISOString(),
    tool: 'antigravity'
  });
  if (log.length > 200) log.splice(0, log.length - 200);
  writePromptLog(log);

  res.json({ ok: true, item });
});

app.post('/api/workbench/kanban-antigravity/:id/open', (req, res) => {
  const wb = readWorkbench();
  if (!wb.antigravityKanban) wb.antigravityKanban = [];
  const item = wb.antigravityKanban.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: '项目不存在' });
  openAntigravityApp(item.path);
  res.json({ ok: true });
});

app.post('/api/workbench/kanban-antigravity/sync', (req, res) => {
  const wb = readWorkbench();
  if (!wb.antigravityKanban) wb.antigravityKanban = [];
  const existingPaths = new Set(wb.antigravityKanban.map(p => p.path));
  let added = 0;
  const addedNames = [];
  try {
    if (!fs.existsSync(ANTIGRAVITY_DIR)) return res.json({ added: 0, total: 0 });
    const entries = fs.readdirSync(ANTIGRAVITY_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(ANTIGRAVITY_DIR, entry.name);
      if (existingPaths.has(dirPath)) continue;
      const item = {
        id: 'ag_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name: entry.name,
        description: '',
        path: dirPath,
        status: 'done',
        createdAt: new Date().toISOString(),
        prompt: '',
        docLink: '',
        startedAt: null,
        completedAt: new Date().toISOString(),
        dirCreated: true
      };
      wb.antigravityKanban.push(item);
      addedNames.push(entry.name);
      added++;
    }
    if (added > 0) writeWorkbench(wb);
  } catch (e) {
    return res.status(500).json({ error: '扫描目录失败: ' + e.message });
  }
  res.json({ added, addedNames, total: wb.antigravityKanban.length });
});

app.post('/api/workbench/kanban-antigravity/:id/push-github', (req, res) => {
  const wb = readWorkbench();
  if (!wb.antigravityKanban) wb.antigravityKanban = [];
  const item = wb.antigravityKanban.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: '项目不存在' });
  try {
    const output = execSync(`cd "${item.path}" && git push origin main 2>&1`, { encoding: 'utf-8', timeout: 30000 });
    res.json({ success: true, output });
  } catch (e) {
    res.status(500).json({ error: (e.stderr || e.message || '').slice(0, 500) });
  }
});

// ===== VSCode 看板 API =====

function openVSCodeApp(projectPath) {
  if (projectPath) {
    exec(`open -a "Visual Studio Code" "${projectPath}"`, (err) => {
      if (err) console.error('open vscode error', err);
    });
  } else {
    exec('open -a "Visual Studio Code"', (err) => {
      if (err) console.error('open vscode error', err);
    });
  }
}

app.get('/api/workbench/kanban-vscode', (req, res) => {
  const wb = readWorkbench();
  if (!wb.vscodeKanban) wb.vscodeKanban = [];
  const before = wb.vscodeKanban.length;
  wb.vscodeKanban = wb.vscodeKanban.filter(item => {
    if (!item.path || item.dirCreated === false) return true;
    return fs.existsSync(item.path);
  });
  if (wb.vscodeKanban.length !== before) writeWorkbench(wb);
  res.json(wb.vscodeKanban);
});

app.post('/api/workbench/kanban-vscode', (req, res) => {
  const { name, description, prompt, docLink } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '项目名称不能为空' });
  const wb = readWorkbench();
  if (!wb.vscodeKanban) wb.vscodeKanban = [];

  const projectName = name.trim();
  const projectPath = path.join(VSCODE_DIR, projectName);

  if (wb.vscodeKanban.some(p => p.name === projectName)) {
    return res.status(400).json({ error: '已存在同名项目' });
  }

  let dirCreated = true;
  try {
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }
  } catch (e) {
    try {
      execSync(`mkdir -p "${projectPath}"`);
    } catch (e2) {
      dirCreated = false;
      console.warn('创建目录失败:', e2.message);
    }
  }

  const item = {
    id: 'vs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name: projectName,
    description: (description || '').trim(),
    path: projectPath,
    status: 'idea',
    createdAt: new Date().toISOString(),
    prompt: (prompt || '').trim(),
    docLink: (docLink || '').trim(),
    startedAt: null,
    completedAt: null,
    dirCreated
  };
  wb.vscodeKanban.push(item);
  writeWorkbench(wb);
  res.json(item);
});

app.put('/api/workbench/kanban-vscode/:id', (req, res) => {
  const wb = readWorkbench();
  if (!wb.vscodeKanban) wb.vscodeKanban = [];
  const idx = wb.vscodeKanban.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '项目不存在' });

  const item = wb.vscodeKanban[idx];
  const { status, prompt, docLink, description, name } = req.body || {};

  if (status === 'doing' && item.status !== 'doing') {
    const doingCount = wb.vscodeKanban.filter(p => p.status === 'doing').length;
    if (doingCount >= 5) {
      return res.status(400).json({ error: '执行中项目已达上限(5个)' });
    }
  }

  if (name !== undefined) item.name = name.trim();
  if (description !== undefined) item.description = description.trim();
  if (prompt !== undefined) item.prompt = prompt.trim();
  if (docLink !== undefined) item.docLink = docLink.trim();
  if (status && status !== item.status) {
    item.status = status;
    if (status === 'doing' && !item.startedAt) item.startedAt = new Date().toISOString();
    if (status === 'done') item.completedAt = new Date().toISOString();
  }

  wb.vscodeKanban[idx] = item;
  writeWorkbench(wb);
  res.json(item);
});

app.delete('/api/workbench/kanban-vscode/:id', (req, res) => {
  const wb = readWorkbench();
  if (!wb.vscodeKanban) wb.vscodeKanban = [];
  const idx = wb.vscodeKanban.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '项目不存在' });
  wb.vscodeKanban.splice(idx, 1);
  writeWorkbench(wb);
  res.json({ ok: true });
});

app.post('/api/workbench/kanban-vscode/:id/start', (req, res) => {
  const wb = readWorkbench();
  if (!wb.vscodeKanban) wb.vscodeKanban = [];
  const item = wb.vscodeKanban.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: '项目不存在' });

  const doingCount = wb.vscodeKanban.filter(p => p.status === 'doing').length;
  if (item.status !== 'doing' && doingCount >= 5) {
    return res.status(400).json({ error: '执行中项目已达上限(5个)' });
  }

  openVSCodeApp(item.path);

  if (item.prompt) {
    setTimeout(() => {
      const copy = exec('pbcopy');
      copy.stdin.write(item.prompt);
      copy.stdin.end();
      copy.on('exit', () => {
        exec(`osascript -e 'tell application "Visual Studio Code" to activate' -e 'delay 1' -e 'tell application "System Events" to keystroke "v" using command down'`, (err) => {
          if (err) console.error('paste error', err);
        });
      });
    }, 2500);
  }

  item.status = 'doing';
  if (!item.startedAt) item.startedAt = new Date().toISOString();
  writeWorkbench(wb);

  const log = readPromptLog();
  log.push({
    id: 'log_' + Date.now(),
    projectName: item.name,
    projectId: item.id,
    prompt: item.prompt || '',
    docLink: item.docLink || '',
    time: new Date().toISOString(),
    tool: 'vscode'
  });
  if (log.length > 200) log.splice(0, log.length - 200);
  writePromptLog(log);

  res.json({ ok: true, item });
});

app.post('/api/workbench/kanban-vscode/:id/open', (req, res) => {
  const wb = readWorkbench();
  if (!wb.vscodeKanban) wb.vscodeKanban = [];
  const item = wb.vscodeKanban.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: '项目不存在' });
  openVSCodeApp(item.path);
  res.json({ ok: true });
});

app.post('/api/workbench/kanban-vscode/sync', (req, res) => {
  const wb = readWorkbench();
  if (!wb.vscodeKanban) wb.vscodeKanban = [];
  const existingPaths = new Set(wb.vscodeKanban.map(p => p.path));
  let added = 0;
  const addedNames = [];
  try {
    if (!fs.existsSync(VSCODE_DIR)) return res.json({ added: 0, total: 0 });
    const entries = fs.readdirSync(VSCODE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(VSCODE_DIR, entry.name);
      if (existingPaths.has(dirPath)) continue;
      const item = {
        id: 'vs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name: entry.name,
        description: '',
        path: dirPath,
        status: 'done',
        createdAt: new Date().toISOString(),
        prompt: '',
        docLink: '',
        startedAt: null,
        completedAt: new Date().toISOString(),
        dirCreated: true
      };
      wb.vscodeKanban.push(item);
      addedNames.push(entry.name);
      added++;
    }
    if (added > 0) writeWorkbench(wb);
  } catch (e) {
    return res.status(500).json({ error: '扫描目录失败: ' + e.message });
  }
  res.json({ added, addedNames, total: wb.vscodeKanban.length });
});

app.post('/api/workbench/kanban-vscode/:id/push-github', (req, res) => {
  const wb = readWorkbench();
  if (!wb.vscodeKanban) wb.vscodeKanban = [];
  const item = wb.vscodeKanban.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: '项目不存在' });
  try {
    const output = execSync(`cd "${item.path}" && git push origin main 2>&1`, { encoding: 'utf-8', timeout: 30000 });
    res.json({ success: true, output });
  } catch (e) {
    res.status(500).json({ error: (e.stderr || e.message || '').slice(0, 500) });
  }
});

// ===== 项目详情 API (背景/市场分析/竞品分析/用户分析/商业模式/Specification) =====
const DETAIL_FIELDS = ['background', 'marketAnalysis', 'competitiveAnalysis', 'userAnalysis', 'businessModel', 'specification'];

const KANBAN_TYPES = {
  trae: { key: 'kanban', prefix: 'kb_' },
  doubao: { key: 'doubaoKanban', prefix: 'db_' },
  antigravity: { key: 'antigravityKanban', prefix: 'ag_' },
  vscode: { key: 'vscodeKanban', prefix: 'vs_' },
  deepseek: { key: 'deepseekKanban', prefix: 'ds_' }
};

app.get('/api/workbench/kanban-detail/:tool/:id', (req, res) => {
  const { tool, id } = req.params;
  const type = KANBAN_TYPES[tool];
  if (!type) return res.status(400).json({ error: '未知工具类型' });
  const wb = readWorkbench();
  const list = wb[type.key] || [];
  const item = list.find(p => p.id === id);
  if (!item) return res.status(404).json({ error: '项目不存在' });
  const detail = {};
  DETAIL_FIELDS.forEach(f => detail[f] = item[f] || '');
  res.json({ ...detail, name: item.name, status: item.status, tool });
});

app.put('/api/workbench/kanban-detail/:tool/:id', (req, res) => {
  const { tool, id } = req.params;
  const type = KANBAN_TYPES[tool];
  if (!type) return res.status(400).json({ error: '未知工具类型' });
  const wb = readWorkbench();
  const list = wb[type.key] || [];
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: '项目不存在' });
  const item = list[idx];
  const updates = req.body || {};
  let updated = false;
  DETAIL_FIELDS.forEach(f => {
    if (updates[f] !== undefined) {
      item[f] = updates[f];
      updated = true;
    }
  });
  if (updates.name !== undefined) { item.name = updates.name.trim(); updated = true; }
  if (updates.description !== undefined) { item.description = updates.description.trim(); updated = true; }
  if (updates.prompt !== undefined) { item.prompt = updates.prompt.trim(); updated = true; }
  if (updates.docLink !== undefined) { item.docLink = updates.docLink.trim(); updated = true; }
  if (updated) {
    list[idx] = item;
    writeWorkbench(wb);
  }
  res.json(item);
});

// 打开指定目录（用于 Antigravity / VSCode 等）
app.post('/api/workbench/open-dir', (req, res) => {
  const { dir } = req.body || {};
  if (!dir) return res.status(400).json({ error: '缺少目录参数' });
  try {
    const homeDir = os.homedir();
    const cleanDir = dir.replace('~/', homeDir + '/');
    exec(`open "${cleanDir}"`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '打开失败: ' + e.message });
  }
});

// 获取提示词日志
app.get('/api/workbench/prompt-log', (req, res) => {
  const log = readPromptLog();
  // 倒序返回（最新在前）
  res.json(log.reverse());
});

// ===== Backend reminder scanner (rings even when browser is closed/locked) =====
function dateKeyBackend(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let backendLastPlayTime = 0;
function scanAndRing() {
  const now = new Date();
  const dk = dateKeyBackend(now);
  let wb;
  try { wb = readWorkbench(); } catch { return; }
  if (!wb) return;

  let shouldRing = false;

  // Check today's tasks (start time / deadline reached, not yet handled)
  if (wb.plans && wb.plans[dk] && Array.isArray(wb.plans[dk].tasks)) {
    for (const task of wb.plans[dk].tasks) {
      if (task.done) continue;
      if (task.startTime && !task.started && !task.startNotified && new Date(task.startTime) <= now) {
        shouldRing = true; break;
      }
      if (task.deadline && !task.deadlineNotified && new Date(task.deadline) <= now) {
        shouldRing = true; break;
      }
    }
  }

  // Check standalone reminders (left sidebar)
  if (!shouldRing && Array.isArray(wb.reminders)) {
    for (const r of wb.reminders) {
      if (r.done) continue;
      if (r.time && new Date(r.time) <= now) { shouldRing = true; break; }
    }
  }

  // Ring at most every 10 seconds (continuous reminder effect)
  if (shouldRing && now.getTime() - backendLastPlayTime > 10000) {
    backendLastPlayTime = now.getTime();
    exec('afplay /System/Library/Sounds/Glass.aiff && afplay /System/Library/Sounds/Glass.aiff && afplay /System/Library/Sounds/Glass.aiff', (err) => {
      if (err) console.error('backend ring error', err);
    });
  }
}

setInterval(scanAndRing, 5000);

// ===== 认证 API =====

// 发送验证码（本地模拟，输出到控制台）
app.post('/api/auth/send-code', (req, res) => {
  const { phone } = req.body || {};
  if (!phone || !/^1\d{10}$/.test(phone)) {
    return res.status(400).json({ error: '请输入正确的手机号' });
  }
  // 生成 6 位验证码
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.storeVerifyCode(phone, code, 5); // 5 分钟有效
  // 本地模拟：输出到控制台，并在开发模式下返回给前端
  console.log(`\n📱 验证码 [${phone}]: ${code}\n`);
  res.json({ ok: true, code: code, message: '验证码已发送' });
});

// 验证码登录
app.post('/api/auth/login', (req, res) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: '手机号和验证码不能为空' });

  const stored = db.getVerifyCode(phone);
  if (!stored) return res.status(400).json({ error: '验证码不存在或已过期' });
  if (stored.code !== code) return res.status(400).json({ error: '验证码错误' });

  db.deleteVerifyCode(phone);

  // 查找或创建用户
  let user = db.getUserByPhone(phone);
  let isNewUser = false;
  if (!user) {
    // 新用户注册
    const userId = 'u_' + Date.now();
    db.createUser({ id: userId, phone, role: 'user', name: '', status: 'active' });
    db.createTenant({ id: 't_' + Date.now(), user_id: userId, name: '' });
    const tenant = db.getTenantByUserId(userId);
    db.updateUser(userId, { tenant_id: tenant.id });
    user = db.getUserById(userId);
    isNewUser = true;
  }

  if (user.status === 'disabled') {
    return res.status(403).json({ error: '账号已被禁用' });
  }

  // 创建会话
  const sessionId = 's_' + Date.now();
  db.createSession({ id: sessionId, user_id: user.id, login_at: new Date().toISOString() });

  // 更新最后登录时间
  db.updateUser(user.id, { last_login: new Date().toISOString() });

  // 生成 JWT
  const token = generateToken(user.id);
  // 移除敏感信息
  const { ...userSafe } = user;
  res.json({ token, user: userSafe, isNewUser, sessionId });
});

// 登出
app.post('/api/auth/logout', (req, res) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      // 查找用户最近的活跃会话并标记登出
      const sessions = db.getUserSessions(payload.userId);
      const activeSession = sessions.find(s => !s.logout_at);
      if (activeSession) {
        db.updateSessionLogout(activeSession.id);
      }
    }
  }
  res.json({ ok: true });
});

// 获取当前用户信息
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

// 更新当前用户信息（姓名等）
app.put('/api/auth/me', authMiddleware, (req, res) => {
  const { name, avatar } = req.body || {};
  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (avatar !== undefined) updates.avatar = avatar;
  db.updateUser(req.user.id, updates);
  const updated = db.getUserById(req.user.id);
  res.json(updated);
});

// ===== 平台管理 API（仅管理员） =====

// 获取所有用户（租户列表）
app.get('/api/platform/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.getAllUsers();
  // 附加租户信息
  const result = users.map(u => {
    const tenant = db.getTenantByUserId(u.id);
    return { ...u, tenant: tenant || null };
  });
  res.json(result);
});

// 更新用户（角色/状态）
app.put('/api/platform/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { role, status, name } = req.body || {};
  const updates = {};
  if (role !== undefined) updates.role = role;
  if (status !== undefined) updates.status = status;
  if (name !== undefined) updates.name = name.trim();
  db.updateUser(req.params.id, updates);
  const updated = db.getUserById(req.params.id);
  if (!updated) return res.status(404).json({ error: '用户不存在' });
  res.json(updated);
});

// 删除用户
app.delete('/api/platform/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'admin') return res.status(400).json({ error: '不能删除管理员账号' });
  db.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
  db.db.prepare('DELETE FROM tenants WHERE user_id = ?').run(req.params.id);
  db.db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 平台指标看板
app.get('/api/platform/metrics', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.getAllUsers();
  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.status === 'active').length;
  const adminCount = users.filter(u => u.role === 'admin').length;

  // 在线时长统计（所有会话总时长，秒）
  const sessions = db.db.prepare('SELECT * FROM sessions').all();
  const totalOnlineDuration = sessions.reduce((sum, s) => {
    if (s.logout_at) {
      return sum + (s.duration || 0);
    } else {
      // 仍在登录中，计算到当前
      return sum + Math.floor((Date.now() - new Date(s.login_at).getTime()) / 1000);
    }
  }, 0);

  // 今日活跃用户数
  const today = new Date().toISOString().slice(0, 10);
  const todayActive = users.filter(u => u.last_login && u.last_login.slice(0, 10) === today).length;

  // 项目数量（从 workbench.json 统计）
  let projectCount = 0;
  let skillsCount = 0;
  try {
    const wb = readWorkbench();
    projectCount += (wb.kanban || []).length;
    projectCount += (wb.antigravityKanban || []).length;
    projectCount += (wb.vscodeKanban || []).length;
    projectCount += (wb.doubaoKanban || []).length;
  } catch {}
  try {
    skillsCount = readJSON(SKILLS_FILE).length;
  } catch {}

  // 最近注册的用户
  const recentUsers = users
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  res.json({
    totalUsers,
    activeUsers,
    adminCount,
    todayActive,
    totalOnlineDuration,
    projectCount,
    skillsCount,
    recentUsers,
    sessions: sessions.length
  });
});

// 心跳接口（更新在线时长）
app.post('/api/auth/heartbeat', authMiddleware, (req, res) => {
  // 查找活跃会话并更新时长
  const sessions = db.getUserSessions(req.user.id);
  const active = sessions.find(s => !s.logout_at);
  if (active) {
    const duration = Math.floor((Date.now() - new Date(active.login_at).getTime()) / 1000);
    db.db.prepare('UPDATE sessions SET duration = ? WHERE id = ?').run(duration, active.id);
    // 更新用户总在线时长
    const newTotal = (req.user.online_duration || 0) + 30; // 每30秒心跳增加30秒
    db.updateUser(req.user.id, { online_duration: newTotal });
  }
  res.json({ ok: true });
});

// ==================== 资讯 RSS 模块 ====================
const Parser = require('rss-parser');
const rssParser = new Parser({
  timeout: 30000,
  maxRedirects: 5,
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36 GourdSprite/1.0' }
});

const NEWS_CACHE_FILE = path.join(CACHE_DIR, 'news.json');
const NEWS_REFRESH_INTERVAL = 30 * 60 * 1000; // 30分钟

const RSS_SOURCES = [
  // ===== 国内科技 =====
  { id: '36kr', name: '36氪', region: 'cn', category: '创投科技', url: 'https://rsshub.app/36kr/newsflashes' },
  { id: 'huxiu', name: '虎嗅', region: 'cn', category: '商业科技', url: 'https://rsshub.app/huxiu/article' },
  { id: 'sspai', name: '少数派', region: 'cn', category: '数字生活', url: 'https://sspai.com/feed' },
  { id: 'infoq-cn', name: 'InfoQ 中文', region: 'cn', category: '技术工程', url: 'https://www.infoq.cn/feed' },
  { id: 'ruanyifeng', name: '阮一峰的网络日志', region: 'cn', category: '科技周刊', url: 'https://www.ruanyifeng.com/blog/atom.xml' },
  { id: 'v2ex', name: 'V2EX', region: 'cn', category: '社区热帖', url: 'https://www.v2ex.com/index.xml' },
  { id: 'juejin', name: '稀土掘金', region: 'cn', category: '开发者', url: 'https://rsshub.app/juejin/trending/0' },
  { id: 'segmentfault', name: '思否', region: 'cn', category: '开发者', url: 'https://segmentfault.com/feeds' },
  { id: 'ithome', name: 'IT之家', region: 'cn', category: '数码科技', url: 'https://www.ithome.com/rss/' },
  { id: 'coolshell', name: '酷壳 CoolShell', region: 'cn', category: '技术深度', url: 'https://coolshell.cn/feed' },
  // ===== 国外科技 =====
  { id: 'hackernews', name: 'Hacker News', region: 'en', category: '技术社区', url: 'https://hnrss.org/frontpage' },
  { id: 'techcrunch', name: 'TechCrunch', region: 'en', category: '创投科技', url: 'https://techcrunch.com/feed/' },
  { id: 'theverge', name: 'The Verge', region: 'en', category: '消费电子', url: 'https://www.theverge.com/rss/index.xml' },
  { id: 'arstechnica', name: 'Ars Technica', region: 'en', category: '深度科技', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { id: 'devto', name: 'Dev.to', region: 'en', category: '开发者社区', url: 'https://dev.to/feed' },
  { id: 'github-blog', name: 'GitHub Blog', region: 'en', category: '平台动态', url: 'https://github.blog/feed/' },
  { id: 'smashing', name: 'Smashing Magazine', region: 'en', category: '设计前端', url: 'https://www.smashingmagazine.com/feed/' },
  { id: 'slashdot', name: 'Slashdot', region: 'en', category: '极客科技', url: 'https://rss.slashdot.org/Slashdot/slashdotMain' },
  { id: 'venturebeat', name: 'VentureBeat', region: 'en', category: 'AI/创投', url: 'https://venturebeat.com/feed/' },
];

let newsCache = { items: [], lastRefresh: 0, sources: [] };

function readNewsCache() {
  try {
    if (fs.existsSync(NEWS_CACHE_FILE)) {
      newsCache = JSON.parse(fs.readFileSync(NEWS_CACHE_FILE, 'utf-8'));
    }
  } catch (e) { console.warn('读取资讯缓存失败:', e.message); }
}

function writeNewsCache() {
  try { fs.writeFileSync(NEWS_CACHE_FILE, JSON.stringify(newsCache, null, 2)); }
  catch (e) { console.warn('写入资讯缓存失败:', e.message); }
}

function normalizeItem(source, raw) {
  const pubDate = raw.isoDate || raw.pubDate || raw.date || Date.now();
  const publishedAt = new Date(pubDate).getTime();
  const title = (raw.title || '').trim();
  const link = raw.link || raw.guid || '';
  let content = raw.contentSnippet || raw.summary || raw.content || '';
  if (typeof content === 'string') content = content.replace(/<[^>]+>/g, '').trim().slice(0, 500);
  const id = `${source.id}:${Buffer.from(link || title).toString('base64').slice(0, 32)}`;
  return {
    id,
    title,
    link,
    summary: content,
    sourceId: source.id,
    sourceName: source.name,
    region: source.region,
    category: source.category,
    author: raw.creator || raw.author || raw['dc:creator'] || '',
    publishedAt: isNaN(publishedAt) ? Date.now() : publishedAt,
    publishedAtStr: new Date(isNaN(publishedAt) ? Date.now() : publishedAt).toISOString(),
    hotScore: 0,
  };
}

async function fetchSourceRaw(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36 GourdSprite/1.0',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        timeout: timeoutMs,
      }, (res) => {
        clearTimeout(timer);
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // follow one redirect manually
          fetchSourceRaw(new URL(res.headers.location, url).toString(), timeoutMs).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', (e) => { clearTimeout(timer); reject(e); });
      req.on('timeout', () => { req.destroy(); clearTimeout(timer); reject(new Error('Request timed out')); });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

function cleanXmlBody(xml) {
  if (!xml || typeof xml !== 'string') return xml;
  // Replace lone & (not part of &entity; pattern) with &amp; inside attribute values
  // Handle common issue: attributes with unescaped & like href="foo?a=1&b=2"
  return xml
    .replace(/&(?!(#[0-9]{1,6}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,20});)/g, '&amp;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

async function fetchSource(source) {
  try {
    const raw = await fetchSourceRaw(source.url);
    const cleaned = cleanXmlBody(raw);
    const feed = await rssParser.parseString(cleaned);
    const items = (feed.items || []).map(it => normalizeItem(source, it));
    source.lastFetch = Date.now();
    source.lastError = null;
    return { source, items, error: null };
  } catch (e) {
    source.lastFetch = Date.now();
    source.lastError = e.message;
    console.warn(`[RSS] ${source.name} 拉取失败: ${e.message}`);
    return { source, items: [], error: e.message };
  }
}

async function refreshNews(force = false) {
  const now = Date.now();
  if (!force && now - newsCache.lastRefresh < NEWS_REFRESH_INTERVAL && newsCache.items.length > 0) {
    return newsCache;
  }
  console.log(`[资讯] 开始刷新 ${RSS_SOURCES.length} 个 RSS 源...`);
  // 限流并发（最多同时请求 5 个源），避免网络拥堵导致超时
  const results = [];
  const concurrency = 5;
  for (let i = 0; i < RSS_SOURCES.length; i += concurrency) {
    const batch = RSS_SOURCES.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(s => fetchSource(s)));
    results.push(...batchResults);
  }
  let allItems = [];
  const sourceStatus = results.map(r => ({
    id: r.source.id, name: r.source.name, region: r.source.region,
    category: r.source.category, count: r.items.length, error: r.error, lastFetch: r.source.lastFetch
  }));
  results.forEach(r => { allItems = allItems.concat(r.items); });
  // 去重（按 link 或 title+source）
  const seen = new Set();
  allItems = allItems.filter(it => {
    if (!it.title && !it.link) return false;
    const key = it.link ? `l:${it.link}` : `t:${it.sourceId}:${it.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // 计算热度分（发布时间 + 源权重简单估算）
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const sourceWeight = { v2ex: 3, hackernews: 5, '36kr': 2, techcrunch: 2 };
  allItems.forEach(it => {
    const age = Math.max(1, (now - it.publishedAt));
    const recency = 1 - Math.min(1, age / weekMs);
    const weight = sourceWeight[it.sourceId] || 1;
    it.hotScore = Math.round((recency * 100 + Math.random() * 5) * weight);
  });
  // 按时间排序，更新缓存
  allItems.sort((a, b) => b.publishedAt - a.publishedAt);
  newsCache = {
    items: allItems,
    lastRefresh: now,
    sources: sourceStatus,
  };
  writeNewsCache();
  console.log(`[资讯] 刷新完成，共 ${allItems.length} 条资讯（来自 ${sourceStatus.filter(s => !s.error).length}/${RSS_SOURCES.length} 个源）`);
  return newsCache;
}

readNewsCache();
refreshNews(); // 启动时立即刷新一次
setInterval(() => refreshNews(), NEWS_REFRESH_INTERVAL); // 定时刷新

app.get('/api/news', (req, res) => {
  const {
    region = 'all',     // all | cn | en
    sort = 'latest',    // latest | hot
    sourceId,           // 按具体源过滤
    category,           // 按分类过滤
    limit = 50,
    offset = 0,
  } = req.query;

  let items = newsCache.items.slice();
  if (region === 'cn') items = items.filter(i => i.region === 'cn');
  else if (region === 'en') items = items.filter(i => i.region === 'en');
  if (sourceId) items = items.filter(i => i.sourceId === sourceId);
  if (category) items = items.filter(i => i.category === category);
  if (sort === 'hot') items.sort((a, b) => b.hotScore - a.hotScore || b.publishedAt - a.publishedAt);

  const total = items.length;
  const data = items.slice(Number(offset), Number(offset) + Number(limit));
  res.json({
    total,
    limit: Number(limit),
    offset: Number(offset),
    sort,
    region,
    lastRefresh: newsCache.lastRefresh,
    items: data,
  });
});

// 国内 AI 科技资讯: 从已抓取的国内源中按 AI 关键词过滤排序
const AI_KEYWORDS = [
  'AI', '人工智能', '大模型', '机器学习', '深度学习', 'GPT', 'LLM', 'AGI',
  '文心', '通义', '豆包', '智谱', 'Kimi', 'DeepSeek', 'Claude', 'ChatGPT',
  '生成式', 'AIGC', '多模态', '智能体', 'Agent', '机器人', '自动驾驶',
  '芯片', '算力', 'NVIDIA', '英伟达', 'OpenAI', 'Anthropic', 'Gemini',
  '神经网络', 'Transformer', '强化学习', '视觉模型', 'Sora', 'Copilot',
];

function isAiRelevant(item) {
  const text = `${item.title || ''} ${item.summary || ''}`;
  return AI_KEYWORDS.some(k => text.toLowerCase().includes(k.toLowerCase()));
}

app.get('/api/news/ai-cn', (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  // 国内源 + AI 相关
  let items = newsCache.items.filter(i => i.region === 'cn' && isAiRelevant(i));
  items.sort((a, b) => b.publishedAt - a.publishedAt);
  const total = items.length;
  // 关联源状态(仅国内源)
  const cnStatus = (newsCache.sources || []).filter(s => s.region === 'cn');
  res.json({
    total,
    limit: Number(limit),
    offset: Number(offset),
    lastRefresh: newsCache.lastRefresh,
    keywords: AI_KEYWORDS.length,
    sources: cnStatus,
    items: items.slice(Number(offset), Number(offset) + Number(limit)),
  });
});

app.get('/api/news/sources', (req, res) => {
  res.json({ sources: newsCache.sources, lastRefresh: newsCache.lastRefresh });
});

app.post('/api/news/refresh', async (req, res) => {
  const cache = await refreshNews(true);
  res.json({ ok: true, total: cache.items.length, lastRefresh: cache.lastRefresh });
});

// ==================== 国内 AI 资讯（单一来源 IT之家 每日抓取） ====================
const ITOME_DIR = path.join(DATA_DIR, 'ithome-ai');
const ITOME_INDEX = path.join(ITOME_DIR, 'index.json');
const ITOME_TOP_N = 20;
const ITOME_FEED_URL = 'https://www.ithome.com/rss/';

function ensureItomeDir() {
  if (!fs.existsSync(ITOME_DIR)) fs.mkdirSync(ITOME_DIR, { recursive: true });
  if (!fs.existsSync(ITOME_INDEX)) fs.writeFileSync(ITOME_INDEX, '[]');
}

function readItomeIndex() {
  try { return readJSON(ITOME_INDEX); } catch { return []; }
}

// 每日抓取: IT之家 feed → AI 关键词过滤 → 取前 20 条 → 按日期沉淀
async function captureItomeDaily(force = false) {
  ensureItomeDir();
  const date = dateStrOf(new Date());
  const file = path.join(ITOME_DIR, `${date}.json`);
  if (fs.existsSync(file) && !force) {
    console.log('[IT之家] 今日已抓取，跳过（如需强制请用 force）');
    return readJSON(file);
  }
  console.log(`[IT之家] 开始抓取 ${date} AI 相关热门 ${ITOME_TOP_N} 条...`);
  const source = { id: 'ithome', name: 'IT之家', region: 'cn', category: '数码科技', url: ITOME_FEED_URL };
  const { items } = await fetchSource(source);
  const aiItems = items
    .filter(it => isAiRelevant(it))
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, ITOME_TOP_N)
    .map((it, i) => ({ rank: i + 1, ...it }));

  const payload = {
    date,
    capturedAt: new Date().toISOString(),
    count: aiItems.length,
    totalFeed: items.length,
    items: aiItems,
  };
  writeJSON(file, payload);

  // 更新索引(按日期倒序)
  let index = readItomeIndex().filter(x => x.date !== date);
  index.unshift({ date, count: aiItems.length, capturedAt: payload.capturedAt });
  index.sort((a, b) => b.date.localeCompare(a.date));
  writeJSON(ITOME_INDEX, index);
  console.log(`[IT之家] 抓取完成，feed ${items.length} 条 → AI 过滤 ${aiItems.length} 条，已沉淀至 ${file}`);
  return payload;
}

// 每日 08:00 定时任务
function scheduleItomeDailyCapture() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  console.log(`[IT之家] 下次定时抓取: ${next.toLocaleString('zh-CN')}`);
  setTimeout(() => {
    captureItomeDaily().catch(e => console.error('[IT之家] 定时抓取失败:', e.message));
    setInterval(() => {
      captureItomeDaily().catch(e => console.error('[IT之家] 定时抓取失败:', e.message));
    }, 24 * 60 * 60 * 1000);
  }, delay);
}

ensureItomeDir();
// 启动时: 如果一条历史数据都没有，先抓一次保证页面可用
if (readItomeIndex().length === 0) {
  captureItomeDaily().catch(e => console.error('[IT之家] 首次抓取失败:', e.message));
}
scheduleItomeDailyCapture();

// 日期列表(左侧导航)
app.get('/api/news/itome', (req, res) => {
  res.json({ dates: readItomeIndex() });
});

// 最新一天
app.get('/api/news/itome/latest', (req, res) => {
  const index = readItomeIndex();
  if (index.length === 0) return res.status(404).json({ error: '暂无数据' });
  const date = index[0].date;
  const file = path.join(ITOME_DIR, `${date}.json`);
  try { res.json(readJSON(file)); } catch { res.status(404).json({ error: '数据文件缺失' }); }
});

// 指定日期
app.get('/api/news/itome/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  const file = path.join(ITOME_DIR, `${date}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '该日期无数据' });
  res.json(readJSON(file));
});

// 手动立即抓取(强制覆盖今日)
app.post('/api/news/itome/refresh', async (req, res) => {
  try {
    const payload = await captureItomeDaily(true);
    res.json({ ok: true, date: payload.date, count: payload.count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 国内 AI 资讯 模块 结束 ====================

// ==================== 虎嗅 前沿科技资讯 模块（科技频道API+RSS摘要, 每日08:00抓最新20条, 按日期沉淀） ====================
const HUXIU_DIR = path.join(DATA_DIR, 'huxiu-news');
const HUXIU_INDEX = path.join(HUXIU_DIR, 'index.json');
const HUXIU_TOP_N = 20;
const HUXIU_FEED_URL = 'https://rss.huxiu.com/';
// 虎嗅「前沿科技」频道（channel_id=105），只抓科技频道文章
const HUXIU_CHANNEL_API = 'https://api-article.huxiu.com/web/channel/articleList?platform=www&web_app=web_huxiu&channel_id=105&pagesize=30';

function ensureHuxiuDir() {
  if (!fs.existsSync(HUXIU_DIR)) fs.mkdirSync(HUXIU_DIR, { recursive: true });
  if (!fs.existsSync(HUXIU_INDEX)) fs.writeFileSync(HUXIU_INDEX, '[]');
}

function readHuxiuIndex() {
  try { return readJSON(HUXIU_INDEX); } catch { return []; }
}

// 循环剥离虎嗅正文模板前缀: "本文来自微信公众号：xxx，制图/编辑/作者/原文标题：xxx，《xxx》"
const cleanHuxiuSummary = (s) => {
  s = (s || '').trim();
  const prefixRe = /^(本文来自[^，]*|原文标题[：:]\s*《[^》]*》|原文标题[：:][^，]*|制图[：:][^，]*|编辑[：:][^，]*|作者[：:][^，]*|《[^》]*》)([，,]\s*)?/;
  let prev;
  do { prev = s; s = s.replace(prefixRe, '').trim(); } while (s !== prev);
  return s;
};

// 每日抓取: 虎嗅「前沿科技」频道 API → 最新 20 条 → 按日期沉淀
// 正文摘要频道 API 大多为空, 从官方 RSS 按文章 aid 匹配补齐
async function captureHuxiuDaily(force = false) {
  ensureHuxiuDir();
  const date = dateStrOf(new Date());
  const file = path.join(HUXIU_DIR, `${date}.json`);
  if (fs.existsSync(file) && !force) {
    console.log('[虎嗅] 今日已抓取，跳过（如需强制请用 force）');
    return readJSON(file);
  }
  console.log(`[虎嗅] 开始抓取 ${date} 前沿科技频道最新 ${HUXIU_TOP_N} 条...`);

  // 1. 科技频道文章列表（aid/标题/时间/作者）
  let channelItems = [];
  try {
    const raw = await fetchSourceRaw(HUXIU_CHANNEL_API);
    const json = JSON.parse(raw);
    channelItems = (json && json.data && json.data.datalist) || [];
  } catch (e) {
    console.warn('[虎嗅] 频道 API 抓取失败:', e.message);
  }
  if (channelItems.length === 0) throw new Error('虎嗅科技频道抓取失败（接口无数据）');

  // 2. RSS 摘要字典: aid → 清洗后 summary
  const source = { id: 'huxiu', name: '虎嗅', region: 'cn', category: '前沿科技', url: HUXIU_FEED_URL };
  const { items: rssItems } = await fetchSource(source);
  const summaryByAid = {};
  for (const it of rssItems) {
    const m = /\/article\/(\d+)\.html/.exec(it.link || '');
    if (m) summaryByAid[m[1]] = cleanHuxiuSummary(it.summary);
  }

  // 3. 合并: 频道字段 + RSS 摘要兜底, 按发布时间倒序取前 20
  const newsItems = channelItems
    .sort((a, b) => (b.dateline || 0) - (a.dateline || 0))
    .slice(0, HUXIU_TOP_N)
    .map((it, i) => {
      const ts = (Number(it.dateline) || Math.floor(Date.now() / 1000)) * 1000;
      const rssSummary = summaryByAid[it.aid] || '';
      const summary = cleanHuxiuSummary(it.summary) || rssSummary;
      return {
        rank: i + 1,
        id: `huxiu:${it.aid}`,
        title: (it.title || '').trim(),
        link: it.url || `https://www.huxiu.com/article/${it.aid}.html`,
        summary: summary.slice(0, 500),
        sourceId: 'huxiu',
        sourceName: '虎嗅',
        region: 'cn',
        category: '前沿科技',
        author: (it.user_info && it.user_info.username) || '',
        publishedAt: ts,
        publishedAtStr: new Date(ts).toISOString(),
        hotScore: 0,
      };
    });

  const payload = {
    date,
    capturedAt: new Date().toISOString(),
    count: newsItems.length,
    totalFeed: channelItems.length,
    items: newsItems,
  };
  writeJSON(file, payload);

  let index = readHuxiuIndex().filter(x => x.date !== date);
  index.unshift({ date, count: newsItems.length, capturedAt: payload.capturedAt });
  index.sort((a, b) => b.date.localeCompare(a.date));
  writeJSON(HUXIU_INDEX, index);
  console.log(`[虎嗅] 抓取完成，频道 ${channelItems.length} 条 → 沉淀 ${newsItems.length} 条，已存至 ${file}`);
  return payload;
}

// 每日 08:00 定时任务
function scheduleHuxiuDailyCapture() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  console.log(`[虎嗅] 下次定时抓取: ${next.toLocaleString('zh-CN')}`);
  setTimeout(() => {
    captureHuxiuDaily().catch(e => console.error('[虎嗅] 定时抓取失败:', e.message));
    setInterval(() => {
      captureHuxiuDaily().catch(e => console.error('[虎嗅] 定时抓取失败:', e.message));
    }, 24 * 60 * 60 * 1000);
  }, delay);
}

ensureHuxiuDir();
if (readHuxiuIndex().length === 0) {
  captureHuxiuDaily().catch(e => console.error('[虎嗅] 首次抓取失败:', e.message));
}
scheduleHuxiuDailyCapture();

// 日期列表(左侧导航)
app.get('/api/news/huxiu', (req, res) => {
  res.json({ dates: readHuxiuIndex() });
});

// 最新一天
app.get('/api/news/huxiu/latest', (req, res) => {
  const index = readHuxiuIndex();
  if (index.length === 0) return res.status(404).json({ error: '暂无数据' });
  const date = index[0].date;
  const file = path.join(HUXIU_DIR, `${date}.json`);
  try { res.json(readJSON(file)); } catch { res.status(404).json({ error: '数据文件缺失' }); }
});

// 指定日期
app.get('/api/news/huxiu/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  const file = path.join(HUXIU_DIR, `${date}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '该日期无数据' });
  res.json(readJSON(file));
});

// 手动立即抓取(强制覆盖今日)
app.post('/api/news/huxiu/refresh', async (req, res) => {
  try {
    const payload = await captureHuxiuDaily(true);
    res.json({ ok: true, date: payload.date, count: payload.count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 虎嗅 模块 结束 ====================

// ==================== 海外 AI 资讯 模块（TechCrunch AI 官方RSS, 每日08:00抓最新20条, 按日期沉淀） ====================
const TCAI_DIR = path.join(DATA_DIR, 'techcrunch-ai');
const TCAI_INDEX = path.join(TCAI_DIR, 'index.json');
const TCAI_TOP_N = 20;
const TCAI_FEED_URL = 'https://techcrunch.com/category/artificial-intelligence/feed/';

function ensureTcAiDir() {
  if (!fs.existsSync(TCAI_DIR)) fs.mkdirSync(TCAI_DIR, { recursive: true });
  if (!fs.existsSync(TCAI_INDEX)) fs.writeFileSync(TCAI_INDEX, '[]');
}

function readTcAiIndex() {
  try { return readJSON(TCAI_INDEX); } catch { return []; }
}

// 每日抓取: TechCrunch AI feed → 最新 20 条 → 按日期沉淀
async function captureTcAiDaily(force = false) {
  ensureTcAiDir();
  const date = dateStrOf(new Date());
  const file = path.join(TCAI_DIR, `${date}.json`);
  if (fs.existsSync(file) && !force) {
    console.log('[TechCrunch] 今日已抓取，跳过（如需强制请用 force）');
    return readJSON(file);
  }
  console.log(`[TechCrunch] 开始抓取 ${date} 最新 ${TCAI_TOP_N} 条...`);
  const source = { id: 'techcrunch', name: 'TechCrunch', region: 'us', category: 'AI资讯', url: TCAI_FEED_URL };
  const { items } = await fetchSource(source);
  const newsItems = items
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, TCAI_TOP_N)
    .map((it, i) => ({
      rank: i + 1,
      ...it,
      // 清理正文 HTML 标签与多余空白, 摘要截断
      summary: (it.summary || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200),
    }));

  const payload = {
    date,
    capturedAt: new Date().toISOString(),
    count: newsItems.length,
    totalFeed: items.length,
    items: newsItems,
  };
  writeJSON(file, payload);

  let index = readTcAiIndex().filter(x => x.date !== date);
  index.unshift({ date, count: newsItems.length, capturedAt: payload.capturedAt });
  index.sort((a, b) => b.date.localeCompare(a.date));
  writeJSON(TCAI_INDEX, index);
  console.log(`[TechCrunch] 抓取完成，feed ${items.length} 条 → 沉淀 ${newsItems.length} 条，已存至 ${file}`);
  return payload;
}

// 每日 08:00 定时任务
function scheduleTcAiDailyCapture() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  console.log(`[TechCrunch] 下次定时抓取: ${next.toLocaleString('zh-CN')}`);
  setTimeout(() => {
    captureTcAiDaily().catch(e => console.error('[TechCrunch] 定时抓取失败:', e.message));
    setInterval(() => {
      captureTcAiDaily().catch(e => console.error('[TechCrunch] 定时抓取失败:', e.message));
    }, 24 * 60 * 60 * 1000);
  }, delay);
}

ensureTcAiDir();
if (readTcAiIndex().length === 0) {
  captureTcAiDaily().catch(e => console.error('[TechCrunch] 首次抓取失败:', e.message));
}
scheduleTcAiDailyCapture();

// 日期列表(左侧导航)
app.get('/api/news/tcai', (req, res) => {
  res.json({ dates: readTcAiIndex() });
});

// 最新一天
app.get('/api/news/tcai/latest', (req, res) => {
  const index = readTcAiIndex();
  if (index.length === 0) return res.status(404).json({ error: '暂无数据' });
  const date = index[0].date;
  const file = path.join(TCAI_DIR, `${date}.json`);
  try { res.json(readJSON(file)); } catch { res.status(404).json({ error: '数据文件缺失' }); }
});

// 指定日期
app.get('/api/news/tcai/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  const file = path.join(TCAI_DIR, `${date}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '该日期无数据' });
  res.json(readJSON(file));
});

// 手动立即抓取(强制覆盖今日)
app.post('/api/news/tcai/refresh', async (req, res) => {
  try {
    const payload = await captureTcAiDaily(true);
    res.json({ ok: true, date: payload.date, count: payload.count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 海外 AI 资讯 模块 结束 ====================

// ==================== Ars Technica 模块（官方RSS, 每日08:00抓最新20条, 按日期沉淀） ====================
const ARS_DIR = path.join(DATA_DIR, 'ars-technica');
const ARS_INDEX = path.join(ARS_DIR, 'index.json');
const ARS_TOP_N = 20;
const ARS_FEED_URL = 'https://arstechnica.com/feed/';

function ensureArsDir() {
  if (!fs.existsSync(ARS_DIR)) fs.mkdirSync(ARS_DIR, { recursive: true });
  if (!fs.existsSync(ARS_INDEX)) fs.writeFileSync(ARS_INDEX, '[]');
}

function readArsIndex() {
  try { return readJSON(ARS_INDEX); } catch { return []; }
}

async function captureArsDaily(force = false) {
  ensureArsDir();
  const date = dateStrOf(new Date());
  const file = path.join(ARS_DIR, `${date}.json`);
  if (fs.existsSync(file) && !force) {
    console.log('[Ars] 今日已抓取，跳过（如需强制请用 force）');
    return readJSON(file);
  }
  console.log(`[Ars] 开始抓取 ${date} 最新 ${ARS_TOP_N} 条...`);
  const source = { id: 'arstechnica', name: 'Ars Technica', region: 'us', category: '科技深度', url: ARS_FEED_URL };
  const { items } = await fetchSource(source);
  const newsItems = items
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, ARS_TOP_N)
    .map((it, i) => ({
      rank: i + 1,
      ...it,
      summary: (it.summary || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200),
    }));

  const payload = { date, capturedAt: new Date().toISOString(), count: newsItems.length, totalFeed: items.length, items: newsItems };
  writeJSON(file, payload);

  let index = readArsIndex().filter(x => x.date !== date);
  index.unshift({ date, count: newsItems.length, capturedAt: payload.capturedAt });
  index.sort((a, b) => b.date.localeCompare(a.date));
  writeJSON(ARS_INDEX, index);
  console.log(`[Ars] 抓取完成，feed ${items.length} 条 → 沉淀 ${newsItems.length} 条，已存至 ${file}`);
  return payload;
}

function scheduleArsDailyCapture() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  console.log(`[Ars] 下次定时抓取: ${next.toLocaleString('zh-CN')}`);
  setTimeout(() => {
    captureArsDaily().catch(e => console.error('[Ars] 定时抓取失败:', e.message));
    setInterval(() => {
      captureArsDaily().catch(e => console.error('[Ars] 定时抓取失败:', e.message));
    }, 24 * 60 * 60 * 1000);
  }, delay);
}

ensureArsDir();
if (readArsIndex().length === 0) {
  captureArsDaily().catch(e => console.error('[Ars] 首次抓取失败:', e.message));
}
scheduleArsDailyCapture();

app.get('/api/news/ars', (req, res) => {
  res.json({ dates: readArsIndex() });
});

app.get('/api/news/ars/latest', (req, res) => {
  const index = readArsIndex();
  if (index.length === 0) return res.status(404).json({ error: '暂无数据' });
  const date = index[0].date;
  const file = path.join(ARS_DIR, `${date}.json`);
  try { res.json(readJSON(file)); } catch { res.status(404).json({ error: '数据文件缺失' }); }
});

app.get('/api/news/ars/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  const file = path.join(ARS_DIR, `${date}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '该日期无数据' });
  res.json(readJSON(file));
});

app.post('/api/news/ars/refresh', async (req, res) => {
  try {
    const payload = await captureArsDaily(true);
    res.json({ ok: true, date: payload.date, count: payload.count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== Ars Technica 模块 结束 ====================

// ==================== B站 AI 科技视频 模块（每日08:00抓科技分区热门20条，按日期沉淀） ====================
const BILI_DIR = path.join(DATA_DIR, 'bilibili-tech');
const BILI_INDEX = path.join(BILI_DIR, 'index.json');
const BILI_TOP_N = 20;
const BILI_FETCH_TIMEOUT = 20000;
// 科技分区(rid=188 科技)热门榜
const BILI_RANK_URL = 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=188&type=all';
// 近7天(秒) - 搜索接口发布时间窗口
const BILI_RECENT_DAYS = 7;

function ensureBiliDir() {
  if (!fs.existsSync(BILI_DIR)) fs.mkdirSync(BILI_DIR, { recursive: true });
  if (!fs.existsSync(BILI_INDEX)) fs.writeFileSync(BILI_INDEX, '[]');
}

function readBiliIndex() {
  try { return readJSON(BILI_INDEX); } catch { return []; }
}

function biliGetCookie() {
  // 用户配置的 bilibili 登录 Cookie(浏览器复制), 为空则匿名(匿名关键词搜索已可用)
  return (readConfig().biliCookie || '').trim();
}

// ---------- bilibili 搜索抓取: 近7天 + AI科技分区 + 关键词配额 ----------
// 纯 AI 关键词(不含消费电子词), 匿名可用无需登录/WBI签名
const BILI_SEARCH_KEYWORDS = ['AI', '大模型', 'DeepSeek', 'AI工具', 'Agent', 'OpenAI', '人工智能', '机器学习', 'Claude', 'GPT'];
const BILI_SEARCH_PAGE = 30;
const BILI_QUOTA_PER_KW = 3; // 每个关键词最多贡献几条, 防止单一爆款霸榜
// AI 科技向分区白名单(剔除数码/电脑装机/手机平板等消费电子分区)
const BILI_TECH_TYPES = new Set([
  '计算机技术', '软件应用', '科学科普', '人工智能', '知识', '校园学习', '职业职场', '野生技能协会',
]);

// 单关键词搜索: 近7天 + 按播放量(order=click)排序, 返回原始搜索项
async function biliSearchByKeyword(keyword, withinDays = BILI_RECENT_DAYS) {
  const end = Math.round(Date.now() / 1000);
  const begin = end - withinDays * 86400;
  const qs = new URLSearchParams({
    keyword,
    search_type: 'video',
    order: 'click',
    pubtime_begin_s: String(begin),
    pubtime_end_s: String(end),
    page: '1',
    page_size: String(BILI_SEARCH_PAGE),
    platform: 'pc',
    web_location: '1550101',
  }).toString();
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'Referer': 'https://search.bilibili.com/',
    'Accept': 'application/json, text/plain, */*',
  };
  const cookie = biliGetCookie();
  if (cookie) headers['Cookie'] = cookie;
  const raw = await fetchWithHeaders(`https://api.bilibili.com/x/web-interface/wbi/search/type?${qs}`, BILI_FETCH_TIMEOUT, headers);
  const j = JSON.parse(raw);
  if (j.code !== 0) throw new Error(`bilibili 搜索接口错误 code=${j.code} ${j.message || ''}`);
  const arr = j.data && j.data.result;
  if (!Array.isArray(arr)) throw new Error('bilibili 搜索无结果(可能被风控)');
  return arr;
}

// fetch 带自定义 headers(复用 http/https)
function fetchWithHeaders(url, timeoutMs = 30000, headers = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(url, { headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...headers,
      }, timeout: timeoutMs }, (res) => {
        clearTimeout(timer);
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchWithHeaders(new URL(res.headers.location, url).toString(), timeoutMs, headers).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', (e) => { clearTimeout(timer); reject(e); });
      req.on('timeout', () => { req.destroy(); clearTimeout(timer); reject(new Error('Request timed out')); });
    } catch (e) { clearTimeout(timer); reject(e); }
  });
}

// 将 bilibili 视频对象映射为统一项(兼容 ranking 与 search 两种字段)
function biliMapItem(v, rank = 0) {
  const stat = v.stat || {};
  const owner = v.owner || {};
  const typename = v.typename || v.tname || '';
  return {
    rank,
    videoId: v.bvid || '',
    aid: v.aid || 0,
    title: (v.title || '').trim().replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"), // 搜索返回标题带 <em> 高亮标签与 HTML 实体
    link: v.short_link_v2 || v.short_link || v.arcurl || `https://www.bilibili.com/video/${v.bvid}`,
    pic: (v.pic || v.cover || '').replace(/^\/\//, 'https://').replace(/^http:\/\//, 'https://'),
    // duration 可能是秒数(ranking)或 "mm:ss" 字符串(搜索), 统一转秒数
    duration: typeof v.duration === 'string' && v.duration.includes(':')
      ? v.duration.split(':').reduce((sum, n, i, arr) => sum + (Number(n) || 0) * Math.pow(60, arr.length - 1 - i), 0)
      : (v.duration || 0),
    publishTime: v.pubdate ? v.pubdate * 1000 : Date.now(),
    publishTimeStr: v.pubdate ? new Date(v.pubdate * 1000).toISOString() : new Date().toISOString(),
    views: stat.view || v.play || 0,
    danmaku: stat.danmaku || v.danmaku || 0,
    likes: stat.like || v.like || 0,
    upName: owner.name || v.author || v.uname || '',
    upMid: owner.mid || v.mid || 0,
    upAvatar: owner.face || v.upic || '',
    category: typename || '科技',
    // 视频简介(搜索接口返回 description, ranking 接口返回 desc), 去掉 HTML 标签与换行
    description: (v.description || v.desc || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
  };
}

// 抓取 bilibili 科技分区热门排行榜(降级), 返回统一视频项
async function fetchBiliTechRanking() {
  const raw = await fetchSourceRaw(BILI_RANK_URL, BILI_FETCH_TIMEOUT);
  const json = JSON.parse(raw);
  if (json.code !== 0) throw new Error(json.message || `bilibili API code ${json.code}`);
  const list = (json.data && json.data.list) || [];
  return list.map((v, i) => biliMapItem(v, i + 1));
}

// 主抓取: 多AI关键词搜索近7天视频, 每词按播放量取配额 top3 → 汇总去重 → 按播放量排序取20
// (配额制防止单一爆款/单一话题霸榜; 若搜索全部失败(风控), 降级为热门榜按近30天过滤)
async function fetchBiliTechRecent() {
  try {
    const seen = new Set(); // 已入选 bvid, 跨关键词去重
    const picked = [];
    const windowStart = Date.now() - BILI_RECENT_DAYS * 86400 * 1000; // 严格近7天窗口
    let kwFail = 0;
    for (const kw of BILI_SEARCH_KEYWORDS) {
      if (picked.length >= BILI_TOP_N) break;
      try {
        const arr = await biliSearchByKeyword(kw, BILI_RECENT_DAYS);
        // 该关键词下: 分区过滤 + 窗口过滤 + AI相关性过滤 + 去重, 按播放量取前 QUOTA 条
        const candidates = arr
          .filter(v => v.bvid && !seen.has(v.bvid))
          .filter(v => BILI_TECH_TYPES.has(v.typename || v.tname || ''))
          .map(v => biliMapItem(v))
          .filter(it => it.publishTime >= windowStart && isAiRelevant(it))
          .sort((a, b) => b.views - a.views)
          .slice(0, BILI_QUOTA_PER_KW);
        for (const item of candidates) {
          seen.add(item.videoId);
          picked.push(item);
        }
        await new Promise(r => setTimeout(r, 800)); // 间隔防风控
      } catch (e) {
        kwFail++;
        console.log(`[B站] 关键词 "${kw}" 搜索失败: ${e.message}`);
        if (kwFail >= 4) throw e; // 多数关键词失败视为整体风控
      }
    }
    if (picked.length === 0) throw new Error('搜索无AI科技视频结果');
    return picked.sort((a, b) => b.views - a.views).slice(0, BILI_TOP_N).map((v, i) => ({ ...v, rank: i + 1 }));
  } catch (e) {
    console.log(`[B站] 搜索方案不可用(${e.message}), 降级为热门榜按近30天过滤`);
    const all = await fetchBiliTechRanking();
    const cutoff = Date.now() - 30 * 86400 * 1000;
    const recent = all.filter(v => v.publishTime >= cutoff).sort((a, b) => b.views - a.views);
    return (recent.length ? recent : all).slice(0, BILI_TOP_N).map((v, i) => ({ ...v, rank: i + 1 }));
  }
}

// 每日抓取: 科技分区近期热门 → 取前20条 → 按日期沉淀
async function captureBiliDaily(force = false) {
  ensureBiliDir();
  const date = dateStrOf(new Date());
  const file = path.join(BILI_DIR, `${date}.json`);
  if (fs.existsSync(file) && !force) {
    console.log('[B站] 今日已抓取，跳过（如需强制请用 force）');
    return readJSON(file);
  }
  console.log(`[B站] 开始抓取 ${date} 科技分区近期热门 ${BILI_TOP_N} 条...`);
  const all = await fetchBiliTechRecent();
  const items = all.slice(0, BILI_TOP_N);
  const payload = {
    date,
    capturedAt: new Date().toISOString(),
    count: items.length,
    total: all.length,
    mode: 'search',
    items,
  };
  writeJSON(file, payload);

  let index = readBiliIndex().filter(x => x.date !== date);
  index.unshift({ date, count: items.length, capturedAt: payload.capturedAt });
  index.sort((a, b) => b.date.localeCompare(a.date));
  writeJSON(BILI_INDEX, index);
  console.log(`[B站] 抓取完成，共 ${items.length} 条（科技分区共 ${all.length} 条），已沉淀至 ${file}`);
  return payload;
}

// 每日 08:00 定时任务
function scheduleBiliDailyCapture() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  console.log(`[B站] 下次定时抓取: ${next.toLocaleString('zh-CN')}`);
  setTimeout(() => {
    captureBiliDaily().catch(e => console.error('[B站] 定时抓取失败:', e.message));
    setInterval(() => {
      captureBiliDaily().catch(e => console.error('[B站] 定时抓取失败:', e.message));
    }, 24 * 60 * 60 * 1000);
  }, delay);
}

ensureBiliDir();
if (readBiliIndex().length === 0) {
  captureBiliDaily().catch(e => console.error('[B站] 首次抓取失败:', e.message));
}
scheduleBiliDailyCapture();

// 日期列表(左侧导航)
app.get('/api/bili', (req, res) => {
  res.json({ dates: readBiliIndex() });
});

// 最新一天
app.get('/api/bili/latest', (req, res) => {
  const index = readBiliIndex();
  if (index.length === 0) return res.status(404).json({ error: '暂无数据' });
  const date = index[0].date;
  const file = path.join(BILI_DIR, `${date}.json`);
  try { res.json(readJSON(file)); } catch { res.status(404).json({ error: '数据文件缺失' }); }
});

// B站登录 Cookie 配置(搜索接口"近7天+播放量"需要; 未配置时降级为热门榜过滤)
app.get('/api/bili/cookie', (req, res) => {
  const cfg = readConfig();
  res.json({ hasCookie: !!cfg.biliCookie, cookieMasked: cfg.biliCookie ? cfg.biliCookie.slice(0, 20) + '…(已配置)' : '' });
});

app.post('/api/bili/cookie', (req, res) => {
  const { cookie } = req.body;
  const cfg = readConfig();
  cfg.biliCookie = (cookie || '').trim();
  writeConfig(cfg);
  res.json({ ok: true, hasCookie: !!cfg.biliCookie });
});

app.delete('/api/bili/cookie', (req, res) => {
  const cfg = readConfig();
  delete cfg.biliCookie;
  writeConfig(cfg);
  res.json({ ok: true, hasCookie: false });
});

// 指定日期
app.get('/api/bili/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  const file = path.join(BILI_DIR, `${date}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '该日期无数据' });
  res.json(readJSON(file));
});

// 手动立即抓取(强制覆盖今日)
app.post('/api/bili/refresh', async (req, res) => {
  try {
    const payload = await captureBiliDaily(true);
    res.json({ ok: true, date: payload.date, count: payload.count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 同源图片代理: hdslb 等图床在跨域 <img> 下被浏览器 ORB 拦截,统一经本接口转发为同源图片
app.get('/api/proxy-image', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).end('missing url');
  let target;
  try { target = new URL(url); } catch { return res.status(400).end('bad url'); }
  if (!/^https?:$/.test(target.protocol)) return res.status(400).end('bad scheme');
  const lib = target.protocol === 'https:' ? https : http;
  const upstream = lib.get(target, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36 GourdSprite/1.0',
      'Referer': 'https://www.bilibili.com/'
    },
    timeout: 15000,
  }, (up) => {
    if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
      // follow redirect up to 3 via recursion
      const redirected = `${target.origin}${up.headers.location}` === up.headers.location ? up.headers.location : new URL(up.headers.location, target).toString();
      res.redirect(redirected);
      up.resume();
      return;
    }
    if (up.statusCode !== 200) {
      up.resume();
      return res.status(up.statusCode || 502).end();
    }
    const ct = up.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    up.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.status(502).end(); });
  upstream.on('timeout', () => { upstream.destroy(); if (!res.headersSent) res.status(504).end(); });
});

// ==================== B站 模块 结束 ====================

// ==================== 资讯 RSS 模块 结束 ====================

// ==================== GitHub 每日涨星项目模块 ====================
const GITHUB_TRENDING_DIR = path.join(DATA_DIR, 'github-trending');
const GITHUB_TRENDING_INDEX = path.join(GITHUB_TRENDING_DIR, 'index.json');
const STAR_SNAPSHOT_DIR = path.join(DATA_DIR, 'star-snapshots');
const TRENDING_TOP_N = 20;
const TRENDING_LOOKBACK_DAYS = 7; // 最近7天内创建、按star排序 = 涨星最快的新项目

function ensureTrendingDir() {
  if (!fs.existsSync(GITHUB_TRENDING_DIR)) fs.mkdirSync(GITHUB_TRENDING_DIR, { recursive: true });
  if (!fs.existsSync(GITHUB_TRENDING_INDEX)) fs.writeFileSync(GITHUB_TRENDING_INDEX, '[]');
}

function readTrendingIndex() {
  try { return readJSON(GITHUB_TRENDING_INDEX); } catch { return []; }
}

function writeTrendingIndex(index) {
  writeJSON(GITHUB_TRENDING_INDEX, index);
}

function dateStrOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 从 README markdown 提取项目详细介绍（去掉图片/badge/HTML，取前800字）
function extractReadmeIntro(md) {
  if (!md) return '';
  let text = md
    .replace(/```[\s\S]*?```/g, ' ')        // 代码块
    .replace(/<[^>]+>/g, ' ')                 // HTML 标签
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')    // 图片
    .replace(/\[!\[[^\]]*\]\[[^\]]*\]/g, ' ') // badge 引用
    .replace(/\[[^\]]*\]\([^)]*\)/g, m => {   // 链接保留文字
      const t = m.match(/^\[([^\]]*)\]/);
      return t ? t[1] : '';
    })
    .replace(/^[#>\-\*\s|]+/gm, ' ')
    .replace(/[*_`~#>|\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 800);
}

// 找 N 天前最近一天已存在的 star 快照(用于计算一周 star 增幅)
function findSnapshotAgo(days) {
  try {
    const files = fs.readdirSync(STAR_SNAPSHOT_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
    if (!files.length) return null;
    const targetStr = dateStrOf(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    const candidates = files.map(f => f.replace('.json', '')).filter(d => d <= targetStr);
    if (!candidates.length) return null;
    candidates.sort();
    return readJSON(path.join(STAR_SNAPSHOT_DIR, candidates[candidates.length - 1] + '.json'));
  } catch { return null; }
}

// 周报: 对候选池按 7 天前快照的 star 增幅排序,取 top20;无快照则回退按当前 star 取 top20
function applyWeeklyDelta(pool) {
  const snapshot = findSnapshotAgo(7);
  if (!snapshot || !snapshot.items || !snapshot.items.length) {
    return pool.slice(0, TRENDING_TOP_N);
  }
  const snapMap = new Map(snapshot.items.map(i => [i.name, i.stars || 0]));
  return pool
    .map(r => ({ ...r, _delta: (r.stargazers_count || 0) - (snapMap.get(r.full_name) || 0) }))
    .sort((a, b) => b._delta - a._delta)
    .slice(0, TRENDING_TOP_N);
}

async function fetchTrendingRepos(mode = 'daily') {
  const octokit = createOctokit();
  const since = new Date(Date.now() - TRENDING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  let query, perPage = TRENDING_TOP_N;
  if (mode === 'weekly') {
    // 周报: 候选池 = 近7天有更新的活跃仓库 top100,再按一周 star 增幅排序
    query = `pushed:>${dateStrOf(since)}`;
    perPage = 100;
  } else {
    // 日报: 近7天创建、star 最多的新项目
    query = `created:>${dateStrOf(since)}`;
  }
  const { data } = await octokit.search.repos({
    q: query,
    sort: 'stars',
    order: 'desc',
    per_page: perPage,
  });

  let list = data.items || [];
  if (mode === 'weekly') {
    list = applyWeeklyDelta(list);
  }

  const items = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    let readmeIntro = '';
    try {
      const readme = await octokit.repos.getReadme({
        owner: r.owner.login, repo: r.name, mediaType: { format: 'raw' }
      });
      readmeIntro = extractReadmeIntro(readme.data);
      await new Promise(res => setTimeout(res, 200)); // 温柔限速
    } catch (e) {
      // README 获取失败不影响整体
    }
    items.push({
      rank: i + 1,
      name: r.full_name,
      title: r.name,
      url: r.html_url,
      description: r.description || '',
      detailIntro: readmeIntro,
      stars: r.stargazers_count || 0,
      starDelta: mode === 'weekly' && typeof r._delta === 'number' ? r._delta : null,
      forks: r.forks_count || 0,
      watchers: r.watchers_count || 0,
      language: r.language || '',
      topics: r.topics || [],
      homepage: r.homepage || '',
      license: r.license ? (r.license.spdx_id || r.license.name || '') : '',
      owner: r.owner.login,
      ownerAvatar: r.owner.avatar_url,
      createdAt: r.created_at,
      archived: r.archived || false,
    });
  }
  return items;
}

async function captureDailyTrending(force = false) {
  ensureTrendingDir();
  const date = dateStrOf(new Date());
  const file = path.join(GITHUB_TRENDING_DIR, `${date}.json`);
  if (fs.existsSync(file) && !force) {
    console.log('[GitHub] 今日已抓取，跳过（如需强制请用 force）');
    return readJSON(file);
  }
  console.log(`[GitHub] 开始抓取 ${date} 涨星最快的 ${TRENDING_TOP_N} 个项目...`);
  const items = await fetchTrendingRepos();
  const payload = {
    date,
    capturedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
  writeJSON(file, payload);

  // 更新索引（按日期倒序）
  let index = readTrendingIndex().filter(x => x.date !== date);
  index.unshift({ date, count: items.length, capturedAt: payload.capturedAt });
  index.sort((a, b) => b.date.localeCompare(a.date));
  writeTrendingIndex(index);
  console.log(`[GitHub] 抓取完成，共 ${items.length} 个项目，已沉淀至 ${file}`);
  return payload;
}

// 每日 star 快照: 记录候选池(近7天活跃 top100)的 star 数,供周报计算一周增幅
function ensureSnapshotDir() {
  if (!fs.existsSync(STAR_SNAPSHOT_DIR)) fs.mkdirSync(STAR_SNAPSHOT_DIR, { recursive: true });
}

async function captureStarSnapshot(force = false) {
  ensureSnapshotDir();
  const date = dateStrOf(new Date());
  const file = path.join(STAR_SNAPSHOT_DIR, `${date}.json`);
  if (fs.existsSync(file) && !force) return readJSON(file);
  const octokit = createOctokit();
  const since = new Date(Date.now() - TRENDING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const { data } = await octokit.search.repos({
    q: `pushed:>${dateStrOf(since)}`,
    sort: 'stars',
    order: 'desc',
    per_page: 100,
  });
  const items = (data.items || []).map(r => ({
    name: r.full_name,
    stars: r.stargazers_count || 0,
  }));
  const payload = { date, capturedAt: new Date().toISOString(), count: items.length, items };
  writeJSON(file, payload);
  console.log(`[Star快照] 已记录 ${items.length} 个候选仓库 star(${date})`);
  return payload;
}

// 每日 08:00 定时任务
function scheduleDailyCapture() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  console.log(`[GitHub] 下次定时抓取: ${next.toLocaleString('zh-CN')}`);
  setTimeout(() => {
    captureDailyTrending().catch(e => console.error('[GitHub] 定时抓取失败:', e.message));
    captureStarSnapshot().catch(e => console.error('[Star快照] 定时抓取失败:', e.message));
    setInterval(() => {
      captureDailyTrending().catch(e => console.error('[GitHub] 定时抓取失败:', e.message));
      captureStarSnapshot().catch(e => console.error('[Star快照] 定时抓取失败:', e.message));
    }, 24 * 60 * 60 * 1000);
  }, delay);
}

ensureTrendingDir();
// 启动时: 如果一条历史数据都没有，先抓一次保证页面可用；否则只调度 08:00
if (readTrendingIndex().length === 0) {
  captureDailyTrending().catch(e => console.error('[GitHub] 首次抓取失败:', e.message));
}
// 启动即补一次今日快照,保证从今天起积累 star 快照
captureStarSnapshot().catch(e => console.error('[Star快照] 首次快照失败:', e.message));
scheduleDailyCapture();

// 日期列表（左侧导航）
app.get('/api/github/trending', (req, res) => {
  res.json({ dates: readTrendingIndex() });
});

// 最新一天
app.get('/api/github/trending/latest', (req, res) => {
  const index = readTrendingIndex();
  if (index.length === 0) return res.status(404).json({ error: '暂无数据' });
  const date = index[0].date;
  const file = path.join(GITHUB_TRENDING_DIR, `${date}.json`);
  try { res.json(readJSON(file)); } catch { res.status(404).json({ error: '数据文件缺失' }); }
});

// 指定日期
app.get('/api/github/trending/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  const file = path.join(GITHUB_TRENDING_DIR, `${date}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '该日期无数据' });
  res.json(readJSON(file));
});

// 手动立即抓取（强制覆盖今日）
app.post('/api/github/trending/refresh', async (req, res) => {
  try {
    const payload = await captureDailyTrending(true);
    res.json({ ok: true, date: payload.date, count: payload.count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== GitHub 每周涨星项目模块 ====================
const GITHUB_WEEKLY_DIR = path.join(DATA_DIR, 'github-weekly');
const GITHUB_WEEKLY_INDEX = path.join(GITHUB_WEEKLY_DIR, 'index.json');

function ensureWeeklyDir() {
  if (!fs.existsSync(GITHUB_WEEKLY_DIR)) fs.mkdirSync(GITHUB_WEEKLY_DIR, { recursive: true });
  if (!fs.existsSync(GITHUB_WEEKLY_INDEX)) fs.writeFileSync(GITHUB_WEEKLY_INDEX, '[]');
}

function readWeeklyIndex() {
  try { return readJSON(GITHUB_WEEKLY_INDEX); } catch { return []; }
}

// 返回日期所在周的周一日期作为周标识(如 2026-09-14 表示 09/14-09/20 周)
function weekKeyOf(d) {
  const day = new Date(d);
  const diff = (day.getDay() + 6) % 7; // 周一=0
  day.setDate(day.getDate() - diff);
  return dateStrOf(day);
}

// 周标识 → 显示标签: 09/14-09/20 周
function weekLabel(weekKey) {
  const start = new Date(weekKey + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${weekKey.slice(5).replace('-', '/')}-${String(end.getMonth() + 1).padStart(2, '0')}/${String(end.getDate()).padStart(2, '0')} 周`;
}

// 每周抓取一次: 近7天有更新的活跃热门仓库 top20(老项目也能进榜)
async function captureWeeklyTrending(force = false) {
  ensureWeeklyDir();
  const weekKey = weekKeyOf(new Date());
  const file = path.join(GITHUB_WEEKLY_DIR, `${weekKey}.json`);
  if (fs.existsSync(file) && !force) {
    console.log('[GitHub-周报] 本周已抓取，跳过（如需强制请用 force）');
    return readJSON(file);
  }
  console.log(`[GitHub-周报] 开始抓取 ${weekKey} 周活跃热门仓库 top ${TRENDING_TOP_N}...`);
  const items = await fetchTrendingRepos('weekly');
  const payload = {
    week: weekKey,
    label: weekLabel(weekKey),
    capturedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
  writeJSON(file, payload);

  // 更新索引(按周倒序)
  let index = readWeeklyIndex().filter(x => x.week !== weekKey);
  index.unshift({ week: weekKey, label: payload.label, count: items.length, capturedAt: payload.capturedAt });
  index.sort((a, b) => b.week.localeCompare(a.week));
  writeJSON(GITHUB_WEEKLY_INDEX, index);
  console.log(`[GitHub-周报] 抓取完成，共 ${items.length} 个项目，已沉淀至 ${file}`);
  return payload;
}

// 每周一 08:00 定时抓取
function scheduleWeeklyCapture() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  // 推进到下一个周一(周一=0)
  const dayDiff = (next.getDay() + 6) % 7;
  if (dayDiff !== 0) next.setDate(next.getDate() + (7 - dayDiff));
  const delay = next - now;
  console.log(`[GitHub-周报] 下次定时抓取: ${next.toLocaleString('zh-CN')}`);
  setTimeout(() => {
    captureWeeklyTrending().catch(e => console.error('[GitHub-周报] 定时抓取失败:', e.message));
    setInterval(() => {
      captureWeeklyTrending().catch(e => console.error('[GitHub-周报] 定时抓取失败:', e.message));
    }, 7 * 24 * 60 * 60 * 1000);
  }, delay);
}

ensureWeeklyDir();
// 启动时: 如果一条周数据都没有，先抓一次保证页面可用
if (readWeeklyIndex().length === 0) {
  captureWeeklyTrending().catch(e => console.error('[GitHub-周报] 首次抓取失败:', e.message));
}
scheduleWeeklyCapture();

// 周列表(左侧导航)
app.get('/api/github/weekly', (req, res) => {
  res.json({ weeks: readWeeklyIndex() });
});

// 最新一周
app.get('/api/github/weekly/latest', (req, res) => {
  const index = readWeeklyIndex();
  if (index.length === 0) return res.status(404).json({ error: '暂无数据' });
  const week = index[0].week;
  const file = path.join(GITHUB_WEEKLY_DIR, `${week}.json`);
  try { res.json(readJSON(file)); } catch { res.status(404).json({ error: '数据文件缺失' }); }
});

// 指定周(以周一的 YYYY-MM-DD 为 key)
app.get('/api/github/weekly/:week', (req, res) => {
  const { week } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return res.status(400).json({ error: '周标识格式应为 YYYY-MM-DD(周一日期)' });
  const file = path.join(GITHUB_WEEKLY_DIR, `${week}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '该周无数据' });
  res.json(readJSON(file));
});

// 手动立即抓取(强制覆盖本周)
app.post('/api/github/weekly/refresh', async (req, res) => {
  try {
    const payload = await captureWeeklyTrending(true);
    res.json({ ok: true, week: payload.week, count: payload.count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== GitHub 每周涨星项目模块 结束 ====================

// ==================== GitHub 每日涨星项目模块 结束 ====================

// ==================== X (Twitter) KOL 发言模块 ====================
const X_KOL_CACHE_FILE = path.join(DATA_DIR, 'x-kol.json');
const X_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 分钟
const X_FETCH_TIMEOUT = 20000; // 20 秒
const X_CONCURRENCY = 3; // 每批并发数，避免 RSSHub 限流

// KOL 配置：handle/name/role。无个人账号者用官方账号替代。
// 注：@demaborr / @drfeili 凭印象填写，TODO: 校准（真实可能是 @DemisHassabis / @drfeifei）
const X_KOLS = [
  { handle: 'elonmusk',   name: 'Elon Musk',       role: 'Tesla / SpaceX / xAI CEO' },
  { handle: 'sama',       name: 'Sam Altman',      role: 'OpenAI CEO' },
  { handle: 'demaborr',   name: 'Demis Hassabis',   role: 'Google DeepMind CEO（TODO: 校准 handle）' }, // TODO: 校准 handle
  { handle: 'nvidia',     name: 'NVIDIA 官方',      role: 'Jensen Huang / NVIDIA' }, // Jensen Huang 无个人账号，用官方替代
  { handle: 'ylecun',     name: 'Yann LeCun',       role: 'Meta Chief AI Scientist' },
  { handle: 'GoogleAI',   name: 'Google AI 官方',   role: 'Geoffrey Hinton / Google AI' }, // Hinton 无个人账号，用官方替代
  { handle: 'drfeili',    name: 'Fei-Fei Li',       role: 'Stanford HAI 主任（TODO: 校准 handle）' }, // TODO: 校准 handle，真实可能为 @drfeifei
  { handle: 'OpenAI',     name: 'OpenAI 官方',     role: 'Ilya Sutskever / OpenAI' }, // Ilya 无个人账号，用官方替代
  { handle: 'AnthropicAI',name: 'Anthropic 官方',   role: 'Dario Amodei / Anthropic' }, // Dario 无个人账号，用官方替代
  { handle: 'karpathy',   name: 'Andrej Karpathy', role: 'AI 研究者 / Eureka Labs' },
];

let xKolCache = { lastRefresh: 0, items: [], status: [] };

function readXKolCache() {
  try {
    if (fs.existsSync(X_KOL_CACHE_FILE)) {
      xKolCache = JSON.parse(fs.readFileSync(X_KOL_CACHE_FILE, 'utf-8'));
    }
  } catch (e) { console.warn('[X] 读取缓存失败:', e.message); }
}

function writeXKolCache() {
  try { fs.writeFileSync(X_KOL_CACHE_FILE, JSON.stringify(xKolCache, null, 2)); }
  catch (e) { console.warn('[X] 写入缓存失败:', e.message); }
}

// 从 RSSHub twitter item 提取图片 URL（ enclosure 或 content 内 <img>）
function extractXMedia(rawItem) {
  if (rawItem.enclosure && rawItem.enclosure.url) return rawItem.enclosure.url;
  const html = rawItem.content || rawItem['content:encoded'] || '';
  const m = String(html).match(/<img[^>]*src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

function normalizeXItem(kol, raw) {
  const pubDate = raw.isoDate || raw.pubDate || raw.date || Date.now();
  const publishedAt = new Date(pubDate).getTime();
  let text = raw.contentSnippet || raw.content || raw.title || '';
  if (typeof text === 'string') text = text.replace(/<[^>]+>/g, '').trim();
  const link = raw.link || raw.guid || '';
  return {
    handle: kol.handle,
    name: kol.name,
    role: kol.role,
    text: text.slice(0, 1000),
    link,
    pubDate: isNaN(publishedAt) ? Date.now() : publishedAt,
    pubDateStr: new Date(isNaN(publishedAt) ? Date.now() : publishedAt).toISOString(),
    mediaUrl: extractXMedia(raw),
  };
}

async function fetchXKol(kol) {
  try {
    const url = `https://rsshub.app/twitter/user/${kol.handle}`;
    const raw = await fetchSourceRaw(url, X_FETCH_TIMEOUT);
    const cleaned = cleanXmlBody(raw);
    const feed = await rssParser.parseString(cleaned);
    const items = (feed.items || []).slice(0, 15).map(it => normalizeXItem(kol, it));
    return { kol, items, error: null };
  } catch (e) {
    console.warn(`[X] ${kol.name}(@${kol.handle}) 拉取失败: ${e.message}`);
    return { kol, items: [], error: e.message };
  }
}

async function refreshXKol(force = false) {
  const now = Date.now();
  if (!force && now - (xKolCache.lastRefresh || 0) < X_REFRESH_INTERVAL && xKolCache.items.length > 0) {
    return xKolCache;
  }
  console.log(`[X] 开始刷新 ${X_KOLS.length} 位 KOL...`);
  const results = [];
  for (let i = 0; i < X_KOLS.length; i += X_CONCURRENCY) {
    const batch = X_KOLS.slice(i, i + X_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(k => fetchXKol(k)));
    results.push(...batchResults);
  }
  let allItems = [];
  const status = results.map(r => ({
    handle: r.kol.handle,
    name: r.kol.name,
    role: r.kol.role,
    count: r.items.length,
    error: r.error,
  }));
  results.forEach(r => { allItems = allItems.concat(r.items); });
  allItems.sort((a, b) => b.pubDate - a.pubDate);
  xKolCache = { lastRefresh: now, items: allItems, status };
  writeXKolCache();
  const ok = status.filter(s => !s.error).length;
  console.log(`[X] 刷新完成，共 ${allItems.length} 条发言（${ok}/${X_KOLS.length} 位 KOL 成功）`);
  return xKolCache;
}

readXKolCache();
refreshXKol();
setInterval(() => refreshXKol(), X_REFRESH_INTERVAL);

app.get('/api/news/x', (req, res) => {
  res.json(xKolCache);
});

app.post('/api/news/x/refresh', async (req, res) => {
  try {
    const cache = await refreshXKol(true);
    res.json({ ok: true, total: cache.items.length, lastRefresh: cache.lastRefresh });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== X KOL 模块 结束 ====================

// ==================== YouTube · AI 科技访谈模块（每日08:00抓取20条，按日期沉淀） ====================
const YOUTUBE_DAILY_DIR = path.join(DATA_DIR, 'youtube-videos');
const YOUTUBE_DAILY_INDEX = path.join(YOUTUBE_DAILY_DIR, 'index.json');
const YT_DAILY_TOP_N = 20;
const YT_FETCH_TIMEOUT = 20000;
const YT_CONCURRENCY = 4;

function ensureYoutubeDir() {
  if (!fs.existsSync(YOUTUBE_DAILY_DIR)) fs.mkdirSync(YOUTUBE_DAILY_DIR, { recursive: true });
  if (!fs.existsSync(YOUTUBE_DAILY_INDEX)) fs.writeFileSync(YOUTUBE_DAILY_INDEX, '[]');
}

function readYoutubeIndex() {
  try { return readJSON(YOUTUBE_DAILY_INDEX); } catch { return []; }
}

// 频道配置：channel_id 已通过抓取 YouTube 官方 RSS 校准（5/6 验证可用）。
// AI Explained 任务给的 ID 为 23 字符且 RSS 404，置占位 TODO，待校准真实 24 字符 channel_id。
const YT_CHANNELS = [
  { id: 'UCbfYPyITQ-7l4upoX8nvctg', name: 'Two Minute Papers' },     // 已校准 ✓
  { id: 'UCZHmQk67mSJgfCCTn7xBfew', name: 'Yannic Kilcher' },        // 已校准 ✓
  { id: 'UCYO_jab_esuFRV4b17AJtAw', name: '3Blue1Brown' },           // 已校准 ✓
  { id: 'UCSHZKyawb77ixDdsGog4iWA', name: 'Lex Fridman Podcast' },   // 已校准 ✓
  { id: 'UCLB7AzTwc6VFZrBsO2ucBMg', name: 'Robert Miles AI Safety' },// 已校准 ✓
  { id: 'UC_PLACEHOLDER_AIEXPLAINED', name: 'AI Explained', todo: true }, // TODO: 校准 channel_id（任务原 ID UCuckBgY6pE__DQ0DHuIIY 为 23 字符且 RSS 404）
];

// 用正则从 YouTube RSS XML 提取 entry，避免 rss-parser 命名空间(media:/yt:)字段问题
function parseYtFeed(xml, channel) {
  const items = [];
  // 频道名：优先取 feed 根 <title>，否则用配置名
  const feedTitleMatch = xml.match(/<title[^>]*>([^<]+)<\/title>/);
  const channelName = (feedTitleMatch && feedTitleMatch[1] && feedTitleMatch[1].trim()) || channel.name;

  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];
    const pick = (re) => {
      const r = e.match(re);
      return r ? r[1].trim() : '';
    };
    const videoId = pick(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    if (!videoId) continue;
    let title = pick(/<media:title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/media:title>/);
    if (!title) title = pick(/<title[^>]*>([^<]+)<\/title>/);
    let desc = pick(/<media:description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/media:description>/);
    const link = pick(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/) || `https://www.youtube.com/watch?v=${videoId}`;
    const thumb = pick(/<media:thumbnail[^>]*url=["']([^"']+)["']/) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const published = pick(/<published>([^<]+)<\/published>/);
    const views = pick(/<media:statistics[^>]*views=["'](\d+)["']/);
    const pubAt = new Date(published).getTime();
    items.push({
      channelId: channel.id,
      channelName,
      videoId,
      title: title.slice(0, 300),
      description: (desc || '').slice(0, 500),
      thumbnail: thumb,
      published: isNaN(pubAt) ? Date.now() : pubAt,
      publishedStr: new Date(isNaN(pubAt) ? Date.now() : pubAt).toISOString(),
      link,
      views: views ? Number(views) : null,
    });
  }
  return items;
}

async function fetchYtChannel(channel) {
  try {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;
    const raw = await fetchSourceRaw(url, YT_FETCH_TIMEOUT);
    const cleaned = cleanXmlBody(raw);
    const items = parseYtFeed(cleaned, channel).slice(0, 15);
    return { channel, items, error: null };
  } catch (e) {
    console.warn(`[YouTube] ${channel.name}(${channel.id}) 拉取失败: ${e.message}`);
    return { channel, items: [], error: e.message };
  }
}

// 每日抓取：合并所有频道最新视频，按发布时间排序取前 20 条，按日期沉淀
async function captureDailyYoutube(force = false) {
  ensureYoutubeDir();
  const date = dateStrOf(new Date());
  const file = path.join(YOUTUBE_DAILY_DIR, `${date}.json`);
  if (fs.existsSync(file) && !force) {
    console.log('[YouTube] 今日已抓取，跳过（如需强制请用 force）');
    return readJSON(file);
  }
  console.log(`[YouTube] 开始抓取 ${date} 最新 ${YT_DAILY_TOP_N} 条视频...`);
  const results = [];
  for (let i = 0; i < YT_CHANNELS.length; i += YT_CONCURRENCY) {
    const batch = YT_CHANNELS.slice(i, i + YT_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(c => fetchYtChannel(c)));
    results.push(...batchResults);
  }
  let allItems = [];
  const status = results.map(r => ({
    channelId: r.channel.id,
    name: r.channel.name,
    count: r.items.length,
    error: r.error,
    todo: r.channel.todo || false,
  }));
  results.forEach(r => { allItems = allItems.concat(r.items); });
  allItems.sort((a, b) => b.published - a.published);
  const items = allItems.slice(0, YT_DAILY_TOP_N).map((it, i) => ({ rank: i + 1, ...it }));

  const payload = {
    date,
    capturedAt: new Date().toISOString(),
    count: items.length,
    status,
    items,
  };
  writeJSON(file, payload);

  // 更新索引（按日期倒序）
  let index = readYoutubeIndex().filter(x => x.date !== date);
  index.unshift({ date, count: items.length, capturedAt: payload.capturedAt });
  index.sort((a, b) => b.date.localeCompare(a.date));
  writeJSON(YOUTUBE_DAILY_INDEX, index);
  const ok = status.filter(s => !s.error).length;
  console.log(`[YouTube] 抓取完成，共 ${items.length} 条视频（${ok}/${YT_CHANNELS.length} 个频道成功），已沉淀至 ${file}`);
  return payload;
}

// 每日 08:00 定时任务（与 GitHub 同一时间）
function scheduleDailyYoutubeCapture() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  console.log(`[YouTube] 下次定时抓取: ${next.toLocaleString('zh-CN')}`);
  setTimeout(() => {
    captureDailyYoutube().catch(e => console.error('[YouTube] 定时抓取失败:', e.message));
    setInterval(() => {
      captureDailyYoutube().catch(e => console.error('[YouTube] 定时抓取失败:', e.message));
    }, 24 * 60 * 60 * 1000);
  }, delay);
}

ensureYoutubeDir();
// 启动时: 如果一条历史数据都没有，先抓一次保证页面可用；否则只调度 08:00
if (readYoutubeIndex().length === 0) {
  captureDailyYoutube().catch(e => console.error('[YouTube] 首次抓取失败:', e.message));
}
scheduleDailyYoutubeCapture();

// 日期列表（左侧导航）
app.get('/api/youtube/daily', (req, res) => {
  res.json({ dates: readYoutubeIndex() });
});

// 最新一天
app.get('/api/youtube/daily/latest', (req, res) => {
  const index = readYoutubeIndex();
  if (index.length === 0) return res.status(404).json({ error: '暂无数据' });
  const date = index[0].date;
  const file = path.join(YOUTUBE_DAILY_DIR, `${date}.json`);
  try { res.json(readJSON(file)); } catch { res.status(404).json({ error: '数据文件缺失' }); }
});

// 指定日期
app.get('/api/youtube/daily/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  const file = path.join(YOUTUBE_DAILY_DIR, `${date}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '该日期无数据' });
  res.json(readJSON(file));
});

// 手动立即抓取（强制覆盖今日）
app.post('/api/youtube/daily/refresh', async (req, res) => {
  try {
    const payload = await captureDailyYoutube(true);
    res.json({ ok: true, date: payload.date, count: payload.count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== YouTube 模块 结束 ====================

app.listen(PORT, () => {
  console.log(`GourdSprite 运行在 http://localhost:${PORT}`);
  console.log(`提醒: 后端扫描器已启动，浏览器关闭/锁屏也会响铃。建议用 caffeinate 防睡眠启动:`);
  console.log(`  caffeinate -i node server.js`);
  const config = readConfig();
  if (config.githubToken) {
    console.log(`GitHub Token 已配置: ${config.githubToken.substring(0, 4)}****`);
  } else {
    console.log('提示: 未配置 GitHub Token，API 速率限制为 60次/小时。配置后可提升至 5000次/小时。');
  }
  const profiles = findChromeProfiles();
  if (profiles.length > 0) {
    console.log(`检测到 ${profiles.length} 个 Chrome Profile: ${profiles.map(p => p.displayName).join(', ')}`);
  }
});
