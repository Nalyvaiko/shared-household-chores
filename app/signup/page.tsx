import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignupForm } from "@/app/signup/signup-form";
import { safeCallbackUrl, withCallbackUrl } from "@/lib/auth/callback-url";
import { getCurrentUser } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Sign up · Shared Household Chores",
};

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);

  // A session whose user was deleted counts as signed out, so a guarded page
  // and this page cannot redirect each other in a loop.
  const user = await getCurrentUser();
  if (user) redirect(callbackUrl);

  return (
    <section className="flex flex-col items-start gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-muted-foreground">
          Sign up with your email to start sharing chores.
        </p>
      </div>
      <SignupForm callbackUrl={callbackUrl} />
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={withCallbackUrl("/signin", callbackUrl)}
          className="font-medium text-foreground underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </section>
  );
}
