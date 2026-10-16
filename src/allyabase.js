import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sessionless from 'sessionless-node';
import config from './config.js';

// guysofwisdom's own identity on allyabase. Visitors never talk to allyabase directly.
const keyFile = join(config.dataDir, 'keys.json');

const saveKeys = (keys) => {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(keyFile, JSON.stringify(keys), { mode: 0o600 });
};
const getKeys = () => existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, 'utf8')) : null;

export const initKeys = async () => {
  if(!getKeys()) {
    return await sessionless.generateKeys(saveKeys, getKeys);
  }
  sessionless.getKeys = getKeys;
  return getKeys();
};

const call = async (method, url, body) => {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let json;
  try {
    json = await res.json();
  } catch(err) {
    throw new Error(`${method} ${url} returned ${res.status} with a non-JSON body`);
  }
  // allyabase services sometimes report failure in a 200 body
  if(!res.ok || json.error) {
    throw new Error(`${method} ${url} failed (${res.status}): ${JSON.stringify(json.error || json)}`);
  }
  return json;
};

const qs = (params) => new URLSearchParams(params).toString();

export const bdo = {
  hash: createHash('sha256').update('guysofwisdom').digest('hex'),

  createUser: async () => {
    const { pubKey } = getKeys();
    const timestamp = Date.now() + '';
    const signature = await sessionless.sign(timestamp + pubKey + bdo.hash);
    const user = await call('PUT', `${config.bdoURL}user/create`, { timestamp, pubKey, hash: bdo.hash, signature });
    return user.uuid;
  },

  get: async (uuid) => {
    const timestamp = Date.now() + '';
    const signature = await sessionless.sign(timestamp + uuid + bdo.hash);
    const res = await call('GET', `${config.bdoURL}user/${uuid}/bdo?${qs({ timestamp, hash: bdo.hash, signature })}`);
    return res.bdo;
  },

  put: async (uuid, value) => {
    const { pubKey } = getKeys();
    const timestamp = Date.now() + '';
    const signature = await sessionless.sign(timestamp + uuid + bdo.hash);
    await call('PUT', `${config.bdoURL}user/${uuid}/bdo`, { timestamp, uuid, hash: bdo.hash, bdo: value, pubKey, signature });
  }
};

export const addie = {
  createUser: async () => {
    const { pubKey } = getKeys();
    const timestamp = Date.now() + '';
    const signature = await sessionless.sign(timestamp + pubKey);
    const user = await call('PUT', `${config.addieURL}user/create`, { timestamp, pubKey, signature });
    return user.uuid;
  },

  // returns { paymentIntent: <client secret>, publishableKey, ... }
  createIntent: async (uuid, amount, currency) => {
    const timestamp = Date.now() + '';
    const signature = await sessionless.sign(timestamp + uuid + amount + currency);
    return await call('POST', `${config.addieURL}user/${uuid}/processor/stripe/intent-without-splits`, { timestamp, amount, currency, signature });
  },

  intentStatus: async (uuid, paymentIntentId) => {
    const timestamp = Date.now() + '';
    const signature = await sessionless.sign(timestamp + uuid + paymentIntentId);
    return await call('GET', `${config.addieURL}user/${uuid}/processor/stripe/payment/${paymentIntentId}/status?${qs({ timestamp, signature })}`);
  }
};
