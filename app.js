/* ================================================
   C# Backend Notes - App Logic
   ================================================ */

// === Configuration ===
const STAGES = [
  { id: 'stage-1', num: '01', title: 'C# 語言核心', desc: '熟悉強型別語言特性與非同步處理邏輯' },
  { id: 'stage-2', num: '02', title: 'HTTP 與後端思維', desc: '從伺服器端視角重新理解 Web' },
  { id: 'stage-3', num: '03', title: 'ASP.NET Core Web API', desc: '理解後端服務的運作生命週期與架構設計' },
  { id: 'stage-4', num: '04', title: '資料庫：MySQL 與 MongoDB', desc: 'EF Core migration 流程是重點；NoSQL 與 RDB 的取捨' },
  { id: 'stage-5', num: '05', title: '程式碼架構', desc: '寫出可維護、可測試的分層架構' },
  { id: 'stage-6', num: '06', title: '後端測試', desc: '單元測試、Mocking、整合測試' },
  { id: 'stage-7', num: '07', title: 'Docker 基礎', desc: '容器化、Dockerfile、docker-compose' },
  { id: 'stage-8', num: '08', title: 'CI/CD 與 Kubernetes', desc: 'Azure Pipelines 與 K8s 維運基礎' },
];

const STORAGE_KEYS = {
  theme: 'cs-notes-theme',
  progress: 'cs-notes-progress',
};

// === State ===
const state = {
  currentRoute: '',
  markdownCache: {},
  searchIndex: null,
  searchActiveIdx: -1,
  tocObserver: null,
};

// === Markdown setup ===
marked.setOptions({
  breaks: false,
  gfm: true,
});

// === Theme ===
function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  setTheme(theme);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEYS.theme, theme);

  // Toggle hljs theme
  const lightCss = document.getElementById('hljs-light');
  const darkCss = document.getElementById('hljs-dark');
  if (theme === 'dark') {
    lightCss.disabled = true;
    darkCss.disabled = false;
  } else {
    lightCss.disabled = false;
    darkCss.disabled = true;
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
}

document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
document.getElementById('theme-toggle-desktop').addEventListener('click', toggleTheme);

// === Progress tracking ===
function getProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.progress) || '{}');
  } catch {
    return {};
  }
}

function setProgress(progress) {
  localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(progress));
}

function toggleTask(stageId, taskKey) {
  const progress = getProgress();
  if (!progress[stageId]) progress[stageId] = {};
  progress[stageId][taskKey] = !progress[stageId][taskKey];
  setProgress(progress);
  updateAllProgressBadges();
}

function getStageProgress(stageId) {
  const progress = getProgress();
  const stage = progress[stageId] || {};
  const total = stage.__total || 0;
  const done = Object.keys(stage).filter(k => k !== '__total' && stage[k]).length;
  return { done, total };
}

function setStageTotal(stageId, total) {
  const progress = getProgress();
  if (!progress[stageId]) progress[stageId] = {};
  progress[stageId].__total = total;
  setProgress(progress);
}

function updateAllProgressBadges() {
  document.querySelectorAll('.nav-progress').forEach(el => {
    const stageId = el.dataset.stage;
    const { done, total } = getStageProgress(stageId);
    if (total > 0) {
      el.textContent = `${done}/${total}`;
      el.classList.toggle('complete', done === total && total > 0);
    } else {
      el.textContent = '';
    }
  });

  // Also update stage cards on home page
  document.querySelectorAll('.stage-card-progress').forEach(el => {
    const stageId = el.dataset.stage;
    const { done, total } = getStageProgress(stageId);
    if (total > 0) {
      el.textContent = `${done}/${total}`;
      el.classList.toggle('complete', done === total && total > 0);
    } else {
      el.textContent = '— / —';
    }
  });
}

document.getElementById('reset-progress').addEventListener('click', () => {
  if (confirm('確定要重設所有進度嗎？這個動作無法復原。')) {
    localStorage.removeItem(STORAGE_KEYS.progress);
    updateAllProgressBadges();
    if (state.currentRoute) loadStage(state.currentRoute);
  }
});

