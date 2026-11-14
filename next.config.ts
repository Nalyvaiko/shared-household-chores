import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` otherwise appends a generated block to AGENTS.md on every run;
  // we keep that file hand-curated. See _docs/testing.md / AGENTS.md for the
  // reminder that Next 16 diverges from older docs.
  agentRules: false,
  // The Docker image (see Dockerfile) sets NEXT_OUTPUT_STANDALONE=1 to build the
  // self-contained `.next/standalone` server. Every other build (`npm run
  // build`, Vercel, the Playwright web server) keeps the default output, so
  // `next start` works as before: it does not support standalone output.
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1"
    ? { output: "standalone" as const }
    : {}),
};

export default nextConfig;
