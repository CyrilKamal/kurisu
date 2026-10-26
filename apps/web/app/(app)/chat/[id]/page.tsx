import { chatThreadResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { apiGet, getMe } from "@/lib/api";

import { ChatView } from "../ChatView";

export const metadata: Metadata = { title: "Chat · kurisu" };

export default async function ChatThreadPage(props: PageProps<"/chat/[id]">) {
  const { id } = await props.params;
  const [thread, me] = await Promise.all([
    apiGet(`/chat/conversations/${encodeURIComponent(id)}`, chatThreadResponseSchema),
    getMe(),
  ]);
  if (!thread || !me) redirect("/");
  // Keyed, so opening another chat starts from that chat's messages.
  return (
    <ChatView
      key={thread.conversation.id}
      details={me.user.isOwner}
      conversation={thread.conversation}
      initialMessages={thread.messages}
    />
  );
}