// === Markdown loading ===
async function loadMarkdown(stageId) {
  if (state.markdownCache[stageId]) return state.markdownCache[stageId];

  try {
    const res = await fetch(`content/${stageId}.md`);
    if (!res.ok) throw new Error(`Failed to load ${stageId}`);
    const text = await res.text();
    state.markdownCache[stageId] = text;
    return text;
  } catch (err) {
    console.error(err);
    return null;
  }
}

// === Render helpers ===
function renderMarkdown(md, stageId) {
  // Custom processing: convert "- [ ]" / "- [x]" to interactive checkboxes
  // marked already handles GFM checkboxes, but we need to make them stateful
  let html = marked.parse(md);

  // Wrap into a container so we can post-process
  return html;
}

function postProcessContent(stageId) {
  const content = document.getElementById('content');

  // Find all task list items (rendered by marked GFM)
  const taskItems = content.querySelectorAll('li input[type="checkbox"]');
  const progress = getProgress();
  const stageProgress = progress[stageId] || {};

  taskItems.forEach((cb, idx) => {
    const li = cb.parentElement;
    li.classList.add('task-item');
    cb.disabled = false;
    cb.removeAttribute('disabled');

    const taskKey = `task-${idx}`;
    const isChecked = !!stageProgress[taskKey];
    cb.checked = isChecked;
    if (isChecked) li.classList.add('checked');

    cb.addEventListener('change', () => {
      toggleTask(stageId, taskKey);
      li.classList.toggle('checked', cb.checked);
    });

    // Click on the li (but not on the checkbox itself) toggles too
    li.addEventListener('click', (e) => {
      // Ignore clicks on links inside the li
      if (e.target.tagName === 'A') return;
      // Don't double-toggle when clicking the checkbox directly
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });
  });

  // Set total for this stage
  setStageTotal(stageId, taskItems.length);
  updateAllProgressBadges();

  // Highlight code blocks
  content.querySelectorAll('pre code').forEach(block => {
    try {
      hljs.highlightElement(block);
    } catch (e) {
      console.warn('Highlight failed:', e);
    }
  });

  // Make tables responsive (wrap in scroll container)
  content.querySelectorAll('table').forEach(table => {
    if (table.parentElement.classList.contains('table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.style.overflowX = 'auto';
    wrap.style.margin = '20px 0';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
    table.style.margin = '0';
  });
}

// === Table of contents ===
function slugify(text) {
  let slug = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'section';
}

function buildToc() {
  const toc = document.getElementById('toc');
  if (!toc) return;

  const content = document.getElementById('content');
  const headings = content.querySelectorAll('h2, h3');

  if (headings.length === 0) {
    toc.classList.remove('show');
    toc.innerHTML = '';
    if (state.tocObserver) {
      state.tocObserver.disconnect();
      state.tocObserver = null;
    }
    return;
  }

  const usedSlugs = {};
  const items = [];
  headings.forEach(h => {
    let slug = slugify(h.textContent);
    if (usedSlugs[slug]) {
      usedSlugs[slug] += 1;
      slug = `${slug}-${usedSlugs[slug]}`;
    } else {
      usedSlugs[slug] = 1;
    }
    h.id = slug;
    items.push({
      level: h.tagName === 'H2' ? 2 : 3,
      text: h.textContent,
      id: slug,
    });
  });

  const escapeHtml = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  toc.innerHTML = `
    <div class="toc-label">本頁目錄</div>
    <ul class="toc-list">
      ${items.map(it => `
        <li class="toc-item">
          <a href="#${encodeURIComponent(it.id)}"
             class="toc-link h${it.level}"
             data-target="${escapeHtml(it.id)}"
             title="${escapeHtml(it.text)}">${escapeHtml(it.text)}</a>
        </li>
      `).join('')}
    </ul>
  `;
  toc.classList.add('show');
  document.getElementById('main').classList.add('has-toc');

  toc.querySelectorAll('.toc-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const id = link.dataset.target;
      const el = document.getElementById(id);
      if (!el) return;
      const offset = window.matchMedia('(max-width: 900px)').matches ? 76 : 24;
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  setupTocActiveTracking(items);
}

function setupTocActiveTracking(items) {
  if (state.tocObserver) state.tocObserver.disconnect();
  if (!('IntersectionObserver' in window)) return;

  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) visible.add(entry.target.id);
      else visible.delete(entry.target.id);
    });

    let activeId = null;
    for (const it of items) {
      if (visible.has(it.id)) { activeId = it.id; break; }
    }
    if (!activeId) {
      // None in the active band — pick last one above the band
      const links = document.querySelectorAll('.toc-link');
      let last = null;
      for (const it of items) {
        const el = document.getElementById(it.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top < 120) last = it.id;
      }
      activeId = last;
    }

    document.querySelectorAll('.toc-link').forEach(l => {
      l.classList.toggle('active', l.dataset.target === activeId);
    });
  }, {
    rootMargin: '-80px 0px -70% 0px',
    threshold: 0,
  });

  items.forEach(it => {
    const el = document.getElementById(it.id);
    if (el) observer.observe(el);
  });
  state.tocObserver = observer;
}

