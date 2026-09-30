"use client";

import {
  changeResponseSchema,
  chatThreadResponseSchema,
  type ChatMessageView,
} from "@kurisu/shared";
import { useEffect, useRef, useState } from "react";

import { getApi, postApi } from "@/lib/clientApi";
import { writeErrorMessage } from "@/lib/describeChange";

import { ChangeCard, PendingCard } from "../ChangeCards";

const EXAMPLES = ["watched ep 3 of Frieren", "two more episodes of JJK", "dropping the isekai one"];

function sendErrorMessage(status: number, error: string): string {
  if (status === 0) return "Network error. Check your connection and try again.";
  if (error === "too_many_messages")
    return "That's a lot of messages. Wait a minute and try again.";
  if (error === "busy") return "Still working on your last message.";
  if (status === 401) return "Your session expired. Reload to log in again.";
  return "Something went wrong. Please try again.";
}

export function ChatView({ initialMessages }: { initialMessages: ChatMessageView[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  async function reload() {
    const result = await getApi("/chat", chatThreadResponseSchema);
    if (result.ok) setMessages(result.data.messages);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setNotice(null);
    setDraft("");
    const result = await postApi("/chat/messages", chatThreadResponseSchema, { text: trimmed });
    setSending(false);
    if (result.ok && result.data) {
      const added = result.data.messages;
      setMessages((current) => [...current, ...added]);
    } else if (!result.ok) {
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
    <main className="mx-auto flex h-dvh max-w-2xl flex-col px-4 pb-14">
      <header className="border-b border-zinc-200 py-3 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">Chat</h1>
      </header>

      <div className="flex-1 overflow-y-auto py-4" aria-live="polite">
        {messages.length === 0 && !sending ? (
          <div className="mt-8 text-center text-sm text-zinc-500">
            <p>Tell me what you watched and I&apos;ll update your MyAnimeList.</p>
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
            {messages.map((message) => (
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
              <li className="text-sm text-zinc-500" role="status">
                Thinking…
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
