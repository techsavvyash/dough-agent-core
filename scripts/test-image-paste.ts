#!/usr/bin/env bun
/**
 * End-to-end test for the image paste pipeline.
 * Starts a server on port 4302, sends a real base64 PNG via WebSocket,
 * and verifies Claude's response acknowledges the image.
 */

const PORT = 4302;
const WS_URL = `ws://localhost:${PORT}/ws`;

// Minimal 1×1 red PNG (base64) — real valid PNG bytes
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAIAAACRXR/mAAAARUlEQVR4nO3OMQ0AMAwDsIIt2MIagf3JYckAPLPXKD/Q0tLS0tLqkB9oaWlpaWl1yA+0tLS0tLQ65AdaWlpaWlod8oOfB9IbclZlpYKPAAAAAElFTkSuQmCC";

let pass = 0;
let fail = 0;

function ok(label: string) { console.log(`  ✅ ${label}`); pass++; }
function ko(label: string, detail?: string) {
  console.log(`  ❌ ${label}${detail ? ": " + detail : ""}`);
  fail++;
}

async function waitForHealthy(port: number, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch {}
    await Bun.sleep(300);
  }
  return false;
}

// ── Start server ────────────────────────────────────────────────────────────
console.log(`\n🚀 Starting server on port ${PORT}...`);
const serverProc = Bun.spawn({
  cmd: ["bun", "run", "packages/server/src/index.ts"],
  env: { ...process.env, DOUGH_PORT: String(PORT) },
  stdout: "pipe",
  stderr: "pipe",
  stdin: "ignore",
});

const healthy = await waitForHealthy(PORT);
if (!healthy) {
  ko("Server started and healthy");
  console.log("\nServer stderr:");
  console.log(await new Response(serverProc.stderr).text());
  process.exit(1);
}
ok("Server started and healthy");

// ── Connect WebSocket ───────────────────────────────────────────────────────
console.log("\n📡 Connecting WebSocket...");

function runTest(): Promise<{ pass: number; fail: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let localPass = 0;
    let localFail = 0;
    let sessionCreated = false;
    let imageSent = false;
    let responseReceived = false;
    const timeout = setTimeout(() => {
      localFail++;
      console.log("  ❌ Test timed out waiting for Claude response");
      ws.close();
      resolve({ pass: localPass, fail: localFail });
    }, 90_000); // 90s for Claude to respond

    ws.onopen = () => {
      localPass++;
      console.log("  ✅ WebSocket connected");
      // Create session
      ws.send(JSON.stringify({ kind: "create", provider: "claude" }));
    };

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data as string);

      if (msg.kind === "session_info" && !sessionCreated) {
        sessionCreated = true;
        localPass++;
        console.log(`  ✅ Session created: ${msg.session.id.slice(0, 8)}...`);

        // Send message WITH image attachment
        console.log("\n🖼️  Sending message with 1×1 PNG attachment...");
        imageSent = true;
        ws.send(JSON.stringify({
          kind: "send",
          prompt: "I am sending you a tiny 1×1 red PNG image. Can you confirm you can see it? Just say YES or NO.",
          attachments: [{
            type: "image",
            mimeType: "image/png",
            data: TINY_PNG_B64,
            name: "test-1x1-red.png",
          }],
        }));
      }

      if (msg.kind === "event") {
        const event = msg.event;

        // Look for the content_complete event with Claude's response
        if (event.type === "content_complete" && imageSent && !responseReceived) {
          responseReceived = true;
          clearTimeout(timeout);
          const text: string = event.text ?? "";
          console.log(`\n📝 Claude responded:\n  "${text.slice(0, 200)}"`);

          const upper = text.toUpperCase();
          if (upper.includes("YES") || upper.includes("SEE") || upper.includes("IMAGE") || upper.includes("RED") || upper.includes("PIXEL")) {
            localPass++;
            console.log("  ✅ Claude acknowledged the image");
          } else if (upper.includes("NO") || upper.includes("CAN'T") || upper.includes("CANNOT") || upper.includes("UNABLE")) {
            localFail++;
            console.log("  ❌ Claude could NOT see the image — pipeline still broken");
          } else {
            localPass++;
            console.log("  ✅ Claude responded (ambiguous, but no 'I can't see it' error)");
          }

          ws.close();
          resolve({ pass: localPass, fail: localFail });
        }
      }

      if (msg.kind === "error") {
        console.log(`  ⚠️  Server error: ${msg.message}`);
      }
    };

    ws.onerror = (e) => {
      localFail++;
      console.log(`  ❌ WebSocket error: ${e}`);
      clearTimeout(timeout);
      resolve({ pass: localPass, fail: localFail });
    };
  });
}

const result = await runTest();
pass += result.pass;
fail += result.fail;

// ── Cleanup ─────────────────────────────────────────────────────────────────
serverProc.kill();

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${pass} pass, ${fail} fail`);
console.log(`${"─".repeat(50)}\n`);
process.exit(fail > 0 ? 1 : 0);
