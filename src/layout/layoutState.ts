import type { GraphLayout } from './layoutTypes.js';

export class LayoutState {
  private current?: GraphLayout;
  private rowMap = new Map<string, number>();
  private laneMap = new Map<string, number>();
  private nodeLaneMap = new Map<string, number>();

  public get layout(): GraphLayout | undefined { return this.current; }
  public get rows(): Map<string, number> { return new Map(this.rowMap); }
  public get lanes(): Map<string, number> { return new Map(this.laneMap); }
  public get nodeLanes(): Map<string, number> { return new Map(this.nodeLaneMap); }

  public set(layout: GraphLayout): void {
    this.current = layout;
    // Operation annotation rows are presentation-only gaps inserted after
    // the structural row layout.  Keep the structural coordinates here so a
    // later page append does not insert the same virtual row a second time.
    const rows = new Map(layout.nodes.filter((node) => node.row !== undefined).map((node) => [node.id, node.row as number]));
    for (const annotation of [...(layout.operationAnnotationRows ?? [])].sort((a, b) => b.row - a.row)) {
      for (const [nodeId, row] of rows) {
        if (row > annotation.row) rows.set(nodeId, row - 1);
      }
    }
    this.rowMap = rows;
    this.laneMap = new Map(layout.tracks.map((track) => [track.id, track.lane]));
    this.nodeLaneMap = new Map(layout.nodes.filter((node) => node.lane !== undefined).map((node) => [node.id, node.lane as number]));
  }
}
