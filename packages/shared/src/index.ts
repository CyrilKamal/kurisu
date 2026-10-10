import { z } from "zod";

/**
 * The HTTP contract between the web app and the server. The web app parses every response
 * with these schemas; the server's integration tests check its responses against them, so the
 * two can't drift apart silently.
 */

/** Name of the httpOnly session cookie the server sets. */
export const SESSION_COOKIE = "kurisu_session";

export const LIST_STATUSES = [
  "watching",
  "completed",
  "on_hold",
  "dropped",
  "plan_to_watch",
] as const;
export const listStatusSchema = z.enum(LIST_STATUSES);
export type ListStatus = z.infer<typeof listStatusSchema>;

/** Why a MAL login failed; the server redirects to `/?login_error=<code>`. */
export const LOGIN_ERRORS = [
  "access_denied",
  "invalid_request",
  "invalid_state",
  "token_exchange_failed",
  "mal_unavailable",
  "invite_only",
] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];

/**
 * Why Chat or an import turned a friend away before calling a model: their runs in the last 24
 * hours, or everyone but the owner's spend this month. The owner is never limited.
 */
export const BUDGET_LIMITS = ["daily_limit", "monthly_limit"] as const;
export type BudgetLimit = (typeof BUDGET_LIMITS)[number];

/** Why a sync failed, as recorded on the sync run. */
export const SYNC_ERRORS = [
  "reauth_required",
  "mal_unavailable",
  "invalid_response",
  "interrupted",
  "internal_error",
] as const;
export type SyncError = (typeof SYNC_ERRORS)[number];

export const lastSyncSchema = z.object({
  status: z.enum(["running", "succeeded", "failed"]),
  trigger: z.enum(["login", "manual"]),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  entriesCount: z.number().int().nonnegative().nullable(),
  error: z.enum(SYNC_ERRORS).nullable(),
});
export type LastSync = z.infer<typeof lastSyncSchema>;

