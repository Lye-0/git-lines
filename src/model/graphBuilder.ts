import type { RepositorySnapshot } from '../git/gitTypes.js';
import type { GraphEdge, GraphFactModel, GraphNode } from './graphModel.js';
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

export function buildGraphFacts(snapshot: RepositorySnapshot, options: GraphBuilderOptions = {}): GraphFactModel {
  const visibleCount = Math.min(snapshot.visibleCommitCount, snapshot.commits.length);
  const visibleCommits = snapshot.commits.slice(0, visibleCount);
  const visibleOids = new Set(visibleCommits.map((commit) => commit.oid));
  const commits = options.showReflog === false
    ? visibleCommits
    : [...visibleCommits, ...snapshot.commits.slice(visibleCount).filter((commit) => !visibleOids.has(commit.oid))];
  const reachableOids = reachableFromRefs(snapshot, new Map(commits.map((commit) => [commit.oid, commit])));
  const refsByOid = new Map<string, ReturnType<typeof toGraphRefBadge>[]>();
  for (const ref of snapshot.refs) {
    if (ref.oid && isUserFacingRef(ref)) refsByOid.set(ref.oid, [...(refsByOid.get(ref.oid) ?? []), toGraphRefBadge(ref)]);
  }
  const nodes: GraphNode[] = commits.map((commit) => {
    const refBadges = uniqueGraphRefBadges(refsByOid.get(commit.oid) ?? []);
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
    const node: GraphNode = {
      id: `working:${tree.worktreeId}`,
      kind: 'working-tree',
      label: index === 0 ? 'Working Tree' : 'Worktree',
      refIds: [],
      refBadges: [],
      oid: tree.headOid,
      timestamp: Number.MAX_SAFE_INTEGER - index,
      workingTree: tree,
    };
    addNode(node);
    const headNode = tree.headOid ? nodeByOid.get(tree.headOid) : undefined;
    if (headNode) edges.push({ id: `working:${tree.worktreeId}:${headNode.id}`, type: 'working-tree', fromNodeId: node.id, toNodeId: headNode.id });
  }
  for (const [index, operation] of snapshot.operations.entries()) {
    const node: GraphNode = {
      id: `operation:${operation.type}:${index}`,
      kind: 'operation',
      label: `${operation.type[0].toUpperCase()}${operation.type.slice(1)} in progress`,
      refIds: [],
      refBadges: [],
      oid: operation.headOid,
      timestamp: Number.MAX_SAFE_INTEGER - 100 - index,
      operation,
    };
    addNode(node);
    if (operation.headOid && nodeByOid.has(operation.headOid)) edges.push({ id: `${node.id}:head`, type: 'operation', fromNodeId: node.id, toNodeId: nodeByOid.get(operation.headOid)!.id, label: 'current HEAD' });
    for (const sourceOid of operation.sourceOids) {
      const source = nodeByOid.get(sourceOid);
      if (source) edges.push({ id: `${node.id}:source:${sourceOid}`, type: 'operation', fromNodeId: node.id, toNodeId: source.id, label: 'source' });
    }
  }
  const events = options.showReflog === false ? [] : snapshot.historyEvents;
  for (const event of events) {
    const target = nodeByOid.get(event.toOid);
    if (!target) continue;
    const isFastForward = event.type === 'fast-forward';
    const affectedRefs = event.affectedRefs?.length ? event.affectedRefs : [event.refName];
    const refBadges = uniqueGraphRefBadges(affectedRefs.map((refName) => {
      const ref = snapshot.refs.find((candidate) => candidate.fullName === refName);
      return ref ? toGraphRefBadge(ref) : specialRefBadge(refName);
    }));
    const node: GraphNode = {
      id: event.id,
      kind: isFastForward ? 'fast-forward-event' : 'history-event',
      label: eventLabel(event.type, event.refName, event.sourceLabel),
      refIds: refBadges.map((badge) => badge.name),
      refBadges,
      timestamp: event.timestamp,
      subject: event.subject,
      event,
    };
    addNode(node);
    edges.push({ id: `${event.id}:to`, type: 'history-event', fromNodeId: node.id, toNodeId: target.id, label: event.sourceLabel });
    const from = event.fromOid ? nodeByOid.get(event.fromOid) : undefined;
    if (from) edges.push({ id: `${event.id}:from`, type: 'history-event', fromNodeId: from.id, toNodeId: node.id, label: event.type });
  }
  const shallowNodes = snapshot.shallowBoundaryOids.map((oid) => nodeByOid.get(oid)).filter((node): node is GraphNode => Boolean(node));
  for (const node of shallowNodes) {
    const boundary: GraphNode = { id: `shallow:${node.id}`, kind: 'history-boundary', label: 'Shallow history boundary', refIds: [], timestamp: (node.timestamp ?? 0) - 1 };
    addNode(boundary);
    edges.push({ id: `${boundary.id}:edge`, type: 'history-event', fromNodeId: node.id, toNodeId: boundary.id, label: 'shallow' });
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
