import { useState, useEffect } from "react";

/** Detects the current git branch by running `git rev-parse --abbrev-ref HEAD`. */
export function useGitBranch(): string {
  const [branch, setBranch] = useState("");

  useEffect(() => {
    async function detect() {
      try {
        const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const exitCode = await proc.exited;
        if (exitCode !== 0) return;
        const text = await new Response(proc.stdout).text();
        const trimmed = text.trim();
        if (trimmed && trimmed !== "HEAD") setBranch(trimmed);
      } catch {
        // Not a git repo or git not installed — stay empty
      }
    }
    detect();
  }, []);

  return branch;
}
