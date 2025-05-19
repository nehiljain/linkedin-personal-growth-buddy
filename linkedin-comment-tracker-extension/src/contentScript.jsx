import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { NavbarTab } from "@components/ui/NavbarTab";
import { Sidebar } from "@components/ui/Sidebar";
import "./index.css";

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

// --- Detect logged-in user profile ---
let loggedInUser = { name: '', profile: '' };
(function detectLoggedInUser() {
  // Try to get from navbar
  const meNav = document.querySelector('a.global-nav__me-photo, a[data-control-name="nav_settings_profile"]');
  if (meNav) {
    loggedInUser.profile = meNav.getAttribute('href') || '';
    // Try to get name from alt or aria-label
    loggedInUser.name = meNav.getAttribute('aria-label') || meNav.getAttribute('alt') || '';
    if (!loggedInUser.name) {
      // Try to get from adjacent text
      const nameNode = meNav.closest('li')?.querySelector('.t-16.t-black.t-bold') || null;
      if (nameNode) loggedInUser.name = nameNode.innerText.trim();
    }
  }
  // Fallback: try to get from profile dropdown
  if (!loggedInUser.profile) {
    const profileLink = document.querySelector('a[href^="/in/"]');
    if (profileLink) {
      loggedInUser.profile = profileLink.getAttribute('href');
      loggedInUser.name = profileLink.innerText.trim();
    }
  }
  console.log('[LinkedIn Comment Tracker] Detected logged-in user:', loggedInUser);
})();

// --- Helpers for persistent comment storage ---
function getStoredComments() {
  try {
    return JSON.parse(localStorage.getItem('linkedin_comment_tracker_comments') || '[]');
  } catch {
    return [];
  }
}
function saveComment(comment) {
  const comments = getStoredComments();
  // Avoid duplicates by commentId and text
  if (comment.commentId && comments.some(c => c.commentId === comment.commentId)) return;
  if (comment.text && comments.some(c => c.text === comment.text && c.author === comment.author)) return;
  comments.push(comment);
  localStorage.setItem('linkedin_comment_tracker_comments', JSON.stringify(comments));
}
window.getDetectedComments = getStoredComments;

// --- Improved LinkedIn Comment Capture MutationObserver ---
function extractCommentMetadata(commentNode) {
  // Author
  const author = commentNode.querySelector('.comments-comment-meta__description-title')?.innerText?.trim() || '';
  // Author profile link
  const authorProfile = commentNode.querySelector('.comments-comment-meta__image-link')?.getAttribute('href') || '';
  // Text
  const text = commentNode.querySelector('.comments-comment-item__main-content')?.innerText?.trim() || '';
  // Timestamp
  const timestamp = commentNode.querySelector('time')?.innerText?.trim() || '';
  // Comment ID
  const commentId = commentNode.getAttribute('data-id') || '';
  // Post ID (try to extract from data-id or parent data-urn)
  let postId = '';
  if (commentId && commentId.includes('ugcPost:')) {
    const match = commentId.match(/ugcPost:([0-9]+)/);
    if (match) postId = match[1];
  }
  let parent = commentNode.parentElement;
  while (parent && !postId) {
    if (parent.hasAttribute && parent.hasAttribute('data-urn')) {
      postId = parent.getAttribute('data-urn');
    }
    parent = parent.parentElement;
  }
  return { text, author, authorProfile, timestamp, commentId, postId };
}

function normalizeProfileUrl(url) {
  if (!url) return '';
  // Remove protocol and domain, keep only the path
  try {
    const u = new URL(url, 'https://www.linkedin.com');
    return u.pathname.replace(/\/$/, '');
  } catch {
    return url.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '');
  }
}

function isCommentByLoggedInUser(comment) {
  // Compare by normalized profile link (preferred), fallback to name
  const userProfileNorm = normalizeProfileUrl(loggedInUser.profile);
  const authorProfileNorm = normalizeProfileUrl(comment.authorProfile);
  console.log('[LinkedIn Comment Tracker] Comparing logged-in user:', loggedInUser, 'with comment:', comment, 'Normalized:', userProfileNorm, authorProfileNorm);
  if (userProfileNorm && authorProfileNorm) {
    return userProfileNorm === authorProfileNorm;
  }
  if (loggedInUser.name && comment.author) {
    return comment.author.trim().toLowerCase() === loggedInUser.name.trim().toLowerCase();
  }
  return false;
}

function observeCommentsContainers() {
  const containers = document.querySelectorAll('.feed-shared-update-v2__comments-container, .comments-comments-list, .comments-comments-list__container');
  containers.forEach(container => {
    if (container.__commentObserverAttached) return;
    container.__commentObserverAttached = true;
    const commentObserver = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1 && node.matches && node.matches('article.comments-comment-entity')) {
            if (!node.__commentCaptured) {
              node.__commentCaptured = true;
              const data = extractCommentMetadata(node);
              console.log('[LinkedIn Comment Tracker] Detected comment node:', data, node);
              if (isCommentByLoggedInUser(data)) {
                console.log('[LinkedIn Comment Tracker] New comment by logged-in user detected:', data);
                saveComment(data);
              } else {
                console.log('[LinkedIn Comment Tracker] Ignored comment (not by logged-in user):', data);
              }
            }
          }
        });
      });
    });
    commentObserver.observe(container, { childList: true, subtree: true });
  });
}

// Initial observation and dynamic container detection
function setupCommentCapture() {
  observeCommentsContainers();
  // Watch for new comments containers being added (e.g., when loading more posts)
  const feedObserver = new MutationObserver(() => {
    observeCommentsContainers();
  });
  feedObserver.observe(document.body, { childList: true, subtree: true });
}

// Wait for the feed to be available, then start comment capture
function waitForFeedAndStart() {
  const feed = document.querySelector('main[aria-label="Main Feed"]');
  if (feed) {
    setupCommentCapture();
  } else {
    setTimeout(waitForFeedAndStart, 1000);
  }
}
waitForFeedAndStart();

// --- Network Interception for Comment Submission ---
(function interceptNetworkForComments() {
  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const [resource, config] = args;
    if (typeof resource === 'string' && resource.startsWith('https://www.linkedin.com/') && config && config.method === 'POST') {
      // Clone body for logging
      let body = config.body;
      if (body && typeof body === 'object' && body instanceof FormData) {
        // Convert FormData to object
        const obj = {};
        for (let [key, value] of body.entries()) obj[key] = value;
        body = JSON.stringify(obj);
      }
      console.log('[LinkedIn Comment Tracker] fetch POST:', resource, body);
    }
    return originalFetch.apply(this, args);
  };

  // Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._isLinkedInPost = method === 'POST' && typeof url === 'string' && url.startsWith('https://www.linkedin.com/');
    this._linkedInUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this._isLinkedInPost) {
      let loggedBody = body;
      if (body && typeof body !== 'string') {
        try { loggedBody = JSON.stringify(body); } catch {}
      }
      console.log('[LinkedIn Comment Tracker] XHR POST:', this._linkedInUrl, loggedBody);
    }
    return originalSend.call(this, body);
  };
})(); 