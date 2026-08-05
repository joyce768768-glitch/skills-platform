const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { Octokit } = require('@octokit/rest');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
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

app.listen(PORT, () => {
  console.log(`Skills Platform 运行在 http://localhost:${PORT}`);
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
