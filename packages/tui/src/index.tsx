import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { App } from "./App.tsx";

const args = process.argv.slice(2);

function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1]!;
  }
  return defaultValue;
}

const port = getArg("port", "4200");
const provider = getArg("provider", "claude");
const model = getArg("model", "");
const serverUrl = getArg("server", `ws://localhost:${port}/ws`);

async function main() {
  const renderer = await createCliRenderer();
  const root = createRoot(renderer);

  root.render(
    <App
      serverUrl={serverUrl}
      provider={provider}
      model={model || undefined}
    />
  );
}

main().catch((err) => {
  console.error("Failed to start TUI:", err);
  process.exit(1);
});
