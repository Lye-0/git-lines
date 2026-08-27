import { GitClient } from './src/git/gitClient.ts';
import { buildGraphFacts } from './src/model/graphBuilder.ts';
import { createGraphLayout } from './src/layout/graphLayout.ts';

const root = process.argv[2];
if (!root) throw new Error('repository root required');
const snapshot = await new GitClient().readSnapshot(root, 30, true);
const facts = buildGraphFacts(snapshot);
const layout = createGraphLayout(facts, {
  visibleCommitCount: snapshot.visibleCommitCount,
  hasMore: snapshot.hasMore,
  primaryBranch: facts.primaryBranch,
});
const byId = new Map(layout.nodes.map((node) => [node.id, node]));
console.log(JSON.stringify({
  primaryBranch: facts.primaryBranch,
  events: layout.nodes.filter((node) => node.event).map((node) => ({
    id: node.id,
    kind: node.kind,
    row: node.row,
    lane: node.lane,
    trackId: node.trackId,
    refName: node.event?.refName,
    fromOid: node.event?.fromOid,
    toOid: node.event?.toOid,
    fromRow: node.event?.fromOid ? byId.get(`commit:${node.event.fromOid}`)?.row : undefined,
    toRow: byId.get(`commit:${node.event?.toOid}`)?.row,
  })),
  eventEdges: layout.edges.filter((edge) => edge.type === 'history-event').map((edge) => ({
    id: edge.id,
    from: byId.get(edge.fromNodeId)?.row,
    to: byId.get(edge.toNodeId)?.row,
    fromLane: byId.get(edge.fromNodeId)?.lane,
    toLane: byId.get(edge.toNodeId)?.lane,
  })),
}, null, 2));
