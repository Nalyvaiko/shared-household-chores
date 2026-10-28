"use client";

import { createContext, useActionState, useContext, useState, type ReactNode } from "react";

import {
  claimChore,
  completeChore,
  releaseChore,
  skipChore,
  type ChoreActionState,
} from "@/app/chores/actions";

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
  /** Form action for a row's Claim form (posts a hidden `choreId`). */
  claimAction: (formData: FormData) => void;
  /** Form action for a row's Release form (posts a hidden `choreId`). */
  releaseAction: (formData: FormData) => void;
  /** Set only while the newest outcome is a refused skip reason. */
  skipDraft: SkipDraft | null;
};

const ChoreFeedbackContext = createContext<ChoreFeedback | null>(null);

const initialState: ChoreActionState = { status: "idle" };

const ACTION_NAMES = ["complete", "skip", "claim", "release"] as const;

/** Each row action's latest state, by action. */
type ActionStates = Record<(typeof ACTION_NAMES)[number], ChoreActionState>;

/**
 * The outcome to show when the page loads. Without JavaScript the page comes
 * back from a post with at most one action's result; otherwise all are idle.
 */
function loadedOutcome(states: ActionStates): ChoreActionState {
  return ACTION_NAMES.map((name) => states[name]).find((s) => s.status !== "idle") ?? initialState;
}

/** The new state of the action that returned since `before`, or null if none did. */
function changedOutcome(before: ActionStates, after: ActionStates): ChoreActionState | null {
  const name = ACTION_NAMES.find((n) => before[n] !== after[n]);
  return name ? after[name] : null;
}

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
  const [claimState, claimAction] = useActionState(claimChore, initialState);
  const [releaseState, releaseAction] = useActionState(releaseChore, initialState);
  const states: ActionStates = {
    complete: completeState,
    skip: skipState,
    claim: claimState,
    release: releaseState,
  };

  // Only the newest outcome of any action is shown. Counting outcomes also
  // makes a repeated, identical message a new node, so it is announced again.
  const [seen, setSeen] = useState(() => ({ states, latest: loadedOutcome(states), count: 0 }));
  let { latest, count } = seen;
  const changed = changedOutcome(seen.states, states);
  if (changed) {
    latest = changed;
    count = seen.count + 1;
    setSeen({ states, latest, count });
  }

  // A newer outcome of any other kind replaces a refused skip, so its draft closes.
  const skipDraft =
    latest.status === "error" && latest.skipDraft ? { ...latest.skipDraft, key: count } : null;

  return (
    <ChoreFeedbackContext.Provider
      value={{ completeAction, skipAction, claimAction, releaseAction, skipDraft }}
    >
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
