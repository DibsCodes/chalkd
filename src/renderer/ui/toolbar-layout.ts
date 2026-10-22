import type { ToolbarPosition } from '../../shared/types';

export type PopoverSide = 'below' | 'above' | 'left' | 'right';

/** Popovers opened from the toolbar open toward the board. */
export const POPOVER_SIDE: Record<ToolbarPosition, PopoverSide> = {
  top: 'below',
  bottom: 'above',
  left: 'right',
  right: 'left',
};

export const isVertical = (position: ToolbarPosition): boolean =>
  position === 'left' || position === 'right';

/**
 * Share `slots` toolbar places between pens and highlighters, a pen then a
 * highlighter in turn, so a crowded toolbar trims both groups evenly. Each
 * group always keeps at least one, even if that's more than `slots`.
 */
export function splitSlots(
  slots: number,
  pens: number,
  highlighters: number,
): [number, number] {
  let p = Math.min(1, pens);
  let h = Math.min(1, highlighters);
  for (
    let left = slots - p - h;
    left > 0 && (p < pens || h < highlighters);
    left--
  ) {
    if (p < pens && (p <= h || h >= highlighters)) p++;
    else h++;
  }
  return [p, h];
}

/**
 * The first `count` presets, except that the selected one always shows: if
 * it falls past the cut it takes the last place.
 */
export function visiblePresets<T extends { id: string }>(
  list: T[],
  count: number,
  selectedId: string | null,
): T[] {
  if (count >= list.length) return list;
  const shown = list.slice(0, count);
  const selected = list.find((p) => p.id === selectedId);
  if (selected && !shown.includes(selected)) shown[count - 1] = selected;
  return shown;
}
