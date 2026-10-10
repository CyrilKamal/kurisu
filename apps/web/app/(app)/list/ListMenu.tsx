"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Icon, type IconName } from "@/components/Icon";

/** The screens around the list, in the header's menu. */
const SCREENS: { href: string; label: string; icon: IconName | null }[] = [
  { href: "/list/brief", label: "Brief", icon: "bell" },
  { href: "/list/stats", label: "Stats", icon: "grid" },
  { href: "/list/diary", label: "Diary", icon: "rename" },
  { href: "/list/taste", label: "Taste", icon: "star" },
  { href: "/list/friends", label: "Friends", icon: "chat" },
  { href: "/list/import", label: "Import", icon: "plus" },
  { href: "/list/changes", label: "History", icon: "undo" },
  { href: "/list/account", label: "Account", icon: null },
];

/**
 * One menu button for every screen around the list, so a phone doesn't scroll a row of them
 * sideways. Opens a panel under the button; a tap outside, Escape or a choice closes it.
 */
export function ListMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="k-btn k-btn--icon"
        aria-label="List screens"
        aria-expanded={open}
        aria-controls="list-menu"
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <Icon name="menu" />
      </button>
      {open && (
        <nav
          id="list-menu"
          aria-label="List screens"
          className="k-panel absolute right-0 top-full z-30 mt-2 w-48 py-1"
        >
          <ul className="m-0 list-none p-0">
            {SCREENS.map((screen) => (
              <li key={screen.href}>
                <Link
                  href={screen.href}
                  className="flex items-center gap-2 px-3 py-2 text-ink no-underline hover:bg-surface-raised"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  <span className="inline-flex w-4 text-ink-faint">
                    {screen.icon && <Icon name={screen.icon} />}
                  </span>
                  {screen.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
