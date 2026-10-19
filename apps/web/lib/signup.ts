import { TERMS_VERSION } from "@kurisu/shared";

/**
 * Where a MyAnimeList login goes once both boxes are ticked: it carries the terms version they
 * accepted, and the invite it came from, if any.
 */
export function signUpUrl(invite?: string): string {
  const params = new URLSearchParams({ consent: TERMS_VERSION });
  if (invite) params.set("invite", invite);
  return `/api/auth/mal/login?${params.toString()}`;
}
