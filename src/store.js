import { bdo } from './allyabase.js';
import { FREE_PLAYS } from './config.js';

// All state lives in one BDO on allyabase, cached in memory and written through.
//   visitors: { [pubKey]: { plays, credits, unlocked, heard: { [category]: [lineId] } } }
//   intents:  { [paymentIntentId]: { pubKey, offer, redeemed } }
let uuid;
let state;
let queue = Promise.resolve();

export const init = async () => {
  uuid = await bdo.createUser();
  const existing = await bdo.get(uuid);
  state = existing && existing.visitors ? existing : { visitors: {}, intents: {} };
  if(state !== existing) {
    await bdo.put(uuid, state);
  }
};

// Mutations are serialized and persisted before they resolve.
export const update = (fn) => {
  const run = queue.then(async () => {
    const before = JSON.stringify(state);
    try {
      const result = await fn(state);
      await bdo.put(uuid, state);
      return result;
    } catch(err) {
      state = JSON.parse(before);
      throw err;
    }
  });
  queue = run.catch(() => {});
  return run;
};

export const visitor = (st, pubKey) => {
  if(!st.visitors[pubKey]) {
    st.visitors[pubKey] = { plays: 0, credits: 0, unlocked: false, heard: {} };
  }
  const v = st.visitors[pubKey];
  if(Array.isArray(v.heard)) {
    v.heard = {}; // pre-category state kept heard koans as a flat list of indexes
  }
  return v;
};

export const summary = (v) => ({
  plays: v.plays,
  freeLeft: Math.max(0, FREE_PLAYS - v.plays),
  credits: v.credits,
  unlocked: v.unlocked
});

export const read = (pubKey) => {
  const v = state.visitors[pubKey] || { plays: 0, credits: 0, unlocked: false };
  return summary(v);
};
