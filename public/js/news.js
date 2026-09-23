// ================ 资讯模块 ================
const NEWS_STATE = {
  region: 'all',   // all | cn | en
  sort: 'latest',  // latest | hot
  sourceId: 'all',
  offset: 0,
  limit: 40,
  total: 0,
  loading: false,
  lastRefresh: 0,
};

function setActiveNavHighlight(isNews) {
  const links = document.querySelectorAll('.nav-links a');
  links.forEach(a => {
    a.classList.remove('active', 'active-news-view');
    if (isNews && a.textContent.trim() === '资讯') a.classList.add('active-news-view');
    if (!isNews && a.getAttribute('href') === '/project.html') a.classList.add('active');
  });
}

function showNewsView() {
  document.getElementById('kbContainer').style.display = 'none';
  const detailView = document.getElementById('detailView');
  if (detailView) detailView.style.display = 'none';
  document.getElementById('newsView').style.display = 'block';
  setActiveNavHighlight(true);
  window.scrollTo(0, 0);
  if (NEWS_STATE.offset === 0) {
    loadNews();
    loadSources();
  }
}

function backToKanbanFromNews() {
  document.getElementById('newsView').style.display = 'none';
  document.getElementById('kbContainer').style.display = 'block';
  setActiveNavHighlight(false);
}

// Hook into closeDetailView (if on kanban.js), ensure nav state is correct
(function () {
  const origClose = window.closeDetailView;
  window.closeDetailView = function () {
    if (origClose) origClose.apply(this, arguments);
    setActiveNavHighlight(false);
  };
})();

// Also hook the original "项目" link to hide newsView if open
document.addEventListener('DOMContentLoaded', function () {
  const projLinks = document.querySelectorAll('.nav-links a[href="/project.html"]');
  projLinks.forEach(a => {
    a.addEventListener('click', function (e) {
      if (document.getElementById('newsView').style.display === 'block') {
        e.preventDefault();
        backToKanbanFromNews();
      }
    });
  });
});

function setNewsRegion(r) {
  NEWS_STATE.region = r;
  NEWS_STATE.offset = 0;
  document.querySelectorAll('#newsRegionTabs .news-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.region === r);
  });
  loadNews();
}

function setNewsSort(s) {
  NEWS_STATE.sort = s;
  NEWS_STATE.offset = 0;
  document.querySelectorAll('#newsSortTabs .news-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.sort === s);
  });
  loadNews();
}

