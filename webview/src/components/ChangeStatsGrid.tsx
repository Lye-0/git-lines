import type { ChangeStats } from './changeStats';

export function ChangeStatsGrid({ stats, className, ariaLabel }: { stats: ChangeStats; className: string; ariaLabel: string }) {
  return <div className={`changes-grid ${className}`} aria-label={ariaLabel}>
    <span className="changes-cell changes-files"><strong>{stats.files}</strong><span>files</span></span>
    <span className="changes-cell changes-additions">+{stats.additions}</span>
    <span className="changes-cell changes-deletions">−{stats.deletions}</span>
  </div>;
}
