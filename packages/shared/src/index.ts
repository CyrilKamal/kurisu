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
  "consent_needed",
] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];

/**
 * The version of the terms and privacy policy people accept (the date they last changed). When
 * it changes, everyone is asked again before using the app. The pages show it as their date.
 */
export const TERMS_VERSION = "2026-10-19";

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

/** Milestone 8's plans, cheapest first. */
export const PLAN_IDS = ["free", "premium", "pro"] as const;
export const planIdSchema = z.enum(PLAN_IDS);

/**
 * Why someone is on their plan: the owner is always Pro, a subscription (paid, or granted by
 * hand), a new account's trial, or Free. "open": limits are off (sign-up open with no owner, as in
 * development).
 */
export const PLAN_SOURCES = ["owner", "subscription", "trial", "free", "open"] as const;

/**
 * What a plan includes beyond its allowances: a supporter badge friends see (only while it's paid
 * for), a push as each episode airs, the calendar feed, the full year in review, and early access
 * to the AI lab.
 */
export const planFeaturesSchema = z.object({
  supporterBadge: z.boolean(),
  episodeAlerts: z.boolean(),
  calendar: z.boolean(),
  fullYear: z.boolean(),
  lab: z.boolean(),
});
export type PlanFeatures = z.infer<typeof planFeaturesSchema>;

export const planViewSchema = z.object({
  id: planIdSchema,
  source: z.enum(PLAN_SOURCES),
  /** When it ends: the trial's end or the paid period's; null for none. */
  until: z.iso.datetime().nullable(),
  /** A subscription that won't renew. */
  cancelAtPeriodEnd: z.boolean(),
  features: planFeaturesSchema,
});
export type PlanView = z.infer<typeof planViewSchema>;

/** What a plan's monthly allowances are about. */
export const LIMIT_KINDS = ["chat", "recommendations", "imports", "import_lines"] as const;
export type LimitKind = (typeof LIMIT_KINDS)[number];

/** Body of a 429 `plan_limit`: which allowance ran out, and when it comes back. */
export const planLimitSchema = z.object({
  kind: z.enum(LIMIT_KINDS),
  plan: planIdSchema,
  allowance: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  resetsAt: z.iso.datetime(),
});
export type PlanLimit = z.infer<typeof planLimitSchema>;
export const planLimitErrorSchema = z.object({
  error: z.literal("plan_limit"),
  limit: planLimitSchema,
});

const usageItemSchema = z.object({
  used: z.number().int().nonnegative(),
  /** null: no monthly cap on this plan. */
  allowance: z.number().int().nonnegative().nullable(),
});

/** GET /plan: the user's plan, and this month's use of its allowances. */
export const planResponseSchema = z.object({
  plan: planViewSchema,
  usage: z.object({
    chat: usageItemSchema,
    recommendations: usageItemSchema,
    imports: usageItemSchema,
  }),
  /** The most lines one import may have on this plan; null for no cap. */
  importLines: z.number().int().positive().nullable(),
  resetsAt: z.iso.datetime(),
});
export type PlanResponse = z.infer<typeof planResponseSchema>;

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
  plan: planViewSchema,
  /**
   * Whether they've said they're 18 or older and accepted the current terms (TERMS_VERSION).
   * Always true for the owner, and on a server without one.
   */
  termsAccepted: z.boolean(),
  /** Which of a show's titles the app shows them. */
  titleLanguage: z.enum(["romaji", "english", "japanese"]),
  /** How scores look to them; MAL's 1–10 is what's saved. */
  scoreStyle: z.enum(["point_10", "point_100", "stars_5"]),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** Which of a show's titles the app shows: MAL's romaji, the English one, or the Japanese. */
export const TITLE_LANGUAGES = ["romaji", "english", "japanese"] as const;
export type TitleLanguage = (typeof TITLE_LANGUAGES)[number];
/** PUT /me/title-language. */
export const titleLanguageRequestSchema = z.object({ language: z.enum(TITLE_LANGUAGES) }).strict();
export const titleLanguageResponseSchema = z.object({ titleLanguage: z.enum(TITLE_LANGUAGES) });

/**
 * How the app shows a score: MAL's 10 points ("8/10"), 100 points ("80"), or 5 stars with
 * halves (an 8 is ★★★★, a 7 ★★★½). Each maps exactly onto MAL's 1–10, which is what's saved.
 */
