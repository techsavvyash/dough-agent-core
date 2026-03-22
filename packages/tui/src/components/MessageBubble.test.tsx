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

    expect(frame).toContain("⏺");
    expect(frame).toContain("Hi there");
  });

  test("shows cursor when streaming", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <MessageBubble message={makeMsg("assistant", "Thinking", { isStreaming: true })} />,
      { width: 60, height: 3 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("▍");
    expect(frame).toContain("Thinking");
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

    expect(frame).toContain("Let me think about this");
    expect(frame).toContain("The answer is 42");
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
      { width: 80, height: 8 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // Tool names shown
    expect(frame).toContain("Read");
    expect(frame).toContain("Run");
    // File path arg
    expect(frame).toContain("index.ts");
    // Command arg
    expect(frame).toContain("bun test");
    // Status icons
    expect(frame).toContain("✓");
    expect(frame).toContain("⋯");
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
      { width: 80, height: 6 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("✗");
    expect(frame).toContain("Command not found");
  });
});
