"use client";

import {
  conversationResponseSchema,
  conversationsResponseSchema,
  type ConversationView,
} from "@kurisu/shared";
import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";

import { getApi, sendApi } from "@/lib/clientApi";

import { ChatSidebar } from "./ChatSidebar";

interface ChatShellContext {
  /** The user's chats, kept current as they're renamed or deleted. */
  chats: ConversationView[];
  /** Fetches the list of chats again, after a message starts a chat or moves one to the top. */
  refreshChats: () => Promise<void>;
  /** Opens the list of chats on a phone, where it's a drawer. */
  openChats: () => void;
}

const ShellContext = createContext<ChatShellContext | null>(null);

export function useChatShell(): ChatShellContext {
  const context = use(ShellContext);
  if (!context) throw new Error("useChatShell must be used inside ChatShell");
  return context;
}

/** The chat open at a path like /chat/<id>; null for /chat/new. */
function activeChatId(pathname: string): string | null {
  const id = /^\/chat\/([^/]+)$/.exec(pathname)?.[1];
  return id && id !== "new" ? id : null;
}

/**
 * Chat's frame: the list of chats beside the open one on wide screens, and in a drawer on
 * phones.
 */
export function ChatShell({
  initialChats,
  children,
}: {
  initialChats: ConversationView[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [chats, setChats] = useState(initialChats);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const activeId = activeChatId(pathname);

  const refreshChats = useCallback(async () => {
    const result = await getApi("/chat/conversations", conversationsResponseSchema);
    if (result.ok) setChats(result.data.conversations);
  }, []);
  const openChats = useCallback(() => {
    setDrawerOpen(true);
  }, []);
  const context = useMemo(
    () => ({ chats, refreshChats, openChats }),
    [chats, refreshChats, openChats],
  );

  useEffect(() => {
    if (!drawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [drawerOpen]);

  async function renameChat(chat: ConversationView, title: string) {
    const name = title.replace(/\s+/g, " ").trim();
    if (!name || name === chat.title) return;
    setNotice(null);
    setChats((current) => current.map((c) => (c.id === chat.id ? { ...c, title: name } : c)));
    const result = await sendApi(
      "PATCH",
      `/chat/conversations/${chat.id}`,
      conversationResponseSchema,
      { title: name },
    );
    if (!result.ok) {
      setNotice("Couldn't rename that chat. Please try again.");
      await refreshChats();
    }
  }

  async function deleteChat(chat: ConversationView) {
    const question = `Delete "${chat.title}"? Changes it made to your list stay in History, where you can still undo them.`;
    if (!window.confirm(question)) return;
    setNotice(null);
    const result = await sendApi("DELETE", `/chat/conversations/${chat.id}`, null);
    // A 404 means it's already gone.
    if (!result.ok && result.status !== 404) {
      setNotice("Couldn't delete that chat. Please try again.");
      return;
    }
    setChats((current) => current.filter((c) => c.id !== chat.id));
    if (chat.id === activeId) router.replace("/chat");
  }

  const sidebar = (onNavigate?: () => void) => (
    <ChatSidebar
      chats={chats}
      activeId={activeId}
      notice={notice}
      onRename={renameChat}
      onDelete={deleteChat}
      {...(onNavigate && { onNavigate })}
    />
  );

  return (
    <ShellContext value={context}>
      <div className="flex h-dvh pb-14">
        <aside className="hidden w-64 shrink-0 border-r border-zinc-200 md:block dark:border-zinc-800">
          {sidebar()}
        </aside>
        {drawerOpen && (
          <div className="fixed inset-0 z-30 md:hidden">
            <button
              type="button"
              aria-label="Close chats"
              className="absolute inset-0 bg-black/40"
              onClick={() => {
                setDrawerOpen(false);
              }}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Chats"
              className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-white shadow-xl dark:bg-zinc-950"
            >
              {sidebar(() => {
                setDrawerOpen(false);
              })}
            </div>
          </div>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </ShellContext>
  );
}
