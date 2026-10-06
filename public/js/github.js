// ================ GitHub 涨星日报 ================
const GH_STATE = {
  dates: [],
  currentDate: null,
  loading: false,
};

// ================ 资讯页 Tab 切换 ================
const NEWS_TAB_MAP = {
  github: 'newsPanelGithub',
  bili: 'newsPanelBili',
  youtube: 'newsPanelYoutube',
  aikn: 'newsPanelAikn',
  huxiu: 'newsPanelHuxiu',
  tcai: 'newsPanelTcai',
  ars: 'newsPanelArs',
};

// GitHub tab 是否已初始化(避免重复加载)
let ghTabInited = false;
let biliTabInited = false;
let ytTabInited = false;
let aiknTabInited = false;
let huxiuTabInited = false;
let tcaiTabInited = false;
let arsTabInited = false;

function switchNewsTab(tab) {
  // 切换按钮高亮
  document.querySelectorAll('.news-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  // 切换面板
  Object.entries(NEWS_TAB_MAP).forEach(([key, panelId]) => {
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.toggle('active', key === tab);
  });
  // 重置滚动位置到顶部，避免上一个 tab 滚得很深、切过来后视口落在空白区
  window.scrollTo(0, 0);
  // 进入 GitHub tab 时懒加载
  if (tab === 'github' && !ghTabInited) {
    ghTabInited = true;
    loadDateIndex();
  }
  // 进入 B站 tab 时懒加载
  if (tab === 'bili' && !biliTabInited) {
    biliTabInited = true;
    loadBiliDateIndex();
  }
  // 进入 YouTube tab 时懒加载
  if (tab === 'youtube' && !ytTabInited) {
    ytTabInited = true;
    loadYtDateIndex();
  }
  // 进入 AI 资讯 tab 时懒加载
  if (tab === 'aikn' && !aiknTabInited) {
    aiknTabInited = true;
    loadAiknDateIndex();
  }
  // 进入虎嗅 tab 时懒加载
  if (tab === 'huxiu' && !huxiuTabInited) {
    huxiuTabInited = true;
    loadHuxiuDateIndex();
  }
  // 进入海外AI tab 时懒加载
  if (tab === 'tcai' && !tcaiTabInited) {
    tcaiTabInited = true;
    loadTcAiDateIndex();
  }
  // 进入 Ars Technica tab 时懒加载
  if (tab === 'ars' && !arsTabInited) {
    arsTabInited = true;
    loadArsDateIndex();
  }
}

// 相对时间格式化：刚刚 / X 分钟前 / X 小时前 / X 天前 / YYYY-MM-DD
function formatRelativeTime(input) {
  if (!input) return '';
  const ts = typeof input === 'number' ? input : new Date(input).getTime();
  if (isNaN(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' 天前';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 由名字/handle 生成稳定的首字母 + 背景色（避免外部头像 API 依赖）
function avatarColor(seed) {
  let h = 0;
  const s = String(seed || 'A');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 65%, 45%)`;
}

function firstLetter(name) {
  return (String(name || '?').trim()[0] || '?').toUpperCase();
}

// ================ B站 AI科技视频（每日08:00抓20条，按日期沉淀） ================
const BILI_STATE = {
  dates: [],
  currentDate: null,
  loading: false,
};

// 时长 → mm:ss（兼容秒数与 "mm:ss" 字符串两种格式）
function formatDuration(sec) {
  if (typeof sec === 'string' && sec.includes(':')) {
    const parts = sec.split(':').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return `${parts[0]}:${String(parts[1]).padStart(2, '0')}`;
    }
  }
  sec = Number(sec) || 0;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 图片统一走同源代理，避免 hdslb 图床跨域被 ORB 拦截
function proxyImg(url) {
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

function renderBiliVideoCard(item) {
  const top3 = item.rank <= 3 ? ' top3' : '';
  return `
    <div class="yt-video-card bili-video-card">
      <span class="gh-rank${top3}">${item.rank}</span>
      <a class="yt-thumb" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">
        <img src="${escapeHtml(proxyImg(item.pic))}" alt="" loading="lazy" onerror="this.parentNode.style.display='none'">
        ${item.duration ? `<span class="bili-duration">${formatDuration(item.duration)}</span>` : ''}
      </a>
      <div class="yt-meta">
        <a class="yt-title" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
        <span class="yt-channel">👤 ${escapeHtml(item.upName)} · ${escapeHtml(item.category)}</span>
        <span class="yt-published">▶ ${Number(item.views).toLocaleString()} 播放 · 👍 ${Number(item.likes).toLocaleString()} · 🕐 ${escapeHtml(formatRelativeTime(item.publishTime || item.publishTimeStr))}</span>
        ${item.description ? `<div class="yt-desc">${escapeHtml(item.description.slice(0, 140))}${item.description.length > 140 ? '…' : ''}</div>` : ''}
      </div>
    </div>
  `;
}

function renderBiliDateList() {
  const listEl = document.getElementById('biliDateList');
  listEl.innerHTML = BILI_STATE.dates.map(d => `
    <li class="gh-date-item ${d.date === BILI_STATE.currentDate ? 'active' : ''}"
        onclick="loadBiliDate('${d.date}')">
      <span class="gh-date-name">${formatDateLabel(d.date)}</span>
      <span class="gh-date-count">${d.count}</span>
    </li>
  `).join('');
}

async function loadBiliDateIndex(selectDate) {
  const listEl = document.getElementById('biliDateList');
  try {
    const res = await fetch('/api/bili');
    const data = await res.json();
    BILI_STATE.dates = data.dates || [];
    renderBiliDateList();
    if (BILI_STATE.dates.length === 0) {
      listEl.innerHTML = '<li class="gh-date-empty">暂无归档<br><small>等待首次抓取</small></li>';
      return;
    }
    const target = selectDate || BILI_STATE.currentDate || BILI_STATE.dates[0].date;
    if (BILI_STATE.dates.some(d => d.date === target)) loadBiliDate(target);
    else loadBiliDate(BILI_STATE.dates[0].date);
  } catch (e) {
    listEl.innerHTML = '<li class="gh-date-empty">日期加载失败</li>';
  }
}

async function loadBiliDate(date) {
  if (BILI_STATE.loading) return;
  BILI_STATE.loading = true;
  BILI_STATE.currentDate = date;
  renderBiliDateList();
  const listEl = document.getElementById('biliFeedList');
  const titleEl = document.getElementById('biliContentTitle');
  listEl.innerHTML = '<div class="gh-loading">正在加载 ' + date + ' 的视频...</div>';
  titleEl.textContent = `B站 · AI科技视频 · ${date}`;
  try {
    const res = await fetch(`/api/bili/${date}`);
    const data = await res.json();
    if (!res.ok) {
      listEl.innerHTML = `<div class="gh-empty">${escapeHtml(data.error || '加载失败')}</div>`;
      return;
    }
    const items = data.items || [];
    if (items.length === 0) {
      listEl.innerHTML = '<div class="gh-empty">该日暂无视频数据</div>';
      return;
    }
    listEl.innerHTML = items.map(renderBiliVideoCard).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="gh-empty">加载失败: ${escapeHtml(e.message)}</div>`;
  } finally {
    BILI_STATE.loading = false;
  }
}

async function refreshBiliDaily() {
  const btn = document.getElementById('biliRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '抓取中...'; }
  try {
    const res = await fetch('/api/bili/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) alert('抓取失败: ' + (data.error || ''));
  } catch (e) {
    alert('抓取失败: ' + e.message);
  } finally {
    await loadBiliDateIndex();
    if (btn) { btn.disabled = false; btn.textContent = '🔄 立即抓取'; }
  }
}

// ================ YouTube（每日08:00抓取20条，按日期沉淀） ================
const YT_STATE = {
  dates: [],
  currentDate: null,
  loading: false,
};

function renderYtVideoCard(item) {
  const desc = item.description ? `<div class="yt-desc">${escapeHtml(item.description.slice(0, 120))}${item.description.length > 120 ? '…' : ''}</div>` : '';
  const top3 = item.rank <= 3 ? ' top3' : '';
  const heat = item.viewsPerHour ? `<span class="yt-heat">🚀 +${Number(item.viewsPerHour).toLocaleString()}/小时</span>` : '';
  return `
    <div class="yt-video-card">
      <span class="gh-rank${top3}">${item.rank}</span>
      <a class="yt-thumb" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">
        <img src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${escapeHtml(item.videoId)}/hqdefault.jpg'">
      </a>
      <div class="yt-meta">
        <a class="yt-title" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
        <span class="yt-channel">📺 ${escapeHtml(item.channelName)}${item.category ? ' · ' + escapeHtml(item.category) : ''}</span>
        <span class="yt-published">${escapeHtml(formatRelativeTime(item.published || item.publishedStr))}${item.views ? ' · ' + Number(item.views).toLocaleString() + ' 次观看' : ''} ${heat}</span>
        ${desc}
      </div>
    </div>
  `;
}

function renderYtDateList() {
  const listEl = document.getElementById('ytDateList');
  listEl.innerHTML = YT_STATE.dates.map(d => `
    <li class="gh-date-item ${d.date === YT_STATE.currentDate ? 'active' : ''}"
        onclick="loadYtDate('${d.date}')">
      <span class="gh-date-name">${formatDateLabel(d.date)}</span>
      <span class="gh-date-count">${d.count}</span>
    </li>
  `).join('');
}

async function loadYtDateIndex(selectDate) {
  const listEl = document.getElementById('ytDateList');
  try {
    const res = await fetch('/api/youtube/daily');
    const data = await res.json();
    YT_STATE.dates = data.dates || [];
    renderYtDateList();

    if (YT_STATE.dates.length === 0) {
      listEl.innerHTML = '<li class="gh-date-empty">暂无归档<br><small>等待首次抓取</small></li>';
      return;
    }
    const target = selectDate || YT_STATE.currentDate || YT_STATE.dates[0].date;
    if (YT_STATE.dates.some(d => d.date === target)) {
      loadYtDate(target);
    } else {
      loadYtDate(YT_STATE.dates[0].date);
    }
  } catch (e) {
    listEl.innerHTML = '<li class="gh-date-empty">日期加载失败</li>';
  }
}

async function loadYtDate(date) {
  if (YT_STATE.loading) return;
  YT_STATE.loading = true;
  YT_STATE.currentDate = date;
  renderYtDateList();

  const listEl = document.getElementById('youtubeFeedList');
  const titleEl = document.getElementById('ytContentTitle');
  listEl.innerHTML = '<div class="gh-loading">正在加载 ' + date + ' 的视频...</div>';
  titleEl.textContent = `YouTube · 前沿科技视频 · ${date}`;

  try {
    const res = await fetch(`/api/youtube/daily/${date}`);
    const data = await res.json();
    if (!res.ok) {
      listEl.innerHTML = `<div class="gh-empty">${escapeHtml(data.error || '加载失败')}</div>`;
      return;
    }
    const items = data.items || [];
    if (items.length === 0) {
      listEl.innerHTML = '<div class="gh-empty">该日无视频数据</div>';
      return;
    }
    listEl.innerHTML = items.map(renderYtVideoCard).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="gh-empty">加载失败: ${escapeHtml(e.message)}</div>`;
  } finally {
    YT_STATE.loading = false;
  }
}

async function refreshYoutubeDaily() {
  const btn = document.getElementById('ytRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '抓取中...'; }
  try {
    const res = await fetch('/api/youtube/daily/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) alert('抓取失败: ' + (data.error || ''));
  } catch (e) {
    alert('抓取失败: ' + e.message);
  } finally {
    await loadYtDateIndex();
    if (btn) { btn.disabled = false; btn.textContent = '🔄 立即抓取'; }
  }
}

// ================ IT之家 AI 资讯（每日08:00抓20条,按日期沉淀） ================
const AIKN_STATE = {
  dates: [],
  currentDate: null,
  loading: false,
};

function renderAiknDateList() {
  const listEl = document.getElementById('aiknDateList');
  listEl.innerHTML = AIKN_STATE.dates.map(d => `
    <li class="gh-date-item ${d.date === AIKN_STATE.currentDate ? 'active' : ''}"
        onclick="loadAiknDate('${d.date}')">
      <span class="gh-date-name">${formatDateLabel(d.date)}</span>
      <span class="gh-date-count">${d.count}</span>
    </li>
  `).join('');
}

async function loadAiknDateIndex(selectDate) {
  const listEl = document.getElementById('aiknDateList');
  try {
    const res = await fetch('/api/news/itome');
    const data = await res.json();
    AIKN_STATE.dates = data.dates || [];
    renderAiknDateList();

    if (AIKN_STATE.dates.length === 0) {
      listEl.innerHTML = '<li class="gh-date-empty">暂无归档<br><small>等待首次抓取</small></li>';
      return;
    }
    const target = selectDate || AIKN_STATE.currentDate || AIKN_STATE.dates[0].date;
    if (AIKN_STATE.dates.some(d => d.date === target)) {
      loadAiknDate(target);
    } else {
      loadAiknDate(AIKN_STATE.dates[0].date);
    }
  } catch (e) {
    listEl.innerHTML = '<li class="gh-date-empty">日期加载失败</li>';
  }
}

function renderNewsCard(item) {
  const time = formatRelativeTime(item.publishedAt || item.publishedAtStr);
  const top3 = item.rank <= 3 ? ' top3' : '';
  return `
    <div class="news-item-card">
      <div class="news-item-rank">
        <span class="gh-rank${top3}">${item.rank}</span>
      </div>
      <div class="news-item-body">
        <a class="news-item-title" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
        ${item.summary ? `<div class="news-item-summary">${escapeHtml(item.summary.slice(0, 160))}${item.summary.length > 160 ? '…' : ''}</div>` : ''}
        <div class="news-item-meta">
          <span class="news-item-source">${escapeHtml(item.sourceName || 'IT之家')}</span>
          <span class="news-item-time">${escapeHtml(time)}</span>
        </div>
      </div>
    </div>
  `;
}

async function loadAiknDate(date) {
  if (AIKN_STATE.loading) return;
  AIKN_STATE.loading = true;
  AIKN_STATE.currentDate = date;
  renderAiknDateList();

  const listEl = document.getElementById('aiknFeedList');
  const titleEl = document.getElementById('aiknContentTitle');
  listEl.innerHTML = '<div class="gh-loading">正在加载 ' + date + ' 的资讯...</div>';
  titleEl.textContent = `IT之家 · AI 科技资讯 · ${date}`;

  try {
    const res = await fetch(`/api/news/itome/${date}`);
    const data = await res.json();
    if (!res.ok) {
      listEl.innerHTML = `<div class="gh-empty">${escapeHtml(data.error || '加载失败')}</div>`;
      return;
    }
    const items = data.items || [];
    if (items.length === 0) {
      listEl.innerHTML = '<div class="gh-empty">该日暂无 AI 相关资讯</div>';
      return;
    }
    listEl.innerHTML = items.map(renderNewsCard).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="gh-empty">加载失败: ${escapeHtml(e.message)}</div>`;
  } finally {
    AIKN_STATE.loading = false;
  }
}

async function refreshAiknFeed() {
  const btn = document.getElementById('aiknRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '抓取中...'; }
  try {
    const res = await fetch('/api/news/itome/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) alert('抓取失败: ' + (data.error || ''));
  } catch (e) {
    alert('抓取失败: ' + e.message);
  } finally {
    await loadAiknDateIndex();
    if (btn) { btn.disabled = false; btn.textContent = '🔄 立即抓取'; }
  }
}

// ================ 虎嗅 科技商业资讯（官方RSS, 每日08:00抓20条,按日期沉淀） ================
const HUXIU_STATE = {
  dates: [],
  currentDate: null,
  loading: false,
};

function renderHuxiuDateList() {
  const listEl = document.getElementById('huxiuDateList');
  listEl.innerHTML = HUXIU_STATE.dates.map(d => `
    <li class="gh-date-item ${d.date === HUXIU_STATE.currentDate ? 'active' : ''}"
        onclick="loadHuxiuDate('${d.date}')">
      <span class="gh-date-name">${formatDateLabel(d.date)}</span>
      <span class="gh-date-count">${d.count}</span>
    </li>
  `).join('');
}

async function loadHuxiuDateIndex(selectDate) {
  const listEl = document.getElementById('huxiuDateList');
  try {
    const res = await fetch('/api/news/huxiu');
    const data = await res.json();
    HUXIU_STATE.dates = data.dates || [];
    renderHuxiuDateList();

    if (HUXIU_STATE.dates.length === 0) {
      listEl.innerHTML = '<li class="gh-date-empty">暂无归档<br><small>等待首次抓取</small></li>';
      return;
    }
    const target = selectDate || HUXIU_STATE.currentDate || HUXIU_STATE.dates[0].date;
    if (HUXIU_STATE.dates.some(d => d.date === target)) {
      loadHuxiuDate(target);
    } else {
      loadHuxiuDate(HUXIU_STATE.dates[0].date);
    }
  } catch (e) {
    listEl.innerHTML = '<li class="gh-date-empty">日期加载失败</li>';
  }
}

async function loadHuxiuDate(date) {
  if (HUXIU_STATE.loading) return;
  HUXIU_STATE.loading = true;
  HUXIU_STATE.currentDate = date;
  renderHuxiuDateList();

  const listEl = document.getElementById('huxiuFeedList');
  const titleEl = document.getElementById('huxiuContentTitle');
  listEl.innerHTML = '<div class="gh-loading">正在加载 ' + date + ' 的资讯...</div>';
  titleEl.textContent = `虎嗅 · 前沿科技资讯 · ${date}`;

  try {
    const res = await fetch(`/api/news/huxiu/${date}`);
    const data = await res.json();
    if (!res.ok) {
      listEl.innerHTML = `<div class="gh-empty">${escapeHtml(data.error || '加载失败')}</div>`;
      return;
    }
    const items = data.items || [];
    if (items.length === 0) {
      listEl.innerHTML = '<div class="gh-empty">该日暂无资讯</div>';
      return;
    }
    listEl.innerHTML = items.map(renderNewsCard).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="gh-empty">加载失败: ${escapeHtml(e.message)}</div>`;
  } finally {
    HUXIU_STATE.loading = false;
  }
}

async function refreshHuxiuFeed() {
  const btn = document.getElementById('huxiuRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '抓取中...'; }
  try {
    const res = await fetch('/api/news/huxiu/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) alert('抓取失败: ' + (data.error || ''));
  } catch (e) {
    alert('抓取失败: ' + e.message);
  } finally {
    await loadHuxiuDateIndex();
    if (btn) { btn.disabled = false; btn.textContent = '🔄 立即抓取'; }
  }
}

// ================ 海外 AI 资讯（TechCrunch 官方RSS, 每日08:00抓20条,按日期沉淀） ================
const TCAI_STATE = {
  dates: [],
  currentDate: null,
  loading: false,
};

function renderTcAiDateList() {
  const listEl = document.getElementById('tcaiDateList');
  listEl.innerHTML = TCAI_STATE.dates.map(d => `
    <li class="gh-date-item ${d.date === TCAI_STATE.currentDate ? 'active' : ''}"
        onclick="loadTcAiDate('${d.date}')">
      <span class="gh-date-name">${formatDateLabel(d.date)}</span>
      <span class="gh-date-count">${d.count}</span>
    </li>
  `).join('');
}

async function loadTcAiDateIndex(selectDate) {
  const listEl = document.getElementById('tcaiDateList');
  try {
    const res = await fetch('/api/news/tcai');
    const data = await res.json();
    TCAI_STATE.dates = data.dates || [];
    renderTcAiDateList();

    if (TCAI_STATE.dates.length === 0) {
      listEl.innerHTML = '<li class="gh-date-empty">暂无归档<br><small>等待首次抓取</small></li>';
      return;
    }
    const target = selectDate || TCAI_STATE.currentDate || TCAI_STATE.dates[0].date;
    if (TCAI_STATE.dates.some(d => d.date === target)) {
      loadTcAiDate(target);
    } else {
      loadTcAiDate(TCAI_STATE.dates[0].date);
    }
  } catch (e) {
    listEl.innerHTML = '<li class="gh-date-empty">日期加载失败</li>';
  }
}

async function loadTcAiDate(date) {
  if (TCAI_STATE.loading) return;
  TCAI_STATE.loading = true;
  TCAI_STATE.currentDate = date;
  renderTcAiDateList();

  const listEl = document.getElementById('tcaiFeedList');
  const titleEl = document.getElementById('tcaiContentTitle');
  listEl.innerHTML = '<div class="gh-loading">正在加载 ' + date + ' 的资讯...</div>';
  titleEl.textContent = `海外 AI 资讯 · ${date}`;

  try {
    const res = await fetch(`/api/news/tcai/${date}`);
    const data = await res.json();
    if (!res.ok) {
      listEl.innerHTML = `<div class="gh-empty">${escapeHtml(data.error || '加载失败')}</div>`;
      return;
    }
    const items = data.items || [];
    if (items.length === 0) {
      listEl.innerHTML = '<div class="gh-empty">该日暂无资讯</div>';
      return;
    }
    listEl.innerHTML = items.map(renderNewsCard).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="gh-empty">加载失败: ${escapeHtml(e.message)}</div>`;
  } finally {
    TCAI_STATE.loading = false;
  }
}

async function refreshTcAiFeed() {
  const btn = document.getElementById('tcaiRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '抓取中...'; }
  try {
    const res = await fetch('/api/news/tcai/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) alert('抓取失败: ' + (data.error || ''));
  } catch (e) {
    alert('抓取失败: ' + e.message);
  } finally {
    await loadTcAiDateIndex();
    if (btn) { btn.disabled = false; btn.textContent = '🔄 立即抓取'; }
  }
}

// ================ Ars Technica（官方RSS, 每日08:00抓20条,按日期沉淀） ================
const ARS_STATE = {
  dates: [],
  currentDate: null,
  loading: false,
};

function renderArsDateList() {
  const listEl = document.getElementById('arsDateList');
  listEl.innerHTML = ARS_STATE.dates.map(d => `
    <li class="gh-date-item ${d.date === ARS_STATE.currentDate ? 'active' : ''}"
        onclick="loadArsDate('${d.date}')">
      <span class="gh-date-name">${formatDateLabel(d.date)}</span>
      <span class="gh-date-count">${d.count}</span>
    </li>
  `).join('');
}

async function loadArsDateIndex(selectDate) {
  const listEl = document.getElementById('arsDateList');
  try {
    const res = await fetch('/api/news/ars');
    const data = await res.json();
    ARS_STATE.dates = data.dates || [];
    renderArsDateList();

    if (ARS_STATE.dates.length === 0) {
      listEl.innerHTML = '<li class="gh-date-empty">暂无归档<br><small>等待首次抓取</small></li>';
      return;
    }
    const target = selectDate || ARS_STATE.currentDate || ARS_STATE.dates[0].date;
    if (ARS_STATE.dates.some(d => d.date === target)) {
      loadArsDate(target);
    } else {
      loadArsDate(ARS_STATE.dates[0].date);
    }
  } catch (e) {
    listEl.innerHTML = '<li class="gh-date-empty">日期加载失败</li>';
  }
}

async function loadArsDate(date) {
  if (ARS_STATE.loading) return;
  ARS_STATE.loading = true;
  ARS_STATE.currentDate = date;
  renderArsDateList();

  const listEl = document.getElementById('arsFeedList');
  const titleEl = document.getElementById('arsContentTitle');
  listEl.innerHTML = '<div class="gh-loading">正在加载 ' + date + ' 的资讯...</div>';
  titleEl.textContent = `Ars Technica · 科技深度资讯 · ${date}`;

  try {
    const res = await fetch(`/api/news/ars/${date}`);
    const data = await res.json();
    if (!res.ok) {
      listEl.innerHTML = `<div class="gh-empty">${escapeHtml(data.error || '加载失败')}</div>`;
      return;
    }
    const items = data.items || [];
    if (items.length === 0) {
      listEl.innerHTML = '<div class="gh-empty">该日暂无资讯</div>';
      return;
    }
    listEl.innerHTML = items.map(renderNewsCard).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="gh-empty">加载失败: ${escapeHtml(e.message)}</div>`;
  } finally {
    ARS_STATE.loading = false;
  }
}

async function refreshArsFeed() {
  const btn = document.getElementById('arsRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '抓取中...'; }
  try {
    const res = await fetch('/api/news/ars/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) alert('抓取失败: ' + (data.error || ''));
  } catch (e) {
    alert('抓取失败: ' + e.message);
  } finally {
    await loadArsDateIndex();
    if (btn) { btn.disabled = false; btn.textContent = '🔄 立即抓取'; }
  }
}

// ================ GitHub 涨星日报（日期索引） ================
async function loadDateIndex(selectDate) {
  const listEl = document.getElementById('ghDateList');
  try {
    const res = await fetch('/api/github/trending');
    const data = await res.json();
    GH_STATE.dates = data.dates || [];
    renderDateList();

    if (GH_STATE.dates.length === 0) {
      listEl.innerHTML = '<li class="gh-date-empty">暂无归档<br><small>等待首次抓取</small></li>';
      return;
    }
    const target = selectDate || GH_STATE.currentDate || GH_STATE.dates[0].date;
    if (GH_STATE.dates.some(d => d.date === target)) {
      loadDate(target);
    } else {
      loadDate(GH_STATE.dates[0].date);
    }
  } catch (e) {
    listEl.innerHTML = '<li class="gh-date-empty">日期加载失败</li>';
  }
}

function renderDateList() {
  const listEl = document.getElementById('ghDateList');
  listEl.innerHTML = GH_STATE.dates.map(d => `
    <li class="gh-date-item ${d.date === GH_STATE.currentDate ? 'active' : ''}"
        onclick="loadDate('${d.date}')">
      <span class="gh-date-name">${formatDateLabel(d.date)}</span>
      <span class="gh-date-count">${d.count}</span>
    </li>
  `).join('');
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / (24 * 60 * 60 * 1000));
  const suffix = diff === 0 ? ' 今天' : diff === 1 ? ' 昨天' : '';
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return `${dateStr.slice(5).replace('-', '/')} ${week}${suffix}`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatStars(n) {
  n = Number(n) || 0;
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function renderRepoCard(item) {
  const top3 = item.rank <= 3 ? ' top3' : '';
  const topics = (item.topics || []).slice(0, 5).map(t =>
    `<span class="gh-topic-chip">${escapeHtml(t)}</span>`).join('');
  const detail = item.detailIntro
    ? `<div class="gh-repo-detail">📖 ${escapeHtml(item.detailIntro)}${item.detailIntro.length >= 790 ? '…' : ''}</div>`
    : '';
  // 周报: 显示一周 star 增幅徽章
  const delta = item.starDelta != null
    ? ` <span class="gh-delta">▲ +${item.starDelta.toLocaleString()}</span>`
    : '';
  return `
    <div class="gh-repo-card">
      <div class="gh-repo-top">
        <span class="gh-rank${top3}">${item.rank}</span>
        ${item.ownerAvatar ? `<img class="gh-owner-avatar" src="${escapeHtml(item.ownerAvatar)}" alt="">` : ''}
        <a class="gh-repo-name" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name)}</a>
        <div class="gh-repo-stats">
          <span class="gh-stat">⭐ ${formatStars(item.stars)}</span>
          ${delta}
          <span class="gh-stat">🍴 ${formatStars(item.forks)}</span>
        </div>
      </div>
      ${item.description ? `<div class="gh-repo-desc">${escapeHtml(item.description)}</div>` : ''}
      ${detail}
      <div class="gh-repo-meta">
        ${item.language ? `<span class="gh-meta-chip">🔵 ${escapeHtml(item.language)}</span>` : ''}
        ${item.license ? `<span class="gh-meta-chip">📜 ${escapeHtml(item.license)}</span>` : ''}
        ${topics}
        <div class="gh-repo-links">
          <a class="gh-link-btn" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">仓库</a>
          ${item.homepage ? `<a class="gh-link-btn" href="${escapeHtml(item.homepage)}" target="_blank" rel="noopener noreferrer">主页</a>` : ''}
        </div>
      </div>
    </div>
  `;
}

async function loadDate(date) {
  if (GH_STATE.loading) return;
  GH_STATE.loading = true;
  GH_STATE.currentDate = date;
  renderDateList();

  const listEl = document.getElementById('ghRepoList');
  const titleEl = document.getElementById('ghContentTitle');
  listEl.innerHTML = '<div class="gh-loading">正在加载 ' + date + ' 的项目...</div>';
  titleEl.textContent = `GitHub 涨星日报 · ${date}`;

  try {
    const res = await fetch(`/api/github/trending/${date}`);
    const data = await res.json();
    if (!res.ok) {
      listEl.innerHTML = `<div class="gh-empty">${escapeHtml(data.error || '加载失败')}</div>`;
      return;
    }
    if (!data.items || data.items.length === 0) {
      listEl.innerHTML = '<div class="gh-empty">该日期暂无项目</div>';
      return;
    }
    listEl.innerHTML = data.items.map(renderRepoCard).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="gh-empty">加载失败: ${escapeHtml(e.message)}</div>`;
  } finally {
    GH_STATE.loading = false;
  }
}

async function refreshTrending() {
  const btn = document.getElementById('ghRefreshBtn');
  btn.disabled = true;
  btn.textContent = '抓取中...';
  try {
    const res = await fetch('/api/github/trending/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      alert('抓取失败: ' + (data.error || ''));
      return;
    }
    await loadDateIndex(data.date);
  } catch (e) {
    alert('抓取失败: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 立即抓取';
  }
}

// ================ 视频生成 ================
let videoPollTimer = null;

async function generateVideo() {
  const btn = document.getElementById('ghVideoBtn');
  const statusEl = document.getElementById('ghVideoStatus');
  btn.disabled = true;
  statusEl.className = 'gh-video-status';
  statusEl.textContent = '启动中...';
  try {
    const date = GH_STATE.currentDate || '';
    const res = await fetch('/api/github/video/generate' + (date ? `?date=${date}` : ''), { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      statusEl.className = 'gh-video-status error';
      statusEl.textContent = data.error || '启动失败';
      btn.disabled = false;
      return;
    }
    pollVideoStatus();
  } catch (e) {
    statusEl.className = 'gh-video-status error';
    statusEl.textContent = '启动失败: ' + e.message;
    btn.disabled = false;
  }
}

function pollVideoStatus() {
  clearTimeout(videoPollTimer);
  videoPollTimer = setInterval(async () => {
    try {
      const res = await fetch('/api/github/video/status');
      const job = await res.json();
      const btn = document.getElementById('ghVideoBtn');
      const statusEl = document.getElementById('ghVideoStatus');
      if (job.state === 'running') {
        statusEl.className = 'gh-video-status';
        statusEl.textContent = `${job.step || '处理中'} ${job.progress || 0}%（渲染约需 8 分钟）`;
        btn.disabled = true;
      } else if (job.state === 'done') {
        statusEl.className = 'gh-video-status';
        statusEl.innerHTML = `✅ ${escapeHtml(job.date || '')} 成片：` +
          `<a href="${job.videoUrl}" target="_blank" download>▶ 观看/下载</a>`;
        btn.disabled = false;
        clearInterval(videoPollTimer);
        videoPollTimer = null;
      } else if (job.state === 'error') {
        statusEl.className = 'gh-video-status error';
        statusEl.textContent = '❌ ' + (job.error || '生成失败');
        btn.disabled = false;
        clearInterval(videoPollTimer);
        videoPollTimer = null;
      } else {
        btn.disabled = false;
        clearInterval(videoPollTimer);
        videoPollTimer = null;
      }
    } catch {
      /* 服务重启等瞬时错误，下个周期再试 */
    }
  }, 10000);
}

// 页面加载时若有任务在跑，恢复进度显示
(async function initVideoStatus() {
  try {
    const res = await fetch('/api/github/video/status');
    const job = await res.json();
    const statusEl = document.getElementById('ghVideoStatus');
    if (!statusEl) return;
    if (job.state === 'running') {
      statusEl.textContent = `${job.step || '处理中'} ${job.progress || 0}%`;
      pollVideoStatus();
    } else if (job.state === 'done' && job.videoUrl) {
      statusEl.innerHTML = `✅ ${escapeHtml(job.date || '')} 成片：` +
        `<a href="${job.videoUrl}" target="_blank" download>▶ 观看/下载</a>`;
    }
  } catch { /* ignore */ }
})();

// ================ 周报归档 ================
const GH_WEEK_STATE = {
  weeks: [],
  currentWeek: null,
  loading: false,
};

// 切换侧边栏归档 tab: daily / weekly
function switchArchiveTab(type) {
  document.querySelectorAll('#ghSidebar .gh-sidebar-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.arch === type);
  });
  const dailyList = document.getElementById('ghDateList');
  const weekList = document.getElementById('ghWeekList');
  if (dailyList) dailyList.style.display = type === 'daily' ? '' : 'none';
  if (weekList) weekList.style.display = type === 'weekly' ? '' : 'none';
  // 首次进入周报时懒加载
  if (type === 'weekly' && GH_WEEK_STATE.weeks.length === 0) {
    loadWeekIndex();
  }
}

function renderWeekList() {
  const listEl = document.getElementById('ghWeekList');
  listEl.innerHTML = GH_WEEK_STATE.weeks.map(w => `
    <li class="gh-date-item ${w.week === GH_WEEK_STATE.currentWeek ? 'active' : ''}"
        onclick="loadWeek('${w.week}')">
      <span class="gh-date-name">${escapeHtml(w.label)}</span>
      <span class="gh-date-count">${w.count}</span>
    </li>
  `).join('');
}

async function loadWeekIndex(selectWeek) {
  const listEl = document.getElementById('ghWeekList');
  try {
    const res = await fetch('/api/github/weekly');
    const data = await res.json();
    GH_WEEK_STATE.weeks = data.weeks || [];
    renderWeekList();

    if (GH_WEEK_STATE.weeks.length === 0) {
      listEl.innerHTML = '<li class="gh-date-empty">暂无周报<br><small>等待首次抓取</small></li>';
      return;
    }
    const target = selectWeek || GH_WEEK_STATE.currentWeek || GH_WEEK_STATE.weeks[0].week;
    if (GH_WEEK_STATE.weeks.some(w => w.week === target)) {
      loadWeek(target);
    } else {
      loadWeek(GH_WEEK_STATE.weeks[0].week);
    }
  } catch (e) {
    listEl.innerHTML = '<li class="gh-date-empty">周报加载失败</li>';
  }
}

async function loadWeek(week) {
  if (GH_WEEK_STATE.loading) return;
  GH_WEEK_STATE.loading = true;
  GH_WEEK_STATE.currentWeek = week;
  renderWeekList();

  const listEl = document.getElementById('ghRepoList');
  const titleEl = document.getElementById('ghContentTitle');
  const subEl = document.getElementById('ghContentSubtitle');
  listEl.innerHTML = '<div class="gh-loading">正在加载周榜...</div>';
  titleEl.textContent = `GitHub 涨星周报 · ${week}`;

  try {
    const res = await fetch(`/api/github/weekly/${week}`);
    const data = await res.json();
    if (!res.ok) {
      listEl.innerHTML = `<div class="gh-empty">${escapeHtml(data.error || '加载失败')}</div>`;
      return;
    }
    const items = data.items || [];
    titleEl.textContent = `GitHub 涨星周报 · ${data.label || week}`;
    if (subEl) subEl.textContent = `每周一 08:00 自动抓取本周 star 增幅最大的 top ${items.length}`;
    if (items.length === 0) {
      listEl.innerHTML = '<div class="gh-empty">该周无数据</div>';
      return;
    }
    listEl.innerHTML = items.map(renderRepoCard).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="gh-empty">加载失败: ${escapeHtml(e.message)}</div>`;
  } finally {
    GH_WEEK_STATE.loading = false;
  }
}

// 事件委托: 点击 tab 行内任意按钮即可切换（不依赖内联 onclick，JS 加载成功就能点）
const newsTabsEl = document.getElementById('newsTabs');
if (newsTabsEl) {
  newsTabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.news-tab');
    if (btn && btn.dataset.tab) switchNewsTab(btn.dataset.tab);
  });
}

// 事件委托: 侧边栏 日报/周报 tab 切换
const ghSidebarEl = document.getElementById('ghSidebar');
if (ghSidebarEl) {
  ghSidebarEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.gh-sidebar-tab');
    if (tab && tab.dataset.arch) switchArchiveTab(tab.dataset.arch);
  });
}

// AI 资讯刷新按钮绑定（HTML 无内联 onclick，此处事件委托）
const aiknRefreshBtn = document.getElementById('aiknRefreshBtn');
if (aiknRefreshBtn) {
  aiknRefreshBtn.addEventListener('click', refreshAiknFeed);
}

// B站刷新按钮绑定
const biliRefreshBtn = document.getElementById('biliRefreshBtn');
if (biliRefreshBtn) {
  biliRefreshBtn.addEventListener('click', refreshBiliDaily);
}

// 虎嗅刷新按钮绑定
const huxiuRefreshBtn = document.getElementById('huxiuRefreshBtn');
if (huxiuRefreshBtn) {
  huxiuRefreshBtn.addEventListener('click', refreshHuxiuFeed);
}

// 海外AI刷新按钮绑定
const tcaiRefreshBtn = document.getElementById('tcaiRefreshBtn');
if (tcaiRefreshBtn) {
  tcaiRefreshBtn.addEventListener('click', refreshTcAiFeed);
}

// Ars Technica刷新按钮绑定
const arsRefreshBtn = document.getElementById('arsRefreshBtn');
if (arsRefreshBtn) {
  arsRefreshBtn.addEventListener('click', refreshArsFeed);
}

// 初始化: 进入 GitHub tab 并触发懒加载
switchNewsTab('github');

window.loadDate = loadDate;
window.refreshTrending = refreshTrending;
window.generateVideo = generateVideo;
window.switchNewsTab = switchNewsTab;
window.loadWeek = loadWeek;
window.switchArchiveTab = switchArchiveTab;
window.loadBiliDate = loadBiliDate;
window.refreshBiliDaily = refreshBiliDaily;
window.loadYtDate = loadYtDate;
window.refreshYoutubeDaily = refreshYoutubeDaily;
window.loadAiknFeed = loadAiknDateIndex;
window.loadAiknDate = loadAiknDate;
window.refreshAiknFeed = refreshAiknFeed;
window.loadHuxiuFeed = loadHuxiuDateIndex;
window.loadHuxiuDate = loadHuxiuDate;
window.refreshHuxiuFeed = refreshHuxiuFeed;
window.loadTcAiFeed = loadTcAiDateIndex;
window.loadTcAiDate = loadTcAiDate;
window.refreshTcAiFeed = refreshTcAiFeed;
window.loadArsFeed = loadArsDateIndex;
window.loadArsDate = loadArsDate;
window.refreshArsFeed = refreshArsFeed;
