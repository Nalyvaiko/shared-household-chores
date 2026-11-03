"use client";

import { useActionState } from "react";

import { changeMemberRole, type MembersActionState } from "@/app/household/members/actions";
import { Button } from "@/components/ui/button";

const initialState: MembersActionState = {};

type ChangeRoleButtonProps = {
  membershipId: string;
  displayName: string;
  currentRole: "admin" | "member";
};

/** "Make admin" on a member, "Make member" on an admin. No confirm: it can be undone. */
export function ChangeRoleButton({ membershipId, displayName, currentRole }: ChangeRoleButtonProps) {
  const [state, action, pending] = useActionState(changeMemberRole, initialState);
  const role = currentRole === "admin" ? "member" : "admin";
  const label = role === "admin" ? "Make admin" : "Make member";

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={action}>
        <input type="hidden" name="membershipId" value={membershipId} />
        <input type="hidden" name="role" value={role} />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`${label}: ${displayName}`}
        >
          {pending ? "Saving…" : label}
        </Button>
      </form>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
