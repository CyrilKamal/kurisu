"use client";

import { todayResponseSchema } from "@kurisu/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";
import { getApi } from "@/lib/clientApi";
import { LIST_CHANGED_EVENT } from "@/lib/listChanged";
import { badgeCount, splitOut } from "@/lib/today";

const TABS = [
  { href: "/today", label: "Today", icon: "today" },
  { href: "/list", label: "List", icon: "list" },
  { href: "/browse", label: "Browse", icon: "search" },
  { href: "/chat", label: "Chat", icon: "chat" },
  { href: "/you", label: "You", icon: "user" },
] as const;

/**
 * The NavBar: kurisu's five screens, as a bottom bar on phones and a rail on the left from
 * 1024px (bundle.css), with a 2px crimson bar on the active one. Today counts the shows you keep
 * up with that have new episodes (backlogs aren't news, `splitOut`).
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
                  <span
                    className="k-nav__count"
                    aria-label={`${String(outNow)} ${outNow === 1 ? "show" : "shows"} with new episodes`}
                  >
                    {badgeCount(outNow)}
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

/** Shows with new episodes to watch: fetched on load, on Today, and after each change. */
function useOutNow(onToday: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let current = true;
    const load = async () => {
      const result = await getApi("/today", todayResponseSchema);
      if (current && result.ok) {
        setCount(splitOut(result.data.outNow).keepingUp.length);
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
