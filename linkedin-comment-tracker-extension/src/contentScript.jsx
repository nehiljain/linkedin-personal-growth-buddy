import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { NavbarTab } from "@components/ui/NavbarTab";
import { Sidebar } from "@components/ui/Sidebar";
import "./index.css";
import { addComment, getUnsyncedComments, markCommentsSynced, deleteSyncedComments, getLoggedInUser, setOrUpdateLoggedInUser } from "./lib/idb";

// Shared state for sidebar
window.__LINKEDIN_COMMENT_TRACKER__ = window.__LINKEDIN_COMMENT_TRACKER__ || { open: true };

// Inject sidebar
const sidebarContainer = document.createElement("div");
sidebarContainer.id = "comment-tracker-sidebar";
document.body.appendChild(sidebarContainer);

createRoot(sidebarContainer).render(<Sidebar />);

// Inject tab into navbar
function injectNavbarTab() {
  const nav = document.querySelector(".global-nav__primary-items");
  if (!nav || document.getElementById("comment-tracker-navbar-tab")) return;

  const tabContainer = document.createElement("li");
  tabContainer.id = "comment-tracker-navbar-tab";
  tabContainer.className = "global-nav__primary-item";
  nav.appendChild(tabContainer);

  createRoot(tabContainer).render(
    <NavbarTab
      isSidebarOpen={window.__LINKEDIN_COMMENT_TRACKER__.open}
      onClick={() => {
        window.dispatchEvent(new CustomEvent("toggleSidebar"));
      }}
    />
  );
}

