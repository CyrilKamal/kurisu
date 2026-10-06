"use client";

import { CHAT_TITLE_MAX, type ConversationView } from "@kurisu/shared";
import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";

import { groupChats } from "@/lib/chatGroups";

import { PlusIcon, RenameIcon, TrashIcon } from "./icons";

const noSubscription = () => () => undefined;

/**
 * False while rendering on the server: "Today" and "Yesterday" depend on the viewer's time zone,
 * so the list is grouped by day only in the browser.
 */
function useIsBrowser(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

const ROW_BUTTON =
  "rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 dark:hover:bg-zinc-800";

/** The list of chats: a New chat button, then each chat by when it was last active. */
export function ChatSidebar({
  chats,
  activeId,
  notice,
  onNavigate,
  onRename,
  onDelete,
}: {
  chats: ConversationView[];
  activeId: string | null;
  notice: string | null;
  /** Called when a link is followed, so the phone drawer can close. */
  onNavigate?: () => void;
  onRename: (chat: ConversationView, title: string) => Promise<void>;
  onDelete: (chat: ConversationView) => Promise<void>;
}) {
  const inBrowser = useIsBrowser();
  const groups = inBrowser ? groupChats(chats, new Date()) : [{ label: null, chats }];
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  // Set by Escape, so leaving the box doesn't save the draft.
  const cancelled = useRef(false);

  function finishRename(chat: ConversationView) {
    const draft = editing?.draft ?? chat.title;
    setEditing(null);
    if (!cancelled.current) void onRename(chat, draft);
  }

  return (
    <nav aria-label="Chats" className="flex h-full flex-col">
      <div className="p-3">
        <Link
          href="/chat/new"
          onClick={onNavigate}
          className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          <PlusIcon />
          New chat
        </Link>
      </div>
      {notice && (
        <p role="alert" className="px-3 pb-2 text-xs text-red-700 dark:text-red-400">
          {notice}
        </p>
      )}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {chats.length === 0 ? (
          <p className="px-2 py-4 text-sm text-zinc-500">No chats yet.</p>
        ) : (
          groups.map((group) => (
            <section key={group.label ?? "all"} className="mb-2">
              {group.label && (
                <h2 className="px-2 pb-1 pt-2 text-xs font-medium text-zinc-500">{group.label}</h2>
              )}
              <ul>
                {group.chats.map((chat) => {
                  const active = chat.id === activeId;
                  if (editing?.id === chat.id) {
                    return (
                      <li key={chat.id} className="py-0.5">
                        <input
                          // Focus moves here because the user just asked to rename.
                          autoFocus
                          value={editing.draft}
                          maxLength={CHAT_TITLE_MAX}
                          aria-label="Chat name"
                          onFocus={(event) => {
                            event.currentTarget.select();
                          }}
                          onChange={(event) => {
                            setEditing({ id: chat.id, draft: event.target.value });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            } else if (event.key === "Escape") {
                              cancelled.current = true;
                              event.currentTarget.blur();
                            }
                          }}
                          onBlur={() => {
                            finishRename(chat);
                          }}
                          className="h-9 w-full rounded-lg border border-blue-700 bg-transparent px-2 text-sm focus:outline-none"
                        />
                      </li>
                    );
                  }
                  return (
                    <li key={chat.id} className="group relative">
                      <Link
                        href={`/chat/${chat.id}`}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        title={chat.title}
                        className={`block truncate rounded-lg py-2 pl-2 pr-16 text-sm ${
                          active
                            ? "bg-zinc-100 font-medium dark:bg-zinc-900"
                            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                        }`}
                      >
                        {chat.title}
                      </Link>
                      <div className="absolute right-1 top-1/2 flex -translate-y-1/2">
                        <button
                          type="button"
                          onClick={() => {
                            cancelled.current = false;
                            setEditing({ id: chat.id, draft: chat.title });
                          }}
                          aria-label={`Rename chat: ${chat.title}`}
                          title="Rename chat"
                          className={`${ROW_BUTTON} hover:text-zinc-900 dark:hover:text-zinc-100`}
                        >
                          <RenameIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void onDelete(chat);
                          }}
                          aria-label={`Delete chat: ${chat.title}`}
                          title="Delete chat"
                          className={`${ROW_BUTTON} hover:text-red-700 dark:hover:text-red-400`}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  );
}
