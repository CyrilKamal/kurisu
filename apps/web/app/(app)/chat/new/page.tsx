import type { Metadata } from "next";

import { ChatView } from "../ChatView";

export const metadata: Metadata = { title: "New chat · kurisu" };

/** The longest draft another screen can put in the command line. */
const DRAFT_MAX = 300;

/**
 * An empty chat; the server creates it with the first message. `?draft=` puts text in the
 * command line without sending it, so the user still sends it themselves.
 */
export default async function NewChatPage(props: PageProps<"/chat/new">) {
  const { draft } = await props.searchParams;
  const initialDraft = typeof draft === "string" ? draft.slice(0, DRAFT_MAX) : "";
  return <ChatView conversation={null} initialMessages={[]} initialDraft={initialDraft} />;
}
