// content.js

// ─── Helper ───────────────────────────────────────────────────────────────────
function waitFor(condition, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('timeout'));
      setTimeout(check, 500);
    };
    check();
  });
}

// ─── Chunked storage ──────────────────────────────────────────────────────────
const CHUNK_SIZE = 20;

async function saveProblems(problems) {
  const slugs = Object.keys(problems);
  const toSet = { pr_info: { count: slugs.length, lastSyncDate: new Date().toDateString(), numChunks: Math.ceil(slugs.length / CHUNK_SIZE) } };
  for (let i = 0; i < slugs.length; i += CHUNK_SIZE) {
    const chunk = {};
    const chunkIdx = Math.floor(i / CHUNK_SIZE);
    slugs.slice(i, i + CHUNK_SIZE).forEach(s => { chunk[s] = { ...problems[s], chunkIdx }; });
    toSet[`pr_${chunkIdx}`] = chunk;
  }
  await chrome.storage.sync.set(toSet);
}

async function loadProblems() {
  const info = (await chrome.storage.sync.get('pr_info')).pr_info;
  if (!info) return null;
  const keys = Array.from({ length: info.numChunks }, (_, i) => `pr_${i}`);
  const chunks = await chrome.storage.sync.get(keys);
  const problems = {};
  Object.values(chunks).forEach(c => Object.assign(problems, c));
  return { problems, lastSyncDate: info.lastSyncDate };
}

async function saveSingleProblem(slug, data) {
  // data has chunkIdx set during saveProblems, use it directly
  if (data.chunkIdx !== undefined) {
    const key = `pr_${data.chunkIdx}`;
    const chunk = (await chrome.storage.sync.get(key))[key] || {};
    chunk[slug] = data;
    await chrome.storage.sync.set({ [key]: chunk });
    return;
  }
  // Fallback: scan chunks
  const info = (await chrome.storage.sync.get('pr_info')).pr_info;
  if (!info) return;
  for (let i = 0; i < info.numChunks; i++) {
    const key = `pr_${i}`;
    const chunk = (await chrome.storage.sync.get(key))[key] || {};
    if (slug in chunk) {
      chunk[slug] = data;
      await chrome.storage.sync.set({ [key]: chunk });
      return;
    }
  }
}

// ─── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'AUTO_SYNC' || msg.type === 'MANUAL_SYNC') {
    doSync(msg.type === 'MANUAL_SYNC').then(count => sendResponse({ count })).catch(() => sendResponse({ count: 0 }));
    return true;
  }
});

// ─── Auto-trigger on /progress ───────────────────────────────────────────────
function isProgressPage() {
  return window.location.pathname.startsWith('/progress');
}

if (isProgressPage()) {
  setTimeout(() => doSync(false), 1500);
}

// ─── Main sync ────────────────────────────────────────────────────────────────
async function doSync(manual) {
  if (!isProgressPage()) {
    if (manual) window.location.href = 'https://leetcode.com/progress/';
    return 0;
  }
  try {
    await waitFor(() => document.querySelectorAll('a[href*="/problems/"]').length > 2);
  } catch(e) {
    console.log('[LeetRecall] Timed out waiting for problems');
    return 0;
  }
  return await scrapeAllPages(manual);
}

async function scrapeAllPages(manual) {
  const loaded = await loadProblems();
  const problems = (loaded && loaded.problems) ? loaded.problems : {};

  // Only scrape first page — newest problems are always here
  scrapePage(problems);

  const count = Object.keys(problems).length;
  if (count > 0) {
    await saveProblems(problems);
    chrome.runtime.sendMessage({ type: 'SYNC_COMPLETE', count });
  }
  if (manual) showToast('✓ Synced ' + count + ' problems');
  else if (count > 0) showToast('✓ LeetRecall: ' + count + ' problems loaded');
  return count;
}

function scrapePage(problems) {
  const links = Array.from(document.querySelectorAll('a[href*="/problems/"]'));
  links.forEach(link => {
    const slugMatch = link.href.match(/\/problems\/([^/?#]+)/);
    if (!slugMatch) return;
    const slug = slugMatch[1];

    let row = link;
    for (let i = 0; i < 6; i++) {
      row = row.parentElement;
      if (!row) break;
      const txt = row.textContent;
      if (txt.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+/) && txt.match(/\d+\s*(Accepted|Wrong)/)) break;
    }
    if (!row) row = link.parentElement;

    const linkText = link.textContent.trim();
    const numMatch = linkText.match(/^(\d+)\.\s+(.+)/);
    const problemId = numMatch ? numMatch[1] : '';
    const title = numMatch ? numMatch[2] : linkText;

    let difficulty = 'Medium';
    const rowText = row.textContent || '';
    if (rowText.includes('Easy')) difficulty = 'Easy';
    else if (rowText.includes('Hard')) difficulty = 'Hard';

    let submissionCount = 1;
    const nums = rowText.match(/\b(\d{1,4})\b/g);
    if (nums && nums.length >= 2) submissionCount = parseInt(nums[nums.length - 1]) || 1;

    let lastAcTimestamp = Date.now() - 30 * 86400000;
    const dateMatch = rowText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d+)/);
    if (dateMatch) {
      const parsed = new Date(`${dateMatch[1]} ${dateMatch[2]}, ${new Date().getFullYear()}`);
      if (!isNaN(parsed.getTime())) lastAcTimestamp = parsed.getTime();
    }

    if (!problems[slug]) {
      problems[slug] = buildProblem(problemId, title, difficulty, lastAcTimestamp, submissionCount, slug);
    }
  });

}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;top:20px;right:20px;z-index:99999;background:#0d1117;color:#00d4aa;border:1px solid #00d4aa;padding:10px 16px;border-radius:8px;font-family:monospace;font-size:13px;box-shadow:0 4px 20px rgba(0,212,170,0.2);`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ─── SM-2 ─────────────────────────────────────────────────────────────────────
function sm2(quality, repetitions, easeFactor, interval) {
  if (quality < 3) { repetitions = 0; interval = 1; }
  else {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    repetitions += 1;
  }
  easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  return { interval, repetitions, easeFactor, nextReview: Date.now() + interval * 86400000 };
}

