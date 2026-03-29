import type { Theme } from "./default.ts";

export const monokaiTheme: Theme = {
  name: "monokai",
  colors: {
    primary: "#A6E22E",      // monokai green
    accent: "#66D9E8",       // monokai cyan
    secondary: "#AE81FF",    // monokai purple
    text: "#F8F8F2",         // monokai fg
    textDim: "#75715E",      // monokai comment
    textMuted: "#49483E",    // monokai selection
    success: "#A6E22E",
    error: "#F92672",        // monokai red
    warning: "#E6DB74",      // monokai yellow
    border: "#3E3D32",
    borderActive: "#A6E22E",
    logo: "#FD971F",         // monokai orange
  },
};
