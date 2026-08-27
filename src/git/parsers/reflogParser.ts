import type { ReflogEntry } from '../gitTypes.js';

function parseTimestamp(value: string): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

export function parseReflogRecords(output: string, refName: string): ReflogEntry[] {
  const entries: ReflogEntry[] = [];
  for (const record of output.split('\x1e')) {
    const fields = record.replace(/^\r?\n/, '').split('\0');
    if (!fields[0] || !/^[0-9a-f]{7,64}$/i.test(fields[0])) continue;
    entries.push({
      refName,
      newOid: fields[0],
      selector: fields[1] || refName,
      subject: fields[2] || '',
      timestamp: parseTimestamp(fields[3] || ''),
      actorName: fields[4] || undefined,
      actorEmail: fields[5] || undefined,
    });
  }
  // Git prints newest first. A directly adjacent next entry is safe evidence for the old OID.
  for (let i = 0; i < entries.length - 1; i += 1) entries[i].previousOid = entries[i + 1].newOid;
  return entries;
}

export const reflogFormat = '%H%x00%gD%x00%gs%x00%ct%x00%an%x00%ae%x00%x1e';