/** GET /me */
export const meResponseSchema = z.object({
  /**
   * isOwner: the account named by OWNER_MAL_USERNAME, the only one that can invite.
   * shareActivity: whether friends see what they watch.
   */
  user: z.object({ malUsername: z.string(), isOwner: z.boolean(), shareActivity: z.boolean() }),
  /** Whether the user finished or skipped the welcome steps (POST /me/welcomed). */
  welcomed: z.boolean(),
  needsReauth: z.boolean(),
  lastSync: lastSyncSchema.nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** One of the owner's invite links, without its code (kurisu keeps only a hash). */
export const inviteViewSchema = z.object({
  id: z.uuid(),
  /** Who it's for, as the owner wrote it. */
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  status: z.enum(["open", "used", "expired"]),
  /** The MAL username of whoever joined with it. */
  usedBy: z.string().nullable(),
});
export type InviteView = z.infer<typeof inviteViewSchema>;

export const invitesResponseSchema = z.object({ invites: z.array(inviteViewSchema) });

/** A new invite: the link to share, shown only this once. */
export const createdInviteSchema = z.object({
  id: z.uuid(),
  url: z.url(),
  expiresAt: z.iso.datetime(),
});

/** GET /invites/code/:code, for the invite page: the link still works, and who sent it. */
export const inviteCodeResponseSchema = z.object({ inviter: z.string() });

/** What a friend did, as the Friends feed shows it. Never a drop's reason or an unshared note. */
export const ACTIVITY_KINDS = [
  "finished",
  "dropped",
  "started",
  "watched",
  "planned",
  "rated",
] as const;

export const activityItemSchema = z.object({
  friendId: z.uuid(),
  friend: z.string(),
  at: z.iso.datetime(),
  kind: z.enum(ACTIVITY_KINDS),
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.string().nullable(),
  /** For "watched" and "started": the episodes, which can span a day's updates. */
  fromEpisode: z.number().int().nullable(),
  toEpisode: z.number().int().nullable(),
  /** Their score, when the update set one. */
  score: z.number().int().min(1).max(10).nullable(),
  /** A diary note they shared with the update. */
  note: z.string().nullable(),
});
export type ActivityItemView = z.infer<typeof activityItemSchema>;

export const friendViewSchema = z.object({
  id: z.uuid(),
  malUsername: z.string(),
  since: z.iso.datetime(),
  /** Whether they share what they watch; off, only the taste match shows. */
  sharing: z.boolean(),
  /** 0–100, or null with too little in common; sharedScored: shows both scored. */
  match: z.object({
    percent: z.number().int().min(0).max(100).nullable(),
    sharedScored: z.number().int().min(0),
  }),
});
export type FriendView = z.infer<typeof friendViewSchema>;

/** GET /friends: your friend link, whether you share, your friends, and what they watched. */
export const friendsResponseSchema = z.object({
  /** The viewer's time zone, for the feed's days. */
  timeZone: z.string(),
  link: z.url(),
  shareActivity: z.boolean(),
  friends: z.array(friendViewSchema),
  activity: z.array(activityItemSchema),
});

const matchShowSchema = z.object({
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.string().nullable(),
});
const scorePair = { mine: z.number().int(), theirs: z.number().int() };

/** GET /friends/:id: the taste match in full, and their activity (empty when not shared). */
export const friendDetailResponseSchema = z.object({
  timeZone: z.string(),
  friend: friendViewSchema,
  bothLoved: z.array(matchShowSchema.extend(scorePair)),
  disagreements: z.array(matchShowSchema.extend(scorePair)),
  /** Shows they scored highly that aren't on your list. */
  theyLoved: z.array(matchShowSchema.extend({ theirs: z.number().int() })),
  activity: z.array(activityItemSchema),
});
export type FriendDetailResponse = z.infer<typeof friendDetailResponseSchema>;

export const friendLinkResponseSchema = z.object({ link: z.url() });

/** GET /friends/links/:code, for the page a friend link opens. */
export const friendLinkCheckSchema = z.object({
  owner: z.string(),
  self: z.boolean(),
  alreadyFriends: z.boolean(),
});

/** POST /friends: the code from someone's friend link. */
export const friendLinkAcceptSchema = z.object({ code: z.string().min(1).max(128) }).strict();
export const friendAddedSchema = z.object({ friendId: z.uuid() });

/** PUT /friends/sharing. */
export const sharingRequestSchema = z.object({ shareActivity: z.boolean() }).strict();
export const sharingResponseSchema = sharingRequestSchema;

/** POST /chat/messages/:id/report: the user says this reply was wrong, in their words or none. */
export const reportRequestSchema = z
  .object({ note: z.string().trim().min(1).max(500).optional() })
  .strict();
export const reportResponseSchema = z.object({ reported: z.literal(true) });

/** PATCH /diary/notes/:id: show a note to friends, or stop. */
export const diaryNotePatchSchema = z.object({ shared: z.boolean() }).strict();

/** A show's airing, from AniList's cached schedule (refreshed after syncs; never a live call). */
export const airingViewSchema = z.object({
  /** The latest episode out, in MAL's numbering; null when we can't tell. 0: none yet. */
  latestAired: z.number().int().nonnegative().nullable(),
  /** The next episode and when it airs, when AniList has it scheduled. */
  nextEpisode: z.number().int().positive().nullable(),
  nextAiringAt: z.iso.datetime().nullable(),
});
export type AiringView = z.infer<typeof airingViewSchema>;

/** Where a show streams among the user's services, from AniList's official links only. */
export const watchOnSchema = z.object({ service: z.string(), url: z.string().nullable() });
export type WatchOnView = z.infer<typeof watchOnSchema>;

export const listEntrySchema = z.object({
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.url({ protocol: /^https$/ }).nullable(),
  mediaType: z.string().nullable(),
  numEpisodes: z.number().int().positive().nullable(),
  airingStatus: z.string().nullable(),
  /** MAL's English title and synonyms, so filtering by "Frieren" finds "Sousou no Frieren". */
  altTitles: z.array(z.string()),
  /** Genres, themes and demographics, as MAL names them. */
  genres: z.array(z.string()),
  episodeMinutes: z.number().int().positive().nullable(),
  /** MAL's community score; null when it has none yet. */
  malMean: z.number().positive().nullable(),
  status: listStatusSchema,
  score: z.number().int().min(0).max(10),
  episodesWatched: z.number().int().nonnegative(),
  isRewatching: z.boolean(),
  updatedAt: z.iso.datetime(),
  /** Null when AniList has nothing cached for it (it isn't airing, or doesn't map). */
  airing: airingViewSchema.nullable(),
});
export type ListEntry = z.infer<typeof listEntrySchema>;

/** GET /list: entries sorted by most recently updated on MAL first. */
export const listResponseSchema = z.object({
  entries: z.array(listEntrySchema),
  lastSync: lastSyncSchema.nullable(),
});
export type ListResponse = z.infer<typeof listResponseSchema>;

/** POST /sync, 200 */
export const syncResponseSchema = z.object({
  lastSync: lastSyncSchema,
});

/** POST /sync, 409 / 429 / 502 */
export const syncErrorResponseSchema = z.object({
  error: z.enum(["cooldown", "reauth_required", "sync_failed"]),
  retryAfterSeconds: z.number().int().positive().optional(),
  lastSync: lastSyncSchema.nullable(),
});
export type SyncErrorResponse = z.infer<typeof syncErrorResponseSchema>;

/** The list fields a change touches (only the ones that changed are present). */
export const listChangeSchema = z
  .object({
    status: listStatusSchema.optional(),
    episodesWatched: z.number().int().nonnegative().optional(),
    score: z.number().int().min(0).max(10).optional(),
    isRewatching: z.boolean().optional(),
  })
  .strict();
export type ListChange = z.infer<typeof listChangeSchema>;

/** A committed write to MAL, from the change log. */
/** A show a reply names, as a card. `status` is null when it isn't on the user's list. */
export const showCardSchema = z.object({
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.string().nullable(),
  mediaType: z.string().nullable(),
  numEpisodes: z.number().int().positive().nullable(),
  episodeMinutes: z.number().int().positive().nullable(),
  status: listStatusSchema.nullable(),
  episodesWatched: z.number().int().nonnegative(),
});
export type ShowCard = z.infer<typeof showCardSchema>;

/** update: a change to an entry. add: a show put on the list. remove: one taken off (an undone add). */
export const WRITE_KINDS = ["update", "add", "remove"] as const;
export type WriteKind = (typeof WRITE_KINDS)[number];

/** Who made a change: the agent in Chat, the user on the List screen, an import, or an undo. */
export const CHANGE_SOURCES = ["agent", "user", "import", "undo"] as const;
export type ChangeSource = (typeof CHANGE_SOURCES)[number];

export const changeViewSchema = z.object({
  id: z.uuid(),
  /** The proposal it committed, shown as its short id (`shortId`). */
  proposalId: z.uuid(),
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.string().nullable(),
  /** The show's episode count, for "ep 6 → 7 of 12". */
  numEpisodes: z.number().int().positive().nullable(),
  kind: z.enum(WRITE_KINDS),
  before: listChangeSchema,
  after: listChangeSchema,
  committedAt: z.iso.datetime(),
  /** True once someone pressed Undo on it. */
  undone: z.boolean(),
  /** True if this change is itself an undo. */
  isUndo: z.boolean(),
  source: z.enum(CHANGE_SOURCES),
});
export type ChangeView = z.infer<typeof changeViewSchema>;

/** A change the agent staged that waits for the user to confirm it. */
export const pendingProposalViewSchema = z.object({
  id: z.uuid(),
  animeId: z.number().int().positive(),
  title: z.string(),
  /** An add puts the show on the list; it always waits for the user. */
  kind: z.enum(["update", "add"]),
  before: listChangeSchema,
  change: listChangeSchema,
  reason: z.string().nullable(),
  /** The show, for an add's card. */
  show: showCardSchema.nullable(),
});
export type PendingProposalView = z.infer<typeof pendingProposalViewSchema>;

/** A recommended show, shown as a card under the reply. `status` is null for a show new to the user. */
export const pickViewSchema = z.object({
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.string().nullable(),
  status: listStatusSchema.nullable(),
  episodesWatched: z.number().int().nonnegative(),
  numEpisodes: z.number().int().positive().nullable(),
  episodeMinutes: z.number().int().positive().nullable(),
  /** One line on why it fits. */
  why: z.string(),
  /**
   * Where it streams, among the user's services and any the request named, from AniList's
   * official links: a label like "Crunchyroll" and AniList's https link there (or null).
   */
  watchOn: z.array(watchOnSchema),
});
export type PickView = z.infer<typeof pickViewSchema>;

/** A proposal's or change's short id, as Chat shows it: "p_7f3a". */
export function shortId(id: string): string {
  return `p_${id.replaceAll("-", "").slice(0, 4)}`;
}

/** One tool call of a reply's run, summed up for its trace. */
export const runStepViewSchema = z.object({
  tool: z.string(),
  /** The arguments in a few words: `"tidewater"`, `#5114 status=completed`. */
  args: z.string(),
  /** What came back in a few words: "1 match", "written", or the error code. */
  result: z.string(),
  ok: z.boolean(),
  ms: z.number().int().nonnegative(),
});
export type RunStepView = z.infer<typeof runStepViewSchema>;

/**
 * The agent runs behind a reply (RunMeta): the progress agent's, after any escalation, plus the
 * recommender's when it handed the message over. Times and tokens add up all of them.
 */
export const runViewSchema = z.object({
  /** "gemini:gemini-3.5-flash-lite". */
  model: z.string(),
  promptVersion: z.string(),
  /** The model of the run it escalated from, when it did. */
  escalatedFrom: z.string().nullable(),
  /** The recommender, when the message was handed to it. */
  handoff: z.object({ model: z.string(), promptVersion: z.string() }).nullable(),
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** A short error code when the reply's run failed ("model_timeout"). */
  error: z.string().nullable(),
  steps: z.array(runStepViewSchema),
});
export type RunView = z.infer<typeof runViewSchema>;

/** A morning brief's message, for its card: the new episodes, premieres and Sunday recap. */
export const briefCardViewSchema = z.object({
  /** The user's local date it's for ("2026-10-08"). */
  localDate: z.string().nullable(),
  summary: z.string().nullable(),
  items: z.array(
    z.object({
      animeId: z.number().int().positive(),
      title: z.string(),
      pictureUrl: z.string().nullable(),
      /** New episodes not watched yet, ascending. */
      episodes: z.array(z.number().int().positive()),
      premiere: z.boolean(),
      finale: z.boolean(),
      episodesWatched: z.number().int().nonnegative(),
      numEpisodes: z.number().int().positive().nullable(),
      /** The user's services that list it; empty when none do. */
      services: z.array(z.string()),
    }),
  ),
  /** Shows that started airing; their cards are the message's `shows`. */
  alerts: z.array(
    z.object({
      animeId: z.number().int().positive(),
      kind: z.enum(["sequel_started", "ptw_started"]),
      /** For a sequel: the show they finished that it follows. */
      after: z.string().nullable(),
      services: z.array(z.string()),
    }),
  ),
  recap: z
    .object({
      episodes: z.number().int().nonnegative(),
      minutes: z.number().int().nonnegative(),
      shows: z.number().int().nonnegative(),
      finished: z.array(z.string()),
      year: z.number().int(),
      completed: z.number().int().nonnegative(),
      goal: z.number().int().positive().nullable(),
    })
    .nullable(),
});
export type BriefCardView = z.infer<typeof briefCardViewSchema>;

export const chatMessageViewSchema = z.object({
  id: z.uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.iso.datetime(),
  changes: z.array(changeViewSchema),
  pending: z.array(pendingProposalViewSchema),
  picks: z.array(pickViewSchema),
  /** Shows the reply names that have no other card in it. */
  shows: z.array(showCardSchema),
  /** The reply asks a question, so its show cards answer it when tapped. */
  asksToChoose: z.boolean(),
  /** The runs behind an assistant reply; null for the user's messages and for briefs. */
  run: runViewSchema.nullable(),
  /** A brief's message: its card. */
  brief: briefCardViewSchema.nullable(),
});
export type ChatMessageView = z.infer<typeof chatMessageViewSchema>;

/** A chat, as listed in the sidebar. */
export const conversationViewSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  lastMessageAt: z.iso.datetime(),
  /** A chat a morning brief started. */
  isBrief: z.boolean(),
});
export type ConversationView = z.infer<typeof conversationViewSchema>;

