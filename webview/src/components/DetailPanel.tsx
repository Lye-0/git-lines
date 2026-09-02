import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { GitCommit, OperationState, WorkingTreeState } from '../../../src/git/gitTypes';
import type { DetailMessage } from '../types';
import { commitDescription, detailFileChanges, shortHash } from './detailPresentation';
import type { DetailRefBadge } from './detailPresentation';
import { linkedWorktreeBranchLabel, linkedWorktreeStatusLabel, operationInProgressLabel, summarizeWorkingTree, workingTreeStateLabel } from './workingTreePresentation';
import type { HistoryEvent } from '../../../src/git/gitTypes';
import { eventDetailFields, eventDetailTitle } from './eventDetailPresentation';

function statusClass(status: string): string {
  return status.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'unknown';
}

export function DetailPanel({ detail, event, workingTree, operation, sourceCommits = [], linkedWorktrees = [], title, routeName, refBadges = [], onClose }: { detail?: Exclude<DetailMessage, null>; event?: HistoryEvent; workingTree?: WorkingTreeState; operation?: OperationState; sourceCommits?: GitCommit[]; linkedWorktrees?: WorkingTreeState[]; title?: string; routeName?: string; refBadges?: DetailRefBadge[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (workingTree) {
    const summary = summarizeWorkingTree(workingTree);
    const operationLabel = operation ? operationInProgressLabel(operation) : undefined;
    const location = workingTree.detached ? 'HEAD (detached)' : workingTree.branch ?? 'No branch';
    return <aside className="detail-panel" aria-label="Working Tree details">
      <div className="detail-header">
        <div className="detail-heading">
          <span className="eyebrow">Working Tree</span>
          <h2>Working Tree</h2>
          {operationLabel && <div className="working-operation-detail" title={operationLabel}>{`(+ ${operationLabel})`}</div>}
        </div>
        <button type="button" className="close-button" onClick={onClose} aria-label="Close Working Tree details">×</button>
      </div>

      <section className="detail-change-summary" aria-label="Working Tree changes">
        <div className="detail-change-stat additions"><strong>+{summary.additions}</strong><span>additions</span></div>
        <div className="detail-change-stat deletions"><strong>−{summary.deletions}</strong><span>deletions</span></div>
        <div className="detail-change-stat files"><strong>{summary.files}</strong><span>files</span></div>
      </section>

      <dl className="detail-meta">
        <div>
          <dt>Branch / Ref</dt>
          <dd className="detail-route-value" title={workingTree.branch}>{location}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{workingTreeStateLabel(workingTree)}</dd>
        </div>
        <div>
          <dt>HEAD</dt>
          <dd>{workingTree.headOid ? <code title={workingTree.headOid}>{shortHash(workingTree.headOid, 12)}</code> : 'No commit'}</dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd className="detail-route-value" title={workingTree.path}>{workingTree.path}</dd>
        </div>
        {operationLabel && <div>
          <dt>Operation</dt>
          <dd className="working-operation-detail" title={operationLabel}>{operationLabel}</dd>
        </div>}
      </dl>

      {operation && <section className="detail-section detail-source-section" aria-labelledby="operation-source-heading">
        <div className="detail-section-header"><h3 id="operation-source-heading">Source commits</h3><span>{operation.sourceOids.length}</span></div>
        {operation.sourceOids.length ? <ul className="detail-source-commits">
          {operation.sourceOids.map((oid) => {
            const source = sourceCommits.find((commit) => commit.oid === oid);
            return <li className="detail-source-commit" key={oid}>
              <code title={oid}>{shortHash(oid, 12)}</code>
              {source && <span title={source.subject}>{source.subject}</span>}
            </li>;
          })}
        </ul> : <p className="detail-empty">No source commit recorded</p>}
        {operation.detail && <p className="detail-operation-detail" title={operation.detail}>{operation.detail}</p>}
      </section>}
    </aside>;
  }
  if (event) {
    const fields = eventDetailFields(event);
    return <aside className="detail-panel" aria-label="Git operation details">
      <div className="detail-header">
        <div className="detail-heading">
          <span className="eyebrow">Git operation</span>
          <h2 title={eventDetailTitle(event)}>{eventDetailTitle(event)}</h2>
          {refBadges.length > 0 && <div className="detail-refs" aria-label="Event refs">
            {refBadges.map((badge) => <span className={`ref-badge ref-badge-${badge.kind}${badge.isDefault ? ' default' : ''}`} style={{ '--badge-color': badge.color } as CSSProperties} key={badge.fullName} title={badge.fullName}>{badge.name}{badge.isDefault ? ' · default' : ''}</span>)}
          </div>}
        </div>
        <button type="button" className="close-button" onClick={onClose} aria-label="Close operation details">×</button>
      </div>
      <dl className="detail-meta event-detail-meta">
        {fields.map((field) => <div key={field.label}>
          <dt>{field.label}</dt>
          <dd className={field.kind === 'raw' ? 'detail-raw-message' : undefined} title={field.title}>{field.kind === 'hash' ? <code>{field.value}</code> : field.value}</dd>
        </div>)}
      </dl>
    </aside>;
  }
  if (!detail) return null;
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
        {refBadges.length > 0 && <div className="detail-refs" aria-label="Commit refs">
          {refBadges.map((badge) => <span className={`ref-badge ref-badge-${badge.kind}${badge.isDefault ? ' default' : ''}`} style={{ '--badge-color': badge.color } as CSSProperties} key={badge.fullName} title={badge.fullName}>{badge.name}{badge.isDefault ? ' · default' : ''}</span>)}
        </div>}
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
        <dt>Branch / Route</dt>
        <dd className="detail-route-value" title={routeName}>{routeName || 'Unknown route'}</dd>
      </div>
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

    {linkedWorktrees.length > 0 && <section className="detail-section detail-linked-worktree-section" aria-labelledby="linked-worktree-heading">
      <div className="detail-section-header"><h3 id="linked-worktree-heading">Linked Worktree</h3><span>{linkedWorktrees.length}</span></div>
      {linkedWorktrees.map((linked) => <article className="linked-worktree-detail" key={linked.worktreeId}>
        <p className="linked-worktree-description">Checked out in another worktree</p>
        <dl className="linked-worktree-meta">
          <div><dt>Branch in worktree</dt><dd title={linkedWorktreeBranchLabel(linked)}>{linkedWorktreeBranchLabel(linked)}</dd></div>
          <div><dt>Path</dt><dd title={linked.path}>{linked.path}</dd></div>
          <div><dt>Status</dt><dd>{linkedWorktreeStatusLabel(linked)}</dd></div>
        </dl>
      </article>)}
    </section>}

    <section className="detail-section detail-files-section" aria-labelledby="changed-files-heading">
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
