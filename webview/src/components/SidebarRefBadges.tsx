import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { GraphRefBadge } from '../../../src/model/refDisplay';
import type { GraphTrack } from '../../../src/model/graphModel';
import { sidebarRefMode } from './sidebarRefPresentation';

export function RefKindIcon({ kind }: { kind: GraphRefBadge['kind'] }) {
  return <svg className="sidebar-ref-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === 'remote' ? <path d="M4.2 12.5h7.6a2.7 2.7 0 0 0 .3-5.4 4.3 4.3 0 0 0-8.3-1 3.2 3.2 0 0 0 .4 6.4Z" />
      : kind === 'tag' ? <><path d="M2 2.5h5.5l6 6-5 5-6.5-6Z" /><circle cx="5" cy="5" r=".7" /></>
      : <><rect x="3" y="2.5" width="10" height="8" rx="1" /><path d="M3 10.5 1.5 13h13L13 10.5M6.5 11.7h3" /></>}
  </svg>;
}

interface Props { badges: GraphRefBadge[]; ghosts: GraphRefBadge[]; tracks: GraphTrack[] }
export function SidebarRefBadges({ badges, ghosts, tracks }: Props) {
  const root = useRef<HTMLSpanElement>(null), measure = useRef<HTMLSpanElement>(null), overflowMeasure = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState({ mode: 'names' as 'names' | 'icons', visible: badges.length + ghosts.length, available: Number.MAX_SAFE_INTEGER });
  const items = [...badges.map(badge => ({ badge, ghost: false })), ...ghosts.map(badge => ({ badge, ghost: true }))];
  useLayoutEffect(() => {
    const heading = root.current?.parentElement;
    if (!heading || !measure.current || !overflowMeasure.current) return;
    const update = () => {
      const children = [...heading.children].filter(el => getComputedStyle(el).display !== 'none');
      const gap = parseFloat(getComputedStyle(heading).columnGap) || 0;
      const fixed = children.filter(el => el !== root.current && !el.classList.contains('subject')).reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
      // The message gets the remaining width and is shortened before refs.
      const overflowWidth = overflowMeasure.current!.getBoundingClientRect().width;
      const gaps = Math.max(0, children.length - 1) * gap;
      const minimum = Math.min(items.length === 1 ? 20 : overflowWidth, Math.max(0, heading.clientWidth - gaps));
      const subject = children.find(el => el.classList.contains('subject'));
      const messageMinimum = Math.min(18, subject?.scrollWidth ?? 18);
      const available = Math.max(minimum, heading.clientWidth - fixed - gaps - messageMinimum);
      // Switch names early enough to keep a useful message preview. Icons
      // still use the full ref budget, so this does not hide more refs.
      const nameAvailable = Math.max(0, heading.clientWidth - fixed - gaps - Math.min(80, subject?.scrollWidth ?? 80));
      const next = { ...sidebarRefMode(items.length, available, measure.current!.getBoundingClientRect().width, overflowWidth, nameAvailable), available };
      setDisplay(previous => previous.mode === next.mode && previous.visible === next.visible && previous.available === next.available ? previous : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(heading); observer.observe(measure.current); observer.observe(overflowMeasure.current);
    return () => observer.disconnect();
  }, [badges, ghosts, tracks]);
  const tooltip = ({ badge, ghost }: typeof items[number]) => `${ghost ? 'Previous ' : ''}${badge.fullName}${badge.isDefault ? ' · default' : ''}`;
  const renderBadge = (item: typeof items[number], icons: boolean) => {
    const { badge, ghost } = item;
    const track = tracks.find(t => t.refNames.includes(badge.fullName)) ?? (ghost ? tracks.find(t => t.family === badge.name) : undefined);
    return <span key={`${ghost ? 'old:' : ''}${badge.fullName}`} className={`ref-badge ref-badge-${badge.kind}${ghost ? ' ref-badge-ghost' : ''}${icons ? ' sidebar-ref-icon-only' : ''}${badge.isDefault ? ' default' : ''}`}
      style={{ '--badge-color': track?.color } as CSSProperties} title={tooltip(item)} role="img" aria-label={tooltip(item)}>
      {(icons || badge.kind === 'tag') && <RefKindIcon kind={badge.kind} />}
      {!icons && <span>{badge.name}{badge.isDefault ? ' · default' : ''}</span>}
    </span>;
  };
  const hidden = items.slice(display.visible);
  return <span ref={root} className="sidebar-ref-badges" data-mode={display.mode} style={{ maxWidth: display.available }}>
    {items.slice(0, display.visible).map(item => renderBadge(item, display.mode === 'icons'))}
    {hidden.length > 0 && <span className="ref-badge sidebar-ref-overflow" title={hidden.map(tooltip).join('\n')} role="img" aria-label={`${hidden.length} more refs: ${hidden.map(tooltip).join(', ')}`}>+{hidden.length}</span>}
    <span ref={measure} className="sidebar-ref-measure" aria-hidden="true">{items.map(item => renderBadge(item, false))}</span>
    <span ref={overflowMeasure} className="ref-badge sidebar-ref-overflow sidebar-ref-measure-overflow" aria-hidden="true">+{items.length}</span>
  </span>;
}
