"use client";

import { useActionState } from "react";

import { joinHousehold, type JoinHouseholdState } from "@/app/invite/[token]/actions";
import { INVITE_PROBLEM_MESSAGES } from "@/app/invite/[token]/messages";
import { Button } from "@/components/ui/button";

const initialState: JoinHouseholdState = {};

/** The "Join household" button. On success the action redirects to `/`. */
export function JoinForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(joinHousehold, initialState);

  if (state.problem) {
    const message = INVITE_PROBLEM_MESSAGES[state.problem];
    return (
      <div className="flex flex-col gap-1" role="alert">
        <p className="font-medium">{message.title}</p>
        <p className="text-sm text-muted-foreground">{message.body}</p>
      </div>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Join household"}
      </Button>
    </form>
  );
}
