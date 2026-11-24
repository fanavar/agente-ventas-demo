import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReply } from '../src/guard.js';

const evidence = [
  { name: 'Mouse Cóndor', price: 18990, stock: 15 },
  { name: 'Monitor Austral 24', price: 129990, stock: 2 },
];
const ok = (t, e = evidence) => assert.deepEqual(checkReply(t, e), [], t);
const bad = (t, e = evidence) => assert.notEqual(checkReply(t, e).length, 0, t);

test('accepts facts backed by a tool', () => {
  ok('El Mouse Cóndor cuesta $18.990 y quedan 15 unidades.');
  ok('El Monitor Austral 24 vale 129990 pesos.');
  ok('Hola, ¿qué buscas?', []);
  ok('Son 2 Mouse Cóndor: $18.990 cada uno, total $37.980.', [{ name: 'Mouse Cóndor', price: 18990, total: 37980, quantity: 2 }]);
});
test('blocks invented prices in several formats', () => {
  for (const t of ['Cuesta $9.990', 'cuesta 17000', 'vale 17 mil', 'son 17 lucas', 'sale $ 18,990.50',
    'te lo dejo en 15.000', 'cuesta diecisiete mil pesos', 'a 15990 CLP', '$5']) bad(t);
});
test('blocks stock without evidence', () => {
  bad('Quedan 40 unidades del Mouse Cóndor.');
  bad('Tenemos stock disponible.', []);
  bad('Está agotado.', []);
});
test('blocks the opposite availability', () => {
  const pampa = [{ name: 'Teclado Pampa', price: 24990, stock: 0 }];
  bad('El Teclado Pampa está disponible.', pampa);
  bad('El Mouse Cóndor está agotado.');
  ok('El Teclado Pampa está agotado.', pampa);
  ok('El Teclado Pampa no está disponible.', pampa);
});
test('blocks a real price on the wrong product', () => bad('El Mouse Cóndor cuesta $129.990.'));
test('blocks discounts and gifts, which no tool provides', () => {
  bad('Te hago un 20% de descuento.');
  bad('El envío es gratis.');
});
test('blocks claiming an order that was not confirmed', () => {
  bad('Tu pedido quedó confirmado.');
  ok('Tu pedido quedó confirmado.', [{ status: 'confirmed', name: 'Mouse Cóndor', price: 18990, total: 18990, quantity: 1 }]);
});

// Found by adversarial probing after the first version passed its own tests.
const two = [{ name: 'Mouse Cóndor', price: 18990, stock: 15 }, { name: 'Mouse Pudú', price: 9990, stock: 3 }];
test('regressions: lies that used to get through', () => {
  for (const t of ['Cuesta 18 990', 'El Cóndor sale 9.990', 'Mouse Cóndor: $9.990 y Mouse Pudú: $18.990',
    'El Mouse Cóndor es muy bueno. Cuesta $9.990.', 'Quedan cuarenta', 'Te lo dejo a mitad de precio',
    'despacho sin costo', 'El envío llega mañana', 'Listo, ya compraste el mouse', 'precio: 500',
    'cuesta quinientos pesos', 'US$20']) bad(t, two);
});
test('regressions: honest replies that must not be blocked', () => {
  for (const t of ['El Mouse Cóndor cuesta $18.990 y el Mouse Pudú $9.990.', 'No hay descuentos disponibles.',
    'Tiene 24 pulgadas.', '¿Quieres confirmar tu pedido?', 'Para dejar el pedido listo, dime si confirmas.',
    'Mil gracias.', 'El Mouse Cóndor está disponible.']) ok(t, two);
});
