/** How the policy pages name who runs kurisu, and how to reach them (GET /site). */
export function operatorName(operator: string | null): string {
  return operator ?? "the person who runs kurisu";
}

/** The contact address as a mail link, or a plain fallback while CONTACT_EMAIL isn't set. */
export function ContactLink({ email }: { email: string | null }) {
  return email ? (
    <a className="k-link" href={`mailto:${email}`}>
      {email}
    </a>
  ) : (
    <>us</>
  );
}
