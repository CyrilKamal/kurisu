import { conversationsResponseSchema } from "@kurisu/shared";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";

/** Opens the most recent chat, or a new one if there are none. */
export default async function ChatPage() {
  const list = await apiGet("/chat/conversations", conversationsResponseSchema);
  if (!list) redirect("/");
  const [latest] = list.conversations;
  redirect(latest ? `/chat/${latest.id}` : "/chat/new");
}
