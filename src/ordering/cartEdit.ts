import type { CartLine } from "./CartContext";
import type { OptionGroup } from "../data/menu";

/** Editing keeps one line's identity and never merges another customer's customization. */
export function replaceCartLine(lines: CartLine[], lineId: string, replacement: Omit<CartLine, "lineId">, held = false): CartLine[] {
  const original = lines.find(line => line.lineId === lineId);
  if (held || !original || original.itemName !== replacement.itemName || original.categoryId !== replacement.categoryId) return lines;
  if (!Number.isFinite(replacement.quantity) || replacement.quantity < 1 || !Number.isFinite(replacement.basePrice) || replacement.basePrice <= 0) return lines;
  const room = 100 - lines.filter(line => line.lineId !== lineId).reduce((sum, line) => sum + line.quantity, 0);
  if (room < 1) return lines;
  const quantity = Math.min(50, Math.floor(replacement.quantity), room);
  return lines.map(line => line.lineId === lineId ? { ...replacement, lineId, quantity } : line);
}

/** Only choices still offered are selected; their deltas are recomputed by the modal. */
export function initialEditSelections(groups: OptionGroup[], line?: CartLine) {
  return Object.fromEntries(groups.map((group, index) => [index, new Set(
    (line?.options ?? []).filter(option => option.group === group.group && group.choices.some(choice => choice.name === option.name)).map(option => option.name),
  )])) as Record<number, Set<string>>;
}
