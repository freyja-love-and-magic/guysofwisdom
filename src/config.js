import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const required = (name) => {
  const value = process.env[name];
  if(!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
};

const withSlash = (url) => url.endsWith('/') ? url : url + '/';

export const FREE_PLAYS = 4;

// amounts are in cents
export const OFFERS = {
  unlock: { amount: 1000, currency: 'usd', label: 'Unlimited wisdom, forever', credits: null },
  pack10: { amount: 200, currency: 'usd', label: '10 more', credits: 10 }
};

// Display copy for each category in content/manifest.json
export const CATEGORIES = {
  koans: { label: 'Koans', blurb: 'Woo woo wisdom' },
  affirmations: { label: 'Affirmations', blurb: 'Somebody is proud of you' },
  astrology: { label: 'Astrology', blurb: 'The stars have notes' },
  pumpup: { label: 'Pump-up', blurb: 'Get up. Get going.' }
};

const contentDir = process.env.CONTENT_DIR || join(root, 'content');
const manifestFile = join(contentDir, 'manifest.json');
if(!existsSync(manifestFile)) {
  throw new Error(`${manifestFile} not found; generate the content first (scripts/generate.py)`);
}
const lines = JSON.parse(readFileSync(manifestFile, 'utf8'));

for(const line of lines) {
  if(!CATEGORIES[line.category]) {
    throw new Error(`manifest line ${line.id} has unknown category ${line.category}`);
  }
  if(!existsSync(join(contentDir, line.audio))) {
    throw new Error(`manifest line ${line.id} is missing its audio file ${line.audio}`);
  }
}

export default {
  port: +(process.env.PORT || 3030),
  dataDir: process.env.DATA_DIR || join(root, 'data'),
  publicDir: join(root, 'public'),
  contentDir,
  lines,
  bdoURL: withSlash(required('BDO_URL')),
  addieURL: withSlash(required('ADDIE_URL')),
  allowedTimeDifference: 300000
};