function clearToc() {
  const toc = document.getElementById('toc');
  if (!toc) return;
  toc.classList.remove('show');
  toc.innerHTML = '';
  document.getElementById('main').classList.remove('has-toc');
  if (state.tocObserver) {
    state.tocObserver.disconnect();
    state.tocObserver = null;
  }
}

function renderPageNav(stageId) {
  const idx = STAGES.findIndex(s => s.id === stageId);
  if (idx === -1) {
    document.getElementById('page-nav').innerHTML = '';
    return;
  }

  const prev = idx > 0 ? STAGES[idx - 1] : null;
  const next = idx < STAGES.length - 1 ? STAGES[idx + 1] : null;
  const home = idx === 0 ? { id: '', title: '回到總覽', num: '00' } : null;

  let html = '';
  if (prev) {
    html += `<a href="#/${prev.id}" class="page-nav-link prev">
      <div class="page-nav-direction">← 上一階段 / ${prev.num}</div>
      <div class="page-nav-title">${prev.title}</div>
    </a>`;
  } else if (home) {
    html += `<a href="#/" class="page-nav-link prev">
      <div class="page-nav-direction">← 回到</div>
      <div class="page-nav-title">總覽</div>
    </a>`;
  } else {
    html += '<div></div>';
  }

  if (next) {
    html += `<a href="#/${next.id}" class="page-nav-link next">
      <div class="page-nav-direction">下一階段 → / ${next.num}</div>
      <div class="page-nav-title">${next.title}</div>
    </a>`;
  } else {
    html += '<div></div>';
  }

  document.getElementById('page-nav').innerHTML = html;
}

// === Routes ===
async function loadStage(stageId) {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">載入中…</div>';
  clearToc();

  const md = await loadMarkdown(stageId);
  if (!md) {
    content.innerHTML = '<div class="loading">載入失敗</div>';
    return;
  }

  content.innerHTML = renderMarkdown(md, stageId);
  postProcessContent(stageId);
  renderPageNav(stageId);
  buildToc();

  window.scrollTo(0, 0);
}

