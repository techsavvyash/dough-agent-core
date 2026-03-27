import type { TodoItem } from "@dough/protocol";
import type { LLMProvider } from "../providers/provider.ts";

export interface VerificationResult {
  passed: boolean;
  details?: string;
  awaitingManualApproval?: boolean;
}

export class TodoVerifier {
  constructor(private provider: LLMProvider) {}

  async verify(item: TodoItem): Promise<VerificationResult> {
    const v = item.verification;

    switch (v.strategy) {
      case "manual":
        // Signal that human approval is needed; caller handles the round-trip
        return {
          passed: false,
          awaitingManualApproval: true,
          details: v.instructions ?? "Please review and confirm this todo is complete.",
        };

      case "command": {
        try {
          const proc = Bun.spawn(v.command.split(" "), {
            cwd: v.cwd,
            stdout: "pipe",
            stderr: "pipe",
          });
          await proc.exited;
          const stdout = await new Response(proc.stdout).text();
          if (proc.exitCode !== 0) {
            return { passed: false, details: `Command exited with code ${proc.exitCode}` };
          }
          if (v.outputPattern) {
            const re = new RegExp(v.outputPattern);
            if (!re.test(stdout)) {
              return { passed: false, details: `Output did not match pattern: ${v.outputPattern}` };
            }
          }
          return { passed: true, details: `Command succeeded (exit 0)` };
        } catch (err) {
          return { passed: false, details: `Command failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case "file_exists": {
        const exists = await Bun.file(v.path).exists();
        return {
          passed: exists,
          details: exists ? `File exists: ${v.path}` : `File not found: ${v.path}`,
        };
      }

      case "file_contains": {
        try {
          const content = await Bun.file(v.path).text();
          const matches = v.isRegex
            ? new RegExp(v.pattern).test(content)
            : content.includes(v.pattern);
          return {
            passed: matches,
            details: matches
              ? `Pattern found in ${v.path}`
              : `Pattern not found in ${v.path}: ${v.pattern}`,
          };
        } catch (err) {
          return { passed: false, details: `Could not read file ${v.path}: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case "test_pass": {
        try {
          const args = ["bun", "test"];
          if (v.filter) args.push("--filter", v.filter);
          const proc = Bun.spawn(args, {
            cwd: v.cwd,
            stdout: "pipe",
            stderr: "pipe",
          });
          await proc.exited;
          return {
            passed: proc.exitCode === 0,
            details: proc.exitCode === 0 ? "Tests passed" : `Tests failed (exit ${proc.exitCode})`,
          };
        } catch (err) {
          return { passed: false, details: `Test run failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case "llm_judge": {
        try {
          const judgePrompt = [
            `You are evaluating whether a task is complete.`,
            `Task title: ${item.title}`,
            item.description ? `Task description: ${item.description}` : "",
            `Evaluation criteria: ${v.prompt}`,
            ``,
            `Reply with exactly "PASS" or "FAIL" on the first line, followed by a brief explanation.`,
          ]
            .filter(Boolean)
            .join("\n");

          let fullText = "";
          for await (const event of this.provider.send(
            [{ id: crypto.randomUUID(), role: "user", content: judgePrompt, timestamp: new Date().toISOString(), tokenEstimate: 0 }],
            {}
          )) {
            if (event.type === "content_delta" as string) {
              fullText += (event as { text: string }).text;
            }
            if (event.type === "content_complete" as string) {
              fullText = (event as { text: string }).text;
            }
          }

          const passed = /^PASS/i.test(fullText.trim());
          return { passed, details: fullText.trim() };
        } catch (err) {
          return { passed: false, details: `LLM judge failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
    }
  }
}
