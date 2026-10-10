import {
  briefSettingsResponseSchema,
  meResponseSchema,
  pushPublicKeyResponseSchema,
} from "@kurisu/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { apiGet } from "@/lib/api";

import { WelcomeFlow } from "./WelcomeFlow";

export const metadata: Metadata = { title: "Welcome · kurisu" };

/** A new account's first steps, once; anyone who has done them goes to Today. */
export default async function WelcomePage() {
  const [me, settings, push] = await Promise.all([
    apiGet("/me", meResponseSchema),
    apiGet("/brief/settings", briefSettingsResponseSchema),
    apiGet("/push/public-key", pushPublicKeyResponseSchema),
  ]);
  if (!me || !settings || !push) redirect("/");
  if (me.welcomed) redirect("/today");

  return (
    <WelcomeFlow
      name={me.user.malUsername}
      listSize={me.lastSync?.entriesCount ?? 0}
      publicKey={push.publicKey}
      initialSettings={settings}
    />
  );
}
