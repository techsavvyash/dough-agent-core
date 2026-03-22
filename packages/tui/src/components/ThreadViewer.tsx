import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ThreadMeta, ThreadOrigin } from "@dough/protocol";
import { colors, symbols, hrule } from "../theme.ts";

interface ThreadViewerProps {
  threads: ThreadMeta[];
  activeThreadId: string;
  onClose: () => void;
}

/** A node in the visual thread tree */
interface TreeNode {
  thread: ThreadMeta;
  depth: number;
  children: TreeNode[];
  isLast: boolean;
}

/**
 * Full-screen thread viewer overlay.
 * Shows a tree of all threads with their relationships,
 * status, token usage, and summaries.
 */
export function ThreadViewer({
  threads,
  activeThreadId,
  onClose,
}: ThreadViewerProps) {
  const { width, height } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);

  // Build a flat list from the tree for navigation
  const flatNodes = buildFlatTree(threads);

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (showDetail) {
        setShowDetail(false);
      } else {
        onClose();
      }
    } else if (key.name === "up" || key.name === "k") {
      setSelectedIndex((i) => (i > 0 ? i - 1 : flatNodes.length - 1));
    } else if (key.name === "down" || key.name === "j") {
      setSelectedIndex((i) => (i < flatNodes.length - 1 ? i + 1 : 0));
    } else if (key.name === "return") {
      setShowDetail(!showDetail);
    }
  });

  const rule = hrule(width);
  const selectedNode = flatNodes[selectedIndex];

  if (flatNodes.length === 0) {
    return (
      <box flexDirection="column" height="100%">
        <box height={1}>
          <text fg={colors.border}>{rule}</text>
        </box>
        <box paddingX={2} flex={1}>
          <text fg={colors.textMuted}>No threads in this session.</text>
        </box>
        <box height={1} paddingX={2}>
          <text fg={colors.textMuted}>Press Esc to close</text>
        </box>
      </box>
    );
  }

  // Split view when detail is shown
  const detailWidth = showDetail ? Math.min(50, Math.floor(width * 0.4)) : 0;

  return (
    <box flexDirection="column" height="100%">
      {/* Header */}
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>
      <box height={1} paddingX={2} flexDirection="row">
        <text fg={colors.primary}>{"Threads "}</text>
        <text fg={colors.accent}>{`${threads.length} total `}</text>
        <text fg={colors.textMuted}>
          {"  (↑↓/jk navigate, Enter details, Esc close)"}
        </text>
      </box>
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>

      {/* Main content */}
      <box flex={1} flexDirection="row">
        {/* Thread tree */}
        <scrollbox flex={1} focused>
          <box flexDirection="column" paddingX={1}>
            {flatNodes.map((node, i) => {
              const isSelected = i === selectedIndex;
              const isActive = node.thread.id === activeThreadId;
              return (
                <ThreadRow
                  key={node.thread.id}
                  node={node}
                  isSelected={isSelected}
                  isActive={isActive}
                />
              );
            })}
          </box>
        </scrollbox>

        {/* Detail panel */}
        {showDetail && selectedNode && (
          <box width={detailWidth} flexDirection="column" paddingX={1}>
            <ThreadDetail
              thread={selectedNode.thread}
              isActive={selectedNode.thread.id === activeThreadId}
            />
          </box>
        )}
      </box>

      {/* Footer — legend */}
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>
      <box height={1} paddingX={2} flexDirection="row" gap={2}>
        <text fg={colors.success}>{"● active "}</text>
        <text fg={colors.warning}>{"● full "}</text>
        <text fg={colors.textMuted}>{"● archived "}</text>
        <text fg={colors.textDim}>{"  "}</text>
        <text fg={colors.accent}>{"→ handoff "}</text>
        <text fg={colors.secondary}>{"⑂ fork "}</text>
        <text fg={colors.primary}>{"○ root"}</text>
      </box>
    </box>
  );
}

