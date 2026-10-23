"use client";

import { createContext, use, useCallback, useEffect, useRef, useState } from "react";

import { Banner } from "./Banner";
import { Icon } from "./Icon";

/** How long a toast stays, unless it's hovered or focused. */
const TOAST_MS = 5_000;

export interface ToastInput {
  /** The change in words: "Tidewater: ep 7 → 8". */
  text: string;
  /** An error stays until it's dismissed or replaced. */
  level?: "info" | "error";
  /** Takes the change back; the toast offers Undo when given. */
  undo?: () => void | Promise<void>;
}

const ToastContext = createContext<(toast: ToastInput) => void>(() => undefined);

/** Shows a toast, replacing the one on screen. */
export function useToast(): (toast: ToastInput) => void {
  return use(ToastContext);
}

/** Nobody can see or reach the toast: the tab is hidden, or a sheet's scrim covers it. */
function outOfReach(): boolean {
  return document.hidden || document.querySelector("dialog[open]") !== null;
}

/**
 * The design system's Toast: a change made outside Chat confirmed in words, with Undo, above the
 * bottom bar on phones and beside the rail on desktop. It goes after 5 seconds; hovering or
 * focusing it holds it, and so does a hidden tab or an open sheet (the Finished sheet opens with
 * one). Alt+T focuses it. A replacement swaps its words in place; Undo says "Undoing…" until the
 * undo's own toast arrives. Screen readers hear it through a live region that's always there.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<(ToastInput & { undoing?: boolean }) | null>(null);
  const [held, setHeld] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const show = useCallback((input: ToastInput) => {
    setToast(input);
    setHeld(false);
  }, []);

  useEffect(() => {
    if (!toast || held || toast.undoing || toast.level === "error") return;
    let timer: ReturnType<typeof setTimeout>;
    const wait = () => {
      timer = setTimeout(() => {
        if (outOfReach()) wait();
        else setToast(null);
      }, TOAST_MS);
    };
    wait();
    return () => {
      clearTimeout(timer);
    };
  }, [toast, held]);

  useEffect(() => {
    if (!toast) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        box.current?.querySelector("button")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [toast]);

  return (
    <ToastContext value={show}>
      {children}
      <div role="status" className="k-visually-hidden">
        {toast?.level !== "error" && toast?.text}
      </div>
      <div role="alert" className="k-visually-hidden">
        {toast?.level === "error" && toast.text}
      </div>
      {toast && (
        <div
          ref={box}
          aria-keyshortcuts="Alt+T"
          onPointerEnter={() => {
            setHeld(true);
          }}
          onPointerLeave={() => {
            setHeld(false);
          }}
          onFocus={() => {
            setHeld(true);
          }}
          onBlur={() => {
            setHeld(false);
          }}
        >
          <Banner
            level={toast.level ?? "info"}
            className="k-toast"
            live={false}
            action={
              <span className="flex items-center gap-2">
                {toast.undo && (
                  <button
                    type="button"
                    className="k-link"
                    disabled={toast.undoing}
                    aria-busy={toast.undoing}
                    onClick={() => {
                      const undo = toast.undo;
                      setToast({ ...toast, undoing: true });
                      void undo?.();
                    }}
                  >
                    {toast.undoing ? "Undoing…" : "Undo"}
                  </button>
                )}
                <button
                  type="button"
                  className="k-btn k-btn--ghost k-btn--icon k-btn--sm"
                  aria-label="Dismiss"
                  onClick={() => {
                    setToast(null);
                  }}
                >
                  <Icon name="clear" />
                </button>
              </span>
            }
          >
            {toast.text}
          </Banner>
        </div>
      )}
    </ToastContext>
  );
}