/** GET /chat/conversations: most recently active first. */
export const conversationsResponseSchema = z.object({
  conversations: z.array(conversationViewSchema),
});

/** The longest name a chat can be given. */
export const CHAT_TITLE_MAX = 100;

/** PATCH /chat/conversations/:id: the renamed chat. */
export const conversationResponseSchema = z.object({ conversation: conversationViewSchema });

/**
 * GET /chat/conversations/:id, and POST /chat/messages (the chat it went to, and the new user and
 * assistant messages).
 */
export const chatThreadResponseSchema = z.object({
  conversation: conversationViewSchema,
  messages: z.array(chatMessageViewSchema),
});

/** GET /changes: newest first. */
export const changesResponseSchema = z.object({ changes: z.array(changeViewSchema) });

/** POST /proposals/:id/confirm and POST /changes/:id/undo, on success. */
export const changeResponseSchema = z.object({ change: changeViewSchema });

/** Why a confirm, cancel or undo didn't happen. */
export const WRITE_ERRORS = [
  "not_found",
  "stale",
  "changed_since",
  "already_undone",
  "cancelled",
  "not_cancellable",
  "in_progress",
  "not_on_list",
  "reauth_required",
  "mal_rejected",
  "mal_unavailable",
  "invalid_response",
  "internal_error",
] as const;
export const writeErrorResponseSchema = z.object({ error: z.enum(WRITE_ERRORS) });

