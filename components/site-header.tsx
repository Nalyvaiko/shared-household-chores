import Link from "next/link";

import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { getCurrentHousehold, getCurrentUser } from "@/lib/auth/guards";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export async function SiteHeader() {
  // A session whose user was deleted resolves to `null`, so it shows the
  // sign-in links. Only the email, and whether the user has a household (for the
  // Members item), go to the client menu.
  const user = await getCurrentUser();
  const hasHousehold = user ? (await getCurrentHousehold()) !== null : false;

  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <span className="text-base leading-tight font-semibold">
          Shared Household Chores
        </span>
        {user ? (
          <UserMenu
            email={user.email}
            hasHousehold={hasHousehold}
            signOutAction={signOutAction}
          />
        ) : (
          <nav aria-label="Account" className="flex shrink-0 items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/signin">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Sign up</Link>
            </Button>
          </nav>
        )}
      </div>
    </header>
  );
}
