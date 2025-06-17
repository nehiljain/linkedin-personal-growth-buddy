// Add this at the top for TypeScript global declaration
declare global {
  interface Window {
    __LINKEDIN_COMMENT_TRACKER__?: { open: boolean };
    loggedInUser?: { profile: string };
  }
}
declare const chrome: any;

import * as React from "react";
import { useEffect, useState } from "react";
import { Progress } from "./progress";
import { Input } from "./input";

export function Sidebar() {
  // --- State for goal and count ---
  const today = new Date().toLocaleDateString('en-CA');
  const todayKey = `comment-tracker-count-${today}`;
  const [goal, setGoal] = useState(() => {
    const stored = localStorage.getItem("comment-tracker-goal");
    return stored ? parseInt(stored, 10) : 5;
  });
  const [count, setCount] = useState(() => {
    const stored = localStorage.getItem(todayKey);
    return stored ? parseInt(stored, 10) : 0;
  });
  const [open, setOpen] = useState(
    window.__LINKEDIN_COMMENT_TRACKER__ && typeof window.__LINKEDIN_COMMENT_TRACKER__.open === 'boolean'
      ? window.__LINKEDIN_COMMENT_TRACKER__.open
      : true
  );

  // --- Helper: get logged-in user profile from content script via messaging ---
  async function getLoggedInUserProfile(): Promise<string> {
    // Try window global first (for backward compatibility)
    if (window.loggedInUser && window.loggedInUser.profile) {
      console.log('[LinkedIn Comment Tracker][SIDEBAR][getLoggedInUserProfile] Found in window:', window.loggedInUser.profile);
      return window.loggedInUser.profile;
    }
    // Try to get from content script via messaging
    return new Promise((resolve) => {
      console.log('[LinkedIn Comment Tracker][SIDEBAR][getLoggedInUserProfile] Sending GET_LOGGED_IN_USER message');
      chrome.runtime.sendMessage({ type: 'GET_LOGGED_IN_USER' }, (user) => {
        console.log('[LinkedIn Comment Tracker][SIDEBAR][getLoggedInUserProfile] Received response:', user);
        if (user && user.profile) {
          resolve(user.profile);
        } else {
          // Fallback: try localStorage or DOM
          const stored = localStorage.getItem('linkedin_comment_tracker_logged_in_profile');
          if (stored) {
            console.log('[LinkedIn Comment Tracker][SIDEBAR][getLoggedInUserProfile] Fallback to localStorage:', stored);
            return resolve(stored);
          }
          const meNav = document.querySelector('a.global-nav__me-photo, a[data-control-name="nav_settings_profile"]');
          if (meNav) {
            const href = meNav.getAttribute('href') || '';
            console.log('[LinkedIn Comment Tracker][SIDEBAR][getLoggedInUserProfile] Fallback to DOM:', href);
            return resolve(href);
          }
          console.log('[LinkedIn Comment Tracker][SIDEBAR][getLoggedInUserProfile] No author_profile found in any method.');
          resolve('');
        }
      });
    });
  }

  // --- Effect: fetch count from backend ---
  useEffect(() => {
    async function fetchCount() {
      const author_profile = await getLoggedInUserProfile();
      if (!author_profile) {
        console.log('[LinkedIn Comment Tracker][SIDEBAR] No author_profile found, skipping fetchCount.');
        return;
      }
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        console.log('[LinkedIn Comment Tracker][SIDEBAR] Sending GET_DAILY_COUNT:', { author_profile, date: today, timezone });
        chrome.runtime.sendMessage(
          { type: 'GET_DAILY_COUNT', author_profile, date: today, timezone },
          (response) => {
            console.log('[LinkedIn Comment Tracker][SIDEBAR] Received response from background for GET_DAILY_COUNT:', response);
            if (response && typeof response.count === 'number') {
              setCount(response.count);
              localStorage.setItem(todayKey, String(response.count));
            } else {
              // Fallback to localStorage
              const stored = localStorage.getItem(todayKey);
              console.log('[LinkedIn Comment Tracker][SIDEBAR] Falling back to localStorage for count:', stored);
              setCount(stored ? parseInt(stored, 10) : 0);
            }
          }
        );
      } catch (e) {
        // Fallback to localStorage
        const stored = localStorage.getItem(todayKey);
        console.log('[LinkedIn Comment Tracker][SIDEBAR] Exception in fetchCount, falling back to localStorage:', e, stored);
        setCount(stored ? parseInt(stored, 10) : 0);
      }
    }
    fetchCount();
  }, [todayKey]);

  // --- Effect: listen for sidebar toggle ---
  useEffect(() => {
    const handler = () => {
      setOpen((prev) => {
        const newOpen = !prev;
        window.__LINKEDIN_COMMENT_TRACKER__.open = newOpen;
        return newOpen;
      });
    };
    window.addEventListener("toggleSidebar", handler);
    return () => window.removeEventListener("toggleSidebar", handler);
  }, []);

  // --- Effect: listen for new comment event and update count from backend ---
  useEffect(() => {
    const updateCount = () => {
      (async () => {
        const author_profile = await getLoggedInUserProfile();
        if (!author_profile) {
          console.log('[LinkedIn Comment Tracker][SIDEBAR] No author_profile found, skipping updateCount.');
          return;
        }
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        console.log('[LinkedIn Comment Tracker][SIDEBAR] Sending GET_DAILY_COUNT (updateCount):', { author_profile, date: today, timezone });
        chrome.runtime.sendMessage(
          { type: 'GET_DAILY_COUNT', author_profile, date: today, timezone },
          (response) => {
            console.log('[LinkedIn Comment Tracker][SIDEBAR] Received response from background for GET_DAILY_COUNT (updateCount):', response);
            if (response && typeof response.count === 'number') {
              setCount(response.count);
              localStorage.setItem(todayKey, String(response.count));
            } else {
              // Fallback to localStorage
              const stored = localStorage.getItem(todayKey);
              console.log('[LinkedIn Comment Tracker][SIDEBAR] Falling back to localStorage for count (updateCount):', stored);
              setCount(stored ? parseInt(stored, 10) : 0);
            }
          }
        );
      })();
    };
    window.addEventListener("comment-tracker-new-comment", updateCount);
    return () => window.removeEventListener("comment-tracker-new-comment", updateCount);
  }, [todayKey]);

  // --- Effect: persist goal ---
  useEffect(() => {
    localStorage.setItem("comment-tracker-goal", String(goal));
  }, [goal]);

  // --- Effect: listen for COMMENT_COUNT_UPDATED from background ---
  useEffect(() => {
    function handleMessage(request) {
      if (request.type === 'COMMENT_COUNT_UPDATED' && typeof request.count === 'number') {
        console.log('[LinkedIn Comment Tracker][SIDEBAR] Received COMMENT_COUNT_UPDATED:', request.count);
        setCount(request.count);
        localStorage.setItem(todayKey, String(request.count));
      }
    }
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [todayKey]);

  // --- Progress calculation ---
  const percent = goal > 0 ? Math.min((count / goal) * 100, 100) : 0;
  let progressColor = "bg-red-500";
  if (percent >= 100) progressColor = "bg-green-500";
  else if (percent >= 50) progressColor = "bg-yellow-400";

  // --- Animate progress bar (shadcn Progress supports transitions) ---

  if (!open) return null;

  return (
    <div
      id="comment-tracker-sidebar-inner"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 320,
        height: "100vh",
        background: "#fff",
        borderLeft: "2px solid #e5e7eb",
        zIndex: 2147483647,
        boxShadow: "0 0 16px rgba(0,0,0,0.12)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "sans-serif"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem", borderBottom: "1px solid #e5e7eb", background: "#f8f9fa" }}>
        <span style={{ fontWeight: 600, fontSize: 18 }}>Comment Tracker</span>
        <button
          aria-label="Close sidebar"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            margin: 0,
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
          onClick={() => {
            setOpen(false);
            window.__LINKEDIN_COMMENT_TRACKER__.open = false;
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div style={{ flex: 1, padding: "2rem", textAlign: "center" }}>
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontSize: 20, fontWeight: 600 }}>Daily Comment Goal</span>
          <div style={{ marginTop: 12, marginBottom: 12 }}>
            <Input
              type="number"
              min={1}
              value={goal}
              onChange={e => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val > 0) setGoal(val);
              }}
              style={{ width: 80, textAlign: "center", fontSize: 18, fontWeight: 500 }}
            />
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 16 }}>Comments today: <b>{count}</b></span>
        </div>
        <div style={{ marginBottom: 8 }}>
          <Progress value={percent} className="h-6 w-full transition-all duration-500" />
          <div className="relative w-full" style={{ marginTop: -24 }}>
            <div
              className={`absolute left-0 top-0 h-6 rounded transition-colors duration-500 ${progressColor}`}
              style={{ width: `${percent}%`, zIndex: -1 }}
            />
            <span style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)", fontWeight: 600, color: percent >= 50 ? '#222' : '#fff', width: '100%' }}>{Math.round(percent)}%</span>
          </div>
        </div>
        <div style={{ marginTop: 32, color: "#666", fontSize: 14 }}>
          <span>Track and gamify your daily LinkedIn comments.<br />Your progress resets every day.</span>
        </div>
      </div>
    </div>
  );
} 