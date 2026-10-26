"use client";

import { useState } from "react";

import { AddSheet } from "./AddSheet";

/** "Add" on a row of a server-rendered page: opens the Add sheet, whose tap is the confirmation. */
export function AddButton({ show }: { show: { animeId: number; title: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="k-btn k-btn--sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Add
      </button>
      {open && (
        <AddSheet
          show={show}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
