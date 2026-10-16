import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

// Same scheme as sessionless-node: sign keccak256(message) with secp256k1, compact hex.
const STORAGE_KEY = 'guysofwisdom-keys';

export const loadKeys = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(stored && stored.privateKey && stored.pubKey) {
      return stored;
    }
  } catch(err) {}
  return null;
};

export const saveKeys = (privateKey) => {
  const keys = { privateKey, pubKey: bytesToHex(secp256k1.getPublicKey(privateKey)) };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  return keys;
};

export const ensureKeys = () => loadKeys() || saveKeys(bytesToHex(secp256k1.utils.randomPrivateKey()));

export const sign = (privateKey, message) =>
  secp256k1.sign(keccak_256(utf8ToBytes(message)), privateKey).toCompactHex();