function buildProblem(id, title, difficulty, lastAcTs, subCount, slug) {
  const q = subCount <= 2 ? 5 : subCount <= 5 ? 4 : subCount <= 10 ? 3 : 2;
  const daysSince = Math.max(1, Math.floor((Date.now() - lastAcTs) / 86400000));
  const r = sm2(q, 0, 2.5, 1);
  r.nextReview = Date.now() + Math.max(0, r.interval - Math.min(daysSince, 30)) * 86400000;
  return { id, title, difficulty, slug, submissionCount: subCount, lastAcTimestamp: lastAcTs,
    repetitions: r.repetitions, easeFactor: r.easeFactor, interval: r.interval, nextReview: r.nextReview };
}



async function findProblem(slug) {
  const info = (await chrome.storage.sync.get('pr_info')).pr_info;
  if (!info) return null;
  for (let i = 0; i < info.numChunks; i++) {
    const chunk = (await chrome.storage.sync.get(`pr_${i}`))[`pr_${i}`] || {};
    if (slug in chunk) return chunk[slug];
  }
  return null;
}

async function saveOneProblem(slug, data) {
  // Use chunkIdx if available — single read/write, no scanning
  if (data.chunkIdx !== undefined) {
    const key = `pr_${data.chunkIdx}`;
    const chunk = (await chrome.storage.sync.get(key))[key] || {};
    chunk[slug] = data;
    await chrome.storage.sync.set({ [key]: chunk });
    return;
  }
  // Fallback: scan (only for old data without chunkIdx)
  const info = (await chrome.storage.sync.get('pr_info')).pr_info;
  if (!info) return;
  for (let i = 0; i < info.numChunks; i++) {
    const key = `pr_${i}`;
    const chunk = (await chrome.storage.sync.get(key))[key] || {};
    if (slug in chunk) {
      chunk[slug] = { ...data, chunkIdx: i };
      await chrome.storage.sync.set({ [key]: chunk });
      return;
    }
  }
}

// ─── Rating card after AC ─────────────────────────────────────────────────────
let ratingShown = false;
let lastPath = location.pathname;

setInterval(() => {
  if (location.pathname !== lastPath) { lastPath = location.pathname; ratingShown = false; }
}, 500);

function getDifficulty() {
  const el = document.querySelector('[diff]') || document.querySelector('.text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard');
  if (!el) return 'Medium';
  const t = el.textContent.trim();
  if (t.includes('Easy')) return 'Easy';
  if (t.includes('Hard')) return 'Hard';
  return 'Medium';
}

async function handleAccepted(slug) {
  if (ratingShown) return;
  ratingShown = true;
  const titleEl = document.querySelector('[data-cy="question-title"]') || document.querySelector('.text-title-large');
  const title = titleEl?.textContent?.trim() || slug;
  const p = await findProblem(slug);
  if (p) {
    const r = sm2(3, p.repetitions, p.easeFactor, p.interval);
    await saveOneProblem(slug, { ...p, ...r, lastReviewed: Date.now() });
  } else {
    const loaded = await loadProblems();
    const existing = loaded && loaded.problems ? loaded.problems : {};
    const difficulty = getDifficulty();
    existing[slug] = buildProblem('', title, difficulty, Date.now(), 1, slug);
    await saveProblems(existing);
  }
  chrome.runtime.sendMessage({ type: 'REVIEW_UPDATED' });
}

function watchForAccepted() {
  if (!location.pathname.includes('/problems/')) return;

  // Method 1: Watch for submission result element (after clicking Submit)
  const obs = new MutationObserver(() => {
    const result = document.querySelector('[data-e2e-locator="submission-result"]');
    if (result && result.textContent.includes('Accepted')) {
      const slug = location.pathname.match(/\/problems\/([^/]+)/)?.[1];
      if (slug) handleAccepted(slug);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Method 2: Watch URL change to /submissions/ (user navigated to submission page)
  const urlObs = new MutationObserver(() => {
    const path = location.pathname;
    if (path.includes('/submissions/') && !ratingShown) {
      const slug = path.match(/\/problems\/([^/]+)/)?.[1];
      if (!slug) return;
      // Check if page shows Accepted
      setTimeout(() => {
        const hasAccepted = document.body.textContent.includes('Accepted') &&
          (document.querySelector('[data-e2e-locator="submission-result"]') ||
           document.querySelector('.text-green-s'));
        if (hasAccepted) handleAccepted(slug);
      }, 800);
    }
  });
  urlObs.observe(document.querySelector('title') || document.head, { subtree: true, characterData: true, childList: true });
}


watchForAccepted();
