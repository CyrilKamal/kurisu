"use client";

import {
  changeResponseSchema,
  chatThreadResponseSchema,
  type ChatMessageView,
  type ConversationView,
} from "@kurisu/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getApi, postApi } from "@/lib/clientApi";
import { writeErrorMessage } from "@/lib/describeChange";

import { ChangeCard, PendingCard } from "../ChangeCards";
import { useChatShell } from "./ChatShell";
import { MenuIcon, NewChatIcon } from "./icons";
import { PickCard } from "./PickCard";
import { ShowCard } from "./ShowCard";
import { ThinkingBubble } from "./ThinkingBubble";

const EXAMPLES = [
  "watched ep 3 of Frieren",
  "two more episodes of JJK",
  "dropping the isekai one",
  "40 minutes, something chill",
];

/** The user's message as it shows while the reply is on its way. */
function sendingMessage(id: string, content: string): ChatMessageView {
  return {
    id,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
    changes: [],
    pending: [],
    picks: [],
    shows: [],
    asksToChoose: false,
  };
}

function sendErrorMessage(status: number, error: string): string {
  if (status === 0) return "Network error. Check your connection and try again.";
  if (error === "too_many_messages")
    return "That's a lot of messages. Wait a minute and try again.";
  if (error === "busy") return "Still working on your last message.";
  if (status === 401) return "Your session expired. Reload to log in again.";
  if (status === 404) return "This chat was deleted. Start a new one to keep going.";
  return "Something went wrong. Please try again.";
}

/** One chat: its messages and the box to write the next. A null conversation is a new chat. */
export function ChatView({
  conversation,
  initialMessages,
}: {
  conversation: ConversationView | null;
  initialMessages: ChatMessageView[];
}) {
  const router = useRouter();
  const { chats, refreshChats, openChats } = useChatShell();
  // The sidebar's copy has any new name the chat was given.
  const title = conversation
    ? (chats.find((c) => c.id === conversation.id)?.title ?? conversation.title)
    : "New chat";
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  /** Numbers the messages shown while they're sent. */
  const sentCount = useRef(0);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  async function reload() {
    if (!conversation) return;
    const result = await getApi(`/chat/conversations/${conversation.id}`, chatThreadResponseSchema);
    if (result.ok) setMessages(result.data.messages);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setNotice(null);
    setDraft("");
    // Show the message right away; the server's copy replaces it when the reply arrives.
    sentCount.current += 1;
    const shownId = `sending-${String(sentCount.current)}`;
    setMessages((current) => [...current, sendingMessage(shownId, trimmed)]);
    const result = await postApi("/chat/messages", chatThreadResponseSchema, {
      text: trimmed,
      ...(conversation && { conversationId: conversation.id }),
    });
    setSending(false);
    const withoutShown = (current: ChatMessageView[]) => current.filter((m) => m.id !== shownId);
    if (result.ok && result.data) {
      const { conversation: chat, messages: added } = result.data;
      setMessages((current) => [...withoutShown(current), ...added]);
      void refreshChats();
      // The first message created the chat: move to its address, unless the user went elsewhere.
      if (!conversation && window.location.pathname === "/chat/new") {
        router.replace(`/chat/${chat.id}`, { scroll: false });
      }
    } else if (!result.ok) {
      // Not sent: the message goes back to the box to try again.
      setMessages(withoutShown);
      setDraft(trimmed);
      setNotice(sendErrorMessage(result.status, result.error));
    }
  }

  async function act(path: string, schema: typeof changeResponseSchema | null) {
    setNotice(null);
    const result = await postApi(path, schema);
    if (!result.ok) setNotice(writeErrorMessage(result.error));
    await reload();
  }

  return (
    <main className="mx-auto flex h-full max-w-2xl flex-col px-4">
      <header className="flex items-center gap-1 border-b border-zinc-200 py-2 dark:border-zinc-800">
        <button
          type="button"
          onClick={openChats}
          aria-label="Show chats"
          className="-ml-2 rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 md:hidden dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          <MenuIcon />
        </button>
        <h1 className="min-w-0 flex-1 truncate py-1 text-lg font-semibold">{title}</h1>
        <Link
          href="/chat/new"
          aria-label="New chat"
          title="New chat"
          className="-mr-2 rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 md:hidden dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          <NewChatIcon />
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto py-4" aria-live="polite">
        {messages.length === 0 && !sending ? (
          <div className="mt-8 text-center text-sm text-zinc-500">
            <p>
              Tell me what you watched and I&apos;ll update your MyAnimeList, or ask what to watch
              next.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setDraft(example);
                  }}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((message, index) => (
              <li
                key={message.id}
                className={message.role === "user" ? "flex justify-end" : "flex flex-col gap-2"}
              >
                <p
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                    message.role === "user"
                      ? "bg-blue-700 text-white"
                      : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {message.content}
                </p>
                {message.changes.map((change) => (
                  <ChangeCard
                    key={change.id}
                    change={change}
                    onUndo={(id) => act(`/changes/${id}/undo`, changeResponseSchema)}
                  />
                ))}
                {message.picks.map((pick, i) => (
                  <PickCard
                    key={pick.animeId}
                    pick={pick}
                    rank={i + 1}
                    // A new show is added through Chat, which asks you to confirm it.
                    {...(pick.status === null &&
                      !sending && {
                        onAdd: () => {
                          void send(`Add ${pick.title} to my Plan to Watch`);
                        },
                      })}
                  />
                ))}
                {message.shows.map((show) => (
                  <ShowCard
                    key={show.animeId}
                    show={show}
                    // Only the latest question can still be answered by tapping.
                    {...(message.asksToChoose &&
                      index === messages.length - 1 &&
                      !sending && {
                        onChoose: () => {
                          void send(show.title);
                        },
                      })}
                  />
                ))}
                {message.pending.map((proposal) => (
                  <PendingCard
                    key={proposal.id}
                    proposal={proposal}
                    onConfirm={(id) => act(`/proposals/${id}/confirm`, changeResponseSchema)}
                    onCancel={(id) => act(`/proposals/${id}/cancel`, null)}
                  />
                ))}
              </li>
            ))}
            {sending && (
              <li>
                <ThinkingBubble />
              </li>
            )}
          </ul>
        )}
        <div ref={bottom} />
      </div>

      {notice && (
        <p role="alert" className="mb-2 text-sm text-red-700 dark:text-red-400">
          {notice}
        </p>
      )}
      <form
        className="flex gap-2 border-t border-zinc-200 py-3 dark:border-zinc-800"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <input
          id="chat-input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          maxLength={1000}
          autoComplete="off"
          placeholder="watched ep 5 of …"
          className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 text-sm focus:border-blue-700 focus:outline-none dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </main>
  );
}
