import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface GitObject { oid: string; type: string; body: Buffer }
export interface ObjectReader {
  read(oid: string): Promise<GitObject | undefined>;
  close(): Promise<void>;
}

/** One bounded, request-driven cat-file process; byte lengths frame raw objects. */
export class BatchObjectReader implements ObjectReader {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private pending: Array<{ resolve: (value: GitObject | undefined) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
  private failure?: Error;
  private ending = false;
  private bytes = 0;
  private readonly closed: Promise<void>;

  constructor(executable: string, cwd: string, private readonly timeoutMs: number, onClose?: (ms: number, bytes: number, ok: boolean) => void) {
    const started = performance.now();
    this.child = spawn(executable, ['cat-file', '--batch'], { cwd, shell: false, windowsHide: true });
    this.closed = new Promise((resolve) => {
      this.child.on('close', (code) => {
        if (this.pending.length) this.fail(new Error('Git object reader closed before completing its requests'));
        this.ending = true;
        onClose?.(performance.now() - started, this.bytes, code === 0 && !this.failure);
        resolve();
      });
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.stdin.on('error', (error) => this.fail(error));
    // Drain stderr without retaining arbitrary object/repository output.
    this.child.stderr.resume();
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.bytes += chunk.length;
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.consume();
    });
  }

  read(oid: string): Promise<GitObject | undefined> {
    if (!/^[0-9a-f]{7,64}$/i.test(oid)) return Promise.reject(new Error('Invalid object ID'));
    if (this.failure || this.ending) return Promise.reject(this.failure ?? new Error('Git object reader is closed'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Git object read timed out')), this.timeoutMs);
      this.pending.push({ resolve, reject, timer });
      this.child.stdin.write(`${oid}\n`);
    });
  }

  private consume(): void {
    while (this.pending.length) {
      const newline = this.buffer.indexOf(10);
      if (newline < 0) return;
      const header = this.buffer.subarray(0, newline).toString('ascii');
      const missing = /^[0-9a-f]+ (?:missing|ambiguous)$/i.test(header);
      const match = /^([0-9a-f]+) (\w+) (\d+)$/i.exec(header);
      if (!missing && !match) { this.fail(new Error('Invalid Git object header')); return; }
      const size = match ? Number(match[3]) : 0;
      if (!Number.isSafeInteger(size) || size < 0) { this.fail(new Error('Invalid Git object size')); return; }
      const end = newline + 1 + (missing ? 0 : size + 1);
      if (this.buffer.length < end) return;
      if (!missing && this.buffer[end - 1] !== 10) { this.fail(new Error('Invalid Git object terminator')); return; }
      const request = this.pending.shift()!;
      clearTimeout(request.timer);
      request.resolve(match ? { oid: match[1], type: match[2], body: Buffer.from(this.buffer.subarray(newline + 1, end - 1)) } : undefined);
      this.buffer = this.buffer.subarray(end);
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const request of this.pending.splice(0)) { clearTimeout(request.timer); request.reject(error); }
    this.buffer = Buffer.alloc(0);
    this.child.kill();
  }

  async close(): Promise<void> {
    if (!this.ending) { this.ending = true; this.child.stdin.end(); }
    const timer = setTimeout(() => this.fail(new Error('Git object reader shutdown timed out')), this.timeoutMs);
    try { await this.closed; }
    finally { clearTimeout(timer); }
  }
}
