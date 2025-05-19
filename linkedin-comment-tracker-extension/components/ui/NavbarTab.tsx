import * as React from "react";
import { Button } from "./button";

export function NavbarTab({ onClick, isSidebarOpen }: { onClick: () => void; isSidebarOpen: boolean }) {
  return (
    <Button
      variant={isSidebarOpen ? "default" : "outline"}
      size="icon"
      className="!rounded-lg !h-10 !w-10 !mx-1"
      style={{ minWidth: 40, minHeight: 40 }}
      onClick={() => window.dispatchEvent(new CustomEvent("toggleSidebar"))}
      aria-label={isSidebarOpen ? "Hide Comment Tracker" : "Show Comment Tracker"}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <rect x="4" y="4" width="16" height="16" rx="2" strokeWidth="2" />
        <rect x="7" y="7" width="10" height="10" rx="1" strokeWidth="2" />
      </svg>
    </Button>
  );
} 