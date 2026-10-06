import { chatThreadResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";

import { ChatView } from "../ChatView";

export const metadata: Metadata = { title: "Chat · kurisu" };

export default async function ChatThreadPage(props: PageProps<"/chat/[id]">) {
  const { id } = await props.params;
  const thread = await apiGet(
    `/chat/conversations/${encodeURIComponent(id)}`,
    chatThreadResponseSchema,
  );
  if (!thread) redirect("/");
  // Keyed, so opening another chat starts from that chat's messages.
  return (
    <ChatView
      key={thread.conversation.id}
      conversation={thread.conversation}
      initialMessages={thread.messages}
    />
  );
}
