import { previousTodosByAssistantMessageId, latestTodoWriteInputFromMessages } from '/Users/elian/Documents/od-wt-perf/apps/web/src/runtime/todos.ts';
import { readFileSync } from 'node:fs';

const convs = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Array<{ label: string; messages: any[] }>;
const stats = (xs: number[]) => { const s=[...xs].sort((a,b)=>a-b); const q=(p:number)=>+s[Math.min(s.length-1,Math.floor(s.length*p))]!.toFixed(3);
  return { n: xs.length, p50: q(.5), p95: q(.95), max: +s[s.length-1]!.toFixed(3) }; };

for (const c of convs) {
  const evTotal = c.messages.reduce((n, m) => n + (m.events?.length ?? 0), 0);
  for (let i=0;i<5;i++) previousTodosByAssistantMessageId(c.messages);
  const a: number[] = [], b: number[] = [];
  const iters = evTotal > 3000 ? 50 : 300;
  for (let i=0;i<iters;i++) {
    let t = performance.now(); previousTodosByAssistantMessageId(c.messages); a.push(performance.now()-t);
    t = performance.now(); latestTodoWriteInputFromMessages(c.messages); b.push(performance.now()-t);
  }
  console.log(JSON.stringify({ label: c.label, msgs: c.messages.length, events: evTotal,
    previousTodosByAssistantMessageId_ms: stats(a), latestTodoWriteInputFromMessages_ms: stats(b) }));
}
