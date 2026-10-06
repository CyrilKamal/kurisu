/** Small outline icons for Chat's buttons; they inherit the text color. */

function Icon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5"
    >
      <path d={path} />
    </svg>
  );
}

export function MenuIcon() {
  return <Icon path="M4 6h16M4 12h16M4 18h16" />;
}

export function NewChatIcon() {
  return (
    <Icon path="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" />
  );
}

export function RenameIcon() {
  return <Icon path="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />;
}

export function PlusIcon() {
  return <Icon path="M12 5v14M5 12h14" />;
}

export function TrashIcon() {
  return (
    <Icon path="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  );
}
