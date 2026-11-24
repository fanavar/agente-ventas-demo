# Design and plan (approved 2026-11-24)

**Why:** show tool calling, hallucination control, evals and MCP in public code, using a fictional store.
**Out of scope:** real WhatsApp, RAG, web panel.

## Approaches considered
1. Node.js + MCP (chosen): one language for agent and MCP server. 2. Python + FastAPI: equally viable. 3. n8n: little visible code.

## Constraints
- Node >= 20.12, few dependencies, offline by default. Prices and stock come from SQLite, never from the prompt.
- The README only shows measured results.

## Plan (each task ends with passing tests)
1. `src/store.js`: search, stock/price, two-step order, escalate. 
2. `src/guard.js`: block amounts, stock and discounts without evidence from this turn.
3. `src/agent.js`: tool loop, one retry, then human handoff.
4. `src/mcp.js`: same tools over stdio; orders stay drafts.
5. `evals/`: 20 cases. `README.md`.

## Review focus
- Customer states a fake price -> it is not evidence.
- Price or stock changes between summary and confirmation -> no order.
- Model tries to confirm in the same turn, or customer says "no" -> no order.
- Right price, wrong product -> blocked when the sentence names one product.
- Tool error, refusal, truncation or API failure -> human handoff.
