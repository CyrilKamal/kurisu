"use client";

import type { ScoreStyle } from "@kurisu/shared";
import { createContext, useContext } from "react";

const ScoreStyleContext = createContext<ScoreStyle>("point_10");

/** The user's score style (Settings) for every score under it; the (app) layout sets it. */
export function ScoreStyleProvider({
  style,
  children,
}: {
  style: ScoreStyle;
  children: React.ReactNode;
}) {
  return <ScoreStyleContext.Provider value={style}>{children}</ScoreStyleContext.Provider>;
}

/** How the user wants scores shown: 10 points, 100 points or 5 stars. */
export function useScoreStyle(): ScoreStyle {
  return useContext(ScoreStyleContext);
}
