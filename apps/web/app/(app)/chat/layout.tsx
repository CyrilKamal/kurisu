import { conversationsResponseSchema } from "@kurisu/shared";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";

import { ChatShell } from "./ChatShell";

/** Chat's screens share the list of chats: a sidebar on wide screens, a drawer on phones. */
export default async function ChatLayout({ children }: LayoutProps<"/chat">) {
  const list = await apiGet("/chat/conversations", conversationsResponseSchema);
  if (!list) redirect("/");
  return <ChatShell initialChats={list.conversations}>{children}</ChatShell>;
}
