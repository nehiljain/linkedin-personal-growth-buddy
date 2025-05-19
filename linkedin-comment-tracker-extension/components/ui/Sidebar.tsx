// Add this at the top for TypeScript global declaration
declare global {
  interface Window {
    __LINKEDIN_COMMENT_TRACKER__?: { open: boolean };
  }
}

import * as React from "react";
import { useEffect, useState } from "react";

export function Sidebar() {
  const [open, setOpen] = useState(
    window.__LINKEDIN_COMMENT_TRACKER__ && typeof window.__LINKEDIN_COMMENT_TRACKER__.open === 'boolean'
      ? window.__LINKEDIN_COMMENT_TRACKER__.open
      : true
  );

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
        <span style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, display: "block" }}>Welcome! 🎉</span>
        <span style={{ color: "#666" }}>Track and gamify your daily LinkedIn comments.<br />Click the tab in the navbar to open/close this sidebar.</span>
      </div>
    </div>
  );
} 