import { SyntaxStyle } from "@opentui/core";
import type { ThemeTokenStyle } from "@opentui/core";

/**
 * Dough-themed SyntaxStyle for <markdown> and <code> components.
 * Uses the same blue/cyan/purple palette as theme.ts.
 *
 * Two groups of scopes:
 *   1. markup.*  — OpenTUI's own markdown inline/block scopes
 *   2. Standard TextMate scopes — for syntax-highlighted code blocks
 */
const DOUGH_THEME: ThemeTokenStyle[] = [
  // ── Markdown inline & block elements ─────────────────────────────────────
  // markup.strong  →  bold text  (**text** / __text__)
  {
    scope: ["markup.strong"],
    style: { foreground: "#FFFFFF", bold: true },
  },
  // markup.italic  →  italic text  (*text* / _text_)
  {
    scope: ["markup.italic"],
    style: { foreground: "#E8E8E8", italic: true },
  },
  // markup.strikethrough  →  ~~text~~  (dim since no strikethrough attr)
  {
    scope: ["markup.strikethrough"],
    style: { foreground: "#5F5F5F", dim: true },
  },
  // markup.raw  →  inline code  (`code`)
  {
    scope: ["markup.raw"],
    style: { foreground: "#87D7D7" }, // accent cyan
  },
  // markup.raw.block  →  fenced code block body
  {
    scope: ["markup.raw.block"],
    style: { foreground: "#FFFFFF" },
  },
  // markup.heading  →  # H1 / ## H2 / etc.
  {
    scope: ["markup.heading"],
    style: { foreground: "#87AFFF", bold: true }, // primary blue + bold
  },
  // markup.link.label  →  [visible text](url) — the label part
  {
    scope: ["markup.link.label", "markup.link"],
    style: { foreground: "#D7AFFF", underline: true }, // secondary purple underlined
  },
  // markup.link.url  →  [text](url) — the URL part
  {
    scope: ["markup.link.url"],
    style: { foreground: "#5F5F5F", italic: true }, // textMuted, de-emphasised
  },

  // ── Code-block syntax highlighting (TextMate scopes) ─────────────────────
  // Keywords & control flow
  {
    scope: ["keyword", "keyword.control", "storage.type", "storage.modifier"],
    style: { foreground: "#D7AFFF" }, // secondary purple
  },
  // Strings
  {
    scope: ["string", "string.quoted", "string.template", "string.regexp"],
    style: { foreground: "#87D7D7" }, // accent cyan
  },
  // Numbers
  {
    scope: ["constant.numeric", "constant.numeric.integer", "constant.numeric.float"],
    style: { foreground: "#FFFFAF" }, // warning yellow
  },
  // Functions & methods
  {
    scope: ["entity.name.function", "support.function", "meta.function-call.generic"],
    style: { foreground: "#87AFFF" }, // primary blue
  },
  // Comments
  {
    scope: ["comment", "comment.line", "comment.block"],
    style: { foreground: "#5F5F5F", italic: true }, // textMuted
  },
  // Types & classes
  {
    scope: [
      "entity.name.type",
      "entity.name.class",
      "support.type",
      "support.class",
      "entity.name.interface",
    ],
    style: { foreground: "#D7FFD7" }, // success green
  },
  // Constants & booleans
  {
    scope: ["constant", "constant.language", "variable.language.this"],
    style: { foreground: "#D7AFFF", bold: true }, // secondary purple bold
  },
  // Object properties
  {
    scope: [
      "variable.other.property",
      "meta.property-name",
      "support.type.property-name",
      "variable.other.object.property",
    ],
    style: { foreground: "#87D7D7" }, // accent cyan
  },
  // HTML/JSX tags
  {
    scope: ["entity.name.tag"],
    style: { foreground: "#FF87AF" }, // soft red/pink
  },
  // HTML/JSX attributes
  {
    scope: ["entity.other.attribute-name"],
    style: { foreground: "#87AFFF" }, // primary blue
  },
  // Operators
  {
    scope: ["keyword.operator", "punctuation.accessor"],
    style: { foreground: "#AFAFAF" }, // textDim
  },
  // Punctuation
  {
    scope: ["punctuation", "meta.brace"],
    style: { foreground: "#5F5F5F" }, // textMuted
  },
  // Import/export
  {
    scope: ["keyword.control.import", "keyword.control.export", "keyword.control.from"],
    style: { foreground: "#D7AFFF" }, // secondary purple
  },
  // Variables
  {
    scope: ["variable", "variable.other"],
    style: { foreground: "#FFFFFF" }, // text white
  },
  // Decorators
  {
    scope: ["meta.decorator", "punctuation.decorator"],
    style: { foreground: "#D7AFFF", italic: true }, // secondary purple italic
  },
];

let _instance: SyntaxStyle | null = null;

/** Lazy singleton — created once, reused across all markdown/code renders. */
export function getDoughSyntaxStyle(): SyntaxStyle {
  if (!_instance) {
    _instance = SyntaxStyle.fromTheme(DOUGH_THEME);
  }
  return _instance;
}

/** Call this to force a theme rebuild (e.g. after a theme change). */
export function invalidateDoughSyntaxStyle(): void {
  _instance = null;
}
