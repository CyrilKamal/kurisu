import type { Metadata } from "next";

import { ChatView } from "../ChatView";

export const metadata: Metadata = { title: "New chat · kurisu" };

/** An empty chat; the server creates it with the first message. */
export default function NewChatPage() {
  return <ChatView conversation={null} initialMessages={[]} />;
}
