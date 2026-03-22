import { test, expect, describe } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { Header } from "./Header.tsx";

describe("Header", () => {
  test("renders logo and app name", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <Header session={null} connected={false} />,
      { width: 80, height: 12 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("Dough");
    expect(frame).toContain("v0.1.0");
    // Braille logo characters should be present
    expect(frame).toContain("⣿");
  });

  test("shows provider from session", async () => {
    const session = {
      id: "s1",
      activeThreadId: "t1",
      threads: [],
      provider: "codex",
      model: "gpt-4",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { captureCharFrame, renderOnce } = await testRender(
      <Header session={session} connected={true} />,
      { width: 80, height: 12 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("codex");
    expect(frame).toContain("gpt-4");
  });

  test("shows connected status when connected", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <Header session={null} connected={true} />,
      { width: 80, height: 12 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("connected");
  });

  test("shows disconnected status when not connected", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <Header session={null} connected={false} />,
      { width: 80, height: 12 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("disconnected");
  });
});
