"use client";

import { useActionState, useState } from "react";

import {
  createInvite,
  regenerateInvite,
  type MembersActionState,
} from "@/app/household/members/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: MembersActionState = {};

type InviteSectionProps = {
  /** The active invite, or `null` when the household has none. */
  invite: { url: string; expiresLabel: string } | null;
};

type CopyStatus = "idle" | "copied" | "failed";

function FormError({ state }: { state: MembersActionState }) {
  return state.error ? (
    <p className="text-sm text-destructive" role="alert">
      {state.error}
    </p>
  ) : null;
}

export function InviteSection({ invite }: InviteSectionProps) {
  const [createState, createAction, creating] = useActionState(createInvite, initialState);
  const [regenerateState, regenerateAction, regenerating] = useActionState(
    regenerateInvite,
    initialState,
  );
  const [copy, setCopy] = useState<{ url: string; status: CopyStatus }>({
    url: "",
    status: "idle",
  });
  // A status for a link that has since been replaced is not shown.
  const copyStatus = invite && copy.url === invite.url ? copy.status : "idle";

  if (!invite) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">No active invite link</p>
        <form action={createAction}>
          <Button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create invite link"}
          </Button>
        </form>
        <FormError state={createState} />
      </div>
    );
  }

  async function copyLink(url: string) {
    try {
      // `navigator.clipboard` is missing in insecure contexts; that throws here too.
      await navigator.clipboard.writeText(url);
      setCopy({ url, status: "copied" });
    } catch {
      setCopy({ url, status: "failed" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-url" className="sr-only">
          Invite URL
        </Label>
        <div className="flex gap-2">
          {/* Read-only, so the link can be selected and copied by hand without JavaScript. */}
          <Input
            id="invite-url"
            type="text"
            readOnly
            value={invite.url}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button type="button" variant="outline" onClick={() => copyLink(invite.url)}>
            Copy
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">Expires {invite.expiresLabel}</p>
        <p aria-live="polite" className="text-sm">
          {copyStatus === "copied" ? "Copied" : null}
          {copyStatus === "failed" ? (
            <span className="text-destructive">
              Couldn&rsquo;t copy. Select the link and copy it.
            </span>
          ) : null}
        </p>
      </div>
      <form action={regenerateAction}>
        <Button type="submit" variant="outline" disabled={regenerating}>
          {regenerating ? "Regenerating…" : "Regenerate link"}
        </Button>
      </form>
      <FormError state={regenerateState} />
    </div>
  );
}
