import Database from 'better-sqlite3';

// Fictional catalog. Prices in CLP.
const SEED = [
  ['TEC-01', 'Teclado Nimbus', 'teclado mecánico inalámbrico', 39990, 8],
  ['TEC-02', 'Teclado Pampa', 'teclado compacto silencioso', 24990, 0],
  ['MOU-01', 'Mouse Cóndor', 'mouse inalámbrico ergonómico', 18990, 15],
  ['MOU-02', 'Mouse Pudú', 'mouse con cable liviano', 9990, 3],
  ['AUD-01', 'Audífonos Alerce', 'audífonos bluetooth con micrófono', 45990, 5],
  ['MON-01', 'Monitor Austral 24', 'monitor full hd de 24 pulgadas', 129990, 2],
];

export const plain = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const NO = /\b(no|nunca|cancel\w*|espera|todavia|aun|mejor|cambi\w*|pero)\b/;
const YES = /\b(si|confirmo|confirmado|dale|ok|acepto|de acuerdo|perfecto)\b/;

// Decided by code, from the customer's own words. Doubt counts as "no".
export function isConfirmation(text) {
  const t = plain(text);
  return YES.test(t) && !NO.test(t) && !t.includes('?');
}

export class Store {
  constructor(file = ':memory:') {
    this.db = new Database(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (sku TEXT PRIMARY KEY, name TEXT, description TEXT,
        price INTEGER CHECK (price > 0), stock INTEGER CHECK (stock >= 0));
      CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, customer TEXT, sku TEXT, quantity INTEGER,
        unit_price INTEGER, total INTEGER, turn INTEGER, status TEXT);
      CREATE TABLE IF NOT EXISTS handoffs (id INTEGER PRIMARY KEY, customer TEXT, reason TEXT, summary TEXT);`);
    if (!this.db.prepare('SELECT 1 FROM products').get()) {
      const insert = this.db.prepare('INSERT INTO products VALUES (?, ?, ?, ?, ?)');
      this.db.transaction(() => SEED.forEach((row) => insert.run(...row)))();
    }
  }

  // Search never returns prices or stock: those have a single source.
  search(query) {
    const words = plain(query).split(/\W+/).filter((w) => w.length > 2).map((w) => w.replace(/s$/, ''));
    if (!words.length) return { products: [] };
    const all = this.db.prepare('SELECT sku, name, description FROM products').all();
    const scored = all.map((p) => {
      const text = plain(`${p.name} ${p.description} ${p.sku}`);
      return { p, score: words.filter((w) => text.includes(w)).length };
    });
    const best = Math.max(...scored.map((s) => s.score));
    return { products: best ? scored.filter((s) => s.score === best).map((s) => s.p) : [] };
  }

  check(sku) {
    const p = this.db.prepare('SELECT sku, name, price, stock FROM products WHERE sku = ?').get(sku);
    return p ?? { error: 'product_not_found' };
  }

  draftOrder({ customer, sku, quantity, turn }) {
    const p = this.check(sku);
    if (p.error) return p;
    if (quantity > p.stock) return { error: 'insufficient_stock', sku, name: p.name, stock: p.stock };
    const total = p.price * quantity;
    const { lastInsertRowid } = this.db.prepare(
      "INSERT INTO orders (customer, sku, quantity, unit_price, total, turn, status) VALUES (?, ?, ?, ?, ?, ?, 'draft')",
    ).run(customer, sku, quantity, p.price, total, turn);
    return { status: 'draft', order_id: Number(lastInsertRowid), sku, name: p.name, quantity, price: p.price, total };
  }

  confirmOrder({ customer, order_id, turn, customerText }) {
    return this.db.transaction(() => {
      const o = this.db.prepare('SELECT * FROM orders WHERE id = ? AND customer = ?').get(order_id, customer);
      if (!o) return { error: 'order_not_found' };
      const p = this.check(o.sku);
      const done = { status: 'confirmed', order_id, sku: o.sku, name: p.name,
        quantity: o.quantity, price: o.unit_price, total: o.total };
      if (o.status === 'confirmed') return done; // idempotent: stock is discounted once
      if (o.status !== 'draft') return { error: 'order_expired' };
      // Only the summary shown in the previous turn can be accepted.
      if (turn !== o.turn + 1 || !isConfirmation(customerText)) return { error: 'customer_has_not_confirmed' };
      if (p.price !== o.unit_price || p.stock < o.quantity) {
        this.db.prepare("UPDATE orders SET status = 'expired' WHERE id = ?").run(order_id);
        return { error: p.price !== o.unit_price ? 'price_changed' : 'insufficient_stock', ...p };
      }
      this.db.prepare('UPDATE products SET stock = stock - ? WHERE sku = ?').run(o.quantity, o.sku);
      this.db.prepare("UPDATE orders SET status = 'confirmed' WHERE id = ?").run(order_id);
      return done;
    }).immediate();
  }

  escalate({ customer, reason, summary }) {
    this.db.prepare('INSERT INTO handoffs (customer, reason, summary) VALUES (?, ?, ?)').run(customer, reason, summary);
    return { status: 'handed_to_human' };
  }
}
