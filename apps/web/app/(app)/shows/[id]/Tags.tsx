"use client";

import type { ShowExtrasView } from "@kurisu/shared";
import { useState } from "react";

/** A show's tags, with the ones that give something away hidden until asked for. */
export function Tags({ tags }: { tags: ShowExtrasView["tags"] }) {
  const [spoilers, setSpoilers] = useState(false);
  const safe = tags.filter((tag) => !tag.spoiler);
  const hidden = tags.filter((tag) => tag.spoiler);
  const shown = spoilers ? tags : safe;
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {shown.map((tag) => (
          <li key={tag.name}>
            <span className="k-tag" title={tag.rank === null ? undefined : `${String(tag.rank)}%`}>
              {tag.name}
              {tag.spoiler && <span className="text-accent-text">spoiler</span>}
            </span>
          </li>
        ))}
      </ul>
      {hidden.length > 0 && (
        <button
          type="button"
          className="k-link self-start"
          aria-pressed={spoilers}
          onClick={() => {
            setSpoilers(!spoilers);
          }}
        >
          {spoilers
            ? "Hide spoiler tags"
            : `Show ${String(hidden.length)} spoiler ${hidden.length === 1 ? "tag" : "tags"}`}
        </button>
      )}
    </div>
  );
}
