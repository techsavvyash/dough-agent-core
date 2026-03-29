export const defaultTheme = {
  name: "default",
  colors: {
    primary: "#87AFFF",
    accent: "#87D7D7",
    secondary: "#D7AFFF",
    text: "#FFFFFF",
    textDim: "#AFAFAF",
    textMuted: "#5F5F5F",
    success: "#D7FFD7",
    error: "#FF87AF",
    warning: "#FFFFAF",
    border: "#3A3A3A",
    borderActive: "#87AFFF",
    logo: "#E6E7DD",
  },
} as const;

export type ThemeColors = { [K in keyof typeof defaultTheme.colors]: string };
export type Theme = { name: string; colors: ThemeColors };
