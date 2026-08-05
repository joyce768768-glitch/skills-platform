let bookmarkData = null;
let currentProfile = '';
let searchQuery = '';
let editTarget = null;
let syncTimer = null;
let collapsedFolders = new Set();
let expandedFolders = new Set();

const ROOT_KEYS = ['bookmark_bar', 'other', 'synced'];

async function init() {
  await loadProfiles();
  await loadBookmarks();
  renderTree();
  renderGrid();
  setupSearch();
  startAutoSync();
}

async function loadProfiles() {
  try {
    const res = await fetch('/api/bookmarks/profiles');
    const profiles = await res.json();
    const select = document.getElementById('profileSelect');
    select.innerHTML = profiles.map(p =>
      `<option value="${p.id}">${escapeHtml(p.displayName)}</option>`
    ).join('');
    if (profiles.length > 0) currentProfile = profiles[0].id;
  } catch (e) {
    showToast('加载Chrome Profile失败', 'error');
  }
}

async function loadBookmarks() {
  try {
    const res = await fetch(`/api/bookmarks?profile=${encodeURIComponent(currentProfile)}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    const result = await res.json();
    bookmarkData = result.data;
    currentProfile = result.profile;
  } catch (e) {
    showToast(e.message, 'error');
    bookmarkData = null;
  }
}

async function saveBookmarks() {
  try {
    const res = await fetch(`/api/bookmarks?profile=${encodeURIComponent(currentProfile)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookmarkData)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    return true;
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
    return false;
  }
}

// ===== Sidebar Tree (quick navigation) =====
function renderTree() {
  const container = document.getElementById('bmTree');
  container.innerHTML = '';
  if (!bookmarkData) return;

  ROOT_KEYS.forEach(key => {
    const root = bookmarkData.roots[key];
    if (!root) return;
    container.appendChild(createTreeNode(root, key, 0));
  });
}

function createTreeNode(node, nodeId, depth) {
  const wrapper = document.createElement('div');

  const item = document.createElement('div');
  item.className = 'bm-tree-item';
  item.dataset.folderId = nodeId;

  const childFolders = node.children ? node.children.filter(c => c.type === 'folder') : [];
  const hasFolders = childFolders.length > 0;

  item.innerHTML = `
    <span class="bm-tree-toggle">${hasFolders ? '▶' : ''}</span>
    <span class="bm-tree-icon">${nodeId === 'bookmark_bar' ? '📑' : nodeId === 'other' ? '📋' : nodeId === 'synced' ? '📱' : '📁'}</span>
    <span class="bm-tree-name">${escapeHtml(node.name)}</span>
  `;

  item.addEventListener('click', (e) => {
    if (e.target.classList.contains('bm-tree-toggle') && hasFolders) {
      toggleChildren(wrapper);
    } else {
      scrollToFolder(nodeId);
    }
  });

  // Drop target for moving bookmarks
  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    item.classList.add('drop-target');
  });
  item.addEventListener('dragleave', () => {
    item.classList.remove('drop-target');
  });
  item.addEventListener('drop', (e) => {
    e.preventDefault();
    item.classList.remove('drop-target');
    const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
    if (dragData.type === 'bookmark' || dragData.type === 'folder') {
      moveItem(dragData.id, nodeId);
    }
  });

  wrapper.appendChild(item);

  if (hasFolders) {
    const childContainer = document.createElement('div');
    childContainer.className = 'bm-tree-children';
    childFolders.forEach(child => {
      const childId = nodeId + '/' + child.id;
      childContainer.appendChild(createTreeNode(child, childId, depth + 1));
    });
    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

function toggleChildren(wrapper) {
  const childContainer = wrapper.querySelector('.bm-tree-children');
  if (!childContainer) return;
  const toggle = wrapper.querySelector('.bm-tree-toggle');
  if (childContainer.style.display === 'none' || !childContainer.style.display) {
    childContainer.style.display = 'block';
    toggle.textContent = '▼';
  } else {
    childContainer.style.display = 'none';
    toggle.textContent = '▶';
  }
}

function scrollToFolder(folderId) {
  const el = document.getElementById('section-' + folderId);
  if (el) {
    const offset = 60;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: top, behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
  }
}

// ===== Rendering: root sections → 3-col masonry → folder blocks =====
function renderGrid() {
  const container = document.getElementById('bmGrid');
  const empty = document.getElementById('bmEmpty');
  container.innerHTML = '';

  if (!bookmarkData) return;

  if (searchQuery) {
    renderSearchResults(container, empty);
    return;
  }

  empty.style.display = 'none';

  ROOT_KEYS.forEach(key => {
    const root = bookmarkData.roots[key];
    if (!root || !root.children || root.children.length === 0) return;
    container.appendChild(renderRootSection(root, key));
  });
}

// Root (书签栏/其他书签/移动设备书签) = full-width header + 3-col masonry
function renderRootSection(folder, folderId) {
  const section = document.createElement('section');
  section.className = 'bm-section';
  section.id = 'section-' + folderId;

  const isCollapsed = collapsedFolders.has(folderId);
  const totalCount = (folder.children || []).length;

  const header = document.createElement('div');
  header.className = 'bm-section-header' + (isCollapsed ? ' collapsed' : '');
  header.innerHTML = `
    <span class="bm-section-toggle">${isCollapsed ? '▶' : '▼'}</span>
    <span class="bm-section-icon">${folderId === 'bookmark_bar' ? '📑' : folderId === 'other' ? '📋' : folderId === 'synced' ? '📱' : '📁'}</span>
    <span class="bm-section-name">${escapeHtml(folder.name)}</span>
    <span class="bm-section-count">${totalCount}</span>
    <div class="bm-section-actions">
      <button class="bm-card-action" onclick="event.stopPropagation();addBookmarkTo('${folderId}')" title="添加书签">+</button>
    </div>
  `;

  header.addEventListener('dragover', (e) => { e.preventDefault(); header.classList.add('drop-target'); });
  header.addEventListener('dragleave', () => { header.classList.remove('drop-target'); });
  header.addEventListener('drop', (e) => {
    e.preventDefault();
    header.classList.remove('drop-target');
    const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
    if (dragData.id && dragData.parentId !== folderId) moveItem(dragData.id, folderId);
  });

  header.addEventListener('click', () => {
    if (isCollapsed) collapsedFolders.delete(folderId);
    else collapsedFolders.add(folderId);
    renderGrid();
  });

  section.appendChild(header);

  if (!isCollapsed) {
    const masonry = document.createElement('div');
    masonry.className = 'bm-masonry';

    folder.children.forEach((item, index) => {
      const childId = folderId + '/' + item.id;
      if (item.type === 'folder') {
        masonry.appendChild(renderFolderBlock(item, childId, folderId, index));
      } else {
        masonry.appendChild(createCard(item, folderId, index));
      }
    });

    section.appendChild(masonry);
  }

  return section;
}

// Level-1 folder = open block with header + visible URLs + collapsed sub-folder cards
function renderFolderBlock(folder, folderId, parentId, index) {
  const block = document.createElement('div');
  block.className = 'bm-folder-block';
  block.id = 'section-' + folderId;

  const isCollapsed = collapsedFolders.has(folderId);
  const childUrls = (folder.children || []).filter(c => c.type === 'url');
  const childFolders = (folder.children || []).filter(c => c.type === 'folder');

  // Block header
  const header = document.createElement('div');
  header.className = 'bm-block-header' + (isCollapsed ? ' collapsed' : '');
  header.innerHTML = `
    <span class="bm-block-toggle">${isCollapsed ? '▶' : '▼'}</span>
    <span class="bm-block-icon">📁</span>
    <span class="bm-block-name">${escapeHtml(folder.name)}</span>
    <span class="bm-block-count">${childUrls.length}</span>
    <div class="bm-block-actions">
      <button class="bm-card-action" onclick="event.stopPropagation();addBookmarkTo('${folderId}')" title="添加书签">+</button>
      <button class="bm-card-action" onclick="event.stopPropagation();editFolder('${folder.id}','${parentId}')" title="编辑">✏️</button>
      <button class="bm-card-action danger" onclick="event.stopPropagation();deleteItem('${folder.id}','${parentId}')" title="删除">🗑️</button>
    </div>
  `;

  // Drop target
  header.addEventListener('dragover', (e) => { e.preventDefault(); header.classList.add('drop-target'); });
  header.addEventListener('dragleave', () => { header.classList.remove('drop-target'); });
  header.addEventListener('drop', (e) => {
    e.preventDefault();
    header.classList.remove('drop-target');
    const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
    if (dragData.id && dragData.parentId !== folderId) moveItem(dragData.id, folderId);
  });

  header.addEventListener('click', () => {
    if (isCollapsed) collapsedFolders.delete(folderId);
    else collapsedFolders.add(folderId);
    renderGrid();
  });

  block.appendChild(header);

  if (!isCollapsed) {
    const content = document.createElement('div');
    content.className = 'bm-block-content';

    if (!folder.children || folder.children.length === 0) {
      content.innerHTML = '<div class="bm-block-empty">空文件夹</div>';
    } else {
      folder.children.forEach((item, idx) => {
        if (item.type === 'url') {
          content.appendChild(createCard(item, folderId, idx));
        } else {
          // Sub-folder = collapsed card
          const childId = folderId + '/' + item.id;
          content.appendChild(createFolderCard(item, childId, folderId, idx));
        }
      });
    }

    block.appendChild(content);
  }

  return block;
}

// Sub-folders (level 2+) = collapsed card, click to expand inline
function createFolderCard(folder, folderId, parentId, index) {
  const wrapper = document.createElement('div');
  wrapper.className = 'bm-folder-card-wrapper';

  const isExpanded = expandedFolders.has(folderId);
  const childUrls = (folder.children || []).filter(c => c.type === 'url').length;
  const childFolders = (folder.children || []).filter(c => c.type === 'folder').length;

  const card = document.createElement('div');
  card.className = 'bm-card bm-card-folder' + (isExpanded ? ' expanded' : '');
  card.draggable = true;
  card.dataset.id = folder.id;
  card.dataset.parentId = parentId;
  card.dataset.index = index;

  card.innerHTML = `
    <div class="bm-card-icon bm-folder-icon">📁</div>
    <div class="bm-card-content">
      <div class="bm-card-name">${escapeHtml(folder.name)}</div>
      <div class="bm-card-url">${childUrls} 个书签${childFolders > 0 ? ' · ' + childFolders + ' 个子文件夹' : ''}</div>
    </div>
    <div class="bm-card-actions">
      <button class="bm-card-action" onclick="event.stopPropagation();addBookmarkTo('${folderId}')" title="添加书签">+</button>
      <button class="bm-card-action" onclick="event.stopPropagation();editFolder('${folder.id}','${parentId}')" title="编辑">✏️</button>
      <button class="bm-card-action danger" onclick="event.stopPropagation();deleteItem('${folder.id}','${parentId}')" title="删除">🗑️</button>
    </div>
    <span class="bm-folder-toggle">${isExpanded ? '▼' : '▶'}</span>
  `;

  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop-target'); });
  card.addEventListener('dragleave', () => { card.classList.remove('drop-target'); });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove('drop-target');
    const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
    if (dragData.id && dragData.parentId !== folderId) moveItem(dragData.id, folderId);
  });

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({
      type: 'folder', id: folder.id, parentId: parentId, index: index
    }));
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => { card.classList.remove('dragging'); });

  card.addEventListener('click', () => {
    if (isExpanded) expandedFolders.delete(folderId);
    else expandedFolders.add(folderId);
    renderGrid();
  });

  wrapper.appendChild(card);

  if (isExpanded && folder.children && folder.children.length > 0) {
    const subContent = document.createElement('div');
    subContent.className = 'bm-sub-content';
    folder.children.forEach((item, idx) => {
      if (item.type === 'url') {
        subContent.appendChild(createCard(item, folderId, idx));
      } else {
        const childId = folderId + '/' + item.id;
        subContent.appendChild(createFolderCard(item, childId, folderId, idx));
      }
    });
    wrapper.appendChild(subContent);
  }

  return wrapper;
}