/** POST /list/:animeId/edit: the fields the user changed on the List screen. */
export const listEditRequestSchema = z
  .object({
    status: listStatusSchema.optional(),
    episodesWatched: z.number().int().nonnegative().max(100_000).optional(),
    score: z.number().int().min(0).max(10).optional(),
    isRewatching: z.boolean().optional(),
    /** One per tap, so a retried tap writes once. */
    requestId: z.uuid(),
  })
  .strict();
export type ListEditRequest = z.infer<typeof listEditRequestSchema>;

/** POST /list/:animeId/remove: takes a show off the list (undoable). */
export const listRemoveRequestSchema = z.object({ requestId: z.uuid() }).strict();

/** Why an edit was turned down before anything was written. */
export const EDIT_ERRORS = [
  "invalid_edit",
  "no_change",
  "episodes_exceed_total",
  "negative_episodes",
  "score_out_of_range",
  "rewatch_not_completed",
] as const;
export type EditError = (typeof EDIT_ERRORS)[number];
export const editErrorResponseSchema = z.object({
  error: z.enum([...WRITE_ERRORS, ...EDIT_ERRORS]),
});

/** GET /push/public-key: the VAPID key browsers subscribe with, or null when push is off. */
export const pushPublicKeyResponseSchema = z.object({ publicKey: z.string().nullable() });
export type PushPublicKeyResponse = z.infer<typeof pushPublicKeyResponseSchema>;

/** POST and DELETE /push/subscriptions, on success. */
export const pushSubscriptionResponseSchema = z.object({ subscribed: z.boolean() });

