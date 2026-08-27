export interface ParsedWorktree {
  path: string;
  headOid?: string;
  branch?: string;
  detached: boolean;
  locked?: string;
  prunable?: string;
}

export function parseWorktreePorcelain(output: string): ParsedWorktree[] {
  const entries: ParsedWorktree[] = [];
  let current: ParsedWorktree | undefined;
  const flush = () => {
    if (current) entries.push(current);
    current = undefined;
  };
  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      flush();
      continue;
    }
    const [key, ...rest] = line.split(' ');
    const value = rest.join(' ');
    if (key === 'worktree') {
      flush();
      current = { path: value, detached: false };
    } else if (!current) {
      continue;
    } else if (key === 'HEAD') {
      current.headOid = value;
    } else if (key === 'branch') {
      current.branch = value.replace(/^refs\/heads\//, '');
    } else if (key === 'detached') {
      current.detached = true;
    } else if (key === 'locked') {
      current.locked = value;
    } else if (key === 'prunable') {
      current.prunable = value;
    }
  }
  flush();
  return entries;
}
