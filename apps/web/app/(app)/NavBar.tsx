"use client";

import { todayResponseSchema } from "@kurisu/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";
import { getApi } from "@/lib/clientApi";
import { LIST_CHANGED_EVENT } from "@/lib/listChanged";

const TABS = [
  { href: "/today", label: "Today", icon: "today" },
  { href: "/list", label: "List", icon: "list" },
  { href: "/chat", label: "Chat", icon: "chat" },
  { href: "/you", label: "You", icon: "user" },
] as const;

/**
 * The NavBar: kurisu's four screens, as a bottom bar on phones and a rail on the left from
 * 1024px (bundle.css), with a 2px crimson bar on the active one. Today counts the episodes out
 * that you haven't watched.
 */
export function NavBar() {
  const pathname = usePathname();
  const outNow = useOutNow(pathname === "/today");
  return (
    <nav
      aria-label="Main"
      className="k-nav fixed inset-x-0 bottom-0 z-20 lg:inset-y-0 lg:right-auto"
    >
      <ul>
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link href={tab.href} aria-current={active ? "page" : undefined}>
                <Icon name={tab.icon} />
                {tab.label}
                {tab.href === "/today" && outNow > 0 && (
                  <span className="k-nav__count" aria-label={`${String(outNow)} episodes out`}>
                    {outNow}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Episodes out that the user hasn't watched: fetched on load, on Today, and after each change. */
function useOutNow(onToday: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let current = true;
    const load = async () => {
      const result = await getApi("/today", todayResponseSchema);
      if (current && result.ok) {
        setCount(result.data.outNow.reduce((n, s) => n + s.latestAired - s.episodesWatched, 0));
      }
    };
    void load();
    const reload = () => void load();
    window.addEventListener(LIST_CHANGED_EVENT, reload);
    return () => {
      current = false;
      window.removeEventListener(LIST_CHANGED_EVENT, reload);
    };
  }, [onToday]);
  return count;
}
