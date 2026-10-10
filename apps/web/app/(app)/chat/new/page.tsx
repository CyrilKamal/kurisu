import { listResponseSchema } from "@kurisu/shared";
import type { Metadata } from "next";

import { apiGet } from "@/lib/api";

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
  const list = await apiGet("/list", listResponseSchema);
  // The shows they're watching, by how they'd say it: "watched ep 8 of <their show>".
  const watching = (list?.entries ?? [])
    .filter((entry) => entry.status === "watching")
    .filter((entry) => entry.numEpisodes === null || entry.episodesWatched < entry.numEpisodes)
    .slice(0, 2)
    .map((entry) => `watched ep ${String(entry.episodesWatched + 1)} of ${entry.title}`);
  const examples =
    watching.length > 0
      ? [...watching, "what should I watch tonight?", "40 minutes, something chill"]
      : undefined;
  return (
    <ChatView
      conversation={null}
      initialMessages={[]}
      initialDraft={initialDraft}
      {...(examples && { examples })}
    />
  );
}
