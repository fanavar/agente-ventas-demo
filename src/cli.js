import readline from 'node:readline';
import { Agent } from './agent.js';
import { getClient } from './client.js';
import { Store } from './store.js';

const { client, model } = await getClient(process.argv.includes('--real'));
const agent = new Agent({ client, model, store: new Store(), customer: 'cli' });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'Cliente: ' });

console.log(`Modelo: ${model}. Ctrl+C para salir.`);
rl.prompt();
for await (const line of rl) {
  if (line.trim()) {
    const { reply, paused, trace } = await agent.reply(line.trim());
    for (const t of trace.tools) console.log(`  [${t.name}] ${JSON.stringify(t.input)} -> ${JSON.stringify(t.result)}`);
    for (const b of trace.blocked) console.log(`  [bloqueado] ${b.reply} (${b.problems.join('; ')})`);
    console.log(`Agente: ${reply}`);
    if (paused) break;
  }
  rl.prompt();
}
rl.close();
