/**
 * Runs the fake MAL as a standalone server, so the whole app can be clicked through locally
 * without MAL credentials. Consent is auto-approved and the list is the synthetic fixture.
 *
 *   pnpm --filter @kurisu/server dev:fake-mal
 *
 * Then start the app with these overrides (plus DATABASE_URL and TOKEN_ENCRYPTION_KEY):
 *   MAL_AUTH_BASE_URL=http://127.0.0.1:4010/v1/oauth2
 *   MAL_API_BASE_URL=http://127.0.0.1:4010/v2
 *   MAL_CLIENT_ID=fake-client-id  MAL_CLIENT_SECRET=fake-client-secret
 *
 * FAKE_MAL_PORT and FAKE_MAL_REDIRECT_URI override the port (4010) and the registered redirect
 * URI, for running a second copy of the app alongside a normal dev server.
 *
 * To log in as someone else (an invited friend, say), open
 * http://127.0.0.1:4010/fake/login-as?name=<name>&id=<number> first. Everyone sees the same list.
 */
import { fixtureList } from "../fixtures/animeList.js";
import { FakeMal } from "./fakeMal.js";

const PORT = Number(process.env.FAKE_MAL_PORT ?? "4010");
const REDIRECT_URI =
  process.env.FAKE_MAL_REDIRECT_URI ?? "http://localhost:3000/api/auth/mal/callback";

const fake = await FakeMal.start(
  {
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: REDIRECT_URI,
    user: { id: 4242, name: "fake_user" },
  },
  PORT,
);
fake.list = fixtureList();
// Shows that aren't on the list, by their real MAL ids, so adding one found by searching the real
// AniList works here too. Public show details only.
fake.catalog = [
  {
    id: 52991,
    title: "Sousou no Frieren",
    alternative_titles: {
      synonyms: [],
      en: "Frieren: Beyond Journey's End",
      ja: "葬送のフリーレン",
    },
    media_type: "tv",
    num_episodes: 28,
    status: "finished_airing",
    genres: [
      { id: 2, name: "Adventure" },
      { id: 8, name: "Drama" },
      { id: 10, name: "Fantasy" },
    ],
    average_episode_duration: 1440,
    mean: 9.3,
  },
  {
    id: 59978,
    title: "Sousou no Frieren 2nd Season",
    alternative_titles: {
      synonyms: [],
      en: "Frieren: Beyond Journey's End Season 2",
      ja: "葬送のフリーレン 第2期",
    },
    media_type: "tv",
    num_episodes: 10,
    status: "finished_airing",
    genres: [
      { id: 2, name: "Adventure" },
      { id: 10, name: "Fantasy" },
    ],
    average_episode_duration: 1440,
    mean: 9.1,
  },
];

console.log(`Fake MAL listening on ${fake.baseUrl}`);
console.log(`  MAL_AUTH_BASE_URL=${fake.authBaseUrl}`);
console.log(`  MAL_API_BASE_URL=${fake.apiBaseUrl}`);
