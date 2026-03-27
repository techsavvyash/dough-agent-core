/**
 * useClipboard — reads an image from the OS clipboard.
 *
 * Terminal apps have no DOM clipboard API, so we shell out to OS-native tools:
 *   macOS  → osascript  (always available)
 *   Linux  → xclip  (X11)  or  wl-paste  (Wayland)
 *
 * Returns a function `pasteImage()` that resolves with an Attachment when the
 * clipboard contains an image, or null when it doesn't (or on error).
 */

import type { Attachment } from "@dough/protocol";

const platform = process.platform; // "darwin" | "linux" | "win32" | …

/**
 * macOS: use osascript to check clipboard type, then write PNG bytes to a
 * temp file and read them back.  pngpaste is not assumed to be installed.
 */
async function macPasteImage(): Promise<Attachment | null> {
  // 1. Check what's on the clipboard
  const checkProc = Bun.spawn(
    ["osascript", "-e", "clipboard info"],
    { stdout: "pipe", stderr: "pipe" }
  );
  await checkProc.exited;
  const info = await new Response(checkProc.stdout).text();

  const hasPng  = info.includes("PNGf");
  const hasJpeg = info.includes("JPEG");
  if (!hasPng && !hasJpeg) return null;

  const mimeType: Attachment["mimeType"] = hasJpeg ? "image/jpeg" : "image/png";
  const classTag = hasJpeg ? "«class JPEG»" : "«class PNGf»";
  const ext      = hasJpeg ? "jpg" : "png";
  const tmpPath  = `/tmp/dough-paste-${Date.now()}.${ext}`;

  // 2. Write clipboard bytes to temp file via AppleScript
  const script = [
    `set tmpFile to "${tmpPath}"`,
    `set fileRef to open for access POSIX file tmpFile with write permission`,
    `write (the clipboard as ${classTag}) to fileRef`,
    `close access fileRef`,
  ].join("\n");

  const writeProc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await writeProc.exited;

  if (writeProc.exitCode !== 0) return null;

  // 3. Read file → base64
  try {
    const buf = await Bun.file(tmpPath).arrayBuffer();
    const data = Buffer.from(buf).toString("base64");
    // Clean up temp file (best-effort)
    Bun.spawn(["rm", "-f", tmpPath]);
    const name = `paste-${Date.now()}.${ext}`;
    return { type: "image", mimeType, data, name };
  } catch {
    return null;
  }
}

/**
 * Linux: try xclip (X11) then wl-paste (Wayland).
 */
async function linuxPasteImage(): Promise<Attachment | null> {
  const tmpPath = `/tmp/dough-paste-${Date.now()}.png`;

  // Try X11 first
  const x11 = Bun.spawn(
    ["xclip", "-selection", "clipboard", "-t", "image/png", "-o"],
    { stdout: "pipe", stderr: "pipe" }
  );
  await x11.exited;

  if (x11.exitCode === 0) {
    const buf = await new Response(x11.stdout).arrayBuffer();
    if (buf.byteLength > 0) {
      const data = Buffer.from(buf).toString("base64");
      return { type: "image", mimeType: "image/png", data, name: `paste-${Date.now()}.png` };
    }
  }

  // Try Wayland
  const wl = Bun.spawn(
    ["wl-paste", "--type", "image/png"],
    { stdout: "pipe", stderr: "pipe" }
  );
  await wl.exited;

  if (wl.exitCode === 0) {
    const buf = await new Response(wl.stdout).arrayBuffer();
    if (buf.byteLength > 0) {
      const data = Buffer.from(buf).toString("base64");
      return { type: "image", mimeType: "image/png", data, name: `paste-${Date.now()}.png` };
    }
  }

  return null;
}

/**
 * Attempt to read an image from the clipboard.
 * Returns the Attachment if an image is present, null otherwise.
 */
export async function pasteImageFromClipboard(): Promise<Attachment | null> {
  try {
    if (platform === "darwin") return await macPasteImage();
    if (platform === "linux")  return await linuxPasteImage();
    // Windows / other: not yet supported
    return null;
  } catch {
    return null;
  }
}
