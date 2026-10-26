"use client";

import { createContext, useActionState, useContext, useState, type ReactNode } from "react";

import { completeChore, skipChore, type ChoreActionState } from "@/app/chores/actions";

/** A refused skip reason to put back into its row's form. */
export type SkipDraft = {
  choreId: string;
  reason: string;
  /** Changes with every outcome, so the form remounts with the draft each time. */
  key: number;
};

type ChoreFeedback = {
  /** Form action for a row's Complete form (posts a hidden `choreId`). */
  completeAction: (formData: FormData) => void;
  /** Form action for a row's Skip form (posts a hidden `choreId` and `reason`). */
  skipAction: (formData: FormData) => void;
  /** Set only while the newest outcome is a refused skip reason. */
  skipDraft: SkipDraft | null;
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
  // The Server Actions themselves (not client wrappers), so the forms still
  // post without JavaScript.
  const [completeState, completeAction] = useActionState(completeChore, initialState);
  const [skipState, skipAction] = useActionState(skipChore, initialState);

  // Only the newest outcome of either action is shown. Counting outcomes also
  // makes a repeated, identical message a new node, so it is announced again.
  const [seen, setSeen] = useState(() => ({
    complete: completeState,
    skip: skipState,
    // Without JavaScript the page comes back with one action's result.
    latest: skipState.status !== "idle" ? skipState : completeState,
    count: 0,
  }));
  let { latest, count } = seen;
  if (seen.complete !== completeState || seen.skip !== skipState) {
    latest = seen.skip !== skipState ? skipState : completeState;
    count = seen.count + 1;
    setSeen({ complete: completeState, skip: skipState, latest, count });
  }

  const skipDraft =
    latest.status === "error" && latest.skipDraft ? { ...latest.skipDraft, key: count } : null;

  return (
    <ChoreFeedbackContext.Provider value={{ completeAction, skipAction, skipDraft }}>
      <div className="flex w-full flex-col">
        {/* Both regions are always in the DOM so screen readers pick up changes. */}
        <div role="status">
          {latest.status === "success" ? (
            <p key={count} className="mb-4 rounded-md border px-4 py-3 text-sm break-words">
              {latest.message}
            </p>
          ) : null}
        </div>
        <div role="alert">
          {latest.status === "error" ? (
            <p
              key={count}
              className="mb-4 rounded-md border border-destructive px-4 py-3 text-sm break-words text-destructive"
            >
              {latest.message}
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
