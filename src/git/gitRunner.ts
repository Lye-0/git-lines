import { spawn } from 'node:child_process';

export interface GitRunOptions {
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class GitCommandError extends Error {
  public readonly args: string[];
  public readonly stderr: string;
  public readonly exitCode: number | null;

  public constructor(message: string, args: string[], stderr = '', exitCode: number | null = null) {
    super(message);
    this.name = 'GitCommandError';
    this.args = args;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

/** Runs Git without invoking a shell. This keeps repository paths and ref names opaque arguments. */
export class GitRunner {
  public constructor(private readonly gitExecutable = 'git') {}

  public run(args: string[], options: GitRunOptions): Promise<GitRunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitExecutable, args, {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeout = options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill();
            if (!settled) {
              settled = true;
              reject(new GitCommandError(`Git command timed out: ${args[0] ?? ''}`, args, stderr, null));
            }
          }, options.timeoutMs);

      const abort = () => child.kill();
      options.signal?.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.on('data', (chunk: string) => { stderr += chunk; });
      child.on('error', (error) => {
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
        if (!settled) {
          settled = true;
          reject(new GitCommandError(error.message, args, stderr, null));
        }
      });
      child.on('close', (exitCode) => {
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
        if (settled) return;
        settled = true;
        resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
      });
    });
  }

  public async runChecked(args: string[], options: GitRunOptions): Promise<string> {
    const result = await this.run(args, options);
    if (result.exitCode !== 0) {
      throw new GitCommandError(
        `Git command failed (${result.exitCode}): ${args.join(' ')}`,
        args,
        result.stderr,
        result.exitCode,
      );
    }
    return result.stdout;
  }
}
