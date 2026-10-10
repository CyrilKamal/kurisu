"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/Icon";

const TABS = [
  { href: "/chat", label: "Chat", icon: "chat" },
  { href: "/list", label: "List", icon: "list" },
] as const;

/**
 * The NavBar: a bottom bar on phones and a rail on the left from 1024px (bundle.css), solid
 * surface, with a 2px crimson bar on the active tab.
 */
export function NavBar() {
  const pathname = usePathname();
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
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
