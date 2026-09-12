import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { sidebarPopoverPosition } from './sidebarPresentation';

export function SidebarDetailPopover({ anchor, onClose, children }: { anchor: { top: number; bottom: number }; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState(() => sidebarPopoverPosition(anchor.top, anchor.bottom, window.innerHeight));
  useLayoutEffect(() => {
    const update = () => setPosition(sidebarPopoverPosition(anchor.top, anchor.bottom, window.innerHeight));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [anchor]);
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close.current(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); opener?.focus(); }
    };
    const blur = () => close.current();
    const scroll = (event: Event) => { if (event.target instanceof Element && event.target.matches('.graph-scroll')) close.current(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keyboard);
    window.addEventListener('blur', blur);
    document.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keyboard);
      window.removeEventListener('blur', blur);
      document.removeEventListener('scroll', scroll, true);
    };
  }, []);
  return <div ref={ref} role="dialog" aria-label="Git Lines details" tabIndex={-1}
    className={`sidebar-popover${position.upwards ? ' opens-up' : ''}`} style={{ top: position.top, maxHeight: position.maxHeight }}><div className="sidebar-popover-content">{children}</div></div>;
}
