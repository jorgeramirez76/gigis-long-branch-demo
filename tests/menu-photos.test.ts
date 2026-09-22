import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {test} from 'node:test';
import {MENU_PRICED} from '../src/data/menuPriced.js';

// menuPhotos.ts uses import.meta.glob (Vite only), so read its table as text.
const source=readFileSync(new URL('../src/data/menuPhotos.ts',import.meta.url),'utf8');
const table=source.slice(source.indexOf('const PHOTOS'),source.indexOf('export function menuPhotos'));

test('every menu photo is attached to a real menu item and has both sizes on disk',()=>{
  const blocks=[...table.matchAll(/^ {2}([\w-]+): \{\n([\s\S]*?)^ {2}\},/gm)];
  assert.ok(blocks.length>0);
  let count=0;
  for(const [,categoryId,body] of blocks){
    const category=MENU_PRICED.find(c=>c.id===categoryId);
    assert.ok(category,`unknown category ${categoryId}`);
    for(const [,quoted,bare] of body.matchAll(/^ {4}(?:"([^"]+)"|(\w+)): \[/gm)){
      const name=quoted??bare;
      assert.ok(category.items.some(item=>item.name===name),`${categoryId}: no menu item named "${name}"`);
      count++;
    }
  }
  assert.ok(count>=30);
  for(const [,slug] of table.matchAll(/photo\("([^"]+)"/g)){
    for(const width of [320,960]) assert.ok(existsSync(new URL(`../src/assets/menu/${slug}-${width}.webp`,import.meta.url)),`missing ${slug}-${width}.webp`);
  }
});
