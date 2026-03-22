import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ThreadMeta, ThreadOrigin } from "@dough/protocol";
import { colors, symbols, hrule } from "../theme.ts";

interface ThreadViewerProps {
  threads: ThreadMeta[];
  activeThreadId: string;
  onClose: () => void;
  /** Called when the user presses R to resume a thread */
  onSwitch?: (thread: ThreadMeta) => void;
}

/** A node in the visual thread tree */
interface TreeNode {
  thread: ThreadMeta;
  depth: number;
  children: TreeNode[];
  isLast: boolean;
}

/** A flat list item — either a session header or a thread row */
type ListItem =
  | { kind: "session_header"; sessionId: string; createdAt: string; count: number; title?: string }
  | { kind: "thread"; node: TreeNode };

/**
 * Full-screen thread viewer overlay.
 * Shows all threads grouped by session, with origin tree, token bars, and summaries.
 * R to switch to a thread (may cross sessions), Enter for detail panel.
 */
export function ThreadViewer({
  threads,
  activeThreadId,
  onClose,
  onSwitch,
}: ThreadViewerProps) {
  const { width } = useTerminalDimensions();
  const [showDetail, setShowDetail] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  // Build flat grouped list — session headers + thread nodes
  const items = buildGroupedList(threads);

  // Start selection on the first actual thread row (index 0 is always a session header)
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const first = items.findIndex((it) => it.kind === "thread");
    return first >= 0 ? first : 0;
  });

  // Only thread items are navigable
  const navigable = items.filter((it): it is Extract<ListItem, { kind: "thread" }> => it.kind === "thread");
  const selectedItem = items[selectedIndex];
  const selectedThread =
    selectedItem?.kind === "thread" ? selectedItem.node.thread : null;

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (showDetail) {
        setShowDetail(false);
      } else {
        onClose();
      }
    } else if (key.name === "up" || key.name === "k") {
      // Skip over session headers when navigating
      setSelectedIndex((i: number) => {
        let next = i - 1;
        while (next >= 0 && items[next]?.kind === "session_header") next--;
        return next >= 0 ? next : i;
      });
    } else if (key.name === "down" || key.name === "j") {
      setSelectedIndex((i: number) => {
        let next = i + 1;
        while (next < items.length && items[next]?.kind === "session_header") next++;
        return next < items.length ? next : i;
      });
    } else if (key.name === "return") {
      if (selectedThread) setShowDetail(!showDetail);
    } else if ((key.name === "r" || key.name === "R") && selectedThread && onSwitch) {
      setSwitching(selectedThread.id);
      onSwitch(selectedThread);
    }
  });

  const rule = hrule(width);

  if (navigable.length === 0) {
    return (
      <box flexDirection="column" height="100%">
        <box height={1}>
          <text fg={colors.border}>{rule}</text>
        </box>
        <box paddingX={2} flex={1}>
          <text fg={colors.textMuted}>No threads found. Start a conversation first.</text>
        </box>
        <box height={1} paddingX={2}>
          <text fg={colors.textMuted}>Press Esc to close</text>
        </box>
      </box>
    );
  }

  const detailWidth = showDetail ? Math.min(52, Math.floor(width * 0.42)) : 0;
  const sessionCount = new Set(threads.map((t) => t.sessionId)).size;

  return (
    <box flexDirection="column" height="100%">
      {/* Header */}
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>
      <box height={1} paddingX={2} flexDirection="row">
        <text fg={colors.primary}>{"All Threads  "}</text>
        <text fg={colors.accent}>{`${threads.length} threads `}</text>
        <text fg={colors.textMuted}>{`across ${sessionCount} session${sessionCount !== 1 ? "s" : ""}  `}</text>
        <text fg={colors.textDim}>{"(↑↓/jk navigate, Enter details, R resume, Esc close)"}</text>
      </box>
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>

      {/* Main content */}
      <box flex={1} flexDirection="row">
        {/* Thread list with session groups */}
        <scrollbox flex={1} focused>
          <box flexDirection="column" paddingX={1}>
            {items.map((item, i) => {
              if (item.kind === "session_header") {
                return (
                  <SessionHeader
                    key={`session-${item.sessionId}`}
                    sessionId={item.sessionId}
                    createdAt={item.createdAt}
                    count={item.count}
                    title={item.title}
                  />
                );
              }
              const isSelected = i === selectedIndex;
              const isActive = item.node.thread.id === activeThreadId;
              const isSwitching = item.node.thread.id === switching;
              return (
                <ThreadRow
                  key={item.node.thread.id}
                  node={item.node}
                  isSelected={isSelected}
                  isActive={isActive}
                  isSwitching={isSwitching}
                />
              );
            })}
          </box>
        </scrollbox>

        {/* Detail panel */}
        {showDetail && selectedThread && (
          <box width={detailWidth} flexDirection="column" paddingX={1}>
            <ThreadDetail
              thread={selectedThread}
              isActive={selectedThread.id === activeThreadId}
              onSwitch={onSwitch}
            />
          </box>
        )}
      </box>

      {/* Footer */}
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>
      <box height={1} paddingX={2} flexDirection="row" gap={3}>
        <text fg={colors.success}>{"● active"}</text>
        <text fg={colors.warning}>{"● full"}</text>
        <text fg={colors.textMuted}>{"● archived"}</text>
        <text fg={colors.textDim}>{"  "}</text>
        <text fg={colors.accent}>{"→ handoff"}</text>
        <text fg={colors.secondary}>{"⑂ fork"}</text>
        <text fg={colors.primary}>{"○ root"}</text>
        {onSwitch && <text fg={colors.textDim}>{"  R=resume thread"}</text>}
      </box>
    </box>
  );
}

