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
 * Run an AppleScript by writing it to a temp file.
 * More reliable than -e for multi-line scripts with special characters.
 */
async function runAppleScript(script: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const scriptPath = `/tmp/dough-as-${Date.now()}.applescript`;
  await Bun.write(scriptPath, script);
  const proc = Bun.spawn(["osascript", scriptPath], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  // Clean up script file (best-effort)
  Bun.spawn(["rm", "-f", scriptPath]);
  return { exitCode: proc.exitCode ?? 1, stdout, stderr };
}

/**
 * macOS: use osascript to check clipboard type, then write bytes to a
 * temp file and read them back.
 *
 * Handles: PNG («class PNGf»), JPEG («class JPEG»), TIFF («class TIFF»).
 * TIFF is converted to PNG via `sips` (always available on macOS).
 */
async function macPasteImage(): Promise<Attachment | null> {
  // 1. Check what's on the clipboard
  const { stdout: info } = await runAppleScript('return clipboard info as string');

  const hasPng  = info.includes("PNGf");
  const hasJpeg = info.includes("JPEG") || info.includes("jpeg");
  const hasTiff = info.includes("TIFF") || info.includes("tiff");

  if (!hasPng && !hasJpeg && !hasTiff) return null;

  const ext = hasJpeg ? "jpg" : "png";
  const tmpRaw  = `/tmp/dough-paste-raw-${Date.now()}.${hasTiff && !hasPng ? "tiff" : ext}`;
  const tmpFinal = `/tmp/dough-paste-${Date.now()}.png`;

  // 2. Determine which clipboard class to read
  let classTag: string;
  let mimeType: Attachment["mimeType"];

  if (hasPng) {
    classTag = "«class PNGf»";
    mimeType = "image/png";
  } else if (hasJpeg) {
    classTag = "«class JPEG»";
    mimeType = "image/jpeg";
  } else {
    // TIFF only — we'll convert to PNG with sips
    classTag = "«class TIFF»";
    mimeType = "image/png";
  }

  // 3. Write clipboard bytes to temp file via AppleScript
  const writeScript = [
    `set tmpFile to "${tmpRaw}"`,
    `set fileRef to open for access POSIX file tmpFile with write permission`,
    `write (the clipboard as ${classTag}) to fileRef`,
    `close access fileRef`,
  ].join("\n");

  const { exitCode: writeExit } = await runAppleScript(writeScript);
  if (writeExit !== 0) return null;

  // 4. For TIFF, convert to PNG via sips (built into macOS)
  let readPath = tmpRaw;
  if (hasTiff && !hasPng && !hasJpeg) {
    const sips = Bun.spawn(["sips", "-s", "format", "png", tmpRaw, "--out", tmpFinal], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await sips.exited;
    if (sips.exitCode === 0) {
      readPath = tmpFinal;
    }
    // Clean up raw TIFF
    Bun.spawn(["rm", "-f", tmpRaw]);
  }

  // 5. Read file → base64
  try {
    const buf = await Bun.file(readPath).arrayBuffer();
    const data = Buffer.from(buf).toString("base64");
    // Clean up temp files (best-effort)
    Bun.spawn(["rm", "-f", readPath, tmpFinal]);
    if (buf.byteLength === 0) return null;
    const name = `paste-${Date.now()}.png`;
    return { type: "image", mimeType, data, name };
  } catch {
    return null;
  }
}

/**
 * Linux: try xclip (X11) then wl-paste (Wayland).
 */
async function linuxPasteImage(): Promise<Attachment | null> {
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