export const SCORE_STYLES = ["point_10", "point_100", "stars_5"] as const;
export type ScoreStyle = (typeof SCORE_STYLES)[number];
/** PUT /me/score-style. */
export const scoreStyleRequestSchema = z.object({ style: z.enum(SCORE_STYLES) }).strict();
export const scoreStyleResponseSchema = z.object({ scoreStyle: z.enum(SCORE_STYLES) });

/** The most favorites a user keeps. */
export const FAVORITES_MAX = 10;

/** A favorite show, as the profile and friends see it. */
export const favoriteShowSchema = z.object({
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.string().nullable(),
  mediaType: z.string().nullable(),
  startDate: z.string().nullable(),
});
export type FavoriteShow = z.infer<typeof favoriteShowSchema>;

/** GET, PUT and DELETE /favorites: the user's favorites, in their order. */
export const favoritesResponseSchema = z.object({
  favorites: z.array(favoriteShowSchema).max(FAVORITES_MAX),
});
export type FavoritesResponse = z.infer<typeof favoritesResponseSchema>;

/** PUT /favorites: the same shows in a new order. */
export const favoritesOrderRequestSchema = z
  .object({ animeIds: z.array(z.number().int().positive()).max(FAVORITES_MAX) })
  .strict();

/** POST /me/terms: "I'm 18 or older and I accept these terms", for the version they read. */
export const termsAcceptRequestSchema = z.object({ version: z.string().max(32) }).strict();
export const termsAcceptResponseSchema = z.object({ termsAccepted: z.literal(true) });

/**
 * GET /me/export: everything kurisu holds about the user, as JSON (never their MAL tokens). Each
 * part is a list of rows as stored; `account` is one.
 */
const exportRows = z.array(z.record(z.string(), z.unknown()));
export const dataExportSchema = z.object({
  kurisuExport: z.literal(1),
  exportedAt: z.iso.datetime(),
  account: z.record(z.string(), z.unknown()),
  plan: z.record(z.string(), z.unknown()),
  favorites: exportRows,
  list: exportRows,
  changes: exportRows,
  listEvents: exportRows,
  chats: exportRows,
  diaryNotes: exportRows,
  dropReasons: exportRows,
  tasteGenres: exportRows,
  yearlyGoals: exportRows,
  briefSettings: exportRows,
  briefs: exportRows,
  episodeAlerts: exportRows,
  episodeAlertMutes: exportRows,
  friendHidden: exportRows,
  recommendations: exportRows,
  imports: exportRows,
  friends: exportRows,
  invites: exportRows,
  calendarFeed: exportRows,
  pushSubscriptions: exportRows,
  agentRuns: exportRows,
});
export type DataExport = z.infer<typeof dataExportSchema>;

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

/** GET /site: what the public pages say about who runs kurisu, and whether sign-up is open. */
export const siteResponseSchema = z.object({
  /** OWNER_DISPLAY_NAME (else the owner's MAL username), or null when unset. */
  operator: z.string().nullable(),
  contactEmail: z.email().nullable(),
  signup: z.enum(["invite", "open"]),
});
export type SiteResponse = z.infer<typeof siteResponseSchema>;

/** MAL usernames: 2 to 16 letters, digits, underscores or hyphens. */
export const MAL_USERNAME_PATTERN = /^[A-Za-z0-9_-]{2,16}$/;

/** POST /waitlist, from the landing page. */
export const waitlistJoinRequestSchema = z
  .object({
    email: z.string().trim().max(254).pipe(z.email()),
    // An empty field is no username.
    malUsername: z
      .string()
      .trim()
      .transform((name) => (name === "" ? null : name))
      .pipe(z.string().regex(MAL_USERNAME_PATTERN).nullable())
      .optional(),
    /** A field people never see: a bot that fills it in is quietly not added. */
    website: z.string().max(200).optional(),
    /** How long the form was open before it was sent; bots send at once. */
    elapsedMs: z.number().int().nonnegative().optional(),
  })
  .strict();
export type WaitlistJoinRequest = z.infer<typeof waitlistJoinRequestSchema>;

export const waitlistJoinResponseSchema = z.object({
  status: z.enum(["joined", "already"]),
  /** For the "leave the waitlist" link, shown once; null when already on the list. */
  leaveToken: z.string().nullable(),
});

/** POST /waitlist/leave */
export const waitlistLeaveRequestSchema = z.object({ token: z.string().min(16).max(128) }).strict();

