import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('a real MCP client can list and call the tools over stdio', async (t) => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/mcp.js', import.meta.url))],
  }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    let data = null;
    try { data = JSON.parse(r.content[0].text); } catch { /* protocol error text */ }
    return { isError: Boolean(r.isError), data };
  };

  const { tools } = await client.listTools();
  assert.equal(tools.length, 4);
  const order = tools.find((x) => x.name === 'create_order');
  assert.equal('order_id' in order.inputSchema.properties, false);

  assert.equal((await call('check_price_and_stock', { sku: 'MOU-01' })).data.price, 18990);
  assert.equal((await call('check_price_and_stock', { sku: 'NOPE' })).isError, true);
  assert.equal((await call('create_order', { sku: 'MOU-01', quantity: -1 })).isError, true);
  assert.equal((await call('create_order', { sku: 'MOU-01', quantity: 1 })).data.status, 'draft');
  const sneaky = await call('create_order', { sku: 'MOU-01', quantity: 1, order_id: 1 });
  assert.notEqual(sneaky.data?.status, 'confirmed');
  assert.equal((await call('check_price_and_stock', { sku: 'MOU-01' })).data.stock, 15);
});
