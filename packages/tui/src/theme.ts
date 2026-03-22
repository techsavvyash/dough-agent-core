export const colors = {
  // Core — gemini-inspired blue/cyan palette
  primary: "#87AFFF",     // soft blue
  accent: "#87D7D7",      // accent cyan
  secondary: "#D7AFFF",   // accent purple

  // Text
  text: "#FFFFFF",        // bright white
  textDim: "#AFAFAF",     // comment gray
  textMuted: "#5F5F5F",   // dark gray

  // Status
  success: "#D7FFD7",     // soft green
  error: "#FF87AF",       // soft red
  warning: "#FFFFAF",     // soft yellow

  // Borders
  border: "#3A3A3A",      // subtle dark
  borderActive: "#87AFFF",

  // Logo
  logo: "#E6E7DD",        // dough cream (from SVG)
} as const;

export const symbols = {
  userPrefix: "❯",
  assistantPrefix: "⏺",
  thinking: "◐",
  cursor: "▍",
  dot: "·",
  hrule: "─",
  // Tool call indicators
  toolCall: "⚡",
  toolSuccess: "✓",
  toolError: "✗",
  toolPending: "⋯",
  // Streaming spinners
  spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as readonly string[],
  // Thought
  thought: "💭",
  // Context warning
  contextWarn: "⚠",
} as const;

export function hrule(width: number): string {
  return symbols.hrule.repeat(width);
}
