import type { GraphLayout } from './layoutTypes.js';

export class LayoutState {
  private current?: GraphLayout;
  private rowMap = new Map<string, number>();
  private laneMap = new Map<string, number>();

  public get layout(): GraphLayout | undefined { return this.current; }
  public get rows(): Map<string, number> { return new Map(this.rowMap); }
  public get lanes(): Map<string, number> { return new Map(this.laneMap); }

  public set(layout: GraphLayout): void {
    this.current = layout;
    this.rowMap = new Map(layout.nodes.filter((node) => node.row !== undefined).map((node) => [node.id, node.row as number]));
    this.laneMap = new Map(layout.tracks.map((track) => [track.id, track.lane]));
  }
}
