import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SigninForm } from "@/app/signin/signin-form";
import { safeCallbackUrl, withCallbackUrl } from "@/lib/auth/callback-url";

export const metadata: Metadata = {
  title: "Sign in · Shared Household Chores",
};

export default async function SigninPage({ searchParams }: PageProps<"/signin">) {
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);

  const session = await auth();
  if (session?.user) redirect(callbackUrl);

  return (
    <section className="flex flex-col items-start gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground">
          Welcome back. Sign in with your email and password.
        </p>
      </div>
      <SigninForm callbackUrl={callbackUrl} />
      <p className="text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href={withCallbackUrl("/signup", callbackUrl)}
          className="font-medium text-foreground underline underline-offset-4"
        >
          Create an account
        </Link>
      </p>
    </section>
  );
}