/** Session group divider shown before each session's threads */
function SessionHeader({
  sessionId,
  createdAt,
  count,
  title,
}: {
  sessionId: string;
  createdAt: string;
  count: number;
  title?: string;
}) {
  const shortId = sessionId.slice(0, 8);
  const date = formatDate(createdAt);
  // Show session title (from root thread's first prompt) if available,
  // otherwise fall back to the truncated session ID.
  const label = title ? truncate(title, 48) : shortId;
  return (
    <box height={1} flexDirection="row" marginTop={1}>
      <text fg={colors.textDim}>{"  ── "}</text>
      <text fg={colors.primary}>{label}</text>
      <text fg={colors.textDim}>{`  ${date}  `}</text>
      <text fg={colors.textDim}>{`${count} thread${count !== 1 ? "s" : ""}  ──`}</text>
    </box>
  );
}

/** Render a single row in the thread tree */
function ThreadRow({
  node,
  isSelected,
  isActive,
  isSwitching,
}: {
  node: TreeNode;
  isSelected: boolean;
  isActive: boolean;
  isSwitching: boolean;
}) {
  const { thread } = node;
  const indent = buildIndent(node);
  const originIcon = getOriginIcon(thread.origin);
  const originColor = getOriginColor(thread.origin);
  const statusDot = "●";
  const statusColor = getStatusColor(thread.status);
  const indicator = isSelected ? `${symbols.userPrefix} ` : "  ";
  const idShort = thread.id.slice(0, 8);
  const tokenPct = Math.round((thread.tokenCount / thread.maxTokens) * 100);
  const tokenBar = renderTokenBar(tokenPct, 8);

  const nameColor = isSwitching
    ? colors.warning
    : isActive
      ? colors.primary
      : isSelected
        ? colors.text
        : colors.textDim;

  const suffix = isSwitching
    ? " (switching…)"
    : isActive
      ? " (active)"
      : "";

  const title = thread.summary ? truncate(thread.summary, 32) : null;

  return (
    <box height={1} flexDirection="row">
      <text fg={colors.accent}>{indicator}</text>
      <text fg={colors.textMuted}>{indent}</text>
      <text fg={originColor}>{originIcon} </text>
      <text fg={statusColor}>{statusDot} </text>
      <text fg={nameColor}>{idShort}</text>
      {title && <text fg={colors.textDim}>{`  ${title}`}</text>}
      <text fg={nameColor}>{suffix}</text>
      <text fg={colors.textMuted}>{`  ${thread.messageCount}msg  `}</text>
      <text fg={tokenBarColor(tokenPct)}>{tokenBar}</text>
      <text fg={colors.textMuted}>{` ${tokenPct}%  `}</text>
      <text fg={colors.textDim}>{formatRelative(thread.updatedAt)}</text>
    </box>
  );
}

/** Render thread detail panel */
function ThreadDetail({
  thread,
  isActive,
  onSwitch,
}: {
  thread: ThreadMeta;
  isActive: boolean;
  onSwitch?: (t: ThreadMeta) => void;
}) {
  const originLabel = {
    root: "Root thread",
    handoff: "Handoff (context overflow)",
    fork: "Forked from parent",
  }[thread.origin];

  return (
    <box flexDirection="column">
      <box height={1}>
        <text fg={colors.primary}>{"─── Thread Detail ───"}</text>
      </box>
      <box height={1} />

      <DetailRow label="ID" value={thread.id} />
      <DetailRow label="Session" value={thread.sessionId.slice(0, 16)} />
      <DetailRow label="Status" value={thread.status} />
      <DetailRow label="Origin" value={originLabel} />
      {thread.parentThreadId && (
        <DetailRow label="Parent" value={thread.parentThreadId.slice(0, 8)} />
      )}
      <DetailRow label="Messages" value={String(thread.messageCount)} />
      <DetailRow
        label="Tokens"
        value={`${thread.tokenCount.toLocaleString()} / ${thread.maxTokens.toLocaleString()}`}
      />
      <DetailRow label="Created" value={formatAbsolute(thread.createdAt)} />
      <DetailRow label="Updated" value={formatAbsolute(thread.updatedAt)} />

      {isActive && (
        <box height={1} marginTop={1}>
          <text fg={colors.primary}>{"● Currently active"}</text>
        </box>
      )}
      {!isActive && onSwitch && (
        <box height={1} marginTop={1}>
          <text fg={colors.accent}>{"Press R to resume this thread"}</text>
        </box>
      )}

      {thread.summary && (
        <>
          <box height={1} />
          <box height={1}>
            <text fg={colors.accent}>{"Summary:"}</text>
          </box>
          <box>
            <text fg={colors.textDim} wrapMode="word">
              {thread.summary.slice(0, 300)}
            </text>
          </box>
        </>
      )}
    </box>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <box height={1} flexDirection="row">
      <text fg={colors.textMuted}>{`${label}: `}</text>
      <text fg={colors.text}>{value}</text>
    </box>
  );
}

