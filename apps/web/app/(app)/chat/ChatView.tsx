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

import { Icon } from "@/components/Icon";
import { getApi, postApi } from "@/lib/clientApi";
import { writeErrorMessage } from "@/lib/describeChange";

import { BriefCard } from "./BriefCard";
import { useChatShell } from "./ChatShell";
import { CommandLine } from "./CommandLine";
import { LogEntry, Working } from "./Log";
import { Picks } from "./Picks";
import { RunMeta } from "./RunMeta";
import { ChoiceList, ShowList } from "./Shows";
import { HeldWrite, WriteBlock } from "./WriteBlock";

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
    run: null,
    brief: null,
  };
}

function sendErrorMessage(status: number, error: string): string {
  if (status === 0) return "Network error. Check your connection and try again.";
  if (error === "too_many_messages")
    return "That's a lot of messages. Wait a minute and try again.";
  if (error === "busy") return "Still working on your last message.";
  if (error === "daily_limit")
    return "You've reached today's limit for kurisu. It frees up over the next day.";
  if (error === "monthly_limit")
    return "kurisu is resting until the 1st: this month's budget for the beta is used up.";
  if (status === 401) return "Your session expired. Reload to log in again.";
  if (status === 404) return "This chat was deleted. Start a new one to keep going.";
  return "Something went wrong. Please try again.";
}

/**
 * One chat as a command log (the design system's LogEntry): your lines and kurisu's replies,
 * each reply with its writes, picks or brief, its trace and the run behind it; then the command
 * line. A null conversation is a new chat.
 */
export function ChatView({
  conversation,
  initialMessages,
  initialDraft = "",
}: {
  conversation: ConversationView | null;
  initialMessages: ChatMessageView[];
  /** Text already in the command line, unsent (another screen's "Add", say). */
  initialDraft?: string;
}) {
  const router = useRouter();
  const { chats, refreshChats, openChats } = useChatShell();
  // The sidebar's copy has any new name the chat was given.
  const title = conversation
    ? (chats.find((c) => c.id === conversation.id)?.title ?? conversation.title)
    : "New chat";
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState(initialDraft);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  /** Numbers the messages shown while they're sent. */
  const sentCount = useRef(0);
  const sending = sentAt !== null;

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
    setSentAt(new Date().toISOString());
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
    setSentAt(null);
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
      // Not sent: the message goes back to the command line to try again.
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

  const empty = messages.length === 0 && !sending;
  const latest = messages.length - 1;

  return (
    <main className="mx-auto flex h-full max-w-(--content-max) flex-col">
      <header className="k-header k-header--bar px-2">
        <button
          type="button"
          onClick={openChats}
          aria-label="Show chats"
          className="k-btn k-btn--ghost k-btn--icon md:hidden"
        >
          <Icon name="menu" />
        </button>
        <h1 className="k-header__title md:px-2">{title}</h1>
        <Link
          href="/chat/new"
          aria-label="New chat"
          title="New chat"
          className="k-btn k-btn--ghost k-btn--icon md:hidden"
        >
          <Icon name="new-chat" />
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="px-4 py-6">
            <div className="k-empty">
              <p className="k-empty__title">Tell me what you watched</p>
              <p className="k-empty__text">
                I&apos;ll keep your MyAnimeList in sync, or tell you what to watch next.
              </p>
            </div>
          </div>
        ) : (
          <ol className="k-log" aria-live="polite">
            {messages.map((message, index) =>
              message.role === "user" ? (
                <LogEntry
                  key={message.id}
                  at={message.createdAt}
                  user
                  sending={message.id.startsWith("sending-")}
                >
                  <p className="k-log__text">{message.content}</p>
                </LogEntry>
              ) : (
                <LogEntry key={message.id} at={message.createdAt}>
                  {message.brief ? (
                    <BriefCard
                      brief={message.brief}
                      shows={message.shows}
                      sentAt={message.createdAt}
                      onReply={
                        index === latest && !sending
                          ? (text) => {
                              void send(text);
                            }
                          : undefined
                      }
                      onAdd={
                        sending
                          ? undefined
                          : (show) => {
                              void send(`Add ${show.title} to my Plan to Watch`);
                            }
                      }
                    />
                  ) : (
                    <>
                      <p className="k-log__text">{message.content}</p>
                      {message.changes.length > 0 && (
                        <WriteBlock
                          changes={message.changes}
                          onUndo={(id) => act(`/changes/${id}/undo`, changeResponseSchema)}
                        />
                      )}
                      {message.pending.map((proposal) => (
                        <HeldWrite
                          key={proposal.id}
                          proposal={proposal}
                          onConfirm={(id) => act(`/proposals/${id}/confirm`, changeResponseSchema)}
                          onCancel={(id) => act(`/proposals/${id}/cancel`, null)}
                        />
                      ))}
                      {message.picks.length > 0 && (
                        <Picks
                          picks={message.picks}
                          // A new show is added through Chat, which holds it for the user's OK.
                          onAdd={
                            sending
                              ? undefined
                              : (pick) => {
                                  void send(`Add ${pick.title} to my Plan to Watch`);
                                }
                          }
                        />
                      )}
                      {message.shows.length > 0 &&
                        (message.asksToChoose ? (
                          <ChoiceList
                            shows={message.shows}
                            // Only the latest question can still be answered by tapping.
                            onChoose={
                              index === latest && !sending
                                ? (show) => {
                                    void send(show.title);
                                  }
                                : undefined
                            }
                          />
                        ) : (
                          <ShowList
                            shows={message.shows}
                            onAdd={
                              sending
                                ? undefined
                                : (show) => {
                                    void send(`Add ${show.title} to my Plan to Watch`);
                                  }
                            }
                          />
                        ))}
                    </>
                  )}
                  {message.run && <RunMeta run={message.run} />}
                </LogEntry>
              ),
            )}
            {sentAt && (
              <LogEntry at={sentAt}>
                <Working since={sentAt} />
              </LogEntry>
            )}
          </ol>
        )}
        <div ref={bottom} />
      </div>

      <div className="px-4">
        {empty && (
          <div className="k-chips pt-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="k-chip k-chip--cmd"
                onClick={() => {
                  setDraft(example);
                }}
              >
                {example}
              </button>
            ))}
          </div>
        )}
        <CommandLine
          draft={draft}
          onDraft={setDraft}
          onSend={() => {
            void send(draft);
          }}
          busy={sending}
          notice={notice}
        />
      </div>
    </main>
  );
}
