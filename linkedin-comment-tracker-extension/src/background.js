// background.js
// Service worker for LinkedIn Comment Tracker extension (Webpack build)

// Only keep daily count and broadcast logic

// Helper to get Authorization header from storage
async function getAuthHeader() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['auth'], (result) => {
      if (result.auth && result.auth.username && result.auth.password) {
        resolve('Basic ' + btoa(result.auth.username + ':' + result.auth.password));
      } else {
        resolve(null);
      }
    });
  });
}

// Helper: fetch and broadcast new count to all tabs
async function fetchAndBroadcastCount(author_profile, date, timezone) {
  const url = `https://roomiy-automations-1b3a1f8f45bc.herokuapp.com/webhook/c3027a79-1178-4b7b-8c1b-11c49e38bd81-comment-count?author_profile=${encodeURIComponent(author_profile)}&date=${encodeURIComponent(date)}&timezone=${encodeURIComponent(timezone || '')}`;
  try {
    const authHeader = await getAuthHeader();
    const res = await fetch(url, {
      headers: {
        ...(authHeader ? { "Authorization": authHeader } : {})
      }
    });
    const data = await res.json();
    chrome.tabs.query({}, function(tabs) {
      for (let tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: 'COMMENT_COUNT_UPDATED', count: data.count });
      }
    });
  } catch (e) {
    // Optionally handle error
    console.error('[LinkedIn Comment Tracker][DEBUG][BG] Error broadcasting count:', e);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[LinkedIn Comment Tracker][DEBUG][BG] Received message:', message);
  // Relay GET_LOGGED_IN_USER from sidebar to content script
  if (message && message.type === 'GET_LOGGED_IN_USER') {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.sendMessage(sender.tab.id, { type: 'GET_LOGGED_IN_USER' }, (response) => {
        sendResponse(response);
      });
      return true; // Indicates async response
    } else {
      // No tab info, cannot relay
      sendResponse(undefined);
      return false;
    }
  }
  // Handle daily count request
  if (message.type === "GET_DAILY_COUNT" && message.author_profile && message.date) {
    (async () => {
      try {
        console.log('[LinkedIn Comment Tracker][DEBUG][BG] GET_DAILY_COUNT params:', {
          author_profile: message.author_profile,
          date: message.date,
          timezone: message.timezone
        });
        const url = `https://roomiy-automations-1b3a1f8f45bc.herokuapp.com/webhook/c3027a79-1178-4b7b-8c1b-11c49e38bd81-comment-count?author_profile=${encodeURIComponent(message.author_profile)}&date=${encodeURIComponent(message.date)}&timezone=${encodeURIComponent(message.timezone || '')}`;
        console.log('[LinkedIn Comment Tracker][DEBUG][BG] Fetching daily count from backend:', url);
        const res = await fetch(url);
        let data = null;
        let text = null;
        if (res.ok) {
          try {
            text = await res.text();
            data = JSON.parse(text);
          } catch (parseErr) {
            console.error('[LinkedIn Comment Tracker][DEBUG][BG] Failed to parse backend response as JSON:', text, parseErr);
            sendResponse({ count: null, error: 'Invalid JSON from backend' });
            return;
          }
          console.log('[LinkedIn Comment Tracker][DEBUG][BG] Raw backend response:', text);
          console.log('[LinkedIn Comment Tracker][DEBUG][BG] Parsed backend response:', data);
          if (typeof data.count === 'undefined') {
            console.warn('[LinkedIn Comment Tracker][DEBUG][BG] Backend response missing count field:', data);
          }
          sendResponse({ count: typeof data.count === 'string' ? parseInt(data.count, 10) : data.count });
        } else {
          text = await res.text();
          console.error('[LinkedIn Comment Tracker][DEBUG][BG] Backend returned error status:', res.status, text);
          sendResponse({ count: null, error: 'Backend error', status: res.status, body: text });
        }
      } catch (e) {
        console.log('[LinkedIn Comment Tracker][DEBUG][BG] Exception, sending error response to Sidebar:', e);
        sendResponse({ count: null, error: e.message });
      }
    })();
    // Indicate async response
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('LinkedIn Comment Tracker background service worker installed.');
});