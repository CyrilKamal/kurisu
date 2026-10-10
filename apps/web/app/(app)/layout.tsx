import { NavBar } from "./NavBar";

/** The signed-in screens share the NavBar: a bottom bar on phones, a rail on the left from 1024px. */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <div className="lg:pl-(--rail-width)">{children}</div>
      <NavBar />
    </>
  );
}
