import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Store } from './store.js';
import { TOOLS, runTool } from './tools.js';

// stdout carries the protocol: never console.log here.
const store = new Store(process.env.STORE_DB ?? ':memory:');
const server = new McpServer({ name: 'agente-ventas-demo', version: '0.1.0' });
const ctx = { customer: 'mcp', turn: 0, customerText: '' };

for (const [name, tool] of Object.entries(TOOLS)) {
  const draftOnly = name === 'create_order';
  server.registerTool(name, {
    // An MCP client cannot prove what the customer said, so orders stay drafts here.
    description: draftOnly ? 'Create a draft order. Confirmation is not available over MCP.' : tool.description,
    inputSchema: draftOnly ? tool.schema.omit({ order_id: true }) : tool.schema,
  }, async (input) => {
    const { order_id, ...safe } = input;
    const result = runTool(store, name, safe, ctx);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: Boolean(result.error) };
  });
}

await server.connect(new StdioServerTransport());
