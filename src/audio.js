import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import config from './config.js';

mkdirSync(config.dataDir, { recursive: true });

const secretFile = join(config.dataDir, 'audio-secret');
if(!existsSync(secretFile)) {
  writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
}
const secret = readFileSync(secretFile, 'utf8');

// Clips are only reachable through keyed names handed out with a play, so they
// can't be enumerated from the (public) manifest to skip the paywall.
const token = (id) => createHmac('sha256', secret).update(id).digest('hex').slice(0, 32);

const files = new Map(config.lines.map(line => [token(line.id), join(config.contentDir, line.audio)]));

export const audioURL = (line) => `/audio/${token(line.id)}.mp3`;

export const audioFile = (name) => files.get(name.replace(/\.mp3$/, ''));
