/** Sizes match the sidebar badge CSS; overflowWidth is measured with the active font. */
export function sidebarRefMode(count: number, available: number, fullWidth: number, overflowWidth: number, nameAvailable = available) {
  if (fullWidth <= Math.min(available, nameAvailable)) return { mode: 'names' as const, visible: count };
  const iconWidth = 20, gap = 4;
  if (count * iconWidth + Math.max(0, count - 1) * gap <= available) return { mode: 'icons' as const, visible: count };
  let visible = Math.max(0, Math.min(count - 1, Math.floor((available - overflowWidth) / (iconWidth + gap))));
  while (visible > 0 && visible * (iconWidth + gap) + overflowWidth > available) visible--;
  return { mode: 'icons' as const, visible };
}
