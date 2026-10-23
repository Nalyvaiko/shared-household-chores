"use client";

import { createContext, useActionState, useContext, useState, type ReactNode } from "react";

import { completeChore, type ChoreActionState } from "@/app/chores/actions";

type ChoreFeedback = {
  /** Form action for a row's Complete form (posts a hidden `choreId`). */
  completeAction: (formData: FormData) => void;
};

const ChoreFeedbackContext = createContext<ChoreFeedback | null>(null);

const initialState: ChoreActionState = { status: "idle" };

/**
 * Holds the chore row actions' state for a page and renders their outcome in
 * a live region above `children` (the list or its empty state).
 *
 * The state lives here rather than in the row because a successful action
 * removes the row in the same render that delivers the result. This provider
 * must sit at a stable, unkeyed position in the page, so a server re-render
 * keeps the message. It unmounts, and the message clears, on navigation to
 * another page.
 */
export function ChoreFeedbackProvider({ children }: { children: ReactNode }) {
  // The Server Action itself (not a client wrapper), so the forms still post
  // without JavaScript.
  const [state, completeAction] = useActionState(completeChore, initialState);

  // Counts outcomes so that a repeated, identical message is a new node and
  // gets announced again.
  const [seen, setSeen] = useState({ state, count: 0 });
  if (seen.state !== state) setSeen({ state, count: seen.count + 1 });

  return (
    <ChoreFeedbackContext.Provider value={{ completeAction }}>
      <div className="flex w-full flex-col">
        {/* Both regions are always in the DOM so screen readers pick up changes. */}
        <div role="status">
          {state.status === "success" ? (
            <p key={seen.count} className="mb-4 rounded-md border px-4 py-3 text-sm break-words">
              {state.message}
            </p>
          ) : null}
        </div>
        <div role="alert">
          {state.status === "error" ? (
            <p
              key={seen.count}
              className="mb-4 rounded-md border border-destructive px-4 py-3 text-sm break-words text-destructive"
            >
              {state.message}
            </p>
          ) : null}
        </div>
        {children}
      </div>
    </ChoreFeedbackContext.Provider>
  );
}

/** The page's chore actions. Only valid under `ChoreFeedbackProvider`. */
export function useChoreFeedback(): ChoreFeedback {
  const feedback = useContext(ChoreFeedbackContext);
  if (!feedback) throw new Error("useChoreFeedback must be used inside ChoreFeedbackProvider");
  return feedback;
}