/** POST /push/test, on success: how many of the user's browsers got the test notification. */
export const pushTestResponseSchema = z.object({
  sent: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type PushTestResponse = z.infer<typeof pushTestResponseSchema>;

/** Why a push request didn't go through. */
export const PUSH_ERRORS = [
  "push_disabled",
  "invalid_subscription",
  "unsupported_push_service",
  "too_soon",
  "no_subscriptions",
] as const;
export type PushError = (typeof PUSH_ERRORS)[number];
export const pushErrorResponseSchema = z.object({ error: z.enum(PUSH_ERRORS) });

/**
 * Streaming services the brief can name. The user picks theirs once; the brief only ever names
 * one of these, and only when AniList lists the show on it.
 */
export const STREAMING_SERVICES = [
  { id: "crunchyroll", label: "Crunchyroll" },
  { id: "netflix", label: "Netflix" },
  { id: "hidive", label: "HIDIVE" },
  { id: "hulu", label: "Hulu" },
  { id: "disney_plus", label: "Disney+" },
  { id: "prime_video", label: "Prime Video" },
  { id: "max", label: "Max" },
  { id: "apple_tv", label: "Apple TV+" },
  { id: "tubi", label: "Tubi" },
  { id: "youtube", label: "YouTube" },
  { id: "bilibili_tv", label: "Bilibili TV" },
  { id: "retrocrush", label: "RetroCrush" },
  { id: "adult_swim", label: "Adult Swim" },
] as const;
export type StreamingServiceId = (typeof STREAMING_SERVICES)[number]["id"];
const streamingServiceIds = STREAMING_SERVICES.map((s) => s.id) as [
  StreamingServiceId,
  ...StreamingServiceId[],
];

/** GET and PUT /brief/settings. `time` is the user's local "HH:MM"; `timeZone` is IANA. */
export const briefSettingsSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.string().min(1).max(64),
  services: z.array(z.enum(streamingServiceIds)).max(STREAMING_SERVICES.length),
  /** On Sundays the brief also sums up the week, with this year's goal. */
  sundayRecap: z.boolean(),
});
export type BriefSettings = z.infer<typeof briefSettingsSchema>;

/** GET and PUT /brief/settings respond with the settings plus where the daily brief stands. */
export const briefSettingsResponseSchema = briefSettingsSchema.extend({
  /** When the next daily brief goes out; null when the brief is off. */
  next: z.enum(["today", "tomorrow"]).nullable(),
  /** The most recent daily brief. */
  lastDaily: z
    .object({
      localDate: z.string(),
      status: z.enum(["building", "ready", "sent", "empty", "skipped_late", "failed"]),
      episodes: z.number().int().nonnegative(),
      /** Shows it said started airing: sequels to ones the user finished, Plan to Watch shows. */
      started: z.number().int().nonnegative(),
      /** Whether it summed up the week (a Sunday). */
      recap: z.boolean(),
      at: z.iso.datetime({ offset: true }),
    })
    .nullable(),
});
export type BriefSettingsResponse = z.infer<typeof briefSettingsResponseSchema>;

/**
 * POST /brief/test: a brief of the last 24 hours, sent now. "empty" means nothing aired: no new
 * episodes, and nothing the user follows started airing.
 */
export const briefTestResponseSchema = z.object({
  status: z.enum(["sent", "empty"]),
  episodes: z.number().int().nonnegative(),
  /** Shows that started airing: sequels to ones the user finished, Plan to Watch shows. */
  started: z.number().int().nonnegative(),
  /** Whether it summed up the week (sent on a Sunday). */
  recap: z.boolean(),
  push: pushTestResponseSchema,
});
export type BriefTestResponse = z.infer<typeof briefTestResponseSchema>;

/** Why a brief request didn't go through. */
export const BRIEF_ERRORS = [
  "invalid_settings",
  "too_soon",
  "anilist_unavailable",
  "push_disabled",
] as const;
export type BriefError = (typeof BRIEF_ERRORS)[number];
export const briefErrorResponseSchema = z.object({ error: z.enum(BRIEF_ERRORS) });

/** Why a user dropped a show, as one of a few categories; their own words are kept alongside. */
export const DROP_CATEGORIES = [
  "pacing",
  "story",
  "characters",
  "art_animation",
  "too_long",
  "lost_interest",
  "other",
] as const;
export type DropCategory = (typeof DROP_CATEGORIES)[number];

/** How the user rates one genre (genres, themes and demographics, as MAL names them). */
export const tasteGenreSchema = z.object({
  genre: z.string(),
  /** Shows in the genre the user scored, and their average score. */
  scored: z.number().int().nonnegative(),
  meanScore: z.number().nullable(),
  dropped: z.number().int().nonnegative(),
  /** The genre average minus the overall average, pulled toward 0 when few shows back it. */
  affinity: z.number(),
});
export type TasteGenre = z.infer<typeof tasteGenreSchema>;

