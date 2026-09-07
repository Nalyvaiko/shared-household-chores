import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shared Household Chores",
  description: "Manage shared household chores for couples, families, and roommates.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <div className="flex min-h-dvh flex-col">
          <header className="border-b">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
              <span className="text-base font-semibold">Shared Household Chores</span>
              {/* User menu placeholder — wired up in task #7. */}
              <Button
                variant="ghost"
                size="icon"
                disabled
                aria-label="User menu (coming soon)"
              >
                <UserRound />
              </Button>
            </div>
          </header>
          <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
