import type { OperationState, RepositorySnapshot } from '../git/gitTypes.js';
import type { GraphEdge, GraphFactModel, GraphNode, GraphSyncState } from './graphModel.js';
import { isUserFacingRef, normalizeRefName, specialRefBadge, toGraphRefBadge, uniqueGraphRefBadges } from './refDisplay.js';

export interface GraphBuilderOptions {
  showReflog?: boolean;
  primaryBranch?: string | null;
}

function reachableFromRefs(snapshot: RepositorySnapshot, commits: Map<string, { parentOids: string[] }>): Set<string> {
  const reachable = new Set<string>();
  const queue = snapshot.refs.filter(isUserFacingRef).map((ref) => ref.oid).filter((oid): oid is string => Boolean(oid));
  while (queue.length) {
    const oid = queue.shift() as string;
    if (reachable.has(oid)) continue;
    reachable.add(oid);
    for (const parent of commits.get(oid)?.parentOids ?? []) queue.push(parent);
  }
  return reachable;
}

function reachableFromRefType(snapshot: RepositorySnapshot, commits: Map<string, { parentOids: string[] }>, type: 'local' | 'remote'): Set<string> {
  const reachable = new Set<string>();
  const queue = snapshot.refs.filter((ref) => ref.type === type).map((ref) => ref.oid).filter((oid): oid is string => Boolean(oid));
  while (queue.length) {
    const oid = queue.shift() as string;
    if (reachable.has(oid)) continue;
    reachable.add(oid);
    for (const parent of commits.get(oid)?.parentOids ?? []) queue.push(parent);
  }
  return reachable;
}

function syncStateFor(oid: string, localReachable: Set<string>, remoteReachable: Set<string>): GraphSyncState | undefined {
  const local = localReachable.has(oid);
  const remote = remoteReachable.has(oid);
  if (local && remote) return 'shared';
  if (local) return 'local-only';
  if (remote) return 'remote-only';
  return undefined;
}

interface PreviousRouteSelection {
  commitOids: Set<string>;
  eventIds: Set<string>;
}

/**
 * Finds old first-parent paths that are no longer reachable from a current
 * user-facing ref.  The event is useful only when at least one real commit is
 * retained on that old path; a reflog message by itself is not a timeline
 * event.  Stop at the first live ancestor so a shared live section is never
 * reclassified as PREVIOUS.
 */
function previousRouteSelection(snapshot: RepositorySnapshot, commits: Map<string, { parentOids: string[] }>, reachableOids: Set<string>): PreviousRouteSelection {
  const commitOids = new Set<string>();
  const eventIds = new Set<string>();
  for (const event of snapshot.historyEvents) {
    if (event.type !== 'reset' && event.type !== 'amend' && event.type !== 'rebase') continue;
    const routeOids = new Set<string>();
    let current = event.fromOid;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      if (reachableOids.has(current)) break;
      // A reflog may outlive its commit object.  Such an entry cannot produce
      // a visible PREVIOUS route, so do not promote its event either.
      if (!commits.has(current)) break;
      commitOids.add(current);
      routeOids.add(current);
      current = commits.get(current)?.parentOids[0];
    }
    if (routeOids.size > 0) eventIds.add(event.id);
  }
  return { commitOids, eventIds };
}

function eventLabel(type: string, refName: string, sourceLabel?: string): string {
  const ref = normalizeRefName(refName);
  const source = sourceLabel ? normalizeRefName(sourceLabel) : undefined;
  if (type === 'fast-forward') return source && source !== ref ? `Fast-forward · ${ref} ← ${source}` : `Fast-forward · ${ref}`;
  if (type === 'force-update') return `Force update · ${ref}`;
  if (type === 'branch-move') return `Branch move · ${ref}`;
  return `${type[0].toUpperCase()}${type.slice(1)} · ${ref}`;
}

