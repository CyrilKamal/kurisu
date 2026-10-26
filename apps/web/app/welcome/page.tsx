import {
  briefSettingsResponseSchema,
  friendsResponseSchema,
  pushPublicKeyResponseSchema,
  siteResponseSchema,
} from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { apiGet, getMe } from "@/lib/api";

import { WelcomeFlow } from "./WelcomeFlow";

export const metadata: Metadata = { title: "Welcome · kurisu" };

/** A new account's first steps, once; anyone who has done them goes to Today. */
export default async function WelcomePage() {
  const [me, settings, push, friends, site] = await Promise.all([
    getMe(),
    apiGet("/brief/settings", briefSettingsResponseSchema),
    apiGet("/push/public-key", pushPublicKeyResponseSchema),
    apiGet("/friends", friendsResponseSchema),
    apiGet("/site", siteResponseSchema),
  ]);
  if (!me || !settings || !push || !friends) redirect("/");
  if (me.welcomed) redirect("/today");
  // A new account's only friend is whoever invited them: the owner, who alone makes invites, so
  // they're called what the invite page called them (OWNER_DISPLAY_NAME).
  const inviter = friends.friends[0];

  return (
    <WelcomeFlow
      name={me.user.malUsername}
      listSize={me.lastSync?.entriesCount ?? 0}
      publicKey={push.publicKey}
      initialSettings={settings}
      inviter={
        inviter
          ? { name: site?.operator ?? inviter.malUsername, match: inviter.match.percent }
          : null
      }
      friendLink={friends.link}
    />
  );
}
