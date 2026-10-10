"use client";

import { CHAT_TITLE_MAX, type ConversationView } from "@kurisu/shared";
import Link from "next/link";
import { useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { groupChats } from "@/lib/chatGroups";
import { useIsBrowser } from "@/lib/useIsBrowser";

/** "21:41" for a chat from today or yesterday, "10-01" for an older one, in the viewer's zone. */
function chatTime(iso: string, recent: boolean): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return recent
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The list of chats (the design system's ChatList): New chat, then chats by day with briefs
 * tagged and times in mono. With a mouse, rename and delete take the time's place on hover or
 * focus; on a touch screen, each chat has a ⋯ that opens them in a sheet.
 */
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
  // "Today" and the times depend on the viewer's time zone, so they're only shown in the browser.
  const inBrowser = useIsBrowser();
  const groups = inBrowser ? groupChats(chats, new Date()) : [{ label: null, chats }];
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  // The chat whose ⋯ was tapped, on a touch screen.
  const [actionsFor, setActionsFor] = useState<ConversationView | null>(null);
  // Set by Escape, so leaving the box doesn't save the draft.
  const cancelled = useRef(false);

  function finishRename(chat: ConversationView) {
    const draft = editing?.draft ?? chat.title;
    setEditing(null);
    if (!cancelled.current) void onRename(chat, draft);
  }

  return (
    <nav aria-label="Chats" className="k-chatlist flex h-full flex-col">
      <div className="k-chatlist__top">
        <Link href="/chat/new" onClick={onNavigate} className="k-btn k-btn--block">
          <Icon name="new-chat" />
          New chat
        </Link>
      </div>
      {notice && (
        <p role="alert" className="k-cmd__notice px-4 pt-2">
          <span className="k-tag k-tag--word text-accent-text">Err</span>
          {notice}
        </p>
      )}
      <div className="k-chatlist__scroll">
        {chats.length === 0 ? (
          <p className="k-caps k-chatlist__group">No chats yet</p>
        ) : (
          groups.map((group) => {
            const recent = group.label === "Today" || group.label === "Yesterday";
            return (
              <section key={group.label ?? "all"}>
                {group.label && <h2 className="k-caps k-chatlist__group">{group.label}</h2>}
                <ul>
                  {group.chats.map((chat) => {
                    if (editing?.id === chat.id) {
                      return (
                        <li key={chat.id} className="px-2 py-2">
                          <input
                            // Focus moves here because the user just asked to rename.
                            autoFocus
                            value={editing.draft}
                            maxLength={CHAT_TITLE_MAX}
                            aria-label="Chat name"
                            className="k-input w-full"
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
                          />
                        </li>
                      );
                    }
                    return (
                      <li key={chat.id} className="group relative pointer-coarse:flex">
                        <Link
                          href={`/chat/${chat.id}`}
                          onClick={onNavigate}
                          aria-current={chat.id === activeId ? "page" : undefined}
                          title={chat.title}
                          className="k-chatitem pointer-coarse:min-w-0 pointer-coarse:flex-1"
                        >
                          <span className="k-chatitem__title">{chat.title}</span>
                          <span className="k-chatitem__side">
                            {chat.isBrief && <span className="k-tag k-tag--word">Brief</span>}
                            <span className="pointer-fine:group-focus-within:invisible pointer-fine:group-hover:invisible">
                              {inBrowser ? chatTime(chat.lastMessageAt, recent) : ""}
                            </span>
                          </span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            setActionsFor(chat);
                          }}
                          aria-label={`Rename or delete chat: ${chat.title}`}
                          className="k-btn k-btn--icon k-btn--ghost hidden shrink-0 self-center pointer-coarse:inline-flex"
                        >
                          <Icon name="more" />
                        </button>
                        <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 pointer-fine:group-focus-within:flex pointer-fine:group-hover:flex">
                          <button
                            type="button"
                            onClick={() => {
                              cancelled.current = false;
                              setEditing({ id: chat.id, draft: chat.title });
                            }}
                            aria-label={`Rename chat: ${chat.title}`}
                            title="Rename chat"
                            className="k-btn k-btn--icon k-btn--sm k-btn--ghost"
                          >
                            <Icon name="rename" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void onDelete(chat);
                            }}
                            aria-label={`Delete chat: ${chat.title}`}
                            title="Delete chat"
                            className="k-btn k-btn--icon k-btn--sm k-btn--danger"
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </div>
      {actionsFor && (
        <ChatActions
          chat={actionsFor}
          onClose={() => {
            setActionsFor(null);
          }}
          onRename={(title) => {
            setActionsFor(null);
            void onRename(actionsFor, title);
          }}
          onDelete={() => {
            // This sheet closes first: the delete asks in its own.
            setActionsFor(null);
            void onDelete(actionsFor);
          }}
        />
      )}
    </nav>
  );
}

/** A chat's name to change, or the chat to delete, for a touch screen. */
function ChatActions({
  chat,
  onClose,
  onRename,
  onDelete,
}: {
  chat: ConversationView;
  onClose: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(chat.title);
  return (
    <Sheet
      title="Chat"
      onClose={onClose}
      onSubmit={() => {
        onRename(draft);
      }}
    >
      <div className="k-sheet__body">
        <div className="k-field">
          <label className="k-field__label" htmlFor="chat-name">
            Name
          </label>
          <input
            id="chat-name"
            className="k-input"
            value={draft}
            maxLength={CHAT_TITLE_MAX}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
        </div>
      </div>
      <div className="k-sheet__actions">
        <button type="button" className="k-btn k-btn--danger" onClick={onDelete}>
          <Icon name="trash" />
          Delete
        </button>
        <span className="flex-1" />
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="k-btn k-btn--primary" disabled={!draft.trim()}>
          Save
        </button>
      </div>
    </Sheet>
  );
}
