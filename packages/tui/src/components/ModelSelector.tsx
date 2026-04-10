import { useState, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { getModelsForProvider } from "@dough/protocol";
import type { ModelInfo } from "@dough/protocol";
import { colors, symbols, hrule } from "../theme.ts";

interface ModelSelectorProps {
  provider: string;
  currentModel: string;
  onSelect: (modelId: string) => void;
  onClose: () => void;
}

const MAX_VISIBLE = 8;

export function ModelSelector({
  provider,
  currentModel,
  onSelect,
  onClose,
}: ModelSelectorProps) {
  const { width, height: termHeight } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [query, setQuery] = useState("");

  const allModels = getModelsForProvider(provider);

  // Filter models based on search query
  const filtered =
    query === ""
      ? allModels
      : allModels.filter(
          (m) =>
            m.name.toLowerCase().includes(query.toLowerCase()) ||
            m.id.toLowerCase().includes(query.toLowerCase()),
        );

  // Reset selection whenever the filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Pre-select the currently active model on mount
  useEffect(() => {
    const idx = allModels.findIndex((m) => m.id === currentModel);
    if (idx >= 0) setSelectedIndex(idx);
  }, []);

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (query.length > 0) {
        setQuery("");
      } else {
        onClose();
      }
    } else if (key.name === "up") {
      setSelectedIndex((i: number) =>
        i > 0 ? i - 1 : Math.max(0, filtered.length - 1),
      );
    } else if (key.name === "down") {
      setSelectedIndex((i: number) =>
        filtered.length === 0 ? 0 : i < filtered.length - 1 ? i + 1 : 0,
      );
    } else if (key.name === "return") {
      const model = filtered[selectedIndex];
      if (model) onSelect(model.id);
    } else if (key.name === "backspace") {
      setQuery((q: string) => q.slice(0, -1));
    } else if (
      key.sequence &&
      key.sequence.length === 1 &&
      !key.ctrl &&
      !key.meta &&
      key.sequence.charCodeAt(0) >= 32 &&
      key.sequence.charCodeAt(0) <= 126
    ) {
      setQuery((q: string) => q + key.sequence);
    }
  });

  const rule = hrule(width);
  const searchPrompt = `  ${symbols.userPrefix} ${query}${symbols.cursor}`;

  // Cap visible items
  const maxPaletteRows = Math.max(6, Math.floor(termHeight / 2));
  const maxItems = Math.min(MAX_VISIBLE, filtered.length, maxPaletteRows - 5);

  // Window the visible list around the selected index
  let startIdx = 0;
  if (filtered.length > maxItems) {
    startIdx = Math.max(
      0,
      Math.min(
        selectedIndex - Math.floor(maxItems / 2),
        filtered.length - maxItems,
      ),
    );
  }
  const visibleItems = filtered.slice(startIdx, startIdx + maxItems);
  const hasMore = filtered.length > maxItems;

  // Fixed height: separator(1) + title(1) + separator(1) + search(1) + separator(1) + items + hint(1) + separator(1)
  const paletteHeight = Math.min(maxItems, visibleItems.length || 1) + 7;

  return (
    <box flexDirection="column" height={paletteHeight}>
      <box height={1}>
        <text fg={colors.borderActive}>{rule}</text>
      </box>

      {/* Title */}
      <box height={1} paddingX={1} flexDirection="row">
        <text fg={colors.primary}>{"Model Selector"}</text>
        <text fg={colors.textMuted}>{`  (${provider})`}</text>
      </box>

      {/* Search bar */}
      <box height={1} paddingX={1}>
        <text fg={colors.accent}>
          {searchPrompt}
          {query === "" ? "  type to filter..." : ""}
        </text>
      </box>

      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>

      {/* Model list */}
      <box flexDirection="column">
        {filtered.length === 0 ? (
          <box height={1} paddingX={2}>
            <text fg={colors.textMuted}>{"no matching models"}</text>
          </box>
        ) : (
          visibleItems.map((model: ModelInfo, vi: number) => {
            const realIdx = startIdx + vi;
            const isSelected = realIdx === selectedIndex;
            const isCurrent = model.id === currentModel;
            const indicator = isSelected ? `${symbols.userPrefix} ` : "  ";
            const suffix = isCurrent ? "  *" : "";
            const positionInfo =
              isSelected && hasMore
                ? ` (${String(realIdx + 1)}/${String(filtered.length)})`
                : "";
            const label = `${indicator}${model.name}  ${model.id}${suffix}${positionInfo}`;
            const textColor = isSelected
              ? colors.primary
              : isCurrent
                ? colors.accent
                : colors.text;
            return (
              <box key={model.id} height={1}>
                <text fg={textColor}>{label}</text>
              </box>
            );
          })
        )}
      </box>

      {/* Footer hint */}
      <box height={1} paddingX={1}>
        <text fg={colors.textMuted}>
          {"  \u2191\u2193 navigate  \u00B7  Enter select  \u00B7  Esc close  \u00B7  * = active"}
        </text>
      </box>

      <box height={1}>
        <text fg={colors.borderActive}>{rule}</text>
      </box>
    </box>
  );
}
