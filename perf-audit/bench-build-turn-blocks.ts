import { buildTurnBlocks } from '/Users/elian/Documents/od-wt-perf/apps/web/src/runtime/chat/build-turn-blocks.ts';
import { dedupeToolUsesById } from '/Users/elian/Documents/od-wt-perf/apps/web/src/runtime/tool-events.ts';
import { readFileSync } from 'node:fs';

const cases = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Array<{
  label: string; events: any[];
}>;

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
  return { n: xs.length, p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), max: +s[s.length - 1]!.toFixed(3) };
}

for (const c of cases) {
  // warm
  for (let i = 0; i < 3; i++) { buildTurnBlocks({ events: c.events, runStatus: 'succeeded' }); }
  const bt: number[] = []; const dd: number[] = [];
  const iters = c.events.length > 2000 ? 20 : 200;
  for (let i = 0; i < iters; i++) {
    let t = performance.now();
    const deduped = dedupeToolUsesById(c.events);
    dd.push(performance.now() - t);
    t = performance.now();
    buildTurnBlocks({ events: deduped, runStatus: 'succeeded' });
    bt.push(performance.now() - t);
  }
  const blocks = buildTurnBlocks({ events: dedupeToolUsesById(c.events), runStatus: 'succeeded' });
  console.log(JSON.stringify({
    label: c.label, events: c.events.length,
    dedupedEvents: dedupeToolUsesById(c.events).length,
    blocks: blocks.length,
    dedupeMs: stats(dd), buildTurnBlocksMs: stats(bt),
  }));
}
