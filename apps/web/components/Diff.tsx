import type { ListChange, WriteKind } from "@kurisu/shared";
import { Fragment } from "react";

import { diffParts } from "@/lib/describeChange";

/**
 * A write's diff (the design system's `k-diff`): the old value struck through, an arrow, the new
 * value in bold, numbers in mono. "ep 6 → 7 · of 12", "Watching → Completed".
 */
export function Diff({
  kind,
  before,
  after,
  numEpisodes = null,
  prefix = null,
}: {
  kind: WriteKind;
  before: ListChange;
  after: ListChange;
  numEpisodes?: number | null;
  /** Who made it, when it wasn't the agent: "Edited by you". */
  prefix?: string | null;
}) {
  const parts = diffParts(kind, before, after, numEpisodes);
  return (
    <p className="k-diff">
      {prefix && (
        <>
          <span>{prefix}</span>
          <span className="k-sep">·</span>
        </>
      )}
      {parts.map((part, i) => {
        const sep = i > 0 && <span className="k-sep">·</span>;
        if (part.kind === "text") {
          return (
            <Fragment key={i}>
              {sep}
              <span>{part.text}</span>
            </Fragment>
          );
        }
        if (part.kind === "of") {
          return (
            <Fragment key={i}>
              {sep}
              <span>
                of <span className="k-num">{part.total}</span>
              </span>
            </Fragment>
          );
        }
        const value = (text: string, struck: boolean) => {
          const inner = struck ? <s>{text}</s> : <b>{text}</b>;
          return part.numeric ? <span className="k-num">{inner}</span> : inner;
        };
        return (
          <Fragment key={i}>
            {sep}
            {part.label && <span>{part.label}</span>}
            {value(part.from, true)}
            <span className="k-diff__arrow">→</span>
            {value(part.to, false)}
          </Fragment>
        );
      })}
    </p>
  );
}
