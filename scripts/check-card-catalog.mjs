import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const catalog=JSON.parse(readFileSync(new URL('../data/cards.zh-Hant.json',import.meta.url),'utf8'));
assert.equal(catalog.schemaVersion,1);
assert.equal(catalog.locale,'zh-Hant');
assert.equal(catalog.complete,false);
assert.ok(Array.isArray(catalog.cards));
const keys=new Set();
for(const [i,c] of catalog.cards.entries()){
  assert.match(c.number,/^(UA|EX|PC|UAPR)[A-Z0-9]*\/[A-Z0-9]+-[0-9]+-[0-9]+$/);
  assert.equal(c.id,c.number+'#'+c.rarity);
  assert.ok(c.nameZh.trim());
  assert.ok(c.seriesCode);
  assert.ok(!keys.has(c.id),'duplicate '+c.id);
  keys.add(c.id);
  assert.ok(c.sourceUrl.startsWith('https://rugiacreation.com/ua/search'));
  assert.equal(c.imageUrl,null,'art not licensed');
  assert.equal(c.effectZh,null,'translation not licensed');
}
console.log('UA card metadata validation passed: '+keys.size+' identified-only records.');
