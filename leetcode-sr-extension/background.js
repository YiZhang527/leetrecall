// background.js

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// On install, set up alarm
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('dailyCheck', { periodInMinutes: 60 });
  updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyCheck') updateBadge();
});

// Auto-sync: when user opens LeetCode, check if we need to sync
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.includes('leetcode.com')) return;

  const { lastSyncDate } = await chrome.storage.sync.get('lastSyncDate');
  const today = new Date().toDateString();

  if (lastSyncDate !== today) {
    // Trigger sync via content script
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'AUTO_SYNC' });
    } catch (e) {
      // Content script not ready, ignore
    }
  }
});

// Listen for messages from content script / popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SYNC_COMPLETE') {
    chrome.storage.sync.set({ lastSyncDate: new Date().toDateString() });
    updateBadge();
    sendResponse({ ok: true });
  }
  if (msg.type === 'REVIEW_UPDATED') {
    updateBadge();
    sendResponse({ ok: true });
  }
  if (msg.type === 'GET_BADGE_COUNT') {
    getBadgeCount().then(count => sendResponse({ count }));
    return true;
  }
  return true;
});



async function updateBadge() {
  const count = await getBadgeCount();
  if (count > 0) {

  } else {

  }
}

async function getBadgeCount() {
  const { dailyLimit } = await chrome.storage.sync.get('dailyLimit');
  const limit = dailyLimit || 10;
  const info = (await chrome.storage.sync.get('pr_info')).pr_info;
  if (!info) return 0;
  const keys = Array.from({ length: info.numChunks }, (_, i) => `pr_${i}`);
  const chunks = await chrome.storage.sync.get(keys);
  const now = Date.now();
  let due = 0;
  Object.values(chunks).forEach(c => { Object.values(c).forEach(p => { if (p.nextReview <= now) due++; }); });
  return Math.min(due, limit);
}
