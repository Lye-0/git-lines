export function disposeAll(items: Iterable<{ dispose(): void }>): void {
  for (const item of items) item.dispose();
}
