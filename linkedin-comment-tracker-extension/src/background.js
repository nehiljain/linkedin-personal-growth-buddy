// background.js
// Service worker for LinkedIn Comment Tracker extension (Webpack build)
 
const OUTBOX_KEY = 'linkedin_comment_tracker_outbox';
const BACKEND_URL = "http://localhost:8000/comment-event"; // Update for prod
const MAX_RETRY_DELAY = 5 * 60 * 1000; // 5 minutes
const INITIAL_RETRY_DELAY = 5000; // 5 seconds

async function getOutbox() {
  return new Promise(resolve => {
    chrome.storage.local.get([OUTBOX_KEY], result => {
      resolve(result[OUTBOX_KEY] || []);
    });
  });
}

function setOutbox(queue) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [OUTBOX_KEY]: queue }, resolve);
  });
}

async function enqueueEvent(event, retryCount = 0) {
  const queue = await getOutbox();
  // Attach retryCount to event for exponential backoff
  if (!queue.some(e => e.comment_url === event.comment_url)) {
    queue.push({ ...event, retryCount });
    await setOutbox(queue);
    console.log('[LinkedIn Comment Tracker][DEBUG][BG] Event enqueued:', event);
  } else {
    console.log('[LinkedIn Comment Tracker][DEBUG][BG] Duplicate event not enqueued:', event);
  }
}

async function postCommentEventToBackend(event) {
  console.log('[LinkedIn Comment Tracker][DEBUG][BG] Attempting POST to backend:', event);
  const res = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[LinkedIn Comment Tracker][DEBUG][BG] Backend POST failed:', res.status, err);
    throw new Error("Failed to POST");
  } else {
    console.log('[LinkedIn Comment Tracker][DEBUG][BG] Successfully posted to backend:', event);
  }
}

// Helper: fetch and broadcast new count to all tabs
async function fetchAndBroadcastCount(author_profile, date, timezone) {
  const url = `${BACKEND_URL.replace('/comment-event', '/comment-count')}?author_profile=${encodeURIComponent(author_profile)}&date=${encodeURIComponent(date)}&timezone=${encodeURIComponent(timezone || '')}`;
  try {
    const res = await fetch(url);
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

// Non-blocking flush with retry and exponential backoff
async function flushOutbox() {
  let queue = await getOutbox();
  if (queue.length === 0) {
    console.log('[LinkedIn Comment Tracker][DEBUG][BG] Outbox empty, nothing to flush.');
    return;
  }
  // Only process one event at a time to avoid blocking
  const event = queue[0];
  console.log('[LinkedIn Comment Tracker][DEBUG][BG] Flushing event from outbox:', event);
  try {
    await postCommentEventToBackend(event);
    queue = queue.slice(1);
    await setOutbox(queue);
    console.log('[LinkedIn Comment Tracker][DEBUG][BG] Event removed from outbox after successful POST:', event);
    // Immediately try next event
    setTimeout(flushOutbox, 100);
    // After successful POST, fetch and broadcast new count
    const today = new Date().toLocaleDateString('en-CA');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Use event.author_profile_url if available, else fallback to event.author_profile
    const author_profile = event.author_profile_url || event.author_profile;
    if (author_profile) {
      fetchAndBroadcastCount(author_profile, today, timezone);
    }
  } catch (e) {
    // Exponential backoff for retries
    const retryCount = (event.retryCount || 0) + 1;
    const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, retryCount - 1), MAX_RETRY_DELAY);
    // Update retryCount in queue
    queue[0] = { ...event, retryCount };
    await setOutbox(queue);
    console.error('[LinkedIn Comment Tracker][DEBUG][BG] POST failed, will retry after delay:', delay, 'ms', e);
    // Schedule next retry
    setTimeout(flushOutbox, delay);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[LinkedIn Comment Tracker][DEBUG][BG] Received message:', message);
  if (message.type === "NEW_COMMENT_EVENT" && message.event) {
    // Always enqueue, let flushOutbox handle sending
    enqueueEvent(message.event).then(() => flushOutbox());
  }
  // Handle daily count request
  if (message.type === "GET_DAILY_COUNT" && message.author_profile && message.date) {
    (async () => {
      try {
        const url = `${BACKEND_URL.replace('/comment-event', '/comment-count')}?author_profile=${encodeURIComponent(message.author_profile)}&date=${encodeURIComponent(message.date)}&timezone=${encodeURIComponent(message.timezone || '')}`;
        console.log('[LinkedIn Comment Tracker][DEBUG][BG] Fetching daily count from backend:', url);
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          console.log('[LinkedIn Comment Tracker][DEBUG][BG] Sending response to Sidebar:', { count: data.count });
          sendResponse({ count: data.count });
        } else {
          console.log('[LinkedIn Comment Tracker][DEBUG][BG] Sending error response to Sidebar');
          sendResponse({ count: null, error: 'Backend error' });
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

// Comment out or remove polling to minimize compute/IO load
// setInterval(flushOutbox, 30000);
// chrome.runtime.onStartup?.addListener?.(flushOutbox);
// chrome.runtime.onInstalled?.addListener?.(flushOutbox);
// Note: window.addEventListener('online', ...) is not available in service workers
// For network reconnect, consider using chrome.alarms or polling if needed

chrome.runtime.onInstalled.addListener(() => {
  console.log('LinkedIn Comment Tracker background service worker installed.');
}); 