/** A reason the user gave for dropping a show. */
export const dropReasonViewSchema = z.object({
  id: z.uuid(),
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.string().nullable(),
  category: z.enum(DROP_CATEGORIES),
  /** The user's message that gave the reason. */
  said: z.string(),
  createdAt: z.iso.datetime(),
});
export type DropReasonView = z.infer<typeof dropReasonViewSchema>;

/** GET /taste: rating patterns by genre (best first) and drop reasons (newest first). */
export const tasteResponseSchema = z.object({
  /** The average over everything the user scored; null when they scored nothing. */
  overallMean: z.number().nullable(),
  scoredCount: z.number().int().nonnegative(),
  genres: z.array(tasteGenreSchema),
  dropReasons: z.array(dropReasonViewSchema),
});
export type TasteResponse = z.infer<typeof tasteResponseSchema>;

const count = z.number().int().nonnegative();
const shownShow = z.object({ animeId: z.number().int().positive(), title: z.string() });

/**
 * GET /stats: what the user watched. All time from the list; this year's completions by MAL's
 * finish date (or, without one, the day kurisu or a sync saw the show completed); the last 7
 * days from kurisu's changes and the changes a sync found on MAL.
 */
export const statsResponseSchema = z.object({
  /** The user's time zone (from the brief settings), which "this year" follows. */
  timeZone: z.string(),
  allTime: z.object({
    shows: count,
    byStatus: z.object({
      watching: count,
      completed: count,
      on_hold: count,
      dropped: count,
      plan_to_watch: count,
    }),
    episodes: count,
    /** Minutes watched, for shows whose episode length MAL knows. */
    minutes: count,
    /** Shows with episodes watched whose episode length MAL doesn't know. */
    unknownLength: count,
    meanScore: z.number().nullable(),
    scored: count,
    /** How many shows got each score, 1 to 10. */
    scores: z.array(count).length(10),
    topGenres: z.array(z.object({ genre: z.string(), shows: count })),
  }),
  year: z.object({
    year: z.number().int(),
    completed: count,
    /** Completions per month, January first. */
    byMonth: z.array(count).length(12),
    /** Shows to complete this year; null when there's no goal. */
    goal: z.number().int().positive().nullable(),
    /** The latest completions, newest first, with their date as MAL writes dates. */
    recent: z.array(shownShow.extend({ on: z.string() })),
  }),
  week: z.object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    episodes: count,
    minutes: count,
    shows: count,
    finished: z.array(shownShow),
  }),
});
export type StatsResponse = z.infer<typeof statsResponseSchema>;

/**
 * One update in the diary: made through kurisu (Chat, the List screen) or on MAL's site (found by
 * a sync), with the user's reaction when they gave one.
 */
export const diaryEntrySchema = z.object({
  /** The change's id, or the list event's. */
  id: z.uuid(),
  origin: z.enum(["kurisu", "mal"]),
  kind: z.enum(WRITE_KINDS),
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.string().nullable(),
  before: listChangeSchema,
  after: listChangeSchema,
  at: z.iso.datetime(),
  /** What the user said about the show with this update, in their own words; shared with friends or not. */
  note: z.object({ id: z.uuid(), text: z.string(), shared: z.boolean() }).nullable(),
});
export type DiaryEntry = z.infer<typeof diaryEntrySchema>;

/** GET /diary: the latest updates, newest first, and the time zone their days follow. */
export const diaryResponseSchema = z.object({
  timeZone: z.string(),
  entries: z.array(diaryEntrySchema),
});
export type DiaryResponse = z.infer<typeof diaryResponseSchema>;

/** PUT /stats/goal: this year's goal, in shows completed; null clears it. */
export const goalRequestSchema = z.object({
  target: z.number().int().min(1).max(1000).nullable(),
});
export type GoalRequest = z.infer<typeof goalRequestSchema>;

/** The most a pasted import may hold, in characters. */
export const MAX_IMPORT_CHARS = 20_000;

/** POST /imports: notes to import, pasted as they are. */
export const importCreateRequestSchema = z
  .object({ text: z.string().trim().min(1).max(MAX_IMPORT_CHARS) })
  .strict();

