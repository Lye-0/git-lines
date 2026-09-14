import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Keep the historical prototype reproducible after production adopts the policy.
export const baselineCommit = '22ccb2ff8b7885f262427c8924b7f1e35cdd9fe5';
const cache = new Map();
export function baselineSource(file) {
  const relative = path.relative(process.cwd(), file).replaceAll('\\', '/');
  if (!cache.has(relative)) cache.set(relative, execFileSync('git', ['show', `${baselineCommit}:${relative}`], { encoding: 'utf8' }));
  return cache.get(relative);
}