// ── Tree building ────────────────────────────────────────────

/**
 * Group threads by session (sorted by session createdAt), then build a
 * depth-first tree within each session.  Returns a flat list of items
 * (session headers interleaved with thread rows).
 */
function buildGroupedList(threads: ThreadMeta[]): ListItem[] {
  if (threads.length === 0) return [];

  // Group by sessionId, preserving earliest thread creation per session
  const sessionMap = new Map<string, ThreadMeta[]>();
  for (const t of threads) {
    const group = sessionMap.get(t.sessionId) ?? [];
    group.push(t);
    sessionMap.set(t.sessionId, group);
  }

  // Sort sessions by the earliest thread in each group
  const sessionOrder = Array.from(sessionMap.keys()).sort((a, b) => {
    const aMin = Math.min(...(sessionMap.get(a) ?? []).map((t) => new Date(t.createdAt).getTime()));
    const bMin = Math.min(...(sessionMap.get(b) ?? []).map((t) => new Date(t.createdAt).getTime()));
    return bMin - aMin; // newest session first
  });

  const result: ListItem[] = [];

  for (const sessionId of sessionOrder) {
    const group = sessionMap.get(sessionId) ?? [];
    const flatNodes = buildFlatTree(group);

    // Use the earliest thread's createdAt as the session's creation date
    const sessionCreatedAt = group.reduce(
      (min, t) => (t.createdAt < min ? t.createdAt : min),
      group[0]?.createdAt ?? new Date().toISOString()
    );

    // Use the root thread's summary as the session display title.
    const rootThread = group
      .filter((t) => !t.parentThreadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

    result.push({
      kind: "session_header",
      sessionId,
      createdAt: sessionCreatedAt,
      count: group.length,
      title: rootThread?.summary,
    });

    for (const node of flatNodes) {
      result.push({ kind: "thread", node });
    }
  }

  return result;
}

function buildFlatTree(threads: ThreadMeta[]): TreeNode[] {
  if (threads.length === 0) return [];

  const childrenMap = new Map<string, ThreadMeta[]>();
  const roots: ThreadMeta[] = [];

  for (const t of threads) {
    if (!t.parentThreadId) {
      roots.push(t);
    } else {
      const siblings = childrenMap.get(t.parentThreadId) ?? [];
      siblings.push(t);
      childrenMap.set(t.parentThreadId, siblings);
    }
  }

  const byCreated = (a: ThreadMeta, b: ThreadMeta) =>
    a.createdAt.localeCompare(b.createdAt);
  roots.sort(byCreated);
  for (const children of childrenMap.values()) {
    children.sort(byCreated);
  }

  const flat: TreeNode[] = [];

  function walk(thread: ThreadMeta, depth: number, isLast: boolean) {
    const childThreads = childrenMap.get(thread.id) ?? [];
    const children = childThreads.map((child, i, arr) => ({
      thread: child,
      depth: depth + 1,
      children: [],
      isLast: i === arr.length - 1,
    }));
    const node: TreeNode = { thread, depth, children, isLast };
    flat.push(node);
    for (const child of children) {
      walk(child.thread, depth + 1, child.isLast);
    }
  }

  for (let i = 0; i < roots.length; i++) {
    walk(roots[i]!, 0, i === roots.length - 1);
  }

  return flat;
}

function buildIndent(node: TreeNode): string {
  if (node.depth === 0) return "";
  const connector = node.isLast ? "└─" : "├─";
  const padding = "│ ".repeat(Math.max(0, node.depth - 1));
  return padding + connector;
}

/** Truncate a string to maxLen chars, appending … if cut */
function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}

// ── Visual helpers ───────────────────────────────────────────

function getOriginIcon(origin: ThreadOrigin): string {
  switch (origin) {
    case "root":
      return "○";
    case "handoff":
      return "→";
    case "fork":
      return "⑂";
  }
}

function getOriginColor(origin: ThreadOrigin): string {
  switch (origin) {
    case "root":
      return colors.primary;
    case "handoff":
      return colors.accent;
    case "fork":
      return colors.secondary;
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "active":
      return colors.success;
    case "full":
      return colors.warning;
    case "archived":
      return colors.textMuted;
    default:
      return colors.textDim;
  }
}

function renderTokenBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function tokenBarColor(pct: number): string {
  if (pct >= 90) return colors.error;
  if (pct >= 70) return colors.warning;
  return colors.success;
}

/** "2h ago", "3d ago", "just now" */
function formatRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

/** "Today 14:32" or "Mar 18 14:32" */
function formatAbsolute(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return `Today ${time}`;
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
  } catch {
    return iso;
  }
}

/** "Mar 22" or "Today" for session headers */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (isToday) return "today";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
