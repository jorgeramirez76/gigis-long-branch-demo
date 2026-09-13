import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialEditSelections, replaceCartLine } from '../src/ordering/cartEdit.js';
import type { CartLine } from '../src/ordering/CartContext.js';
const line = (lineId: string, quantity = 1): CartLine => ({ lineId, itemName: 'Plain Pizza', categoryId: 'pizza', basePrice: 1700, quantity, options: [{ group: 'Toppings', name: 'Pepperoni', delta: 300, placement: 'left' }], notes: 'Well done' });
test('editing preserves identity, position, and every other cart line', () => {
  const original = [line('first'), line('second', 2), line('third')];
  const replacement = { ...original[1], basePrice: 1800, quantity: 3, notes: 'Light bake', options: [{ group: 'Toppings', name: 'Onions', delta: 150, placement: 'right' as const }] };
  const next = replaceCartLine(original, 'second', replacement);
  assert.equal(next.length, original.length);
  assert.equal(next[1].lineId, 'second');
  assert.equal(next[0], original[0]); assert.equal(next[2], original[2]);
  assert.equal(next[1].basePrice, 1800); assert.equal(next[1].quantity, 3);
  assert.equal(next[1].notes, 'Light bake'); assert.equal(next[1].options[0].placement, 'right');
  assert.equal(original[1].notes, 'Well done', 'original state is immutable');
});
test('matching another customization never merges or deletes the edited line', () => {
  const original = [line('one'), line('two')];
  const next = replaceCartLine(original, 'two', { ...line('one'), quantity: 4 });
  assert.deepEqual(next.map(item => [item.lineId, item.quantity]), [['one', 1], ['two', 4]]);
});
test('edited quantities respect both per-line and whole-cart caps', () => {
  assert.equal(replaceCartLine([line('one')], 'one', line('one', 999))[0].quantity, 50);
  const cart = [line('one', 40), line('two', 50), line('edit')];
  assert.equal(replaceCartLine(cart, 'edit', line('edit', 50))[2].quantity, 10);
});
test('uncertain payments, deleted lines, invalid quantities and identity changes cannot edit', () => {
  const cart = [line('one')];
  for (const next of [replaceCartLine(cart, 'one', line('one', 3), true), replaceCartLine(cart, 'missing', line('missing')), replaceCartLine(cart, 'one', { ...line('one'), itemName: 'Different item' }), replaceCartLine(cart, 'one', line('one', NaN))]) assert.equal(next, cart);
});
test('prefill retains current choices by group and discards removed choices', () => {
  const saved = { ...line('one'), options: [{ group: 'Toppings', name: 'Pepperoni', delta: 999 }, { group: 'Toppings', name: 'Removed topping', delta: 100 }, { group: 'Sauce', name: 'Pepperoni', delta: 0 }] };
  const selected = initialEditSelections([{ group: 'Toppings', choices: [{ name: 'Pepperoni', delta: '+$3.00' }] }, { group: 'Sauce', choices: [{ name: 'Ranch' }] }], saved);
  assert.deepEqual([...selected[0]], ['Pepperoni']);
  assert.equal(selected[1].size, 0);
  assert.equal(initialEditSelections([{ group: 'Toppings', choices: [{ name: 'Pepperoni' }] }])[0].size, 0);
});