/** GET /waitlist, for the owner. */
export const waitlistEntrySchema = z.object({
  id: z.uuid(),
  email: z.email(),
  malUsername: z.string().nullable(),
  createdAt: z.iso.datetime(),
  invitedAt: z.iso.datetime().nullable(),
});
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;
export const waitlistResponseSchema = z.object({ entries: z.array(waitlistEntrySchema) });

/** POST /waitlist/:id/invite: a new invite link for that person, shown only this once. */
export const waitlistInviteResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});

/**
 * The plans as the public pages show them (Milestone 8; prices in USD, limits a month). The
 * server's limits must match these numbers.
 */
export const PLAN_CATALOG = [
  {
    id: "free",
    name: "Free",
    monthlyUsd: 0,
    yearlyUsd: 0,
    /** A month's allowances (null: no monthly cap), as config/plans.json enforces them. */
    limits: { chat: 30, recommendations: 12, imports: 1 },
    tagline: "Everything you need to keep your list.",
    features: [
      "30 chat updates a month",
      "12 recommendations a month",
      "1 import from your notes a month",
      "The morning brief, premiere alerts and Sunday recap",
      "Editing, stats, your journal and friends",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    monthlyUsd: 2.99,
    yearlyUsd: 24.99,
    limits: { chat: 1000, recommendations: 300, imports: null },
    tagline: "For logging everything by chat.",
    features: [
      "1,000 chat updates a month",
      "300 recommendations a month",
      "Imports whenever you like",
      "An alert as each episode airs",
      "A supporter badge",
      "Everything in Free",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyUsd: 5.99,
    yearlyUsd: 49.99,
    limits: { chat: 3000, recommendations: 1000, imports: null },
    tagline: "For superfans, and the AI lab first.",
    features: [
      "3,000 chat updates and 1,000 recommendations a month",
      "A calendar feed of upcoming episodes",
      "Your full year in review",
      "Early access to AI lab features",
      "Everything in Premium",
    ],
  },
] as const;
export type PlanId = (typeof PLAN_IDS)[number];

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
  /** The paid plan they support kurisu with, for its badge; null on Free or a trial. */
  supporter: planIdSchema.nullable(),
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
  /** Their favorite shows, in their order (empty when they don't share). */
  favorites: z.array(favoriteShowSchema),
});
export type FriendDetailResponse = z.infer<typeof friendDetailResponseSchema>;

export const friendLinkResponseSchema = z.object({ link: z.url() });

/**
 * GET/POST/DELETE /calendar: whether the plan includes the calendar feed, and the user's feed
 * link when it's on. `webcalUrl` is the same link for calendar apps to subscribe to;
 * `lastFetchedAt` is when a calendar app last fetched it.
 */
