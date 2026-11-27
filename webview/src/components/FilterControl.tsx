import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GraphMessage } from '../types';
import { filterRows, parseFilter, setFilterValues, type FilterKey } from './filterQuery';

export function FilterControl({ graph, value, onChange }: { graph?: GraphMessage; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 360 });
  const wrapper = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const query = useMemo(() => parseFilter(value), [value]);
  const rows = useMemo(() => graph ? filterRows(graph.layout) : [], [graph]);
  const branches = [...new Set([...rows.flatMap(row => row.branches), ...query.branch])].sort((a,b) => a.localeCompare(b));
  const count = query.branch.length + query.type.length + query.worktree.length;
  useLayoutEffect(() => {
    if (!open || !wrapper.current || !menu.current) return;
    const rect = wrapper.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 8, above = rect.top - 8;
    const upwards = below < Math.min(menu.current.scrollHeight, 240) && above > below;
    const maxHeight = Math.max(0, Math.min(620, upwards ? above - 6 : below - 6));
    setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top: upwards ? Math.max(8, rect.top - Math.min(menu.current.scrollHeight, maxHeight) - 6) : rect.bottom + 6, maxHeight });
  }, [open, value, graph, branchSearch]);
  useLayoutEffect(() => {
    if (!open) return;
    menu.current?.focus();
    const dismiss = () => setOpen(false);
    const outside = (event: Event) => { if (!menu.current?.contains(event.target as Node) && !wrapper.current?.contains(event.target as Node)) dismiss(); };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) dismiss(); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); dismiss(); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('wheel', scroll, { capture: true, passive: true });
    document.addEventListener('keydown', keyboard);
    window.addEventListener('blur', dismiss); window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('wheel', scroll, true); document.removeEventListener('keydown', keyboard);
      window.removeEventListener('blur', dismiss); window.removeEventListener('resize', dismiss);
    };
  }, [open]);
  useLayoutEffect(() => { setOpen(false); setBranchSearch(''); }, [graph?.repository.root]);
  const clearAll = () => { onChange(''); setBranchSearch(''); };
  const group = (key: FilterKey, title: string, options: Array<{value: string; label: string}>) => <fieldset className="filter-group">
    <legend>{title}</legend>
    {key === 'branch' && <input className="filter-branch-search" type="search" aria-label="Search branches" placeholder="Search branches" value={branchSearch} onChange={event => setBranchSearch(event.target.value)} />}
    <label className="filter-option"><input type="checkbox" checked={!query[key].length} onChange={() => onChange(setFilterValues(value, key, []))} /><span>All</span></label>
    <div className="filter-option-list" role="group" aria-label={`${title} choices`} key={key === 'branch' ? branchSearch : key}>
    {options.map(option => {
      const n = rows.filter(row => key === 'branch' ? row.branches.includes(option.value) : key === 'type' ? row.type === option.value : row.worktree.includes(option.value)).length;
      return <label className="filter-option" key={option.value}><input type="checkbox" checked={query[key].includes(option.value)} onChange={() => onChange(setFilterValues(value, key,
        query[key].includes(option.value) ? query[key].filter(v => v !== option.value) : [...query[key], option.value]))} />
        <span className="filter-option-label" title={option.label}>{option.label}</span>{key === 'branch' && graph?.currentBranch === option.value && <small>Current</small>}<small>{n || (key === 'branch' ? 'Unavailable' : 0)}</small></label>;
    })}
    {key === 'branch' && !options.length && <p className="filter-empty" role="status">No branches found</p>}
    </div>
  </fieldset>;
  return <div className="filter-label filter-control" ref={wrapper}>
    <input aria-label="Filter commits and branches" type="search" value={value} onChange={event => onChange(event.target.value)} placeholder="Filter commits or branches" />
    <div className="filter-controls">
      {value && <button type="button" className="filter-clear" aria-label="Clear all filters" title="Clear all filters" onClick={clearAll}>×</button>}
      <button ref={trigger} type="button" className={`filter-menu-trigger${count ? ' active' : ''}`} aria-label={`Filter options${count ? ` (${count})` : ''}`} title="Filter options" aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}>
        {count > 0 && <span className="filter-count">{count}</span>}<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
    {open && createPortal(<div id={menuId} ref={menu} className="filter-popover" role="dialog" aria-label="Filter options" tabIndex={-1} style={position}>
      <p className="filter-note">Loaded history only · Non-matches dimmed</p>
      {group('branch', 'Branch / Route', branches.filter(branch => branch.toLocaleLowerCase().includes(branchSearch.trim().toLocaleLowerCase())).map(branch => ({ value: branch, label: branch })))}
      {group('type', 'Type', [{value:'commit',label:'Commits'},{value:'working',label:'Working Tree'},{value:'operation',label:'Operations'}])}
      {group('worktree', 'Worktree', [{value:'linked',label:'Linked Worktree'},{value:'clean',label:'Clean'},{value:'detached',label:'Detached HEAD'}])}
      <button type="button" className="toolbar-button filter-reset" disabled={!value} onClick={clearAll}>Clear all</button>
    </div>, document.body)}
  </div>;
}
