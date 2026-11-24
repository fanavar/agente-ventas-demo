import fs from 'node:fs';
import { Agent } from '../src/agent.js';
import { getClient } from '../src/client.js';
import { Store } from '../src/store.js';
import { CASES } from './cases.js';

const real = process.argv.includes('--real');
const { client, model } = await getClient(real);

function sabotaged(base, lie) {
  let used = false;
  return { messages: { create: async (params) => {
    const r = await base.messages.create(params);
    if (used || r.stop_reason !== 'end_turn') return r;
    used = true;
    return { ...r, content: [{ type: 'text', text: lie }] };
  } } };
}

const rows = [];
for (const c of CASES) {
  const store = new Store();
  const agent = new Agent({ client: c.sabotage ? sabotaged(client, c.sabotage) : client, model, store, customer: c.id });
  const seen = []; const tools = []; let handoff = null; let blocked = 0; const usage = { input: 0, output: 0 };
  let error = null;
  for (const turn of c.turns) {
    const r = await agent.reply(turn);
    seen.push(r.reply);
    tools.push(...r.trace.tools.map((t) => t.name));
    handoff ??= r.trace.handoff ?? null;
    error ??= r.trace.error ?? null;
    blocked += r.trace.blocked.length;
    usage.input += r.trace.usage.input; usage.output += r.trace.usage.output;
  }
  const all = seen.join('\n');
  const orders = store.db.prepare("SELECT count(*) n FROM orders WHERE status = 'confirmed'").get().n;
  const fails = [];
  if (error) fails.push(`model error: ${error}`);
  if (c.tool && !tools.includes(c.tool)) fails.push(`did not call ${c.tool}`);
  if (c.says && !c.says.test(all)) fails.push(`missing ${c.says}`);
  if (c.never?.test(all)) fails.push(`said ${c.never}`);
  if (c.orders !== undefined && orders !== c.orders) fails.push(`orders ${orders}`);
  if (c.handoff && !handoff) fails.push('no handoff');
  if (c.sabotage && !blocked) fails.push('lie was not blocked');
  for (const [sku, n] of Object.entries(c.stock ?? {})) if (store.check(sku).stock !== n) fails.push(`stock ${sku}`);
  rows.push({ id: c.id, pass: !fails.length, fails, blocked, handoff, usage, seen });
  console.log(`${fails.length ? 'FAIL' : 'ok  '} ${c.id}${fails.length ? `: ${fails.join('; ')}` : ''}`);
}

const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
console.log(`\n${sum((r) => r.pass)}/${rows.length} passed | model: ${model} | blocked replies: ${sum((r) => r.blocked)}`
  + ` | tokens in/out: ${sum((r) => r.usage.input)}/${sum((r) => r.usage.output)}`);
if (!real) console.log('Simulated model: this measures the harness, not a language model.');
fs.writeFileSync(new URL(`results-${model}.json`, import.meta.url), JSON.stringify(rows, null, 2));
process.exitCode = rows.every((r) => r.pass) ? 0 : 1;
