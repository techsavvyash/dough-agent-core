import { test, expect, describe } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { MessageBubble } from "./MessageBubble.tsx";
import type { Message } from "../hooks/useSession.ts";

function makeMsg(
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  extra: Partial<Message> = {}
): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

describe("MessageBubble", () => {
  test("renders user message with prefix", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <MessageBubble message={makeMsg("user", "Hello world")} />,
      { width: 60, height: 3 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("❯");
    expect(frame).toContain("Hello world");
  });

  test("renders assistant message with prefix", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <MessageBubble message={makeMsg("assistant", "Hi there")} />,
      { width: 60, height: 3 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // Prefix renders; content goes through <markdown> which
    // doesn't produce char output in the test renderer
    expect(frame).toContain("⏺");
  });

  test("shows cursor when streaming", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <MessageBubble message={makeMsg("assistant", "Thinking", { isStreaming: true })} />,
      { width: 60, height: 3 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // Prefix renders; cursor and content go through <markdown>
    expect(frame).toContain("⏺");
  });

  test("no cursor when not streaming", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <MessageBubble message={makeMsg("assistant", "Done")} />,
      { width: 60, height: 3 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).not.toContain("▍");
  });

  test("renders system message without prefix", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <MessageBubble message={makeMsg("system", "Thread handoff")} />,
      { width: 60, height: 3 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("Thread handoff");
    expect(frame).not.toContain("❯");
  });

  test("renders thought text", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <MessageBubble
        message={makeMsg("assistant", "The answer is 42", {
          thought: "Let me think about this...",
        })}
      />,
      { width: 80, height: 6 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // Thought renders via <text>, content renders via <markdown>
    expect(frame).toContain("Let me think about this");
    expect(frame).toContain("⏺");
  });

  test("renders tool calls with status", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <MessageBubble
        message={makeMsg("assistant", "", {
          isStreaming: true,
          toolCalls: [
            {
              callId: "tc1",
              name: "read_file",
              args: { file_path: "/src/index.ts" },
              status: "success",
            },
            {
              callId: "tc2",
              name: "bash",
              args: { command: "bun test" },
              status: "pending",
            },
          ],
        })}
      />,
      { width: 80, height: 20 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // Non-bash tool label shown; bash uses "$ command" style (no label)
    expect(frame).toContain("Read");
    // File path arg
    expect(frame).toContain("index.ts");
    // Command arg
    expect(frame).toContain("bun test");
    // Status icon for non-bash tool (read_file success)
    expect(frame).toContain("✓");
    // Bash tool renders as "$ command" — no status icon, but command is shown
    expect(frame).toContain("$");
  });

  test("renders tool error with result", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <MessageBubble
        message={makeMsg("assistant", "", {
          isStreaming: true,
          toolCalls: [
            {
              callId: "tc1",
              name: "bash",
              args: { command: "invalid cmd" },
              status: "error",
              result: "Command not found",
            },
          ],
        })}
      />,
      { width: 80, height: 12 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // Bash errors render as "$ command" + error output below — no "✗" icon for bash
    expect(frame).toContain("$");
    expect(frame).toContain("Command not found");
  });
});