function renderHome() {
  const progress = getProgress();
  let totalTasks = 0;
  let doneTasks = 0;
  STAGES.forEach(s => {
    const sp = progress[s.id] || {};
    const total = sp.__total || 0;
    const done = Object.keys(sp).filter(k => k !== '__total' && sp[k]).length;
    totalTasks += total;
    doneTasks += done;
  });

  const completedStages = STAGES.filter(s => {
    const sp = progress[s.id] || {};
    const total = sp.__total || 0;
    if (total === 0) return false;
    const done = Object.keys(sp).filter(k => k !== '__total' && sp[k]).length;
    return done === total;
  }).length;

  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="home-hero">
      <div class="home-eyebrow">FRONTEND → BACKEND / 學習筆記</div>
      <h1 class="home-title">C# 後端<br><span class="accent-word">轉職指南</span></h1>
      <p class="home-lede">
        從 ASP.NET Core 到 EF Core、從 Docker 到 Kubernetes —
        為前端工程師量身整理的後端開發學習路徑。
      </p>
    </div>

    <div class="home-stats">
      <div class="home-stat">
        <div class="home-stat-num">${STAGES.length}</div>
        <div class="home-stat-label">學習階段</div>
      </div>
      <div class="home-stat">
        <div class="home-stat-num">${doneTasks}<span style="opacity:.4">/${totalTasks || '—'}</span></div>
        <div class="home-stat-label">完成項目</div>
      </div>
      <div class="home-stat">
        <div class="home-stat-num">${completedStages}<span style="opacity:.4">/${STAGES.length}</span></div>
        <div class="home-stat-label">完成階段</div>
      </div>
    </div>

    <h2 class="home-stages-title">階段索引</h2>

    ${STAGES.map(s => `
      <a href="#/${s.id}" class="stage-card">
        <div class="stage-card-num">${s.num}</div>
        <div class="stage-card-body">
          <h3>${s.title}</h3>
          <p>${s.desc}</p>
        </div>
        <div class="stage-card-progress" data-stage="${s.id}">— / —</div>
      </a>
    `).join('')}
  `;

  document.getElementById('page-nav').innerHTML = '';
  clearToc();
  updateAllProgressBadges();
  window.scrollTo(0, 0);
}

// === Router ===
function handleRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  state.currentRoute = hash;

  // Update active nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === hash);
  });

  // Close mobile sidebar
  closeMobileSidebar();

  if (!hash) {
    renderHome();
  } else if (STAGES.some(s => s.id === hash)) {
    loadStage(hash);
  } else {
    renderHome();
  }
}

window.addEventListener('hashchange', handleRoute);

// === Mobile sidebar ===
const sidebar = document.getElementById('sidebar');
const backdrop = document.getElementById('backdrop');

function openMobileSidebar() {
  sidebar.classList.add('open');
  backdrop.classList.add('show');
}

function closeMobileSidebar() {
  sidebar.classList.remove('open');
  backdrop.classList.remove('show');
}

document.getElementById('menu-toggle').addEventListener('click', openMobileSidebar);
backdrop.addEventListener('click', closeMobileSidebar);

// === Reading progress bar ===
function updateReadingProgress() {
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const scrolled = window.scrollY;
  const pct = docHeight > 0 ? (scrolled / docHeight) * 100 : 0;
  document.getElementById('reading-progress').style.width = `${Math.min(100, pct)}%`;
}

window.addEventListener('scroll', updateReadingProgress, { passive: true });
window.addEventListener('resize', updateReadingProgress);

// === Search ===
async function buildSearchIndex() {
  const index = [];
  for (const stage of STAGES) {
    const md = await loadMarkdown(stage.id);
    if (!md) continue;

    // Split into sections by ## headings
    const lines = md.split('\n');
    let currentSection = { title: stage.title, content: [] };
    const sections = [{ ...currentSection, isStageRoot: true }];

    for (const line of lines) {
      const h2Match = line.match(/^##\s+(.+)$/);
      const h3Match = line.match(/^###\s+(.+)$/);
      if (h2Match) {
        currentSection = { title: h2Match[1].replace(/^[\d.]+\s*/, ''), content: [], isStageRoot: false };
        sections.push(currentSection);
      } else if (h3Match) {
        currentSection = { title: h3Match[1].replace(/^[\d.]+\s*/, ''), content: [], isStageRoot: false };
        sections.push(currentSection);
      } else {
        currentSection.content.push(line);
      }
    }

    sections.forEach(sec => {
      const text = sec.content.join(' ').replace(/```[\s\S]*?```/g, '').replace(/[#*`>|\-]/g, ' ').replace(/\s+/g, ' ').trim();
      index.push({
        stageId: stage.id,
        stageNum: stage.num,
        stageTitle: stage.title,
        sectionTitle: sec.title,
        text: text.slice(0, 800),
        searchText: (sec.title + ' ' + text).toLowerCase(),
      });
    });
  }
  state.searchIndex = index;
}

