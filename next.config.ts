import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack root to this worktree so it doesn't pick up the parent
  // pnpm-workspace.yaml when running `next build` inside a `git worktree`.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
