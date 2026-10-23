"use client";

import { useRef } from "react";

/**
 * Pick one of a few (score style, title language, billing): chips, or a segmented control, that a
 * screen reader hears as one radio group. Tab reaches the chosen one, and the arrow keys move
 * the choice, as with radio buttons.
 */
export function RadioChips<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className = "k-chips",
  chipClassName = "k-chip",
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  chipClassName?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div
      className={className}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step || disabled) return;
        event.preventDefault();
        const at = options.findIndex(([option]) => option === value);
        const next = (at + step + options.length) % options.length;
        const option = options[next];
        if (!option) return;
        onChange(option[0]);
        buttons.current[next]?.focus();
      }}
    >
      {options.map(([option, text], i) => (
        <button
          key={option}
          ref={(element) => {
            buttons.current[i] = element;
          }}
          type="button"
          role="radio"
          aria-checked={value === option}
          tabIndex={value === option ? 0 : -1}
          className={chipClassName}
          disabled={disabled}
          onClick={() => {
            onChange(option);
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
