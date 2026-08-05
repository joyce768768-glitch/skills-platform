const API_BASE = '';
let currentCategory = '';
let currentSearch = '';
let allSkills = [];
let categories = [];

// Load categories and skills
async function init() {
  try {
    const [catsRes, skillsRes] = await Promise.all([
      fetch(`${API_BASE}/api/categories`),
      fetch(`${API_BASE}/api/skills`)
    ]);
    
    categories = await catsRes.json();
    allSkills = await skillsRes.json();
    
    renderCategories();
    renderSkills();
    setupSearch();
  } catch (e) {
    console.error('Failed to load data:', e);
    showToast('加载数据失败', 'error');
  }
}

function renderCategories() {
  const container = document.getElementById('categoryFilters');
  
  // "All" chip
  const allChip = document.createElement('div');
  allChip.className = 'category-chip active';
  allChip.innerHTML = '<span>🌟</span> 全部';
  allChip.onclick = () => {
    currentCategory = '';
    updateActiveCategory();
    renderSkills();
  };
  container.appendChild(allChip);
  
  categories.forEach(cat => {
    const chip = document.createElement('div');
    chip.className = 'category-chip';
    chip.innerHTML = `<span>${cat.icon}</span> ${cat.name}`;
    chip.onclick = () => {
      currentCategory = cat.id;
      updateActiveCategory();
      renderSkills();
    };
    container.appendChild(chip);
  });
}

function updateActiveCategory() {
  document.querySelectorAll('.category-chip').forEach((chip, idx) => {
    if (idx === 0 && !currentCategory) {
      chip.classList.add('active');
    } else if (categories[idx - 1] && categories[idx - 1].id === currentCategory) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function renderSkills() {
  const grid = document.getElementById('skillsGrid');
  const emptyState = document.getElementById('emptyState');
  
  let filtered = allSkills;
  
  if (currentCategory) {
    filtered = filtered.filter(s => s.categoryId === currentCategory);
  }
  
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    filtered = filtered.filter(s =>
      (s.nameZh && s.nameZh.toLowerCase().includes(q)) ||
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.descriptionZh && s.descriptionZh.toLowerCase().includes(q)) ||
      (s.description && s.description.toLowerCase().includes(q))
    );
  }
  
  grid.innerHTML = '';
  
  if (filtered.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  
  emptyState.style.display = 'none';
  
  filtered.forEach(skill => {
    const catName = getCategoryName(skill.categoryId);
    const tags = (skill.topics || []).slice(0, 3);
    
    const card = document.createElement('div');
    card.className = 'skill-card';
    
    card.innerHTML = `
      <div class="skill-card-header">
        <div class="skill-icon">${getSkillIcon(skill)}</div>
        <div class="skill-info">
          <div class="skill-title">${escapeHtml(skill.nameZh || skill.name || '未命名')}</div>
          <div class="skill-meta">
            ${skill.stars ? `<span>⭐ ${skill.stars}</span>` : ''}
            ${skill.language ? `<span>🔵 ${skill.language}</span>` : ''}
            ${catName ? `<span>${getCategoryIcon(skill.categoryId)} ${catName}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="skill-description">${escapeHtml(skill.descriptionZh || skill.description || '暂无描述')}</div>
      ${tags.length > 0 ? `
        <div class="skill-tags">
          ${tags.map(t => `<span class="skill-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
      ` : ''}
      <div class="skill-actions">
        ${skill.downloadUrl ? `
          <a href="${skill.downloadUrl}" class="btn btn-primary" download>
            <span>⬇️</span> 下载
          </a>
        ` : ''}
        ${skill.githubUrl ? `
          <a href="${skill.githubUrl}" class="btn btn-secondary" target="_blank" rel="noopener">
            <span>🔗</span> GitHub
          </a>
        ` : ''}
      </div>
    `;
    
    grid.appendChild(card);
  });
}

function getCategoryName(categoryId) {
  const cat = categories.find(c => c.id === categoryId);
  return cat ? cat.name : '';
}

function getCategoryIcon(categoryId) {
  const cat = categories.find(c => c.id === categoryId);
  return cat ? cat.icon : '📁';
}

function getSkillIcon(skill) {
  if (skill.language) {
    const langIcons = {
      'JavaScript': '🟨',
      'TypeScript': '🔷',
      'Python': '🐍',
      'HTML': '🟥',
      'CSS': '🔵',
      'Go': '🐹',
      'Rust': '🦀',
      'Swift': '🕊️',
      'Java': '☕',
      'Vue': '🟢',
      'React': '⚛️'
    };
    return langIcons[skill.language] || '📦';
  }
  return '📦';
}

function setupSearch() {
  const input = document.getElementById('searchInput');
  let timeout;
  input.addEventListener('input', (e) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      currentSearch = e.target.value.trim();
      renderSkills();
    }, 300);
  });
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

init();