function createCard(item, parentId, index) {
  const card = document.createElement('div');
  card.className = 'bm-card';
  card.draggable = true;
  card.dataset.id = item.id;
  card.dataset.parentId = parentId;
  card.dataset.index = index;

  const domain = getDomain(item.url);
  const favicon = `/api/favicon?domain=${encodeURIComponent(domain)}`;
  const letter = (domain.charAt(0) || '?').toUpperCase();
  card.innerHTML = `
    <div class="bm-card-icon">
      <img src="${favicon}" onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22 viewBox=%220 0 32 32%22><rect width=%2232%22 height=%2232%22 rx=%226%22 fill=%22%23e8e8ed%22/><text x=%2216%22 y=%2222%22 font-family=%22-apple-system%2CSans-serif%22 font-size=%2216%22 font-weight=%22600%22 fill=%22%2386868b%22 text-anchor=%22middle%22>${letter}</text></svg>'" alt="">
    </div>
    <div class="bm-card-content">
      <div class="bm-card-name">${escapeHtml(item.name)}</div>
      <div class="bm-card-url">${escapeHtml(domain)}</div>
    </div>
    <div class="bm-card-actions">
      <button class="bm-card-action" onclick="event.stopPropagation();window.open('${escapeHtml(item.url)}','_blank')" title="打开">🔗</button>
      <button class="bm-card-action" onclick="event.stopPropagation();editItem('${item.id}','${parentId}')" title="编辑">✏️</button>
      <button class="bm-card-action danger" onclick="event.stopPropagation();deleteItem('${item.id}','${parentId}')" title="删除">🗑️</button>
    </div>
  `;
  card.addEventListener('dblclick', () => {
    window.open(item.url, '_blank');
  });

  // Drag & Drop
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({
      type: 'url',
      id: item.id,
      parentId: parentId,
      index: index
    }));
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    card.classList.remove('drop-before', 'drop-after');
    if (e.clientY < mid) {
      card.classList.add('drop-before');
    } else {
      card.classList.add('drop-after');
    }
  });
  card.addEventListener('dragleave', () => {
    card.classList.remove('drop-before', 'drop-after');
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove('drop-before', 'drop-after');
    const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
    const rect = card.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const position = e.clientY < mid ? 'before' : 'after';
    reorderItem(dragData, parentId, item.id, position);
  });

  return card;
}

