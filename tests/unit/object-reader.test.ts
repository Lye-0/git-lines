import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mock.spawn }));
import { BatchObjectReader } from '../../src/git/objectReader.js';

function processStub() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(),
  });
  child.kill.mockImplementation(() => { queueMicrotask(() => child.emit('close', -1)); return true; });
  child.stdin.on('finish', () => queueMicrotask(() => child.emit('close', 0)));
  mock.spawn.mockReturnValue(child);
  return child;
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('persistent object reader', () => {
  it('frames fragmented multibyte responses and missing objects by byte count', async () => {
    const child = processStub();
    const reader = new BatchObjectReader('git', '.', 1000);
    const oid = 'a'.repeat(40);
    const absent = 'b'.repeat(40);
    const first = reader.read(oid);
    const second = reader.read(absent);
    const body = Buffer.from('日本語\n\0\x1e');
    const response = Buffer.concat([Buffer.from(`${oid} commit ${body.length}\n`), body, Buffer.from(`\n${absent} missing\n`)]);
    for (const byte of response) child.stdout.write(Buffer.from([byte]));
    expect(await first).toEqual({ oid, type: 'commit', body });
    expect(await second).toBeUndefined();
    await reader.close();
    await expect(reader.read(oid)).rejects.toThrow('closed');
  });

  it('times out outstanding reads and closes the process', async () => {
    vi.useFakeTimers();
    const child = processStub();
    const reader = new BatchObjectReader('git', '.', 50);
    const result = expect(reader.read('a'.repeat(40))).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(51);
    await result;
    await reader.close();
    expect(child.kill).toHaveBeenCalled();
  });

  it('rejects incomplete responses when Git exits instead of hanging', async () => {
    const child = processStub();
    const reader = new BatchObjectReader('git', '.', 1000);
    const result = expect(reader.read('a'.repeat(40))).rejects.toThrow('closed');
    child.emit('close', 1);
    await result;
    await reader.close();
  });
});