function performSearch(query) {
  if (!query || query.length < 2) return [];
  if (!state.searchIndex) return [];

  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  const results = [];
  for (const item of state.searchIndex) {
    let score = 0;
    let allMatch = true;
    for (const tok of tokens) {
      const inTitle = item.sectionTitle.toLowerCase().includes(tok);
      const inText = item.searchText.includes(tok);
      if (!inTitle && !inText) { allMatch = false; break; }
      if (inTitle) score += 10;
      if (inText) score += 1;
    }
    if (allMatch) results.push({ ...item, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 12);
}

function renderSearchResults(results, query) {
  const container = document.getElementById('search-results');
  if (results.length === 0) {
    if (query.length >= 2) {
      container.innerHTML = '<div class="search-result-item" style="cursor:default"><div class="search-result-snippet">沒有結果</div></div>';
      container.classList.add('show');
    } else {
      container.classList.remove('show');
    }
    return;
  }

  const escapeHtml = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const highlight = (text, q) => {
    const escaped = escapeHtml(text);
    if (!q) return escaped;
    const re = new RegExp('(' + q.split(/\s+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    return escaped.replace(re, '<mark>$1</mark>');
  };

  container.innerHTML = results.map((r, i) => {
    // Find a snippet near the match
    let snippet = r.text;
    const lq = query.toLowerCase();
    const matchIdx = r.text.toLowerCase().indexOf(lq);
    if (matchIdx > 50) {
      snippet = '…' + r.text.slice(Math.max(0, matchIdx - 40), matchIdx + 120);
    } else {
      snippet = r.text.slice(0, 140);
    }
    if (snippet.length >= 140) snippet += '…';

    return `<a class="search-result-item" data-stage="${r.stageId}" data-idx="${i}">
      <div class="search-result-stage">${r.stageNum} / ${escapeHtml(r.stageTitle)}</div>
      <div class="search-result-title">${highlight(r.sectionTitle, query)}</div>
      <div class="search-result-snippet">${highlight(snippet, query)}</div>
    </a>`;
  }).join('');

  container.classList.add('show');

  // Click handlers
  container.querySelectorAll('.search-result-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      const stageId = el.dataset.stage;
      window.location.hash = `#/${stageId}`;
      document.getElementById('search-input').value = '';
      container.classList.remove('show');
    });
  });
}

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

let searchTimer = null;
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const query = e.target.value.trim();
  searchTimer = setTimeout(() => {
    if (!state.searchIndex) {
      buildSearchIndex().then(() => {
        const results = performSearch(query);
        renderSearchResults(results, query);
      });
    } else {
      const results = performSearch(query);
      renderSearchResults(results, query);
    }
    state.searchActiveIdx = -1;
  }, 100);
});

searchInput.addEventListener('focus', () => {
  if (!state.searchIndex) buildSearchIndex();
  const query = searchInput.value.trim();
  if (query.length >= 2) {
    const results = performSearch(query);
    renderSearchResults(results, query);
  }
});

searchInput.addEventListener('keydown', (e) => {
  const items = searchResults.querySelectorAll('.search-result-item[data-idx]');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.searchActiveIdx = Math.min(items.length - 1, state.searchActiveIdx + 1);
    updateSearchActive(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.searchActiveIdx = Math.max(-1, state.searchActiveIdx - 1);
    updateSearchActive(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (state.searchActiveIdx >= 0 && items[state.searchActiveIdx]) {
      items[state.searchActiveIdx].click();
    } else if (items.length > 0) {
      items[0].click();
    }
  } else if (e.key === 'Escape') {
    searchInput.blur();
    searchResults.classList.remove('show');
  }
});

function updateSearchActive(items) {
  items.forEach((el, i) => {
    el.classList.toggle('active', i === state.searchActiveIdx);
  });
  if (state.searchActiveIdx >= 0 && items[state.searchActiveIdx]) {
    items[state.searchActiveIdx].scrollIntoView({ block: 'nearest' });
  }
}

// Close search on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) {
    searchResults.classList.remove('show');
  }
});

// Cmd+K / Ctrl+K to focus search
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

// === Initialize ===
function init() {
  initTheme();
  // Pre-load stage totals from cached progress
  updateAllProgressBadges();
  // Build search index in background
  setTimeout(() => buildSearchIndex(), 500);
  // Initial route
  handleRoute();
  // Pre-load all markdown for snappy navigation (after first render)
  setTimeout(() => {
    STAGES.forEach(s => loadMarkdown(s.id));
  }, 1000);
}

init();
