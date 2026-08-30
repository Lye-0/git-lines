import { useState } from 'react';
import type { DetailMessage } from '../types';
import { commitDescription, detailFileChanges, shortHash } from './detailPresentation';

function statusClass(status: string): string {
  return status.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'unknown';
}

export function DetailPanel({ detail, title, onClose }: { detail: Exclude<DetailMessage, null>; title?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const subject = detail.subject || title || 'Commit';
  const fileChanges = detailFileChanges(detail);
  const description = commitDescription(detail);

  const copyFullHash = async () => {
    const copyWithLegacyApi = () => {
      const input = document.createElement('textarea');
      input.value = detail.oid;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      let copiedByLegacyApi = false;
      try {
        copiedByLegacyApi = document.execCommand('copy');
      } finally {
        input.remove();
      }
      if (!copiedByLegacyApi) throw new Error('Clipboard copy failed');
    };
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(detail.oid);
        } catch {
          copyWithLegacyApi();
        }
      } else {
        copyWithLegacyApi();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return <aside className="detail-panel" aria-label="Commit details">
    <div className="detail-header">
      <div className="detail-heading">
        <span className="eyebrow">Commit detail</span>
        <h2 title={subject}>{subject}</h2>
        <div className="detail-hash-row">
          <code title={detail.oid}>{shortHash(detail.oid)}</code>
          <button type="button" className="copy-button" onClick={() => void copyFullHash()} aria-label="Copy full commit hash">{copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>
      <button type="button" className="close-button" onClick={onClose} aria-label="Close commit details">×</button>
    </div>

    <section className="detail-change-summary" aria-label="Commit changes">
      <div className="detail-change-stat additions"><strong>+{detail.additions ?? 0}</strong><span>additions</span></div>
      <div className="detail-change-stat deletions"><strong>−{detail.deletions ?? 0}</strong><span>deletions</span></div>
      <div className="detail-change-stat files"><strong>{fileChanges.length}</strong><span>files</span></div>
    </section>

    <dl className="detail-meta">
      <div>
        <dt>Author</dt>
        <dd><strong>{detail.authorName || 'Unknown author'}</strong>{detail.authorEmail && <span className="detail-email">{detail.authorEmail}</span>}</dd>
      </div>
      <div>
        <dt>Committed</dt>
        <dd><time dateTime={new Date(detail.committerDate).toISOString()}>{new Date(detail.committerDate).toLocaleString()}</time></dd>
      </div>
      <div>
        <dt>{detail.parentOids.length > 1 ? 'Parents' : 'Parent'}</dt>
        <dd>{detail.parentOids.length ? <span className="detail-parent-list">{detail.parentOids.map((parent) => <code key={parent} title={parent}>{shortHash(parent, 12)}</code>)}</span> : 'None (root commit)'}</dd>
      </div>
    </dl>

    <section className="detail-section" aria-labelledby="changed-files-heading">
      <div className="detail-section-header"><h3 id="changed-files-heading">Changed files</h3><span>{fileChanges.length}</span></div>
      {fileChanges.length ? <ul className="changed-files">
        {fileChanges.map((change, index) => <li className="changed-file" key={`${change.path}-${index}`}>
          <span className={`file-status file-status-${statusClass(change.status)}`}>{change.status}</span>
          <code title={change.path}>{change.path}</code>
          {(change.additions !== undefined || change.deletions !== undefined) && <span className="file-stats">
            {change.additions !== undefined && <span className="additions">+{change.additions}</span>}
            {change.deletions !== undefined && <span className="deletions">−{change.deletions}</span>}
          </span>}
        </li>)}
      </ul> : <p className="detail-empty">No file changes</p>}
    </section>

    {description && <section className="detail-section detail-description" aria-labelledby="description-heading">
      <h3 id="description-heading">Description</h3>
      <p>{description}</p>
    </section>}
  </aside>;
}
