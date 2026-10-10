"use client";

import { createContext, use, useCallback, useEffect, useState } from "react";

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

/**
 * The design system's Toast: a change made outside Chat confirmed in words, with Undo, above the
 * bottom bar on phones and beside the rail on desktop. It goes after 5 seconds; hovering or
 * focusing it holds it.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<(ToastInput & { key: number }) | null>(null);
  const [held, setHeld] = useState(false);

  const show = useCallback((input: ToastInput) => {
    setToast({ ...input, key: Date.now() });
    setHeld(false);
  }, []);

  useEffect(() => {
    if (!toast || held || toast.level === "error") return;
    const timer = setTimeout(() => {
      setToast(null);
    }, TOAST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toast, held]);

  return (
    <ToastContext value={show}>
      {children}
      {toast && (
        <div
          key={toast.key}
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
            action={
              <span className="flex items-center gap-2">
                {toast.undo && (
                  <button
                    type="button"
                    className="k-link"
                    onClick={() => {
                      const undo = toast.undo;
                      setToast(null);
                      void undo?.();
                    }}
                  >
                    Undo
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
