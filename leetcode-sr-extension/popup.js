// popup.js

const CHUNK_SIZE = 20;
const DIFF_CLASS = { Easy: "diff-easy", Medium: "diff-medium", Hard: "diff-hard" };

async function loadProblems() {
  const info = (await chrome.storage.sync.get('pr_info')).pr_info;
  if (!info) return null;
  const keys = Array.from({ length: info.numChunks }, (_, i) => `pr_${i}`);
  const chunks = await chrome.storage.sync.get(keys);
  const problems = {};
  Object.values(chunks).forEach(c => Object.assign(problems, c));
  return { problems, lastSyncDate: info.lastSyncDate };
}

async function load() {
  const { dailyLimit } = await chrome.storage.sync.get('dailyLimit');
  const limit = dailyLimit || 10;
  document.getElementById('daily-limit').value = limit;

  const data = await loadProblems();

  const syncEl = document.getElementById('last-sync');
  if (data?.lastSyncDate) {
    syncEl.textContent = data.lastSyncDate === new Date().toDateString() ? 'Synced today' : `Last sync: ${data.lastSyncDate}`;
  }

  if (!data || Object.keys(data.problems).length === 0) {
    renderEmpty();
    return;
  }

  const { problems } = data;
  const now = Date.now();
  const all = Object.values(problems);
  const due = all.filter(p => p.nextReview <= now);
  const overdue = due.filter(p => now - p.nextReview > 86400000);
  // Problems reviewed today (nextReview > now but lastReviewed today)
  const today = new Date().toDateString();
  const doneToday = all.filter(p => p.lastReviewed && new Date(p.lastReviewed).toDateString() === today && p.nextReview > now);

  const diffWeight = { Hard: 3, Medium: 2, Easy: 1 };
  due.sort((a, b) => {
    const oa = now - a.nextReview, ob = now - b.nextReview;
    if (Math.abs(oa - ob) > 7 * 86400000) return ob - oa;
    return (diffWeight[b.difficulty] || 1) - (diffWeight[a.difficulty] || 1);
  });

  document.getElementById('problem-list').innerHTML = '';
  document.getElementById('stat-due').textContent = Math.min(due.length, limit) - Math.min(doneToday.length, limit);
  document.getElementById('stat-overdue').textContent = overdue.length;
  document.getElementById('stat-total').textContent = all.length;

  renderList(due.slice(0, limit), doneToday, now);
}

function renderList(problems, doneToday, now) {
  const el = document.getElementById('problem-list');
  if (problems.length === 0 && doneToday.length === 0) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🎉</div><div class="empty-title">All caught up!</div><div class="empty-text">No reviews due today.<br>Come back tomorrow.</div></div>`;
    return;
  }
  const dueRows = problems.map(p => {
    const diffClass = DIFF_CLASS[p.difficulty] || 'diff-medium';
    const diffLabel = p.difficulty === 'Medium' ? 'Med' : p.difficulty;
    const isOverdue = now - p.nextReview > 86400000;
    return `
      <a class="problem-row" data-slug="${p.slug}" href="https://leetcode.com/problems/${p.slug}/" target="_blank">
        <span class="problem-num">${p.id || ''}</span>
        <span class="problem-title ${isOverdue ? 'overdue' : ''}">${escapeHtml(p.title)}</span>
        <span class="diff-badge ${diffClass}">${diffLabel}</span>
        <span class="due-label ${isOverdue ? 'due-overdue' : 'due-today'}">${formatDue(p.nextReview, now)}</span>
      </a>`;
  });
  const doneRows = doneToday.map(p => {
    const diffClass = DIFF_CLASS[p.difficulty] || 'diff-medium';
    const diffLabel = p.difficulty === 'Medium' ? 'Med' : p.difficulty;
    return `
      <a class="problem-row done" data-slug="${p.slug}" href="https://leetcode.com/problems/${p.slug}/" target="_blank">
        <span class="problem-num">${p.id || ''}</span>
        <span class="problem-title">${escapeHtml(p.title)}</span>
        <span class="diff-badge ${diffClass}">${diffLabel}</span>
        <span class="due-label" style="color:var(--accent)">✓</span>
      </a>`;
  });
  el.innerHTML = [...dueRows, ...doneRows].join('');
}

function renderEmpty() {
  document.getElementById('problem-list').innerHTML = `
    <div class="empty">
      <div class="empty-icon">📋</div>
      <div class="empty-title">No data yet</div>
      <div class="empty-text">Go to your LeetCode Progress page<br>to sync your history.</div>
    </div>
    <button class="sync-btn" id="go-progress">Open Progress & Sync</button>`;
  document.getElementById('go-progress')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://leetcode.com/progress/' });
  });
  document.getElementById('stat-due').textContent = '0';
  document.getElementById('stat-overdue').textContent = '0';
  document.getElementById('stat-total').textContent = '0';
}

function formatDue(nextReview, now) {
  const diff = now - nextReview;
  const days = Math.floor(Math.abs(diff) / 86400000);
  if (diff <= 0 || days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days/7)}w ago`;
  return `${Math.floor(days/30)}mo ago`;
}

function escapeHtml(str) {
  return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Events ───────────────────────────────────────────────────────────────────
document.getElementById('daily-limit').addEventListener('change', async (e) => {
  const val = Math.max(1, Math.min(50, parseInt(e.target.value) || 10));
  e.target.value = val;
  await chrome.storage.sync.set({ dailyLimit: val });
  load();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (!Object.keys(changes).some(k => k.startsWith('pr_'))) return;
  // Find which slug was updated and mark it done
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith('pr_') || !change.newValue) continue;
    const oldChunk = change.oldValue || {};
    const newChunk = change.newValue;
    for (const slug of Object.keys(newChunk)) {
      const oldP = oldChunk[slug];
      const newP = newChunk[slug];
      if (oldP && newP && newP.nextReview > Date.now() && newP.nextReview !== oldP.nextReview) {
        markDone(slug);
      }
    }
  }
});

function markDone(slug) {
  const row = document.querySelector(`.problem-row[data-slug="${slug}"]`);
  if (!row || row.classList.contains('done')) return;
  row.classList.add('done');
  const dueEl = document.getElementById('stat-due');
  const cur = parseInt(dueEl.textContent) || 0;
  if (cur > 0) dueEl.textContent = cur - 1;
}

load();
