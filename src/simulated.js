import { plain } from './store.js';

// Offline stand-in with the same interface as the SDK client. It is a handful of rules, not a language
// model: it lets anyone run the code for free, and says nothing about how well a real model behaves.

const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
let id = 0;
const use = (name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `sim_${id += 1}`, name, input }] });
const clp = (n) => `$${String(n).replace(/\B(?=(\d{3})+$)/g, '.')}`;

function lastDraft(messages) {
  for (const m of [...messages].reverse()) {
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    const r = JSON.parse(m.content[0].content);
    if (r.status === 'draft') return r;
  }
  return null;
}

function decide(messages) {
  const last = messages.at(-1).content;
  const said = messages.filter((m) => m.role === 'user' && typeof m.content === 'string'
    && !m.content.startsWith('[Validador')).at(-1).content;
  const ask = plain(said);
  const wantsOrder = /\b(quiero|comprar|llevo|pedir)\b/.test(ask);

  if (typeof last === 'string') {
    if (/reclamo|persona|humano|garantia|defectuoso|descuento/.test(ask)) {
      return use('escalate_to_human', { reason: 'customer_request', summary: said.slice(0, 300) });
    }
    const draft = lastDraft(messages);
    if (draft && /^(si|dale|ok|confirmo)\b/.test(ask)) {
      return use('create_order', { sku: draft.sku, quantity: draft.quantity, order_id: draft.order_id });
    }
    if (/^(hola|gracias|no)\b/.test(ask) && ask.split(' ').length < 4) return text('¿En qué producto te puedo ayudar?');
    return use('search_products', { query: said.slice(0, 100) });
  }

  const r = JSON.parse(last[0].content);
  if (r.products) {
    if (!r.products.length) return text('No encontré ese producto. ¿Qué tipo de accesorio buscas?');
    if (r.products.length > 1) return text(`Tengo estas opciones: ${r.products.map((p) => p.name).join(', ')}. ¿Cuál te interesa?`);
    const { sku } = r.products[0];
    const quantity = Number(ask.match(/\b([1-9]\d?)\b/)?.[1] ?? 1);
    return wantsOrder ? use('create_order', { sku, quantity }) : use('check_price_and_stock', { sku });
  }
  if (r.status === 'draft') return text(`Sería ${r.quantity} x ${r.name}, total ${clp(r.total)}. ¿Confirmas?`);
  if (r.status === 'confirmed') return text(`Tu pedido de ${r.name} quedó confirmado por ${clp(r.total)}.`);
  if (r.error === 'insufficient_stock') return text(`No tenemos unidades suficientes de ${r.name}: quedan ${r.stock}.`);
  if (r.error) return use('escalate_to_human', { reason: r.error, summary: said.slice(0, 300) });
  return text(r.stock
    ? `${r.name} cuesta ${clp(r.price)} y quedan ${r.stock} unidades.`
    : `${r.name} cuesta ${clp(r.price)}, pero está agotado.`);
}

export const simulatedClient = () => ({ messages: { create: async ({ messages }) => decide(messages) } });
