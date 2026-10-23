"use client";

import { PRIORITIES, priorityLabel } from "@kurisu/shared";
import { useState, type Dispatch, type SetStateAction } from "react";

import { Icon } from "@/components/Icon";
import { addTags, type EditForm } from "@/lib/editEntry";

/**
 * MAL's other list fields in the edit sheet, behind "More": comments, tags, priority and times
 * rewatched. A field MyAnimeList hasn't sent isn't offered, so kurisu never overwrites a value
 * it hasn't seen.
 */
export function MoreFields({
  form,
  setForm,
}: {
  form: EditForm;
  setForm: Dispatch<SetStateAction<EditForm>>;
}) {
  const filled =
    (form.comments ?? "") !== "" ||
    (form.tags ?? []).length > 0 ||
    (form.priority ?? 0) > 0 ||
    (form.timesRewatched ?? 0) > 0;
  const [open, setOpen] = useState(filled);
  const [typed, setTyped] = useState("");
  const unknown = [form.comments, form.tags, form.priority, form.timesRewatched].some(
    (value) => value === null,
  );

  function addTyped() {
    if (form.tags === null || typed.trim() === "") return;
    const tags = addTags(form.tags, typed);
    setForm((f) => ({ ...f, tags }));
    setTyped("");
  }

  // The toggle stays put when it opens, so focus stays on it.
  const toggle = (
    <div>
      <button
        type="button"
        className="k-btn k-btn--ghost k-btn--sm"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <Icon name="chevron-down" className={open ? "rotate-180" : undefined} />
        Comments, tags, priority
      </button>
    </div>
  );
  if (!open) return toggle;

  return (
    <>
      {toggle}
      {form.comments !== null && (
        <div className="k-field">
          <label className="k-field__label" htmlFor="edit-comments">
            Comments
          </label>
          <textarea
            id="edit-comments"
            className="k-input"
            rows={3}
            maxLength={2000}
            value={form.comments}
            onChange={(event) => {
              setForm((f) => ({ ...f, comments: event.target.value }));
            }}
          />
          <p className="k-field__hint">Saved on MyAnimeList, where your list shows them.</p>
        </div>
      )}

      {form.tags !== null && (
        <div className="k-field">
          <label className="k-field__label" htmlFor="edit-tags">
            Tags
          </label>
          {form.tags.length > 0 && (
            <div className="k-chips pb-2">
              {form.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="k-chip"
                  aria-label={`Remove the tag ${tag}`}
                  onClick={() => {
                    setForm((f) => ({ ...f, tags: (f.tags ?? []).filter((t) => t !== tag) }));
                  }}
                >
                  {tag}
                  <Icon name="clear" />
                </button>
              ))}
            </div>
          )}
          <input
            id="edit-tags"
            className="k-input"
            value={typed}
            maxLength={200}
            placeholder="Add a tag"
            enterKeyHint="done"
            onChange={(event) => {
              const value = event.target.value;
              if (value.includes(",")) {
                setForm((f) => ({ ...f, tags: addTags(f.tags ?? [], value) }));
                setTyped("");
              } else {
                setTyped(value);
              }
            }}
            onKeyDown={(event) => {
              // Enter adds the tag rather than saving the sheet.
              if (event.key === "Enter") {
                event.preventDefault();
                addTyped();
              }
            }}
            onBlur={addTyped}
          />
        </div>
      )}

      {form.priority !== null && (
        <div className="k-field">
          <span className="k-field__label" id="priority-label">
            Priority
          </span>
          <div className="k-chips" role="group" aria-labelledby="priority-label">
            {PRIORITIES.map((priority) => (
              <button
                key={priority}
                type="button"
                className="k-chip"
                aria-pressed={form.priority === priority}
                onClick={() => {
                  setForm((f) => ({ ...f, priority }));
                }}
              >
                {priorityLabel(priority)}
              </button>
            ))}
          </div>
        </div>
      )}

      {form.timesRewatched !== null && (
        <div className="k-field">
          <span className="k-field__label" id="rewatched-label">
            Times rewatched
          </span>
          <div className="flex items-center gap-2" role="group" aria-labelledby="rewatched-label">
            <button
              type="button"
              className="k-btn k-btn--icon"
              aria-label="One rewatch less"
              onClick={() => {
                setForm((f) => ({
                  ...f,
                  timesRewatched: Math.max(0, (f.timesRewatched ?? 0) - 1),
                }));
              }}
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={999}
              value={form.timesRewatched}
              onChange={(event) => {
                const value = Math.floor(Number(event.target.value));
                if (Number.isFinite(value)) {
                  setForm((f) => ({ ...f, timesRewatched: Math.min(999, Math.max(0, value)) }));
                }
              }}
              aria-label="Times rewatched"
              className="k-input k-input--mono w-16 text-center"
            />
            <button
              type="button"
              className="k-btn k-btn--icon"
              aria-label="One rewatch more"
              onClick={() => {
                setForm((f) => ({
                  ...f,
                  timesRewatched: Math.min(999, (f.timesRewatched ?? 0) + 1),
                }));
              }}
            >
              <Icon name="plus" />
            </button>
          </div>
        </div>
      )}

      {unknown && (
        <p className="k-field__hint">
          MyAnimeList hasn&apos;t sent kurisu all of this entry yet, so some fields are left out.
          They appear after the next sync.
        </p>
      )}
    </>
  );
}
