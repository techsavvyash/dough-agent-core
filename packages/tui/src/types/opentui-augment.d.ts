/**
 * Module augmentation for @opentui/core.
 *
 * OpenTUI supports several shorthand props at runtime (via the layout engine
 * and renderer) that are missing from its published TypeScript types.  We
 * declare them here so the codebase can use them without type errors.
 *
 * IMPORTANT: This file must be a TypeScript MODULE (not a script) so that
 * `declare module "@opentui/core" { ... }` is treated as an AUGMENTATION of
 * the existing module rather than a brand-new ambient module declaration.
 * A file is a module when it contains at least one top-level import or export.
 * The `export {}` below serves exactly that purpose.
 */
export {};

declare module "@opentui/core" {
  /**
   * `flex` is a shorthand for `flexGrow` processed by the OpenTUI Yoga layout
   * engine.  It propagates through RenderableOptions → all component option
   * types (BoxOptions, ScrollBoxOptions, TextOptions, DiffRenderableOptions…).
   * LayoutOptions is non-generic so it is safe to augment.
   */
  interface LayoutOptions {
    flex?: number;
  }
}