/** Render a single row in the thread tree */
function ThreadRow({
  node,
  isSelected,
  isActive,
}: {
  node: TreeNode;
  isSelected: boolean;
  isActive: boolean;
}) {
  const { thread, depth } = node;
  const indent = buildIndent(node);
  const originIcon = getOriginIcon(thread.origin);
  const originColor = getOriginColor(thread.origin);
  const statusDot = getStatusDot(thread.status);
  const statusColor = getStatusColor(thread.status);
  const indicator = isSelected ? `${symbols.userPrefix} ` : "  ";
  const idShort = thread.id.slice(0, 8);

  const tokenPct = Math.round((thread.tokenCount / thread.maxTokens) * 100);
  const tokenBar = renderTokenBar(tokenPct, 10);

  const nameColor = isActive
    ? colors.primary
    : isSelected
      ? colors.text
      : colors.textDim;

  return (
    <box height={1} flexDirection="row">
      <text fg={colors.accent}>{indicator}</text>
      <text fg={colors.textMuted}>{indent}</text>
      <text fg={originColor}>{originIcon} </text>
      <text fg={statusColor}>{statusDot} </text>
      <text fg={nameColor}>{idShort}</text>
      {isActive && <text fg={colors.primary}>{" (active)"}</text>}
      <text fg={colors.textMuted}>{`  ${thread.messageCount} msgs  `}</text>
      <text fg={tokenBarColor(tokenPct)}>{tokenBar}</text>
      <text fg={colors.textMuted}>{` ${tokenPct}%`}</text>
    </box>
  );
}

/** Render thread detail panel */
function ThreadDetail({
  thread,
  isActive,
}: {
  thread: ThreadMeta;
  isActive: boolean;
}) {
  const originLabel = {
    root: "Root thread",
    handoff: "Handoff from parent",
    fork: "Forked from parent",
  }[thread.origin];

  return (
    <box flexDirection="column">
      <box height={1}>
        <text fg={colors.primary}>{"Thread Detail"}</text>
      </box>
      <box height={1} />

      <DetailRow label="ID" value={thread.id} />
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
      <DetailRow label="Created" value={formatTime(thread.createdAt)} />
      <DetailRow label="Updated" value={formatTime(thread.updatedAt)} />
      {isActive && (
        <box height={1}>
          <text fg={colors.primary}>{"● Currently active"}</text>
        </box>
      )}

      {thread.summary && (
        <>
          <box height={1} />
          <box height={1}>
            <text fg={colors.accent}>{"Summary:"}</text>
          </box>
          <box>
            <text fg={colors.textDim}>{thread.summary.slice(0, 200)}</text>
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

function buildFlatTree(threads: ThreadMeta[]): TreeNode[] {
  if (threads.length === 0) return [];

  // Build adjacency map: parentId → children
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

  // Sort roots and children by creation time
  const byCreated = (a: ThreadMeta, b: ThreadMeta) =>
    a.createdAt.localeCompare(b.createdAt);
  roots.sort(byCreated);
  for (const children of childrenMap.values()) {
    children.sort(byCreated);
  }

  // DFS to build flat list
  const flat: TreeNode[] = [];

  function walk(thread: ThreadMeta, depth: number, isLast: boolean) {
    const children = (childrenMap.get(thread.id) ?? []).map((child, i, arr) =>
      ({ thread: child, depth: depth + 1, children: [], isLast: i === arr.length - 1 })
    );
    const node: TreeNode = { thread, depth, children, isLast };
    flat.push(node);
    for (const child of children) {
      walk(child.thread, depth + 1, child.isLast);
    }
  }

  for (let i = 0; i < roots.length; i++) {
    walk(roots[i], 0, i === roots.length - 1);
  }

  return flat;
}

function buildIndent(node: TreeNode): string {
  if (node.depth === 0) return "";
  const connector = node.isLast ? "└─" : "├─";
  const padding = "│ ".repeat(Math.max(0, node.depth - 1));
  return padding + connector;
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

function getStatusDot(status: string): string {
  return "●";
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

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
