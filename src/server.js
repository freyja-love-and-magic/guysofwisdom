import express from 'express';
import config, { FREE_PLAYS, OFFERS, CATEGORIES } from './config.js';
import { authenticate } from './auth.js';
import { initKeys, addie } from './allyabase.js';
import * as store from './store.js';
import { audioURL, audioFile } from './audio.js';

const fail = (status, message) => Object.assign(new Error(message), { status });

const linesByCategory = {};
for(const line of config.lines) {
  (linesByCategory[line.category] ||= []).push(line);
}
const personaCount = new Set(config.lines.map(l => l.persona)).size;

await initKeys();
const addieUUID = await addie.createUser();
await store.init();

const app = express();
app.use(express.json());
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(config.publicDir));
app.get('/audio/:name', (req, res) => {
  const file = audioFile(req.params.name);
  if(!file) {
    return res.sendStatus(404);
  }
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(file);
});

const handler = (fn) => async (req, res) => {
  try {
    res.send(await fn(req));
  } catch(err) {
    const status = err.status || 500;
    if(status === 500) {
      console.error(err);
    }
    res.status(status).send({ error: err.status ? err.message : 'internal error' });
  }
};

app.get('/api/config', handler(async () => ({
  freePlays: FREE_PLAYS,
  personaCount,
  categories: Object.entries(linesByCategory).map(([id, lines]) => ({ id, ...CATEGORIES[id], count: lines.length })),
  offers: Object.fromEntries(Object.entries(OFFERS).map(([id, o]) => [id, { amount: o.amount, currency: o.currency, label: o.label }]))
})));

app.get('/api/me', handler(async (req) => {
  const pubKey = authenticate(req.query, 'me');
  return store.read(pubKey);
}));

// Costs one play: a free one, then a credit, unless the visitor has unlocked everything.
app.post('/api/play', handler(async (req) => {
  const category = req.body.category;
  const lines = linesByCategory[category];
  if(!lines) {
    throw fail(400, 'unknown category');
  }
  const pubKey = authenticate(req.body, 'play', category);

  return await store.update((st) => {
    const v = store.visitor(st, pubKey);
    if(!v.unlocked && v.plays >= FREE_PLAYS && v.credits < 1) {
      throw fail(402, 'payment required');
    }
    v.heard[category] ||= [];
    let unheard = lines.filter(l => !v.heard[category].includes(l.id));
    if(unheard.length === 0) {
      v.heard[category] = [];
      unheard = lines;
    }
    const line = unheard[Math.floor(Math.random() * unheard.length)];
    if(!v.unlocked && v.plays >= FREE_PLAYS) {
      v.credits--;
    }
    v.plays++;
    v.heard[category].push(line.id);
    return { persona: line.persona, category, text: line.text, audio: audioURL(line), me: store.summary(v) };
  });
}));

app.post('/api/checkout', handler(async (req) => {
  const offerId = req.body.offer;
  const offer = OFFERS[offerId];
  if(!offer) {
    throw fail(400, 'unknown offer');
  }
  const pubKey = authenticate(req.body, 'checkout', offerId);

  const intent = await addie.createIntent(addieUUID, offer.amount, offer.currency);
  const intentId = intent.paymentIntent.split('_secret_')[0];
  await store.update((st) => {
    st.intents[intentId] = { pubKey, offer: offerId, redeemed: false };
  });
  return { intentId, clientSecret: intent.paymentIntent, publishableKey: intent.publishableKey };
}));

app.post('/api/redeem', handler(async (req) => {
  const intentId = req.body.intentId;
  const pubKey = authenticate(req.body, 'redeem', intentId);

  return await store.update(async (st) => {
    const record = st.intents[intentId];
    if(!record || record.pubKey !== pubKey) {
      throw fail(404, 'unknown payment');
    }
    if(!record.redeemed) {
      const status = await addie.intentStatus(addieUUID, intentId);
      const offer = OFFERS[record.offer];
      if(status.status !== 'succeeded' || status.amount !== offer.amount || status.currency !== offer.currency) {
        throw fail(402, `payment not complete (${status.status})`);
      }
      const v = store.visitor(st, pubKey);
      if(offer.credits === null) {
        v.unlocked = true;
      } else {
        v.credits += offer.credits;
      }
      record.redeemed = true;
    }
    return store.summary(store.visitor(st, pubKey));
  });
}));

app.listen(config.port, () => console.log(`guysofwisdom listening on ${config.port}`));
