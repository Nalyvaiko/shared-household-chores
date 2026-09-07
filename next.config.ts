import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` otherwise appends a generated block to AGENTS.md on every run;
  // we keep that file hand-curated. See _docs/testing.md / AGENTS.md for the
  // reminder that Next 16 diverges from older docs.
  agentRules: false,
};

export default nextConfig;
