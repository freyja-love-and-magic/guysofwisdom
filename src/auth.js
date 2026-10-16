import sessionless from 'sessionless-node';
import config from './config.js';

// Requests from browsers are signed with the visitor's sessionless key:
//   signature = sign(timestamp + pubKey + action + extra)
// A signature may be used once; replays inside the time window are rejected.
const seen = new Map();

const sweep = (now) => {
  for(const [signature, time] of seen) {
    if(now - time > config.allowedTimeDifference) {
      seen.delete(signature);
    }
  }
};

export const authenticate = ({ pubKey, timestamp, signature }, action, extra = '') => {
  if(!/^0[23][0-9a-f]{64}$/.test(pubKey || '')) {
    throw Object.assign(new Error('bad pubKey'), { status: 400 });
  }
  if(typeof signature !== 'string' || !/^[0-9a-f]{128}$/.test(signature)) {
    throw Object.assign(new Error('bad signature'), { status: 400 });
  }
  const now = Date.now();
  if(!(Math.abs(now - +timestamp) <= config.allowedTimeDifference)) {
    throw Object.assign(new Error('no time like the present'), { status: 403 });
  }
  if(seen.has(signature)) {
    throw Object.assign(new Error('signature already used'), { status: 403 });
  }
  let valid = false;
  try {
    valid = sessionless.verifySignature(signature, timestamp + pubKey + action + extra, pubKey);
  } catch(err) {
    valid = false;
  }
  if(!valid) {
    throw Object.assign(new Error('auth error'), { status: 403 });
  }
  sweep(now);
  seen.set(signature, now);
  return pubKey;
};