export const IMPORT_STATUSES = [
  "parsing",
  "review",
  "running",
  "done",
  "undoing",
  "undone",
  "failed",
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** How a line of notes compares with the list; the review screen's groups. */
export const IMPORT_GROUPS = [
  "add",
  "update",
  "up_to_date",
  "disagree",
  "which_one",
  "not_found",
  "not_a_show",
] as const;
export type ImportGroup = (typeof IMPORT_GROUPS)[number];

export const IMPORT_ITEM_STATUSES = [
  "pending",
  "committed",
  "failed",
  "skipped",
  "undone",
  "undo_failed",
] as const;

export const IMPORT_RESOLUTIONS = ["keep_mal", "use_notes"] as const;

const listStateSchema = z.object({
  status: listStatusSchema,
  episodesWatched: z.number().int().nonnegative(),
  score: z.number().int().min(0).max(10),
  isRewatching: z.boolean(),
});

/** One show from the notes, and what the import will do with it. */
export const importItemViewSchema = z.object({
  id: z.uuid(),
  lineNo: z.number().int().positive(),
  line: z.string(),
  /** The user's own words about this show. */
  said: z.string(),
  /** The name as written; null for a line that isn't about a show. */
  title: z.string().nullable(),
  group: z.enum(IMPORT_GROUPS),
  /** The matched (or picked) show. */
  show: showCardSchema.nullable(),
  /** For "which one?": the shows it could be. */
  candidates: z.array(showCardSchema),
  /** The list entry as it was when grouped; null if the show isn't on the list. */
  malState: listStateSchema.nullable(),
  /** What will be written if checked (for a disagreement, the notes' version). */
  change: listChangeSchema.nullable(),
  note: z.string().nullable(),
  checked: z.boolean(),
  resolution: z.enum(IMPORT_RESOLUTIONS).nullable(),
  status: z.enum(IMPORT_ITEM_STATUSES),
  error: z.string().nullable(),
});
export type ImportItemView = z.infer<typeof importItemViewSchema>;

export const importViewSchema = z.object({
  id: z.uuid(),
  status: z.enum(IMPORT_STATUSES),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  items: z.array(importItemViewSchema),
});
export type ImportView = z.infer<typeof importViewSchema>;

/** POST /imports, GET /imports/:id, POST /imports/:id/run and /undo. */
export const importResponseSchema = z.object({ import: importViewSchema });
/** GET /imports/latest: the newest import, if any. */
export const latestImportResponseSchema = z.object({ import: importViewSchema.nullable() });

/** PATCH /imports/:id/items/:itemId: the user's answer for one row. */
export const importItemPatchSchema = z
  .object({
    checked: z.boolean().optional(),
    /** Picks one of a "which one?" row's candidates; null takes the pick back. */
    animeId: z.number().int().positive().nullable().optional(),
    resolution: z.enum(IMPORT_RESOLUTIONS).optional(),
  })
  .strict();
export const importItemResponseSchema = z.object({ item: importItemViewSchema });

/** Why an import request didn't go through. */
export const IMPORT_ERRORS = ["not_found", "not_ready", "busy", "invalid"] as const;
export type ImportError = (typeof IMPORT_ERRORS)[number];
export const importErrorResponseSchema = z.object({ error: z.enum(IMPORT_ERRORS) });

/** A diary note on an update, in the user's own words; shared with friends or not. */
const noteViewSchema = z.object({ id: z.uuid(), text: z.string(), shared: z.boolean() });

/**
 * One line of the Journal: a change made through kurisu (with Undo, until it's undone), a change
 * a sync found on MAL's site, or a whole import, which undoes as one.
 */
export const journalItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("change"),
    /** The change's id, for POST /changes/:id/undo. */
    id: z.uuid(),
    animeId: z.number().int().positive(),
    title: z.string(),
    pictureUrl: z.string().nullable(),
    numEpisodes: z.number().int().positive().nullable(),
    kind: z.enum(WRITE_KINDS),
    before: listChangeSchema,
    after: listChangeSchema,
    at: z.iso.datetime(),
    /** Who made it: Chat, the user's own tap, or an import (on a show's page). Never "undo". */
    source: z.enum(CHANGE_SOURCES),
    undone: z.boolean(),
    note: noteViewSchema.nullable(),
  }),
  z.object({
    type: z.literal("mal"),
    /** The list event's id. */
    id: z.uuid(),
    animeId: z.number().int().positive(),
    title: z.string(),
    pictureUrl: z.string().nullable(),
    numEpisodes: z.number().int().positive().nullable(),
    kind: z.enum(WRITE_KINDS),
    before: listChangeSchema,
    after: listChangeSchema,
    at: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("import"),
    /** The import's id, for POST /imports/:id/undo. */
    id: z.uuid(),
    at: z.iso.datetime(),
    /** Rows it wrote. */
    count: z.number().int().positive(),
    undone: z.boolean(),
  }),
]);
export type JournalItem = z.infer<typeof journalItemSchema>;

/** GET /journal: the latest updates, newest first, and the time zone their days follow. */
export const journalResponseSchema = z.object({
  timeZone: z.string(),
  items: z.array(journalItemSchema),
});
export type JournalResponse = z.infer<typeof journalResponseSchema>;

const todayShowFields = {
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.string().nullable(),
  numEpisodes: z.number().int().positive().nullable(),
  episodesWatched: z.number().int().nonnegative(),
};

