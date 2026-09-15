/** Run only from Computer Use node_repl with initialized sky and a returned Window. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return undefined; } }
export async function captureCases(sky, window, runDir, { start = 0, end, resume = false } = {}) {
  const cases = await readJson(path.join(runDir, 'cases.json'));
  const results = [];
  async function send(request) {
    await fs.writeFile(path.join(runDir, 'request.next.json'), JSON.stringify({ id: randomUUID(), ...request }));
    await fs.rename(path.join(runDir, 'request.next.json'), path.join(runDir, 'request.json'));
  }
  async function position(top = 0, left = 0) {
    const token = randomUUID();
    await send({ action: 'position', token, top, left });
    const started = Date.now();
    for (;;) {
      const view = await readJson(path.join(runDir, 'viewport.json'));
      if (view?.token === token) return view;
      if (Date.now() - started > 10000) throw new Error('Viewport acknowledgement timed out');
      await sleep(100);
    }
  }
  for (let index = start; index < Math.min(end ?? cases.length, cases.length); index++) {
    const item = cases[index];
    const existing = await readJson(path.join(runDir, 'images', `${index}.json`));
    if (resume && existing?.complete && existing.name === item.name && existing.mode === item.mode && existing.showReflog === item.showReflog) { results.push(existing); continue; }
    const started = Date.now();
    await send({ index });
    let status;
    for (;;) {
      status = await readJson(path.join(runDir, 'status.json'));
      if (status?.index === index && status.state === 'ready' && Date.parse(status.renderedAt) >= started) break;
      if (status?.index === index && status.state === 'error' && Date.parse(status.updatedAt) >= started) throw new Error(status.error);
      if (Date.now() - started > 65000) throw new Error(`No render acknowledgement: ${item.name} ${item.mode}`);
      await sleep(100);
    }
    const first = await position();
    if (first.error || first.hasMore) throw new Error(`Graph incomplete: ${status.label}`);
    const stops = (size, visible) => {
      if (visible <= 0) throw new Error('Viewport has no size');
      const values = [0];
      const max = Math.max(0, size - visible);
      while (values.at(-1) < max) values.push(Math.min(max, values.at(-1) + Math.max(1, visible - 100)));
      return values;
    };
    // CSS zoom and native scrollbars can make scrollWidth-clientWidth differ
    // from the browser's actual clamped endpoint. Measure that endpoint.
    const overflow = first.scrollWidth > first.width || first.scrollHeight > first.height;
    const endpoint = overflow ? await position(1e9, 1e9) : first;
    if (overflow) await position();
    const tops = stops(endpoint.top + first.height, first.height);
    const lefts = stops(endpoint.left + first.width, first.width);
    if (tops.length * lefts.length > 100) throw new Error('More than 100 tiles: review capture bounds');
    const pages = [];
    for (const top of tops) for (const left of lefts) {
      const viewport = top || left ? await position(top, left) : first;
      const state = await sky.get_window_state({ window, include_screenshot: true, include_text: true });
      window = state.window;
      const tree = state.accessibility?.tree ?? '';
      if (!tree.includes(status.label) || !tree.includes('Git Lines')) throw new Error(`Visible case could not be verified: ${status.label}`);
      if (/\bDialog\b|ダイアログ/.test(tree)) throw new Error('A dialog is covering the capture window');
      if (state.screenshots.length !== 1) throw new Error('Expected one unobstructed screenshot');
      const shot = state.screenshots[0];
      const format = /^data:image\/(png|jpeg);base64,/.exec(shot.url)?.[1];
      if (!format) throw new Error('Unsupported screenshot format');
      const imageFile = `${index}-${pages.length}.${format === 'jpeg' ? 'jpg' : 'png'}`;
      await fs.writeFile(path.join(runDir, 'images', imageFile), Buffer.from(shot.url.slice(shot.url.indexOf(',') + 1), 'base64'));
      pages.push({ imageFile, width: shot.width, height: shot.height, viewport });
    }
    const result = { ...status, complete: true, endpoint, pages, screenshotAt: new Date().toISOString(), captureElapsedMs: Date.now() - started };
    await fs.writeFile(path.join(runDir, 'images', `${index}.json`), JSON.stringify(result, null, 2));
    results.push(result);
  }
  return results.map(({ index, name, mode, pages, captureElapsedMs }) => ({ index, name, mode, pages: pages?.length, captureElapsedMs }));
}
