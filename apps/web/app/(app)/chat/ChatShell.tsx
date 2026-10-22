"use client";

import {
  conversationResponseSchema,
  conversationsResponseSchema,
  type ConversationView,
} from "@kurisu/shared";
import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useConfirm } from "@/components/Sheet";
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
  const { confirm, sheet } = useConfirm();
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
    const yes = await confirm({
      title: "Delete this chat?",
      body: `"${chat.title}" goes. Changes it made to your list stay in your Journal, where you can still undo them.`,
      action: "Delete chat",
      danger: true,
    });
    if (!yes) return;
    setNotice(null);
    const result = await sendApi("DELETE", `/chat/conversations/${chat.id}`, null);
    // A 404 means it's already gone.
    if (!result.ok && result.status !== 404) {
      setNotice("Couldn't delete that chat. Please try again.");
      return;
    }
    setChats((current) => current.filter((c) => c.id !== chat.id));
    if (chat.id === activeId) router.replace("/chat");
    // Its row, where focus was, is gone: give focus to New chat in the list that's showing.
    requestAnimationFrame(() => {
      const lost = document.activeElement === document.body || !document.activeElement?.isConnected;
      if (!lost) return;
      const newChat = [...document.querySelectorAll<HTMLElement>(".k-chatlist__top a")].find(
        (link) => link.offsetParent !== null,
      );
      newChat?.focus();
    });
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
      <div className="flex h-dvh pb-bar">
        <aside className="hidden w-(--sidebar-width) shrink-0 border-r border-line md:block">
          {sidebar()}
        </aside>
        {drawerOpen && (
          <ChatDrawer
            onClose={() => {
              setDrawerOpen(false);
            }}
          >
            {sidebar(() => {
              setDrawerOpen(false);
            })}
          </ChatDrawer>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {sheet}
    </ShellContext>
  );
}

/**
 * The chat list on a phone: a modal dialog from the left edge over a solid scrim (k-drawer), so
 * focus stays inside and the chat behind is inert. Escape and a press on the scrim close it, and
 * focus goes back where it was. A sheet opened from it (a chat's ⋯) sits on top and takes Escape
 * first.
 */
function ChatDrawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  const pressedOutside = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    const before = document.activeElement;
    if (element && !element.open) element.showModal();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="k-drawer md:hidden"
      aria-label="Chats"
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget && outsideBox(event);
      }}
      onClick={(event) => {
        if (pressedOutside.current && event.target === event.currentTarget && outsideBox(event)) {
          close.current();
        }
        pressedOutside.current = false;
      }}
    >
      {children}
    </dialog>
  );
}

function outsideBox(event: React.MouseEvent<HTMLElement>): boolean {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right;
}
