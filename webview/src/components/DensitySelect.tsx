import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const choices = [
  { value: 'compact', label: 'Compact', description: 'More commits in view' },
  { value: 'comfortable', label: 'Comfortable', description: 'More space between commits' },
] as const;

export function DensitySelect({ value, onChange }: { value: 'compact' | 'comfortable'; onChange: (value: 'compact' | 'comfortable') => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const options = useRef<Array<HTMLDivElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current!.getBoundingClientRect();
    const height = menu.current!.offsetHeight;
    setPosition({ left: Math.max(8, Math.min(rect.right - 244, window.innerWidth - 252)),
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8)) });
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) dismiss(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [open]);
  useLayoutEffect(() => { if (open) options.current[active]?.focus(); }, [active, open]);
  const show = () => { setActive(choices.findIndex((choice) => choice.value === value)); setOpen(true); };
  const select = (index: number) => { onChange(choices[index].value); close(true); };
  return <div className="select-label density-select"><span>Density</span>
    <button ref={trigger} type="button" className="density-trigger" aria-label={`Density: ${value}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => open ? close() : show()} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
      }}>
      {choices.find((choice) => choice.value === value)?.label}<span className="density-chevron" aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} id={menuId} className="density-menu" role="listbox" aria-label="Density" style={position}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        else if (event.key === 'Tab') close(true);
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((active + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length); }
        else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setActive(event.key === 'Home' ? 0 : choices.length - 1); }
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(active); }
      }}>
      {choices.map((choice, index) => <div key={choice.value} ref={(element) => { options.current[index] = element; }} role="option" aria-selected={value === choice.value}
        tabIndex={active === index ? 0 : -1} className="density-option" onFocus={() => setActive(index)} onClick={() => select(index)}>
        <span className="density-choice-text"><strong>{choice.label}</strong><span>{choice.description}</span></span>
        <span className="density-check" aria-hidden="true">{value === choice.value ? '✓' : ''}</span>
      </div>)}
    </div>, document.body)}
  </div>;
}