function renderSearchResults(container, empty) {
  const results = [];
  function search(node, path) {
    if (!node.children) return;
    node.children.forEach(child => {
      const currentPath = path + ' / ' + node.name;
      if (child.type === 'url') {
        if (child.name.toLowerCase().includes(searchQuery) ||
            child.url.toLowerCase().includes(searchQuery)) {
          results.push({ item: child, path: currentPath });
        }
      } else if (child.type === 'folder') {
        if (child.name.toLowerCase().includes(searchQuery)) {
          results.push({ item: child, path: currentPath });
        }
        search(child, currentPath);
      }
    });
  }
  ROOT_KEYS.forEach(key => {
    if (bookmarkData.roots[key]) {
      search(bookmarkData.roots[key], '');
    }
  });

  if (results.length === 0) {
    empty.style.display = 'block';
    empty.querySelector('h3').textContent = '未找到匹配的书签';
    empty.querySelector('p').textContent = `没有包含 "${searchQuery}" 的书签`;
    return;
  }
  empty.style.display = 'none';

  const grid = document.createElement('div');
  grid.className = 'bm-card-grid';
  results.slice(0, 200).forEach(({ item, path }) => {
    const card = document.createElement('div');
    card.className = 'bm-card bm-search-results';
    if (item.type === 'folder') {
      card.innerHTML = `
        <div class="bm-card-icon"><span class="placeholder">📁</span></div>
        <div class="bm-card-content">
          <div class="bm-card-name">${escapeHtml(item.name)}</div>
          <div class="bm-search-path">${escapeHtml(path)}</div>
        </div>
      `;
    } else {
      const domain = getDomain(item.url);
      const favicon = `/api/favicon?domain=${encodeURIComponent(domain)}`;
      const letter = (domain.charAt(0) || '?').toUpperCase();
      card.innerHTML = `
        <div class="bm-card-icon">
          <img src="${favicon}" onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22 viewBox=%220 0 32 32%22><rect width=%2232%22 height=%2232%22 rx=%226%22 fill=%22%23e8e8ed%22/><text x=%2216%22 y=%2222%22 font-family=%22-apple-system%2CSans-serif%22 font-size=%2216%22 font-weight=%22600%22 fill=%22%2386868b%22 text-anchor=%22middle%22>${letter}</text></svg>'" alt="">
        </div>
        <div class="bm-card-content">
          <div class="bm-card-name">${escapeHtml(item.name)}</div>
          <div class="bm-card-url">${escapeHtml(domain)}</div>
          <div class="bm-search-path">${escapeHtml(path)}</div>
        </div>
        <div class="bm-card-actions">
          <button class="bm-card-action" onclick="window.open('${escapeHtml(item.url)}','_blank')" title="打开">🔗</button>
        </div>
      `;
    }
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

// ===== Folder Finding =====
function findFolder(folderId) {
  if (ROOT_KEYS.includes(folderId)) {
    return bookmarkData.roots[folderId];
  }
  const parts = folderId.split('/');
  const rootKey = parts[0];
  let current = bookmarkData.roots[rootKey];
  if (!current) return null;

  for (let i = 1; i < parts.length; i++) {
    if (!current.children) return null;
    current = current.children.find(c => c.id === parts[i] && c.type === 'folder');
    if (!current) return null;
  }
  return current;
}

// ===== CRUD Operations =====
function moveItem(itemId, targetFolderId) {
  let foundItem = null;

  function search(node) {
    if (!node.children) return;
    const idx = node.children.findIndex(c => c.id === itemId);
    if (idx !== -1) {
      foundItem = node.children[idx];
      node.children.splice(idx, 1);
      return true;
    }
    return node.children.some(c => c.type === 'folder' && search(c));
  }

  for (const key of ROOT_KEYS) {
    if (search(bookmarkData.roots[key])) break;
  }

  if (!foundItem) return;

  const targetFolder = findFolder(targetFolderId);
  if (!targetFolder) return;
  if (!targetFolder.children) targetFolder.children = [];
  targetFolder.children.push(foundItem);

  saveBookmarks();
  renderTree();
  renderGrid();
  showToast('已移动到: ' + (targetFolder.name || '目标文件夹'));
}

function reorderItem(dragData, targetParentId, targetItemId, position) {
  if (dragData.parentId === targetParentId && dragData.id === targetItemId) return;

  let foundItem = null;
  const sourceFolder = findFolder(dragData.parentId);
  if (!sourceFolder) return;

  const sourceIdx = sourceFolder.children.findIndex(c => c.id === dragData.id);
  if (sourceIdx === -1) return;
  foundItem = sourceFolder.children[sourceIdx];
  sourceFolder.children.splice(sourceIdx, 1);

  const targetFolder = findFolder(targetParentId);
  if (!targetFolder) return;
  if (!targetFolder.children) targetFolder.children = [];

  let targetIdx = targetFolder.children.findIndex(c => c.id === targetItemId);
  if (targetIdx === -1) {
    targetFolder.children.push(foundItem);
  } else {
    if (position === 'after') targetIdx++;
    if (dragData.parentId === targetParentId && sourceIdx < targetIdx) {
      targetIdx--;
    }
    if (targetIdx < 0) targetIdx = 0;
    targetFolder.children.splice(targetIdx, 0, foundItem);
  }

  saveBookmarks();
  renderGrid();
}

async function deleteItem(itemId, parentId) {
  const folder = findFolder(parentId);
  if (!folder || !folder.children) return;

  const idx = folder.children.findIndex(c => c.id === itemId);
  if (idx === -1) return;

  const item = folder.children[idx];
  const name = item.name || '此项';

  if (item.type === 'folder' && item.children && item.children.length > 0) {
    if (!confirm(`确定删除文件夹 "${name}" 及其所有内容吗？`)) return;
  } else {
    if (!confirm(`确定删除 "${name}" 吗？`)) return;
  }

  folder.children.splice(idx, 1);
  const ok = await saveBookmarks();
  if (ok) {
    renderTree();
    renderGrid();
    showToast('已删除: ' + name);
  }
}

function editItem(itemId, parentId) {
  const folder = findFolder(parentId);
  if (!folder || !folder.children) return;
  const item = folder.children.find(c => c.id === itemId);
  if (!item) return;

  editTarget = { item, parentId };
  document.getElementById('bmEditTitle').textContent = '编辑书签';
  document.getElementById('bmEditName').value = item.name || '';
  document.getElementById('bmEditUrl').value = item.url || '';
  document.getElementById('bmUrlGroup').style.display = '';
  populateFolderSelect('bmEditFolder', parentId);
  document.getElementById('bmEditModal').classList.add('active');
}

function editFolder(itemId, parentId) {
  const folder = findFolder(parentId);
  if (!folder || !folder.children) return;
  const item = folder.children.find(c => c.id === itemId);
  if (!item) return;

  editTarget = { item, parentId };
  document.getElementById('bmEditTitle').textContent = '编辑文件夹';
  document.getElementById('bmEditName').value = item.name || '';
  document.getElementById('bmEditUrl').value = '';
  document.getElementById('bmUrlGroup').style.display = 'none';
  populateFolderSelect('bmEditFolder', parentId);
  document.getElementById('bmEditModal').classList.add('active');
}

async function saveBmEdit() {
  if (!editTarget) return;
  const { item, parentId } = editTarget;
  const newName = document.getElementById('bmEditName').value.trim();
  const newUrl = document.getElementById('bmEditUrl').value.trim();
  const newFolder = document.getElementById('bmEditFolder').value;

  if (!newName) {
    showToast('名称不能为空', 'error');
    return;
  }

  item.name = newName;
  if (item.type === 'url' && newUrl) {
    item.url = newUrl;
  }

  if (newFolder !== parentId) {
    const sourceFolder = findFolder(parentId);
    const idx = sourceFolder.children.findIndex(c => c.id === item.id);
    sourceFolder.children.splice(idx, 1);

    const targetFolder = findFolder(newFolder);
    if (targetFolder) {
      if (!targetFolder.children) targetFolder.children = [];
      targetFolder.children.push(item);
    }
  }

  const ok = await saveBookmarks();
  if (ok) {
    closeBmEdit();
    renderTree();
    renderGrid();
    showToast('已保存修改');
  }
}

function closeBmEdit() {
  document.getElementById('bmEditModal').classList.remove('active');
  editTarget = null;
}

// ===== Add Bookmark/Folder =====
function addBookmark() {
  populateFolderSelect('bmAddFolder', 'bookmark_bar');
  document.getElementById('bmAddName').value = '';
  document.getElementById('bmAddUrl').value = '';
  document.getElementById('bmAddModal').classList.add('active');
}

function addBookmarkTo(folderId) {
  populateFolderSelect('bmAddFolder', folderId);
  document.getElementById('bmAddName').value = '';
  document.getElementById('bmAddUrl').value = '';
  document.getElementById('bmAddModal').classList.add('active');
}

async function confirmAddBookmark() {
  const name = document.getElementById('bmAddName').value.trim();
  const url = document.getElementById('bmAddUrl').value.trim();
  const folderId = document.getElementById('bmAddFolder').value;

  if (!name || !url) {
    showToast('名称和网址不能为空', 'error');
    return;
  }

  const folder = findFolder(folderId);
  if (!folder) return;
  if (!folder.children) folder.children = [];

  folder.children.push({
    date_added: String(Date.now() * 1000000 + Math.floor(Math.random() * 1000000)),
    date_last_used: '0',
    guid: generateGuid(),
    id: String(Date.now()),
    name: name,
    type: 'url',
    url: url
  });

  const ok = await saveBookmarks();
  if (ok) {
    closeBmAdd();
    renderTree();
    renderGrid();
    showToast('书签已添加');
  }
}

function closeBmAdd() {
  document.getElementById('bmAddModal').classList.remove('active');
}

function addFolder() {
  populateFolderSelect('bmFolderParent', 'bookmark_bar');
  document.getElementById('bmFolderName').value = '';
  document.getElementById('bmAddFolderModal').classList.add('active');
}

async function confirmAddFolder() {
  const name = document.getElementById('bmFolderName').value.trim();
  const parentId = document.getElementById('bmFolderParent').value;

  if (!name) {
    showToast('文件夹名称不能为空', 'error');
    return;
  }

  const folder = findFolder(parentId);
  if (!folder) return;
  if (!folder.children) folder.children = [];

  folder.children.push({
    children: [],
    date_added: String(Date.now() * 1000000 + Math.floor(Math.random() * 1000000)),
    date_last_used: '0',
    guid: generateGuid(),
    id: String(Date.now()),
    name: name,
    type: 'folder'
  });

  const ok = await saveBookmarks();
  if (ok) {
    closeBmAddFolder();
    renderTree();
    renderGrid();
    showToast('文件夹已创建');
  }
}

function closeBmAddFolder() {
  document.getElementById('bmAddFolderModal').classList.remove('active');
}

// ===== Helpers =====
function populateFolderSelect(selectId, currentFolderId) {
  const select = document.getElementById(selectId);
  const options = [];

  function addOptions(node, nodeId, depth) {
    const prefix = '  '.repeat(depth);
    options.push(`<option value="${nodeId}">${prefix}${escapeHtml(node.name)}</option>`);
    if (node.children) {
      node.children.forEach(child => {
        if (child.type === 'folder') {
          addOptions(child, nodeId + '/' + child.id, depth + 1);
        }
      });
    }
  }

  ROOT_KEYS.forEach(key => {
    if (bookmarkData.roots[key]) {
      addOptions(bookmarkData.roots[key], key, 0);
    }
  });

  select.innerHTML = options.join('');
  select.value = currentFolderId;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url || '';
  }
}

function generateGuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function setupSearch() {
  const input = document.getElementById('bmSearch');
  let timeout;
  input.addEventListener('input', (e) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderGrid();
    }, 200);
  });
}

