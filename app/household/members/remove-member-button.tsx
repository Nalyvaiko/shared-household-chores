"use client";

import { useActionState, useState } from "react";

import { removeMember, type MembersActionState } from "@/app/household/members/actions";
import { Button } from "@/components/ui/button";

const initialState: MembersActionState = {};

type RemoveMemberButtonProps = {
  membershipId: string;
  displayName: string;
};

/** "Remove", then an inline confirm step before the Server Action runs. */
export function RemoveMemberButton({ membershipId, displayName }: RemoveMemberButtonProps) {
  const [state, action, pending] = useActionState(removeMember, initialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col items-end gap-2">
      {confirming ? (
        <form
          action={action}
          className="flex flex-col items-end gap-2"
          role="group"
          aria-label={`Confirm removing ${displayName}`}
        >
          <input type="hidden" name="membershipId" value={membershipId} />
          <p className="text-sm">Remove {displayName} from the household?</p>
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={pending}>
              {pending ? "Removing…" : "Remove"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Remove
        </Button>
      )}
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