function primaryBranch(snapshot: RepositorySnapshot, configured?: string | null): string | undefined {
  if (configured) {
    const configuredRef = snapshot.refs.find((ref) => ref.shortName === configured || ref.fullName === configured || normalizeRefName(ref.fullName) === configured);
    if (configuredRef?.type === 'local') return normalizeRefName(configuredRef.fullName);
  }
  const defaultRemote = snapshot.refs.find((ref) => ref.type === 'symbolic' && ref.targetRef?.startsWith('refs/remotes/'));
  if (defaultRemote?.targetRef) {
    const target = defaultRemote.targetRef.replace(/^refs\/remotes\/[^/]+\//, '');
    if (snapshot.refs.some((ref) => ref.type === 'local' && normalizeRefName(ref.fullName) === target)) return target;
  }
  for (const candidate of ['main', 'master']) {
    if (snapshot.refs.some((ref) => ref.type === 'local' && normalizeRefName(ref.fullName) === candidate)) return candidate;
  }
  const current = snapshot.workingTrees.find((tree) => !tree.inaccessible && tree.branch)?.branch;
  if (current && snapshot.refs.some((ref) => ref.type === 'local' && normalizeRefName(ref.fullName) === current)) return current;
  return snapshot.refs.filter((ref) => ref.type === 'local').map((ref) => normalizeRefName(ref.fullName)).sort()[0];
}

function operationForWorkingTree(tree: RepositorySnapshot['workingTrees'][number], index: number, operations: OperationState[]): OperationState | undefined {
  const sameHead = tree.headOid ? operations.find((operation) => operation.headOid === tree.headOid) : undefined;
  // OperationStateReader currently reads the repository's active operation
  // files, so the main worktree is the only safe fallback when Git cannot
  // provide a matching HEAD (for example during an unborn/rebase state).
  return sameHead ?? (index === 0 ? operations[0] : undefined);
}

export function buildGraphFacts(snapshot: RepositorySnapshot, options: GraphBuilderOptions = {}): GraphFactModel {
  const currentBranch = snapshot.workingTrees.find((tree) => !tree.inaccessible && tree.branch)?.branch;
  const visibleCount = Math.min(snapshot.visibleCommitCount, snapshot.commits.length);
  const visibleCommits = snapshot.commits.slice(0, visibleCount);
  const visibleOids = new Set(visibleCommits.map((commit) => commit.oid));
  const commits = options.showReflog === false
    ? visibleCommits
    : [...visibleCommits, ...snapshot.commits.slice(visibleCount).filter((commit) => !visibleOids.has(commit.oid))];
  const commitMap = new Map(commits.map((commit) => [commit.oid, commit]));
  const reachableOids = reachableFromRefs(snapshot, commitMap);
  const localReachable = reachableFromRefType(snapshot, commitMap, 'local');
  const remoteReachable = reachableFromRefType(snapshot, commitMap, 'remote');
  const previousRoute = options.showReflog === false
    ? { commitOids: new Set<string>(), eventIds: new Set<string>() }
    : previousRouteSelection(snapshot, commitMap, reachableOids);
  const previousRouteOids = previousRoute.commitOids;
  const refsByOid = new Map<string, ReturnType<typeof toGraphRefBadge>[]>();
  for (const ref of snapshot.refs) {
    if (ref.oid && isUserFacingRef(ref)) refsByOid.set(ref.oid, [...(refsByOid.get(ref.oid) ?? []), toGraphRefBadge(ref)]);
  }
  const nodes: GraphNode[] = commits.map((commit) => {
    const refBadges = uniqueGraphRefBadges(refsByOid.get(commit.oid) ?? [], currentBranch);
    return {
      id: `commit:${commit.oid}`,
      kind: reachableOids.has(commit.oid) ? 'commit' : 'reflog-commit',
      oid: commit.oid,
      refIds: refBadges.map((badge) => badge.name),
      refBadges,
      timestamp: commit.committerDate,
      subject: commit.subject,
      label: commit.subject,
      commit,
      syncState: syncStateFor(commit.oid, localReachable, remoteReachable),
      previousRoute: previousRouteOids.has(commit.oid),
    };
  });
  const nodeByOid = new Map(nodes.filter((node) => node.oid).map((node) => [node.oid as string, node]));
  const edges: GraphEdge[] = [];
  const addNode = (node: GraphNode) => { if (!nodes.some((existing) => existing.id === node.id)) nodes.push(node); };
  for (const commit of commits) {
    for (const parentOid of commit.parentOids) {
      let parentNode = nodeByOid.get(parentOid);
      if (!parentNode && (snapshot.hasMore || snapshot.repository.shallow)) {
        parentNode = { id: `boundary:${parentOid}`, kind: 'history-boundary', oid: parentOid, label: 'More history', refIds: [], timestamp: 0 };
        addNode(parentNode);
        nodeByOid.set(parentOid, parentNode);
      }
      if (parentNode) edges.push({ id: `parent:${commit.oid}:${parentOid}`, type: 'parent', fromNodeId: `commit:${commit.oid}`, toNodeId: parentNode.id });
    }
  }
  for (const [index, tree] of snapshot.workingTrees.entries()) {
    const operation = operationForWorkingTree(tree, index, snapshot.operations);
    const node: GraphNode = {
      id: `working:${tree.worktreeId}`,
      kind: 'working-tree',
      label: index === 0 ? 'Working Tree' : 'Worktree',
      refIds: [],
      refBadges: [],
      oid: tree.headOid,
      timestamp: Number.MAX_SAFE_INTEGER - index,
      workingTree: tree,
      operation,
    };
    addNode(node);
    const headNode = tree.headOid ? nodeByOid.get(tree.headOid) : undefined;
    if (headNode) edges.push({ id: `working:${tree.worktreeId}:${headNode.id}`, type: 'working-tree', fromNodeId: node.id, toNodeId: headNode.id });
    if (!operation) continue;
    // The in-progress operation is an aspect of this Working Tree, not a
    // second current-state node. Keep each source relationship visible as a
    // dotted edge, but make the Working Tree the direct source of that edge.
    for (const sourceOid of operation?.sourceOids ?? []) {
      const source = nodeByOid.get(sourceOid);
      if (source) edges.push({ id: `${node.id}:operation:${operation.type}:source:${sourceOid}`, type: 'operation', fromNodeId: node.id, toNodeId: source.id, label: 'operation source' });
    }
  }
  const events = options.showReflog === false
    ? []
    : snapshot.historyEvents.filter((event) => event.type !== 'reset' && event.type !== 'amend' || previousRoute.eventIds.has(event.id));
  for (const event of events) {
    const target = nodeByOid.get(event.toOid);
    if (!target) continue;
    const eventStart = event.eventStartOid ? nodeByOid.get(event.eventStartOid) : undefined;
    const annotationSource = eventStart ?? target;
    const isFastForward = event.type === 'fast-forward';
    const label = eventLabel(event.type, event.refName, event.sourceLabel);
    const affectedRefs = event.affectedRefs?.length ? event.affectedRefs : [event.refName];
    const refBadges = uniqueGraphRefBadges(affectedRefs.map((refName) => {
      const ref = snapshot.refs.find((candidate) => candidate.fullName === refName);
      return ref ? toGraphRefBadge(ref) : specialRefBadge(refName);
    }), currentBranch);
    const node: GraphNode = {
      id: event.id,
      kind: isFastForward ? 'fast-forward-event' : 'history-event',
      label,
      refIds: refBadges.map((badge) => badge.name),
      refBadges,
      timestamp: event.timestamp,
      subject: event.subject,
      event,
      historicalEvent: (event.type === 'reset' || event.type === 'amend' || event.type === 'rebase') && previousRouteOids.has(event.toOid),
      anchorCommitId: target.id,
      eventBoundaryCommitId: event.boundaryOid ? nodeByOid.get(event.boundaryOid)?.id : undefined,
      eventStartCommitId: annotationSource.id,
      targetRef: event.refName,
    };
    addNode(node);
    // A ref move is a timeline fact, not a commit relationship. Keep one
    // visual connector from the new-history side while leaving parent edges
    // intact; a multi-commit rebase uses the oldest rebuilt commit here.
    edges.push({ id: `${event.id}:annotation`, type: 'history-event', fromNodeId: annotationSource.id, toNodeId: node.id, label: event.sourceLabel, annotation: 'ref-event' });
  }
  const shallowNodes = snapshot.shallowBoundaryOids.map((oid) => nodeByOid.get(oid)).filter((node): node is GraphNode => Boolean(node));
  for (const node of shallowNodes) {
    const boundary: GraphNode = { id: `shallow:${node.id}`, kind: 'history-boundary', label: 'Shallow history boundary', refIds: [], timestamp: (node.timestamp ?? 0) - 1 };
    addNode(boundary);
    edges.push({ id: `${boundary.id}:edge`, type: 'history-event', fromNodeId: node.id, toNodeId: boundary.id, label: 'shallow', annotation: 'shallow-boundary' });
  }
  return {
    nodes,
    edges,
    refs: snapshot.refs,
    commits,
    workingTrees: snapshot.workingTrees,
    operations: snapshot.operations,
    events,
    primaryBranch: primaryBranch(snapshot, options.primaryBranch),
    shallowBoundaryOids: snapshot.shallowBoundaryOids,
  };
}
