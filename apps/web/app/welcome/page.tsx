import {
  briefSettingsResponseSchema,
  friendsResponseSchema,
  pushPublicKeyResponseSchema,
} from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { apiGet, getMe } from "@/lib/api";

import { WelcomeFlow } from "./WelcomeFlow";

export const metadata: Metadata = { title: "Welcome · kurisu" };

/** A new account's first steps, once; anyone who has done them goes to Today. */
export default async function WelcomePage() {
  const [me, settings, push, friends] = await Promise.all([
    getMe(),
    apiGet("/brief/settings", briefSettingsResponseSchema),
    apiGet("/push/public-key", pushPublicKeyResponseSchema),
    apiGet("/friends", friendsResponseSchema),
  ]);
  if (!me || !settings || !push || !friends) redirect("/");
  if (me.welcomed) redirect("/today");
  // A new account's only friend is whoever invited them.
  const inviter = friends.friends[0];

  return (
    <WelcomeFlow
      name={me.user.malUsername}
      listSize={me.lastSync?.entriesCount ?? 0}
      publicKey={push.publicKey}
      initialSettings={settings}
      inviter={inviter ? { name: inviter.malUsername, match: inviter.match.percent } : null}
      friendLink={friends.link}
    />
  );
}
