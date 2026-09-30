import { NavBar } from "./NavBar";

/** The signed-in screens (Chat and List) share a bottom tab bar. */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <NavBar />
    </>
  );
}
