export { defaultTheme } from "./default.ts";
export { monokaiTheme } from "./monokai.ts";
export { catppuccinTheme } from "./catppuccin.ts";
export type { Theme, ThemeColors } from "./default.ts";

import { defaultTheme } from "./default.ts";
import { monokaiTheme } from "./monokai.ts";
import { catppuccinTheme } from "./catppuccin.ts";
import type { Theme } from "./default.ts";

export const THEMES: Theme[] = [defaultTheme, monokaiTheme, catppuccinTheme];

const CONFIG_PATH = `${process.env.HOME ?? "~"}/.dough/config.json`;

/** Persist active theme name to ~/.dough/config.json */
export async function saveThemeName(name: string): Promise<void> {
  try {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(await Bun.file(CONFIG_PATH).text());
    } catch { /* first run */ }
    config.theme = name;
    await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch { /* non-fatal */ }
}

/** Load saved theme name from ~/.dough/config.json */
export async function loadThemeName(): Promise<string | null> {
  try {
    const config = JSON.parse(await Bun.file(CONFIG_PATH).text());
    return typeof config.theme === "string" ? config.theme : null;
  } catch {
    return null;
  }
}