function setNewsSource(sourceId) {
  NEWS_STATE.sourceId = sourceId;
  NEWS_STATE.offset = 0;
  document.querySelectorAll('#newsSourcesBar .news-source-chip').forEach(b => {
    b.classList.toggle('active', b.dataset.source === sourceId);
  });
  loadNews();
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - Number(timestamp);
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr, wk = 7 * day;
  if (diff < min) return '刚刚';
  if (diff < hr) return Math.floor(diff / min) + '分钟前';
  if (diff < day) return Math.floor(diff / hr) + '小时前';
  if (diff < wk) return Math.floor(diff / day) + '天前';
  const d = new Date(Number(timestamp));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderNewsCard(item) {
  const regionClass = item.region === 'cn' ? 'news-card-region-cn' : 'news-card-region-en';
  const title = (item.title || '(无标题)').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const summary = (item.summary || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const source = (item.sourceName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const author = item.author ? item.author.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
  const link = item.link ? item.link.replace(/"/g, '&quot;') : '#';
  const category = item.category || '';
  const hotBadge = NEWS_STATE.sort === 'hot' ? `<span class="news-card-hot">🔥 ${item.hotScore}</span>` : '';

  return `
    <div class="news-card" onclick="window.open('${link}','_blank','noopener,noreferrer')">
      <div class="news-card-top">
        <span class="news-card-source ${regionClass}">${source}</span>
        ${category ? `<span class="news-card-category">${category}</span>` : ''}
        ${hotBadge}
        <span class="news-card-time">${formatTimeAgo(item.publishedAt)}</span>
      </div>
      <h3 class="news-card-title"><a href="${link}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${title}</a></h3>
      ${summary ? `<p class="news-card-summary">${summary}</p>` : ''}
      ${author ? `<span class="news-card-author">作者: ${author}</span>` : ''}
    </div>
  `;
}

async function loadNews(append = false) {
  if (NEWS_STATE.loading) return;
  NEWS_STATE.loading = true;

  const listEl = document.getElementById('newsList');
  const loadMoreWrap = document.getElementById('newsLoadMoreWrap');

  if (!append) {
    listEl.innerHTML = '<div class="news-loading">正在加载资讯...</div>';
    loadMoreWrap.style.display = 'none';
  }

  const params = new URLSearchParams({
    region: NEWS_STATE.region,
    sort: NEWS_STATE.sort,
    limit: NEWS_STATE.limit,
    offset: NEWS_STATE.offset,
  });
  if (NEWS_STATE.sourceId !== 'all') params.set('sourceId', NEWS_STATE.sourceId);

  try {
    const res = await fetch(`/api/news?${params.toString()}`);
    const data = await res.json();
    NEWS_STATE.total = data.total || 0;
    NEWS_STATE.lastRefresh = data.lastRefresh || 0;
    updateLastRefreshLabel();

    if (!append) listEl.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      if (!append) {
        listEl.innerHTML = '<div class="news-empty">暂无资讯，点击"立即刷新"尝试重新拉取。<br><small>注: 首次启动或部分 RSS 源可能暂时无法访问。</small></div>';
      }
      loadMoreWrap.style.display = 'none';
      return;
    }

    const html = data.items.map(renderNewsCard).join('');
    if (append) {
      listEl.insertAdjacentHTML('beforeend', html);
    } else {
      listEl.innerHTML = html;
    }

    NEWS_STATE.offset += data.items.length;
    loadMoreWrap.style.display = NEWS_STATE.offset < NEWS_STATE.total ? 'block' : 'none';
  } catch (e) {
    if (!append) {
      listEl.innerHTML = `<div class="news-empty">加载失败: ${e.message}</div>`;
    }
  } finally {
    NEWS_STATE.loading = false;
  }
}

function loadMoreNews() {
  loadNews(true);
}

async function loadSources() {
  try {
    const res = await fetch('/api/news/sources');
    const data = await res.json();
    const wrap = document.getElementById('newsSourcesList');
    if (!wrap || !data.sources) return;
    const chips = data.sources.map(s => {
      const cls = ['news-source-chip'];
      if (NEWS_STATE.sourceId === s.id) cls.push('active');
      if (s.error) cls.push('has-error');
      const countBadge = s.count != null ? ` <small style="opacity:0.6">(${s.count})</small>` : '';
      const title = s.error ? `title="错误: ${s.error.replace(/"/g, '&quot;')}"` : '';
      return `<button class="${cls.join(' ')}" data-source="${s.id}" ${title} onclick="setNewsSource('${s.id}')">${s.name}${countBadge}</button>`;
    }).join('');
    wrap.innerHTML = chips;
    // 如果当前选中的源不存在于列表，重置为"全部"
    if (NEWS_STATE.sourceId !== 'all' && !data.sources.some(s => s.id === NEWS_STATE.sourceId)) {
      setNewsSource('all');
    }
  } catch (e) {
    // silent
  }
}

function updateLastRefreshLabel() {
  const el = document.getElementById('newsLastRefresh');
  if (!el || !NEWS_STATE.lastRefresh) return;
  el.textContent = '上次更新: ' + formatTimeAgo(NEWS_STATE.lastRefresh);
}

async function refreshNews() {
  const btn = document.querySelector('.news-btn-refresh');
  if (btn) { btn.disabled = true; btn.textContent = '刷新中...'; }
  try {
    await fetch('/api/news/refresh', { method: 'POST' });
    NEWS_STATE.offset = 0;
    await Promise.all([loadNews(), loadSources()]);
  } catch (e) {
    alert('刷新失败: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 立即刷新'; }
  }
}

// Periodically update "xx分钟前"
setInterval(function () {
  if (document.getElementById('newsView').style.display !== 'block') return;
  document.querySelectorAll('.news-card-time').forEach(function (el) {
    // 不做实时 DOM 重算，只重新渲染标签时间
  });
  updateLastRefreshLabel();
}, 60000);

// Expose to global
window.showNewsView = showNewsView;
window.backToKanbanFromNews = backToKanbanFromNews;
window.setNewsRegion = setNewsRegion;
window.setNewsSort = setNewsSort;
window.setNewsSource = setNewsSource;
window.loadMoreNews = loadMoreNews;
window.refreshNews = refreshNews;
