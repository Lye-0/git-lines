import { stableHash } from './hash.js';

export function branchColor(family: string): string {
  return `hsl(${stableHash(family) % 360} 76% 66%)`;
}
