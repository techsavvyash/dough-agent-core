/**
 * Re-export from @dough/core where FileTracker now lives.
 * Kept for backward compatibility within @dough/server.
 */
export { FileTracker } from "@dough/core/src/runtime/file-tracker.ts";
export type { FileTrackerPersistence, FileTrackerOptions } from "@dough/core/src/runtime/file-tracker.ts";