/** GET /today: what's out for the user, what's next, and what they're in the middle of. */
export const todayResponseSchema = z.object({
  timeZone: z.string(),
  /** Watching shows with aired episodes not watched yet, fewest behind first. */
  outNow: z.array(
    z.object({
      ...todayShowFields,
      latestAired: z.number().int().positive(),
      watchOn: z.array(watchOnSchema),
    }),
  ),
  /** The next episode of each Watching or Plan to Watch show airing in the coming week, soonest first. */
  comingUp: z.array(
    z.object({
      ...todayShowFields,
      status: listStatusSchema,
      episode: z.number().int().positive(),
      airingAt: z.iso.datetime(),
    }),
  ),
  /** Watching shows with episodes left that aren't waiting on new ones, last touched first. */
  continueWatching: z.array(
    z.object({ ...todayShowFields, episodeMinutes: z.number().int().positive().nullable() }),
  ),
  /** The latest morning brief that went out, opening its chat. */
  brief: z
    .object({
      conversationId: z.uuid(),
      localDate: z.string().nullable(),
      summary: z.string().nullable(),
      at: z.iso.datetime(),
      /** New episodes it listed, and shows it said started airing. */
      episodes: z.number().int().nonnegative(),
      premieres: z.number().int().nonnegative(),
    })
    .nullable(),
  /** What friends who share watched lately. */
  friends: z.array(activityItemSchema),
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;

/** GET /shows/:animeId: one show, the user's entry for it, and everything kurisu knows. */
export const showResponseSchema = z.object({
  show: z.object({
    animeId: z.number().int().positive(),
    title: z.string(),
    altTitles: z.array(z.string()),
    pictureUrl: z.string().nullable(),
    mediaType: z.string().nullable(),
    numEpisodes: z.number().int().positive().nullable(),
    episodeMinutes: z.number().int().positive().nullable(),
    airingStatus: z.string().nullable(),
    /** "2026-03-19", or partial ("2026-03"). */
    startDate: z.string().nullable(),
    genres: z.array(z.string()),
    malMean: z.number().positive().nullable(),
    /** AniList's description as plain text, without spoilers; null when there's none (yet). */
    synopsis: z.string().nullable(),
  }),
  /** Null when it isn't on the user's list. */
  entry: z
    .object({
      status: listStatusSchema,
      score: z.number().int().min(0).max(10),
      episodesWatched: z.number().int().nonnegative(),
      isRewatching: z.boolean(),
      /** MAL's dates, possibly partial. */
      startDate: z.string().nullable(),
      finishDate: z.string().nullable(),
      updatedAt: z.iso.datetime(),
    })
    .nullable(),
  airing: airingViewSchema.nullable(),
  watchOn: z.array(watchOnSchema),
  /** The user's updates of this show, newest first (never import groups). */
  journal: z.array(journalItemSchema),
  /** Friends who share their activity and have it on their list. */
  friends: z.array(
    z.object({
      friendId: z.uuid(),
      malUsername: z.string(),
      status: listStatusSchema,
      score: z.number().int().min(0).max(10),
      episodesWatched: z.number().int().nonnegative(),
    }),
  ),
});
export type ShowResponse = z.infer<typeof showResponseSchema>;

/** A show found by Search, with where it stands on the user's list. */
export const searchResultSchema = z.object({
  animeId: z.number().int().positive(),
  title: z.string(),
  titleEn: z.string().nullable(),
  pictureUrl: z.string().nullable(),
  mediaType: z.string().nullable(),
  numEpisodes: z.number().int().positive().nullable(),
  airingStatus: z.string().nullable(),
  year: z.number().int().nullable(),
  /** Null when it isn't on the list. */
  entry: z
    .object({ status: listStatusSchema, episodesWatched: z.number().int().nonnegative() })
    .nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

/** GET /search?q=: AniList's matches, or, with no words, what's popular this season. */
export const searchResponseSchema = z.object({
  query: z.string(),
  results: z.array(searchResultSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const SEARCH_ERRORS = ["rate_limited", "search_unavailable"] as const;
export type SearchError = (typeof SEARCH_ERRORS)[number];
export const searchErrorResponseSchema = z.object({ error: z.enum(SEARCH_ERRORS) });

/** Longest search the server accepts. */
export const SEARCH_MAX_CHARS = 100;

/**
 * POST /list/add: puts a show on the list (Plan to Watch unless the user picked another
 * status). The user's tap is the confirmation; History can undo it.
 */
export const listAddRequestSchema = z
  .object({
    animeId: z.number().int().positive(),
    status: listStatusSchema.optional(),
    episodesWatched: z.number().int().nonnegative().max(100_000).optional(),
    score: z.number().int().min(0).max(10).optional(),
    requestId: z.uuid(),
  })
  .strict();
export type ListAddRequest = z.infer<typeof listAddRequestSchema>;

export const ADD_ERRORS = ["already_on_list", "unknown_anime"] as const;
export type AddError = (typeof ADD_ERRORS)[number];
export const addErrorResponseSchema = z.object({
  error: z.enum([...WRITE_ERRORS, ...EDIT_ERRORS, ...ADD_ERRORS]),
});

/** POST /me/welcomed */
export const welcomedResponseSchema = z.object({ welcomed: z.literal(true) });