export const calendarResponseSchema = z.object({
  included: z.boolean(),
  feed: z
    .object({
      url: z.url(),
      webcalUrl: z.string().startsWith("webcal://"),
      lastFetchedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
});
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;

/**
 * GET/PUT /alerts: a push as each episode of a Watching show airs (Premium and Pro). `included`:
 * the plan has them now; `on`: the user turned them on; `muted`: shows they turned off on the
 * show's page.
 */
export const alertsResponseSchema = z.object({
  included: z.boolean(),
  on: z.boolean(),
  muted: z.array(z.number().int().positive()),
});
export type AlertsResponse = z.infer<typeof alertsResponseSchema>;

export const alertsRequestSchema = z.object({ on: z.boolean() }).strict();

/** PUT /alerts/shows/:animeId: no alerts for this show, or alerts again. */
export const alertMuteRequestSchema = z.object({ muted: z.boolean() }).strict();
export const alertMuteResponseSchema = z.object({
  animeId: z.number().int().positive(),
  muted: z.boolean(),
});

/** 403 when a feature isn't in the user's plan: which feature, and the plan that has it. */
export const needsPlanErrorSchema = z.object({
  error: z.literal("needs_plan"),
  feature: z.enum(["episodeAlerts", "calendar", "fullYear", "lab"]),
  plan: planIdSchema,
});

/** GET /friends/links/:code, for the page a friend link opens. */
export const friendLinkCheckSchema = z.object({
  owner: z.string(),
  self: z.boolean(),
  alreadyFriends: z.boolean(),
});

/** POST /friends: the code from someone's friend link. */
export const friendLinkAcceptSchema = z.object({ code: z.string().min(1).max(128) }).strict();
export const friendAddedSchema = z.object({ friendId: z.uuid() });

/** PUT /friends/hidden/:animeId: keep a show from friends, or show it to them. */
export const friendHiddenRequestSchema = z.object({ hidden: z.boolean() }).strict();
export const friendHiddenResponseSchema = z.object({
  animeId: z.number().int().positive(),
  hidden: z.boolean(),
});

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

/**
 * MAL's other list fields, which only the user sets: their comments, tags, priority (0 low, 1
 * medium, 2 high) and times rewatched. Null when MAL hasn't sent kurisu the field, and then it
 * can't be edited here. Missing reads as null, so a list saved for offline use before these
 * fields existed still opens.
 */
const entryExtras = {
  comments: z.string().nullable().default(null),
  tags: z.array(z.string()).nullable().default(null),
  priority: z.number().int().min(0).max(2).nullable().default(null),
  timesRewatched: z.number().int().nonnegative().nullable().default(null),
};

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
  ...entryExtras,
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

/** MAL's list priorities: 0 low, 1 medium, 2 high. */
export const PRIORITIES = [0, 1, 2] as const;
export const priorityLabel = (priority: number): string =>
  priority === 2 ? "High" : priority === 1 ? "Medium" : "Low";

/** The list fields a change touches (only the ones that changed are present). */
export const listChangeSchema = z
  .object({
    status: listStatusSchema.optional(),
    episodesWatched: z.number().int().nonnegative().optional(),
    score: z.number().int().min(0).max(10).optional(),
    isRewatching: z.boolean().optional(),
    /** MAL's other fields, which only the user sets. */
    comments: z.string().optional(),
    tags: z.array(z.string()).optional(),
    priority: z.number().int().min(0).max(2).optional(),
    timesRewatched: z.number().int().nonnegative().optional(),
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
    // MAL's other fields; the server checks their limits (EDIT_ERRORS says which one).
    comments: z.string().max(10_000).optional(),
    tags: z.array(z.string().max(500)).max(100).optional(),
    priority: z.number().int().optional(),
    timesRewatched: z.number().int().optional(),
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
  "field_unknown",
  "comments_too_long",
  "too_many_tags",
  "tag_too_long",
  "priority_out_of_range",
  "rewatch_count_out_of_range",
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
    /**
     * The shows watched (any episode, or completed): MAL's studios and kinds, decades they
     * started airing, and the main characters' Japanese voices (AniList, for the `castKnown` of
     * them kurisu has looked up so far).
     */
    watched: z.object({
      shows: count,
      topStudios: z.array(z.object({ studio: z.string(), shows: count })),
      formats: z.array(z.object({ mediaType: z.string(), shows: count })),
      decades: z.array(z.object({ decade: z.number().int(), shows: count })),
      voiceActors: z.array(
        z.object({ name: z.string(), pictureUrl: z.string().nullable(), shows: count }),
      ),
      castKnown: count,
    }),
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

const yearShow = shownShow.extend({ pictureUrl: z.string().nullable() });
const score = z.number().int().min(1).max(10);

/**
 * GET /year?year=YYYY: a year in review, on the user's clock. Shows finished count by MAL's finish
 * date (as in Stats); episodes only since kurisu started counting (`countingSince`, when that's
 * after the year began). `full` is Pro's, null when the plan doesn't include it.
 */
export const yearReviewSchema = z.object({
  year: z.number().int(),
  /** This year on the user's clock, for the year switcher. */
  currentYear: z.number().int(),
  timeZone: z.string(),
  countingSince: z.string().nullable(),
  basic: z.object({
    completed: count,
    episodes: count,
    /** Minutes of those episodes, for shows whose episode length MAL knows. */
    minutes: count,
    topGenre: z.string().nullable(),
    /** The best-scored show finished this year. */
    favorite: yearShow.extend({ score }).nullable(),
    goal: z.number().int().positive().nullable(),
  }),
  full: z
    .object({
      completedByMonth: z.array(count).length(12),
      episodesByMonth: z.array(count).length(12),
      topGenres: z.array(z.object({ genre: z.string(), shows: count })),
      topRated: z.array(yearShow.extend({ score, on: z.string() })),
      meanScore: z.number().nullable(),
      scored: count,
      /** The finished show that took the longest to watch, when MAL knows episode lengths. */
      longest: yearShow.extend({ episodes: count, minutes: count }).nullable(),
      first: yearShow.extend({ on: z.string() }).nullable(),
      last: yearShow.extend({ on: z.string() }).nullable(),
      /** Finished shows that started airing this year, and ones from earlier years. */
      seasonal: count,
      backlog: count,
      /** Finished shows by MAL's media type ("tv", "movie"), most first. */
      formats: z.array(z.object({ mediaType: z.string(), shows: count })),
      /** Shows started (moved to Watching) and dropped this year, as kurisu saw it. */
      started: count,
      dropped: count,
      /** The user's own diary notes from the year, newest first. */
      notes: z.array(shownShow.extend({ text: z.string(), on: z.string() })),
    })
    .nullable(),
});
export type YearReview = z.infer<typeof yearReviewSchema>;

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
/** A show another's page links to, with where it stands on the user's list. */
const linkedShowSchema = z.object({
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.string().nullable(),
  mediaType: z.string().nullable(),
  startDate: z.string().nullable(),
  status: listStatusSchema.nullable(),
});
export type LinkedShowView = z.infer<typeof linkedShowSchema>;

/** A show page's extras, from AniList. */
export const showExtrasSchema = z.object({
  studios: z.array(z.string()),
  /** AniList's words: MANGA, LIGHT_NOVEL, ORIGINAL, ... */
  source: z.string().nullable(),
  /** "Fall 2026". */
  season: z.string().nullable(),
  /** AniList's average score, out of 10. */
  score: z.number().nullable(),
  /** Its best rankings: "#4 most popular, Fall 2026". */
  rankings: z.array(
    z.object({
      rank: z.number().int().positive(),
      kind: z.enum(["rated", "popular"]),
      /** "all time", "Fall 2026" or "2026". */
      scope: z.string(),
    }),
  ),
  /** The official trailer, a link out (YouTube or Dailymotion). */
  trailer: z.object({ url: z.url(), thumbnail: z.string().nullable() }).nullable(),
  tags: z.array(
    z.object({ name: z.string(), rank: z.number().int().nullable(), spoiler: z.boolean() }),
  ),
  /** Related anime, prequels and sequels first; `relation` is AniList's (SEQUEL, SIDE_STORY, ...). */
  relations: z.array(linkedShowSchema.extend({ relation: z.string() })),
  characters: z.array(
    z.object({
      name: z.string(),
      role: z.enum(["main", "supporting", "background"]),
      pictureUrl: z.string().nullable(),
      /** The Japanese voice. */
      voiceActor: z.object({ name: z.string(), pictureUrl: z.string().nullable() }).nullable(),
    }),
  ),
  /** What AniList's fans of it recommend. */
  recommendations: z.array(linkedShowSchema),
  /** Official per-episode links on the user's own services, in order. */
  episodes: z.array(z.object({ title: z.string(), url: z.url(), service: z.string() })),
  /** The most relevant staff: "Director", "Music", "Character Design". */
  staff: z.array(
    z.object({ name: z.string(), role: z.string(), pictureUrl: z.string().nullable() }),
  ),
  /**
   * How AniList's users score it: ten columns, 10 to 100, each the share of them (0–1); null
   * when too few have scored it.
   */
  scoreDistribution: z
    .array(z.object({ score: z.number().int(), share: z.number().min(0).max(1) }))
    .length(10)
    .nullable(),
});
export type ShowExtrasView = z.infer<typeof showExtrasSchema>;

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
    /**
     * When MAL says a new episode airs in Japan: a weekday ("saturday") and "23:00" JST (null
     * when MAL doesn't say). Null when MAL gives none, or for a show not on anyone's list.
     */
    broadcast: z.object({ day: z.string(), time: z.string().nullable() }).nullable(),
  }),
  /** Null when it isn't on the user's list. */
  entry: z
    .object({
      status: listStatusSchema,
      score: z.number().int().min(0).max(10),
      episodesWatched: z.number().int().nonnegative(),
      isRewatching: z.boolean(),
      ...entryExtras,
      /** MAL's dates, possibly partial. */
      startDate: z.string().nullable(),
      finishDate: z.string().nullable(),
      updatedAt: z.iso.datetime(),
    })
    .nullable(),
  airing: airingViewSchema.nullable(),
  watchOn: z.array(watchOnSchema),
  /** Whether the user has picked streaming services, so an empty `watchOn` means none match. */
  servicesChosen: z.boolean(),
  /**
   * Whether friends don't see this show (the user's choice, or MAL's Hentai and Erotica genres);
   * null for a user with no friends.
   */
  hiddenFromFriends: z.boolean().nullable(),
  /** The user's updates of this show, newest first (never import groups). */
  journal: z.array(journalItemSchema),
  /**
   * The series that follow it (AniList's sequels), with where each stands on the user's list,
   * for "what's next" when they finish it. Empty until kurisu has looked them up.
   */
  sequels: z.array(
    z.object({
      animeId: z.number().int().positive(),
      title: z.string(),
      pictureUrl: z.string().nullable(),
      startDate: z.string().nullable(),
      status: listStatusSchema.nullable(),
    }),
  ),
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
  /** What AniList adds to the page; null until it's been fetched. */
  extras: showExtrasSchema.nullable(),
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

/** Where a show stands on the user's list, or null when it isn't on it. */
const browseEntrySchema = z
  .object({ status: listStatusSchema, episodesWatched: z.number().int().nonnegative() })
  .nullable();

/** One episode on Browse's Schedule. */
export const scheduleEpisodeSchema = z.object({
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.string().nullable(),
  mediaType: z.string().nullable(),
  /** MAL's number for a show on the user's list; AniList's otherwise. */
  episode: z.number().int().positive(),
  airingAt: z.iso.datetime(),
  popularity: z.number().int().nullable(),
  /** MAL's genres, themes and demographics, for the Schedule's genre filter. */
  genres: z.array(z.string()),
  entry: browseEntrySchema,
  /** Where it streams on the user's services, for shows on their list ([] otherwise). */
  watchOn: z.array(watchOnSchema),
});
export type ScheduleEpisode = z.infer<typeof scheduleEpisodeSchema>;

/**
 * GET /browse/schedule: every episode airing from a day back to 7 days ahead, soonest first,
 * of shows MAL knows (never adult), and when AniList's schedule was last fetched.
 */
export const scheduleResponseSchema = z.object({
  /** The user's time zone (their brief settings), which the days follow. */
  timeZone: z.string(),
  updatedAt: z.iso.datetime().nullable(),
  episodes: z.array(scheduleEpisodeSchema),
});
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;

/** One show on a season's chart. */
export const chartShowSchema = z.object({
  animeId: z.number().int().positive(),
  title: z.string(),
  pictureUrl: z.string().nullable(),
  mediaType: z.string().nullable(),
  numEpisodes: z.number().int().positive().nullable(),
  episodeMinutes: z.number().int().positive().nullable(),
  genres: z.array(z.string()),
  /** AniList's average score, out of 10; null before anyone has scored it. */
  score: z.number().nullable(),
  popularity: z.number().int().nullable(),
  /** "2027-01-09", or partial ("2027-01") when AniList isn't sure. */
  startDate: z.string().nullable(),
  airingStatus: z.string().nullable(),
  entry: browseEntrySchema,
});
export type ChartShow = z.infer<typeof chartShowSchema>;

/** A charted season: "2027-WINTER", and "Winter 2027" to show. */
export const chartSeasonSchema = z.object({ season: z.string(), label: z.string() });

/**
 * GET /browse/seasons?season=2027-WINTER: a season's 100 most popular shows (TV, TV short, ONA,
 * movies, OVAs), most popular first. Last, this and next season are kept fresh, and `seasons`
 * lists them; an earlier one (back to Winter 1960) is fetched when someone asks for it, in the
 * background. A season after next is a 404.
 */
export const seasonChartResponseSchema = z.object({
  season: z.string(),
  label: z.string(),
  seasons: z.array(chartSeasonSchema),
  /** The seasons before and after it, null past either end. */
  previous: z.string().nullable(),
  next: z.string().nullable(),
  /** When the chart was last fetched; null while it's on its way. */
  updatedAt: z.iso.datetime().nullable(),
  /** Being fetched from AniList now: ask again in a few seconds. */
  pending: z.boolean(),
  shows: z.array(chartShowSchema),
});
export type SeasonChartResponse = z.infer<typeof seasonChartResponseSchema>;

/** Browse's Top charts: AniList's trending, top airing, upcoming, most popular and best ever. */
export const TOP_CHARTS = ["trending", "airing", "upcoming", "popular", "top"] as const;
export type TopChart = (typeof TOP_CHARTS)[number];
export const TOP_CHART_LABELS: Record<TopChart, string> = {
  trending: "Trending",
  airing: "Top airing",
  upcoming: "Upcoming",
  popular: "Most popular",
  top: "Best ever",
};

/** GET /browse/top?chart=trending: one of the Top charts, 100 shows, in its order. */
export const topChartResponseSchema = z.object({
  chart: z.enum(TOP_CHARTS),
  /** When the chart was last fetched; null while it's on its way. */
  updatedAt: z.iso.datetime().nullable(),
  shows: z.array(chartShowSchema),
});
export type TopChartResponse = z.infer<typeof topChartResponseSchema>;

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
