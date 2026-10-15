"use client";

import { useId, useRef } from "react";
import { LogOut, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type UserMenuProps = {
  /** The signed-in user's email. The only session data sent to the client. */
  email: string;
  signOutAction: () => Promise<void>;
};

export function UserMenu({ email, signOutAction }: UserMenuProps) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      {/*
        The form lives outside the menu: selecting an item closes the menu and
        unmounts its portal, which could take a form inside it along before it
        submits.
      */}
      <form ref={formRef} id={formId} action={signOutAction} hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="max-w-40 min-w-0 shrink sm:max-w-64"
            aria-label={`Account menu for ${email}`}
          >
            <UserRound />
            <span className="truncate">{email}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
            <span className="text-xs text-muted-foreground">Signed in as</span>
            <span className="text-sm break-all">{email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              // Keep the menu open until the sign-out redirect replaces it.
              event.preventDefault();
              formRef.current?.requestSubmit();
            }}
          >
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
