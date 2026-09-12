export function sidebarPopoverPosition(top: number, bottom: number, viewportHeight: number) {
  const below = Math.max(0, viewportHeight - bottom - 12);
  const above = Math.max(0, top - 12);
  const upwards = below < 240 && above > below;
  const height = Math.max(0, Math.min(480, Math.max(80, upwards ? above : below), viewportHeight - 16));
  return { top: Math.max(8, Math.min(upwards ? top - height - 6 : bottom + 6, viewportHeight - height - 8)), maxHeight: height, upwards };
}