// Wait for navbar to be available
const observer = new MutationObserver(() => {
  if (document.querySelector(".global-nav__primary-items")) {
    injectNavbarTab();
    observer.disconnect();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// --- Robust logged-in user detection and caching ---
let loggedInUser = { name: '', profile: '' };
let profileCardPollingInterval = null;

// Robust extraction from profile card member details
function extractAuthorFromProfileCard() {
  const cards = document.querySelectorAll('.profile-card-member-details');
  for (const card of cards) {
    const links = card.querySelectorAll('a[href^="/in/"]');
    for (const link of links) {
      const nameNode = link.querySelector('h3.profile-card-name');
      if (nameNode) {
        const name = nameNode.innerText.trim();
        const profile = new URL(link.getAttribute('href'), window.location.origin).href;
        if (name || profile) {
          console.log('[LinkedIn Comment Tracker][DEBUG] Found author in profile card:', { name, profile });
          return { name, profile };
        }
      }
    }
  }
  return { name: '', profile: '' };
}

// Centralized user detection from DOM/sidebar/code block
function detectUserFromDOM() {
  // Try navbar
  const meNav = document.querySelector('a.global-nav__me-photo, a[data-control-name="nav_settings_profile"]');
  if (meNav) {
    let name = meNav.getAttribute('aria-label') || meNav.getAttribute('alt') || '';
    if (!name) {
      const nameNode = meNav.closest('li')?.querySelector('.t-16.t-black.t-bold') || null;
      if (nameNode) name = nameNode.innerText.trim();
    }
    const profile = meNav.href || meNav.getAttribute('href') || '';
    if (name || profile) return { name, profile };
  }
  // Try profile dropdown
  const profileLink = document.querySelector('a[href^="/in/"]');
  if (profileLink) {
    const name = profileLink.innerText.trim();
    const profile = profileLink.getAttribute('href');
    if (name || profile) return { name, profile };
  }
  // Try robust profile card extraction
  const cardAuthor = extractAuthorFromProfileCard();
  if (cardAuthor.name || cardAuthor.profile) return cardAuthor;
  // Try hidden code block
  const codeBlocks = Array.from(document.querySelectorAll('code[id^="bpr-guid-"]'));
  for (const code of codeBlocks) {
    try {
      const json = JSON.parse(code.textContent);
      if (json.included && Array.isArray(json.included)) {
        for (const obj of json.included) {
          if (obj.$type && obj.$type.includes('MiniProfile')) {
            const firstName = obj.firstName || '';
            const lastName = obj.lastName || '';
            const publicIdentifier = obj.publicIdentifier || '';
            const name = `${firstName} ${lastName}`.trim();
            const profile = publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}` : '';
            if (name || profile) return { name, profile };
          }
        }
      }
    } catch (e) {}
  }
  return { name: '', profile: '' };
}

async function ensureLoggedInUser() {
  const cachedUser = await getLoggedInUser();
  if (cachedUser && (cachedUser.name || cachedUser.profile)) {
    loggedInUser = { name: cachedUser.name || '', profile: cachedUser.profile || '' };
    return loggedInUser;
  }
  // Try to detect
  const detected = detectUserFromDOM();
  if (detected.name || detected.profile) {
    await setOrUpdateLoggedInUser(detected);
    loggedInUser = detected;
    return loggedInUser;
  }
  // No info found
  loggedInUser = { name: '', profile: '' };
  return loggedInUser;
}

async function pollForProfileCardUser() {
  // Only poll if we don't have a cached user
  const cachedUser = await getLoggedInUser();
  if (cachedUser && (cachedUser.name || cachedUser.profile)) {
    return; // Already have a user, no need to poll
  }
  if (profileCardPollingInterval) return; // Already polling
  profileCardPollingInterval = setInterval(async () => {
    const cardAuthor = extractAuthorFromProfileCard();
    console.log('[LinkedIn Comment Tracker][POLL] Profile card polling attempt:', cardAuthor);
    if (cardAuthor.name || cardAuthor.profile) {
      await setOrUpdateLoggedInUser(cardAuthor);
      console.log('[LinkedIn Comment Tracker][DEBUG] Profile card user found and cached:', cardAuthor);
      clearInterval(profileCardPollingInterval);
      profileCardPollingInterval = null;
    }
  }, 10000); // 10 seconds
}

// On script load, ensure we have the best user info and start polling if needed
ensureLoggedInUser().then(() => {
  pollForProfileCardUser();
});

// Helper to get the cached logged-in user from IndexedDB
export async function getCachedLoggedInUser() {
  const user = await getLoggedInUser();
  if (user) {
    return { name: user.name || '', profile: user.profile || '' };
  }
  return { name: '', profile: '' };
}

const BACKEND_URL = "https://roomiy-automations-1b3a1f8f45bc.herokuapp.com/webhook/db70d7dc-f4d0-493a-ba0c-c09467da6272-comment-event"; // Production endpoint

// Helper to get Authorization header from storage
async function getAuthHeader() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["auth"], (result) => {
      if (result.auth && result.auth.username && result.auth.password) {
        resolve("Basic " + btoa(result.auth.username + ":" + result.auth.password));
      } else {
        resolve(null);
      }
    });
  });
}

async function postCommentEventToBackend(comment) {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { "Authorization": authHeader } : {})
      },
      body: JSON.stringify(comment),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[Comment Tracker] Backend POST failed:", res.status, err);
      return false;
    } else {
      console.log("[Comment Tracker] Successfully posted comment event to backend");
      return true;
    }
  } catch (e) {
    console.error("[Comment Tracker] Error posting to backend:", e);
    return false;
  }
}

// Sync unsynced comments to backend
async function syncComments() {
  const unsynced = await getUnsyncedComments();
  if (unsynced.length === 0) return;
  const successfulIds = [];
  for (const comment of unsynced) {
    const ok = await postCommentEventToBackend(comment);
    if (ok) successfulIds.push(comment.id);
  }
  if (successfulIds.length > 0) {
    await markCommentsSynced(successfulIds);
    await deleteSyncedComments();

    // --- Trigger count update after syncing and deleting ---
    const user = await getLoggedInUser();
    if (user && user.profile) {
      const today = new Date().toLocaleDateString('en-CA');
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      chrome.runtime.sendMessage({
        type: 'GET_DAILY_COUNT',
        author_profile: user.profile,
        date: today,
        timezone
      });
      // The background script will broadcast COMMENT_COUNT_UPDATED, which the sidebar listens for.
    }
  }
}

// Periodic sync (every 30 seconds)
setInterval(syncComments, 30000);
// Sync on page unload
window.addEventListener("beforeunload", syncComments);

// Utility: Find the post container for a comment node (works for feed and post pages)
function getPostContainerUniversal(commentNode) {
  // Try closest feed-shared-update-v2 (main feed and post page)
  let container = commentNode.closest('.feed-shared-update-v2');
  if (container) {
    console.log('[LinkedIn Comment Tracker][DEBUG] getPostContainerUniversal: Found .feed-shared-update-v2 via closest', container);
    return container;
  }
  // Try post-specific page: section.feed-detail-update__container .feed-shared-update-v2
  container = document.querySelector('section.feed-detail-update__container .feed-shared-update-v2');
  if (container) {
    console.log('[LinkedIn Comment Tracker][DEBUG] getPostContainerUniversal: Found .feed-shared-update-v2 inside .feed-detail-update__container', container);
    return container;
  }
  // Try fallback: any .feed-shared-update-v2 on page
  container = document.querySelector('.feed-shared-update-v2');
  if (container) {
    console.log('[LinkedIn Comment Tracker][DEBUG] getPostContainerUniversal: Fallback .feed-shared-update-v2', container);
    return container;
  }
  console.warn('[LinkedIn Comment Tracker][DEBUG] getPostContainerUniversal: No post container found for comment node', commentNode);
  return null;
}

// Universal post author extraction
function extractPostAuthorInfoUniversal(container) {
  // Option 1: Post page selectors
  let authorLink = container?.querySelector('.update-components-actor__meta-link[href]');
  let authorName = container?.querySelector('.update-components-actor__title span[dir="ltr"]');
  if (authorLink && authorName) {
    return {
      post_author_name: authorName.innerText?.trim() || '',
      post_author_profile: authorLink.href || ''
    };
  }
  // Option 2: Feed selectors
  authorLink = container?.querySelector('span.feed-shared-actor__name a, a.update-components-actor__meta-link, a.update-components-actor__image');
  authorName = container?.querySelector('span.feed-shared-actor__name, .update-components-actor__title');
  if (authorLink && authorName) {
    return {
      post_author_name: authorName.innerText?.trim() || '',
      post_author_profile: authorLink.href || ''
    };
  }
  // Option 3: Hidden <code> block with MiniProfile JSON
  const codeBlocks = Array.from(document.querySelectorAll('code[id^="bpr-guid-"]'));
  for (const code of codeBlocks) {
    try {
      const json = JSON.parse(code.textContent);
      if (json.included && Array.isArray(json.included)) {
        for (const obj of json.included) {
          if (obj.$type && obj.$type.includes('MiniProfile')) {
            const firstName = obj.firstName || '';
            const lastName = obj.lastName || '';
            const publicIdentifier = obj.publicIdentifier || '';
            if (publicIdentifier) {
              return {
                post_author_name: `${firstName} ${lastName}`.trim(),
                post_author_profile: `https://www.linkedin.com/in/${publicIdentifier}`
              };
            }
          }
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
  // Option 4: Empty fallback
  return { post_author_name: '', post_author_profile: '' };
}

// Universal post content extraction
function extractPostContentUniversal(container) {
  if (!container) return [];
  // Try post page selector
  let contentBlock = container.querySelector('.feed-shared-inline-show-more-text .update-components-text');
  if (!contentBlock) {
    // Fallback to feed selector
    contentBlock = container.querySelector('.feed-shared-update-v2__description, .update-components-text');
  }
  let text = '';
  if (contentBlock) {
    text = Array.from(contentBlock.querySelectorAll('span, a'))
      .map(el => el.innerText?.trim())
      .filter(Boolean)
      .join(' ');
  }
  // Extract images
  const images = Array.from(container.querySelectorAll('img')).map(img => ({ type: 'image', data: img.src }));
  // Extract videos (poster or video src)
  const videos = Array.from(container.querySelectorAll('video')).map(video => ({ type: 'video', data: video.src || video.poster }));
  const result = [];
  if (text) result.push({ type: 'text', data: text });
  result.push(...images, ...videos);
  return result;
}

// Universal comment author extraction
function extractCommentAuthorInfoUniversal(commentNode) {
  if (!commentNode) return { comment_author_name: '', comment_author_profile: '' };
  // Prefer the description container for name and profile
  let authorLink = commentNode.querySelector('.comments-comment-meta__description-container[href]');
  let authorName = commentNode.querySelector('.comments-comment-meta__description-title');
  // Fallback to image link
  if (!authorLink) authorLink = commentNode.querySelector('.comments-comment-meta__image-link[href]');
  // Fallbacks
  if (!authorName) authorName = commentNode.querySelector('h3, .comments-comment-meta__description-title');
  return {
    comment_author_name: authorName?.innerText?.trim() || '',
    comment_author_profile: authorLink?.href || ''
  };
}

// Universal comment content extraction
function extractCommentContentUniversal(commentNode) {
  if (!commentNode) return '';
  // Try post page selector
  let contentBlock = commentNode.querySelector('.comments-comment-item__main-content, .update-components-text');
  if (!contentBlock) contentBlock = commentNode.querySelector('span[dir="ltr"], .update-components-text');
  return contentBlock?.innerText?.trim() || '';
}

// Update extractCommentMetadata to use universal functions
function extractCommentMetadata(commentNode) {
  console.time('[LinkedIn Comment Tracker][Instrumentation] extractCommentMetadata');
  const { comment_author_name, comment_author_profile } = extractCommentAuthorInfoUniversal(commentNode);
  const text = extractCommentContentUniversal(commentNode);
  // Try to get commentId and timestamp as before
  const commentId = commentNode.getAttribute('data-id') || '';
  const timestamp = commentNode.querySelector('time')?.innerText?.trim() || '';
  const commentMeta = {
    comment_author_name,
    comment_author_profile,
    text,
    commentId,
    timestamp
  };
  console.timeEnd('[LinkedIn Comment Tracker][Instrumentation] extractCommentMetadata');
  return commentMeta;
}

// Helper: Extract profile info from sidebar profile card
function extractSidebarProfileInfo() {
  const sidebar = document.querySelector('.profile-card-member-details');
  if (!sidebar) return { name: '', profile: '' };
  const nameNode = sidebar.querySelector('.profile-card-name');
  const linkNode = sidebar.querySelector('a[href^="/in/"]');
  return {
    name: nameNode?.innerText?.trim() || '',
    profile: linkNode ? (new URL(linkNode.href, window.location.origin)).href : ''
  };
}

// --- Efficient: Only track comment submission, not every keystroke ---
// Only keep the submit button click handler
// Remove all other global event listeners

document.addEventListener('click', function(e) {
  console.log('[LinkedIn Comment Tracker][DEBUG] Click event detected:', e.target);
  const postBtn = e.target.closest('button[class*="comments-comment-box__submit-button"]');
  if (postBtn) {
    console.log('[LinkedIn Comment Tracker][DEBUG] Submit button clicked:', postBtn);
    // Find the comment editor in the same container
    const editorContainer = postBtn.closest('.comments-comment-texteditor');
    if (!editorContainer) {
      console.warn('[LinkedIn Comment Tracker][ERROR] Could not find .comments-comment-texteditor for submit button:', postBtn);
      return;
    }
    console.log('[LinkedIn Comment Tracker][DEBUG] Found editor container:', editorContainer);
    const editor = editorContainer.querySelector('.ql-editor[contenteditable="true"]');
    if (!editor) {
      console.warn('[LinkedIn Comment Tracker][ERROR] Could not find .ql-editor for submit button:', postBtn);
      return;
    }
    console.log('[LinkedIn Comment Tracker][DEBUG] Found editor:', editor);
    const text = editor.innerText.trim();
    console.log('[LinkedIn Comment Tracker][DEBUG] Extracted comment text:', text);
    if (!text) {
      // Don't warn for empty comment, just skip
      console.log('[LinkedIn Comment Tracker][DEBUG] Empty comment text, skipping.');
      return;
    }
    // Find the post container
    const postContainer = getPostContainerUniversal(editorContainer);
    if (!postContainer) {
      console.warn('[LinkedIn Comment Tracker][ERROR] Could not find post container for comment submit:', editorContainer);
      return;
    }
    console.log('[LinkedIn Comment Tracker][DEBUG] Found post container:', postContainer);
    // Extract post and author info
    const postContent = extractPostContentUniversal(postContainer);
    const postAuthor = extractPostAuthorInfoUniversal(postContainer);
    console.log('[LinkedIn Comment Tracker][DEBUG] Extracted post content:', postContent);
    console.log('[LinkedIn Comment Tracker][DEBUG] Extracted post author:', postAuthor);

    // Wait for the new comment to appear in the DOM
    setTimeout(() => {
      // Find all comment nodes in the thread
      const commentNodes = Array.from(document.querySelectorAll('.comments-comment-entity'));
      // Find the one whose text matches what we just submitted
      const newCommentNode = commentNodes.find(node => {
        const content = node.querySelector('.comments-comment-item__main-content, .update-components-text, span[dir="ltr"]');
        return content && content.innerText.trim() === text;
      });

      let comment_author_name = '';
      let comment_author_profile = '';

      if (newCommentNode) {
        const authorInfo = extractCommentAuthorInfoUniversal(newCommentNode);
        comment_author_name = authorInfo.comment_author_name;
        comment_author_profile = authorInfo.comment_author_profile;
        console.log('[LinkedIn Comment Tracker][DEBUG] Extracted author from new comment node:', authorInfo);
      } else {
        // Fallback: try sidebar
        const sidebarInfo = extractSidebarProfileInfo();
        comment_author_name = sidebarInfo.name;
        comment_author_profile = sidebarInfo.profile;
        console.log('[LinkedIn Comment Tracker][DEBUG] Fallback to sidebar profile info:', sidebarInfo);
        // If IndexedDB user cache is empty or different, set/update it now
        setOrUpdateLoggedInUser({ name: sidebarInfo.name, profile: sidebarInfo.profile });
      }

      // Final fallback
      if (!comment_author_name && window.loggedInUser) {
        comment_author_name = window.loggedInUser.name;
        comment_author_profile = window.loggedInUser.profile;
        console.log('[LinkedIn Comment Tracker][DEBUG] Fallback to window.loggedInUser:', window.loggedInUser);
      }

      // Compose payload
      const payload = {
        text,
        comment_author_name,
        comment_author_profile,
        timestamp: new Date().toISOString(),
        comment_url: window.location.href,
        postId: postContainer.getAttribute('data-urn') || '',
        post_author_name: postAuthor.post_author_name,
        post_author_profile: postAuthor.post_author_profile,
        post_content: postContent
      };
      console.log('[LinkedIn Comment Tracker][DEBUG] Final payload for backend:', payload);
      // Store in IndexedDB and trigger sync
      addComment(payload).then(syncComments);
    }, 200); // 200ms delay to allow DOM update
  }
});

// Listen for COMMENT_COUNT_UPDATED and forward as CustomEvent for Sidebar
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'COMMENT_COUNT_UPDATED' && typeof request.count === 'number') {
    window.dispatchEvent(new CustomEvent('comment-tracker-new-comment', { detail: { count: request.count } }));
  }
});

// Listen for GET_LOGGED_IN_USER messages from the sidebar
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'GET_LOGGED_IN_USER') {
    console.log('[LinkedIn Comment Tracker][CONTENT SCRIPT][onMessage] Received GET_LOGGED_IN_USER');
    getLoggedInUser().then(user => {
      console.log('[LinkedIn Comment Tracker][CONTENT SCRIPT][onMessage] Responding with user:', user);
      sendResponse(user || { name: '', profile: '' });
    });
    return true; // Indicates async response
  }
});