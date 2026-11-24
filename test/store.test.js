import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, isConfirmation } from '../src/store.js';
import { runTool, toolDefinitions } from '../src/tools.js';

const draft = (s, quantity = 2) => s.draftOrder({ customer: 'a', sku: 'MOU-01', quantity, turn: 1 });
const confirm = (s, o, extra = {}) =>
  s.confirmOrder({ customer: 'a', order_id: o.order_id, turn: 2, customerText: 'Sí, confirmo', ...extra });

test('search ignores accents and plurals, and never leaks prices', () => {
  const { products } = new Store().search('audifono');
  assert.deepEqual(products.map((p) => p.sku), ['AUD-01']);
  assert.equal('price' in products[0], false);
});
test('search with nothing useful returns nothing', () => {
  assert.deepEqual(new Store().search('xyz').products, []);
  assert.deepEqual(new Store().search('??').products, []);
});
test('draft does not touch stock; confirming does, once', () => {
  const s = new Store();
  const o = draft(s);
  assert.equal(o.total, 37980);
  assert.equal(s.check('MOU-01').stock, 15);
  assert.equal(confirm(s, o).status, 'confirmed');
  assert.equal(confirm(s, o).status, 'confirmed');
  assert.equal(s.check('MOU-01').stock, 13);
});
test('cannot confirm in the same turn, two turns later, with a "no", or for another customer', () => {
  const s = new Store();
  const o = draft(s);
  for (const extra of [{ turn: 1 }, { turn: 3 }, { customerText: 'no, gracias' }]) {
    assert.equal(confirm(s, o, extra).error, 'customer_has_not_confirmed');
  }
  assert.equal(confirm(s, o, { customer: 'b' }).error, 'order_not_found');
  assert.equal(s.check('MOU-01').stock, 15);
});
test('a price change between summary and confirmation blocks the order', () => {
  const s = new Store();
  const o = draft(s);
  s.db.prepare("UPDATE products SET price = 20990 WHERE sku = 'MOU-01'").run();
  assert.equal(confirm(s, o).error, 'price_changed');
  assert.equal(confirm(s, o).error, 'order_expired');
});
test('stock sold meanwhile blocks the order', () => {
  const s = new Store();
  const o = draft(s);
  s.db.prepare("UPDATE products SET stock = 1 WHERE sku = 'MOU-01'").run();
  assert.equal(confirm(s, o).error, 'insufficient_stock');
});
test('confirmation wording', () => {
  for (const t of ['sí', 'Si, confirmo', 'dale', 'OK']) assert.equal(isConfirmation(t), true, t);
  for (const t of ['no', 'sí, pero que sean 3', '¿si compro dos?', 'ok, espera', 'cuánto vale']) {
    assert.equal(isConfirmation(t), false, t);
  }
});
test('tool input is validated', () => {
  const s = new Store();
  const ctx = { customer: 'a', turn: 1, customerText: '' };
  for (const quantity of [0, -1, 1.5, 99, '2']) {
    assert.equal(runTool(s, 'create_order', { sku: 'MOU-01', quantity }, ctx).error, 'invalid_input');
  }
  assert.equal(runTool(s, 'create_order', { sku: 'MOU-01', quantity: 1, price: 1 }, ctx).error, 'invalid_input');
  assert.equal(runTool(s, 'constructor', {}, ctx).error, 'unknown_tool');
  assert.equal(runTool(s, 'check_price_and_stock', { sku: "x' OR 1=1" }, ctx).error, 'product_not_found');
  assert.equal(toolDefinitions().length, 4);
});
