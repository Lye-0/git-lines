import { afterEach, expect, it, vi } from 'vitest';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

const compiled = buildSync({ entryPoints: ['webview/src/App.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] }).outputFiles[0].text;
afterEach(() => vi.unstubAllGlobals());

it.each(['standard', 'sidebar'])('preserves and refreshes selected details across graph updates (%s)', presentation => {
  const values: unknown[] = []; let cursor = 0;
  const effects: (() => unknown)[] = [];
  const hooks = {
    useState: (initial: unknown) => { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], (value: unknown) => { values[i] = value; }]; },
    useRef: (initial: unknown) => { const i = cursor++; return values[i] ??= { current: initial }; },
    useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => unknown, deps: unknown[]) => { const i = cursor++; if (!(i in values)) { values[i] = deps; effects.push(fn); } },
  };
  const postMessage = vi.fn(); let receive!: (event: { data: unknown }) => void;
  vi.stubGlobal('window', { acquireVsCodeApi: () => ({ postMessage }), addEventListener: (_: string, fn: typeof receive) => { receive = fn; }, removeEventListener: vi.fn() });
  const realRequire = createRequire(path.join(process.cwd(), 'package.json'));
  const mod = { exports: {} as { App: () => any } };
  new Function('require', 'module', 'exports', compiled)((id: string) => id === 'react' ? hooks : realRequire(id), mod, mod.exports);
  const render = () => { cursor = 0; const tree = mod.exports.App(); effects.splice(0).forEach(fn => fn()); return tree; };
  const find = (tree: any, name: string): any => {
    if (!tree) return undefined;
    if (Array.isArray(tree)) return tree.map(x => find(x, name)).find(Boolean);
    return tree.type?.name === name ? tree : find(tree.props?.children, name);
  };
  const graph: any = { type: 'graph', presentation, repository: { root: 'A' }, layout: { nodes: [{ id: 'commit:abc', oid: 'abc', kind: 'commit', commit: {} }], tracks: [], historyRelations: [] } };
  render(); receive({ data: graph }); let tree = render();
  find(tree, 'GraphViewport').props.onSelect('abc');
  receive({ data: { type: 'detail', detail: { oid: 'abc', files: [] } } }); tree = render();
  expect(find(tree, 'DetailPanel')).toBeTruthy();
  receive({ data: { type: 'loading', loading: true } });
  receive({ data: graph }); tree = render();
  expect(find(tree, 'GraphViewport').props.selected).toBe('abc');
  expect(find(tree, 'DetailPanel').props.detail.oid).toBe('abc');
  expect(postMessage).toHaveBeenLastCalledWith({ type: 'select', oid: 'abc' });
  receive({ data: { ...graph, repository: { root: 'B' } } }); tree = render();
  expect(find(tree, 'DetailPanel')).toBeUndefined();
  receive({ data: { type: 'detail', detail: { oid: 'abc', files: [] } } });
  expect(find(render(), 'DetailPanel')).toBeUndefined();
});
