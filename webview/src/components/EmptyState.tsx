export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return <section className="empty-state" aria-live="polite"><div className="empty-symbol" aria-hidden="true">○</div><h2>{title}</h2>{detail && <p>{detail}</p>}</section>;
}
