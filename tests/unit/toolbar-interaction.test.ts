import { afterEach, expect, it, vi } from 'vitest';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

const source = buildSync({ entryPoints: ['webview/src/components/Toolbar.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom'] }).outputFiles[0].text;
afterEach(() => vi.unstubAllGlobals());
it('limits filter focus to the input and dismisses the legend on outside interaction', () => {
  const inside = {}, outside = {}, focus = vi.fn();
  const details = { open: true, contains: (target: unknown) => target === inside, querySelector: () => ({ focus }) };
  const listeners = new Map<string, (event: any) => void>();
  const effects: (() => () => void)[] = [];
  const dom = (prefix: string) => ({ addEventListener: (type: string, fn: any) => listeners.set(prefix + type, fn),
    removeEventListener: (type: string) => listeners.delete(prefix + type), querySelector: () => null });
  vi.stubGlobal('document', dom('document:')); vi.stubGlobal('window', dom('window:'));
  const realRequire = createRequire(path.join(process.cwd(), 'package.json'));
  const mod = { exports: {} as { Toolbar: (props: any) => any } };
  new Function('require', 'module', 'exports', source)((id: string) => id === 'react'
    ? { useRef: () => ({ current: details }), useLayoutEffect: (fn: () => () => void) => effects.push(fn) }
    : realRequire(id), mod, mod.exports);
  const toolbar = mod.exports.Toolbar({ loading: false, filter: '', onFilter: vi.fn() });
  const onLoadMore = vi.fn();
  const withMore = (loading: boolean) => mod.exports.Toolbar({ graph: { repository: { root: 'A' }, layout: { hasMore: true } }, loading, filter: '', onLoadMore }).props.children[1].props.children;
  const loadButton = withMore(false).find((child: any) => child?.props?.['aria-label'] === 'Load more commits');
  expect(loadButton.props.className).toContain('icon-button');
  expect(loadButton.props.disabled).toBe(false);
  loadButton.props.onClick(); expect(onLoadMore).toHaveBeenCalledOnce();
  const loadingButton = withMore(true).find((child: any) => child?.props?.['aria-label'] === 'Loading more commits');
  expect(loadingButton.props.disabled).toBe(true);
  expect(loadingButton.props['aria-busy']).toBe(true);
  expect(loadingButton.props.children.props.className).toBe('load-more-spinner');
  const actions = toolbar.props.children[1];
  expect(actions.props.children.some((child: any) => child?.props?.className?.includes('load-more-button'))).toBe(false);
  const filter = actions.props.children[0];
  expect(filter.type.name).toBe('FilterControl');
  expect(filter.props.value).toBe('');
  expect(filter.props.onChange).toBeTypeOf('function');
  const legend = actions.props.children.find((child: any) => child?.type?.name === 'GraphLegend');
  legend.type(); const cleanup = effects[0]();
  for (const kind of ['pointerdown', 'scroll', 'wheel']) {
    details.open = true;
    listeners.get('document:' + kind)!({ target: inside }); expect(details.open).toBe(true);
    listeners.get('document:' + kind)!({ target: outside }); expect(details.open).toBe(false);
  }
  details.open = true;
  listeners.get('document:keydown')!({ key: 'Escape', preventDefault: vi.fn() });
  expect(details.open).toBe(false); expect(focus).toHaveBeenCalledOnce();
  details.open = true; listeners.get('window:blur')!({}); expect(details.open).toBe(false);
  cleanup(); expect(listeners.size).toBe(0);
});
