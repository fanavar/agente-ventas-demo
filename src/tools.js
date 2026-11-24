import { z } from 'zod';

// One definition shared by the agent and the MCP server.
export const TOOLS = {
  search_products: {
    description: 'Find products by name or description. Does not return prices or stock.',
    schema: z.strictObject({ query: z.string().min(1).max(100) }),
    run: (store, input) => store.search(input.query),
  },
  check_price_and_stock: {
    description: 'Exact current price (CLP) and stock for one SKU. Call it in the same turn before stating either.',
    schema: z.strictObject({ sku: z.string().min(1).max(20) }),
    run: (store, input) => store.check(input.sku),
  },
  create_order: {
    description: 'Without order_id, creates a draft whose summary must be shown to the customer. With order_id, '
      + 'confirms that draft, only after the customer accepts the summary in their next message.',
    schema: z.strictObject({
      sku: z.string().min(1).max(20),
      quantity: z.number().int().min(1).max(20),
      order_id: z.number().int().positive().optional(),
    }),
    run: (store, input, ctx) => (input.order_id
      ? store.confirmOrder({ ...ctx, order_id: input.order_id })
      : store.draftOrder({ ...ctx, sku: input.sku, quantity: input.quantity })),
  },
  escalate_to_human: {
    description: 'Hand the conversation to a person: complaints, requests for a human, or anything the tools cannot answer.',
    schema: z.strictObject({ reason: z.string().min(1).max(100), summary: z.string().min(1).max(500) }),
    run: (store, input, ctx) => store.escalate({ customer: ctx.customer, ...input }),
  },
};

export const toolDefinitions = () => Object.entries(TOOLS).map(([name, t]) => {
  const { $schema, ...input_schema } = z.toJSONSchema(t.schema);
  return { name, description: t.description, input_schema };
});

// Model input is untrusted: validate before running, and never throw into the loop.
export function runTool(store, name, input, ctx) {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name] : null;
  if (!tool) return { error: 'unknown_tool' };
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_input', details: z.prettifyError(parsed.error) };
  try {
    return tool.run(store, parsed.data, ctx);
  } catch {
    return { error: 'tool_failed' };
  }
}
