import { chatThreadResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";

import { ChatView } from "./ChatView";

export const metadata: Metadata = { title: "Chat · kurisu" };

export default async function ChatPage() {
  const thread = await apiGet("/chat", chatThreadResponseSchema);
  if (!thread) redirect("/");
  return <ChatView initialMessages={thread.messages} />;
}
