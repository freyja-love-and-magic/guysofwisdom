// End-to-end run of the app server against a real BDO + continuebee (BDO_URL).
// Addie needs Stripe keys, so this test stands in a small local HTTP server for it;
// everything else is the real code path. Content is a tiny fixture written to a temp dir.
// Run: BDO_URL=http://localhost:3003 node --test test/*.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

const skip = !process.env.BDO_URL && 'BDO_URL not set';

const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler).listen(0, () => resolve(server));
});
const readBody = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', c => data += c);
  req.on('end', () => resolve(data));
});

let addie, app, base, intentPaid = false;
const privateKey = bytesToHex(secp256k1.utils.randomPrivateKey());
const pubKey = bytesToHex(secp256k1.getPublicKey(privateKey));

const signed = (action, extra = '', fields = {}) => {
  const timestamp = Date.now() + '';
  const signature = secp256k1.sign(keccak_256(utf8ToBytes(timestamp + pubKey + action + extra)), privateKey).toCompactHex();
  return { ...fields, pubKey, timestamp, signature };
};
const post = async (path, body) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const play = (category) => post('/api/play', signed('play', category, { category }));

before(async () => {
  if(skip) return;

  const content = mkdtempSync(join(tmpdir(), 'gow-content-'));
  mkdirSync(join(content, 'audio'));
  const manifest = [];
  for(const [category, persona] of [['koans', 'Marky'], ['pumpup', 'Johnny']]) {
    for(let i = 1; i <= 3; i++) {
      const audio = `audio/${persona}_${i}.mp3`;
      writeFileSync(join(content, audio), 'ID3fakemp3');
      manifest.push({ id: `${category}_${i}`, category, persona, text: `${category} line ${i}`, audio });
    }
  }
  writeFileSync(join(content, 'manifest.json'), JSON.stringify(manifest));

  addie = await listen(async (req, res) => {
    await readBody(req);
    res.setHeader('Content-Type', 'application/json');
    if(req.url.startsWith('/user/create')) return res.end(JSON.stringify({ uuid: 'addie-user' }));
    if(req.url.includes('/intent-without-splits')) return res.end(JSON.stringify({ paymentIntent: 'pi_test123_secret_abc', publishableKey: 'pk_test' }));
    if(req.url.includes('/payment/pi_test123/status')) return res.end(JSON.stringify({ paymentIntentId: 'pi_test123', status: intentPaid ? 'succeeded' : 'requires_payment_method', amount: 200, currency: 'usd' }));
    res.statusCode = 404; res.end('{"error":"nope"}');
  });
  const port = 31000 + Math.floor(Math.random() * 1000);
  base = `http://localhost:${port}`;
  app = spawn('node', ['src/server.js'], {
    env: {
      ...process.env, PORT: port, DATA_DIR: mkdtempSync(join(tmpdir(), 'gow-')), CONTENT_DIR: content,
      ADDIE_URL: `http://localhost:${addie.address().port}`
    },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((resolve, reject) => {
    app.stdout.on('data', d => String(d).includes('listening') && resolve());
    app.on('exit', code => reject(new Error('server exited ' + code)));
  });
});

after(() => {
  app && app.kill();
  addie && addie.close();
});

test('config lists categories and persona count, not persona names', { skip }, async () => {
  const config = await (await fetch(base + '/api/config')).json();
  assert.deepEqual(config.categories.map(c => c.id).sort(), ['koans', 'pumpup']);
  assert.equal(config.personaCount, 2);
  assert.ok(!JSON.stringify(config).includes('Marky'));
});

test('four free plays, no repeats within a category, then payment required', { skip }, async () => {
  const heard = [];
  for(let i = 0; i < 3; i++) {
    const r = await play('koans');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.persona, 'Marky');
    heard.push(r.body.text);
    const audio = await fetch(base + r.body.audio);
    assert.equal(audio.status, 200);
  }
  assert.equal(new Set(heard).size, 3);
  const fourth = await play('pumpup');
  assert.equal(fourth.status, 200);
  assert.equal(fourth.body.persona, 'Johnny');
  assert.equal(fourth.body.me.freeLeft, 0);
  assert.equal((await play('koans')).status, 402);
});

test('audio is only reachable through keyed names', { skip }, async () => {
  assert.equal((await fetch(base + '/audio/Marky_1.mp3')).status, 404);
  assert.equal((await fetch(base + '/audio/audio/Marky_1.mp3')).status, 404);
});

test('signatures are single use and must match the action and category', { skip }, async () => {
  const body = signed('play', 'koans', { category: 'koans' });
  assert.equal((await post('/api/play', body)).status, 402); // paywalled, but authenticated
  assert.equal((await post('/api/play', body)).status, 403); // replay
  assert.equal((await post('/api/play', signed('play', 'koans', { category: 'pumpup' }))).status, 403); // category swapped
  assert.equal((await post('/api/play', signed('play', 'nope', { category: 'nope' }))).status, 400);
});

test('redeem refuses until paid, then grants credits once', { skip }, async () => {
  const checkout = await post('/api/checkout', signed('checkout', 'pack10', { offer: 'pack10' }));
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  assert.equal(checkout.body.intentId, 'pi_test123');
  const body = () => signed('redeem', 'pi_test123', { intentId: 'pi_test123' });
  assert.equal((await post('/api/redeem', body())).status, 402);
  intentPaid = true;
  const paid = await post('/api/redeem', body());
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.credits, 10);
  assert.equal((await post('/api/redeem', body())).body.credits, 10); // not granted twice
  const next = await play('pumpup');
  assert.equal(next.status, 200);
  assert.equal(next.body.me.credits, 9);
});
