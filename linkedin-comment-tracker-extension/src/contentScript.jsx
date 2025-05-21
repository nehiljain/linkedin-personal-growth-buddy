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
  console.log('[LinkedIn Comment Tracker][DEBUG] Trying navbar selector:', meNav);
  if (meNav) {
    loggedInUser.profile = meNav.href || meNav.getAttribute('href') || '';
    loggedInUser.name = meNav.getAttribute('aria-label') || meNav.getAttribute('alt') || '';
    console.log('[LinkedIn Comment Tracker][DEBUG] Got from meNav:', { name: loggedInUser.name, profile: loggedInUser.profile });
    if (!loggedInUser.name) {
      // Try to get from adjacent text
      const nameNode = meNav.closest('li')?.querySelector('.t-16.t-black.t-bold') || null;
      console.log('[LinkedIn Comment Tracker][DEBUG] Trying adjacent text for name:', nameNode);
      if (nameNode) loggedInUser.name = nameNode.innerText.trim();
    }
  }
  // Fallback: try to get from profile dropdown
  if (!loggedInUser.profile) {
    const profileLink = document.querySelector('a[href^="/in/"]');
    console.log('[LinkedIn Comment Tracker][DEBUG] Trying fallback profile link:', profileLink);
    if (profileLink) {
      loggedInUser.profile = profileLink.getAttribute('href');
      loggedInUser.name = profileLink.innerText.trim();
      console.log('[LinkedIn Comment Tracker][DEBUG] Got from profileLink:', { name: loggedInUser.name, profile: loggedInUser.profile });
    }
  }
  window.loggedInUser = loggedInUser;
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

const BACKEND_URL = "http://localhost:8000/comment-event"; // Change to prod URL when deploying

async function postCommentEventToBackend(comment) {
  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(comment),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[Comment Tracker] Backend POST failed:", res.status, err);
    } else {
      console.log("[Comment Tracker] Successfully posted comment event to backend");
    }
  } catch (e) {
    console.error("[Comment Tracker] Error posting to backend:", e);
  }
}

function saveComment(comment) {
  const comments = getStoredComments();
  // Avoid duplicates by commentId and text
  if (comment.commentId && comments.some(c => c.commentId === comment.commentId)) return;
  if (comment.text && comments.some(c => c.text === comment.text && c.author === comment.author)) return;
  comments.push(comment);
  localStorage.setItem('linkedin_comment_tracker_comments', JSON.stringify(comments));
  // Increment today's count (use local date)
  const todayKey = `comment-tracker-count-${new Date().toLocaleDateString('en-CA')}`;
  const prev = parseInt(localStorage.getItem(todayKey) || '0', 10);
  localStorage.setItem(todayKey, String(prev + 1));
  // Send to background for backend POST and outbox
  if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'NEW_COMMENT_EVENT', event: comment });
  }
  // Notify Sidebar to update count
  window.dispatchEvent(new CustomEvent('comment-tracker-new-comment'));
}
window.getDetectedComments = getStoredComments;

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
  if (!container) return { post_author_name: '', post_author_profile: '' };
  // Try post page selectors first
  let authorLink = container.querySelector('.update-components-actor__meta-link[href]');
  let authorName = container.querySelector('.update-components-actor__title span[dir="ltr"]');
  // Fallback to feed selectors
  if (!authorLink) authorLink = container.querySelector('span.feed-shared-actor__name a, a.update-components-actor__meta-link, a.update-components-actor__image');
  if (!authorName) authorName = container.querySelector('span.feed-shared-actor__name, .update-components-actor__title');
  return {
    post_author_name: authorName?.innerText?.trim() || '',
    post_author_profile: authorLink?.href || ''
  };
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
      if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'NEW_COMMENT_EVENT', event: payload }, (response) => {
          console.log('[LinkedIn Comment Tracker][DEBUG] Sent NEW_COMMENT_EVENT to background.js, response:', response);
        });
      } else {
        console.warn('[LinkedIn Comment Tracker][ERROR] chrome.runtime.sendMessage not available');
      }
    }, 200); // 200ms delay to allow DOM update
  }
});