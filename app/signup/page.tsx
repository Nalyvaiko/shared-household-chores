import type { Metadata } from "next";

import { SignupForm } from "@/app/signup/signup-form";

export const metadata: Metadata = {
  title: "Sign up · Shared Household Chores",
};

export default function SignupPage() {
  return (
    <section className="flex flex-col items-start gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-muted-foreground">
          Sign up with your email to start sharing chores.
        </p>
      </div>
      <SignupForm />
    </section>
  );
}