// ===== Auto Sync =====
function getBookmarkSignature(data) {
  // Only compare structural data (names, urls, types, ids), ignore timestamps
  function sig(node) {
    if (!node) return '';
    if (node.type === 'url') return `u:${node.id}:${node.name}:${node.url}`;
    const childSigs = (node.children || []).map(sig).join(',');
    return `f:${node.id}:${node.name}|${childSigs}`;
  }
  return ROOT_KEYS.map(k => sig(data.roots[k])).join(';;');
}

function startAutoSync() {
  syncTimer = setInterval(async () => {
    if (!currentProfile) return;
    if (document.querySelector('.modal-overlay.active')) return;
    try {
      const res = await fetch(`/api/bookmarks?profile=${encodeURIComponent(currentProfile)}`);
      if (!res.ok) return;
      const result = await res.json();
      const newSig = getBookmarkSignature(result.data);
      const oldSig = getBookmarkSignature(bookmarkData);
      if (newSig !== oldSig) {
        const scrollTop = window.scrollY;
        bookmarkData = result.data;
        renderTree();
        renderGrid();
        window.scrollTo(0, scrollTop);
      }
    } catch {}
  }, 10000);
}

async function syncFromChrome() {
  await loadBookmarks();
  renderTree();
  renderGrid();
  showToast('已从Chrome同步最新书签');
}

// Profile switch
document.getElementById('profileSelect').addEventListener('change', async (e) => {
  currentProfile = e.target.value;
  collapsedFolders.clear();
  expandedFolders.clear();
  await loadBookmarks();
  renderTree();
  renderGrid();
});

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
