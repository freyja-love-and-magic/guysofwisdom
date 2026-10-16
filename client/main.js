import { ensureKeys, saveKeys, sign } from './sessionless.js';

const $ = (id) => document.getElementById(id);
let keys;
let config;
let me;
let met = [];
let stripe;

const signed = async (action, extra = '', fields = {}) => {
  const timestamp = Date.now() + '';
  return {
    ...fields,
    pubKey: keys.pubKey,
    timestamp,
    signature: sign(keys.privateKey, timestamp + keys.pubKey + action + extra)
  };
};

const api = async (path, body) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if(!res.ok) {
    throw Object.assign(new Error(json.error || 'something went wrong'), { status: res.status });
  }
  return json;
};

const price = (offer) => '$' + (offer.amount / 100).toFixed(offer.amount % 100 ? 2 : 0);

const renderMe = () => {
  if(me.unlocked) {
    $('status').textContent = 'Unlimited wisdom unlocked.';
  } else if(me.freeLeft > 0) {
    $('status').textContent = `${me.freeLeft} of ${config.freePlays} free ones left.`;
  } else if(me.credits > 0) {
    $('status').textContent = `${me.credits} left.`;
  } else {
    $('status').textContent = 'The free ones are used up.';
  }
};

const message = (text) => { $('message').textContent = text; };

const MET_KEY = 'guysofwisdom-met';

const loadMet = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(MET_KEY));
    return Array.isArray(stored) ? stored : [];
  } catch(err) {
    return [];
  }
};

const saveMet = () => {
  try {
    localStorage.setItem(MET_KEY, JSON.stringify(met));
  } catch(err) {}
};

// a stable color per guy, so each becomes recognizable
const hue = (name) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

const avatar = (name) => {
  const el = document.createElement('span');
  el.className = 'avatar';
  if(name) {
    el.textContent = name[0];
    el.style.background = `hsl(${hue(name)} 55% 45%)`;
    el.title = name;
  } else {
    el.textContent = '?';
    el.classList.add('unknown');
  }
  return el;
};

const renderMet = () => {
  const box = $('met');
  box.innerHTML = '';
  for(let i = 0; i < config.personaCount; i++) {
    box.append(avatar(met[i]));
  }
  $('met-label').textContent = met.length >= config.personaCount
    ? 'You have met all the guys.'
    : `Guys you've met: ${met.length} of ${config.personaCount}`;
};

const renderCategories = () => {
  const list = $('categories');
  list.innerHTML = '';
  for(const c of config.categories) {
    const button = document.createElement('button');
    button.className = 'category';
    const label = document.createElement('strong');
    label.textContent = c.label;
    const blurb = document.createElement('span');
    blurb.textContent = c.blurb;
    button.append(label, blurb);
    button.addEventListener('click', () => seek(c.id));
    list.append(button);
  }
};

const setBusy = (busy) => {
  for(const b of document.querySelectorAll('.category')) {
    b.disabled = busy;
  }
};

const showPaywall = () => {
  $('paywall').hidden = false;
  const offers = $('offers');
  offers.innerHTML = '';
  for(const [id, offer] of Object.entries(config.offers)) {
    const button = document.createElement('button');
    button.className = 'offer';
    button.textContent = `${offer.label} — ${price(offer)}`;
    button.addEventListener('click', () => checkout(id));
    offers.append(button);
  }
};

const seek = async (category) => {
  setBusy(true);
  message('Listening to the universe…');
  try {
    const result = await api('/api/play', await signed('play', category, { category }));
    me = result.me;
    $('paywall').hidden = true;
    $('koan').textContent = result.text;
    const by = $('by');
    by.innerHTML = '';
    by.append(avatar(result.persona), ' ' + result.persona);
    const isNew = !met.includes(result.persona);
    if(isNew) {
      met.push(result.persona);
      saveMet();
      renderMet();
    }
    const audio = $('audio');
    audio.src = result.audio;
    message(isNew ? `You've met ${result.persona}.` : '');
    renderMe();
    audio.play().catch(() => message('Press play to hear it.'));
  } catch(err) {
    if(err.status === 402) {
      message('');
      showPaywall();
      renderMe();
    } else {
      message(err.message);
    }
  } finally {
    setBusy(false);
  }
};

const checkout = async (offer) => {
  $('offers').hidden = true;
  message('Preparing payment…');
  try {
    const { intentId, clientSecret, publishableKey } = await api('/api/checkout', await signed('checkout', offer, { offer }));
    stripe = stripe || Stripe(publishableKey);
    const elements = stripe.elements({ clientSecret });
    const box = $('payment');
    box.hidden = false;
    elements.create('payment').mount('#payment-element');
    message('');
    $('pay').hidden = false;
    $('pay').onclick = async () => {
      $('pay').disabled = true;
      message('Paying…');
      const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
      if(error) {
        message(error.message);
        $('pay').disabled = false;
        return;
      }
      await redeem(intentId);
    };
  } catch(err) {
    message(err.message);
    $('offers').hidden = false;
  }
};

const redeem = async (intentId) => {
  try {
    me = await api('/api/redeem', await signed('redeem', intentId, { intentId }));
    renderMe();
    $('paywall').hidden = true;
    $('payment').hidden = true;
    $('pay').hidden = true;
    $('pay').disabled = false;
    $('offers').hidden = false;
    $('payment-element').innerHTML = '';
    message('Thank you. The universe appreciates you.');
  } catch(err) {
    message(err.message);
  }
};

const setupKeyBackup = () => {
  $('show-key').addEventListener('click', () => {
    $('key-box').value = keys.privateKey;
    $('key-box').hidden = false;
  });
  $('restore-key').addEventListener('click', async () => {
    if($('key-box').hidden) {
      $('key-box').value = '';
      $('key-box').hidden = false;
      message('Paste your key below, then press restore again.');
      return;
    }
    const value = $('key-box').value.trim();
    if(!/^[0-9a-f]{64}$/.test(value)) {
      message('That does not look like a key.');
      return;
    }
    keys = saveKeys(value);
    me = await refresh();
    message('Key restored.');
  });
};

const refresh = async () => {
  const query = new URLSearchParams(await signed('me'));
  const res = await fetch('/api/me?' + query);
  const json = await res.json();
  if(!res.ok) {
    throw new Error(json.error || 'could not load your status');
  }
  me = json;
  renderMe();
  return me;
};

const start = async () => {
  keys = ensureKeys();
  const res = await fetch('/api/config', { cache: 'no-store' });
  config = await res.json();
  if(!res.ok || !Array.isArray(config.categories)) {
    throw new Error('Could not load the site. Try reloading the page.');
  }
  met = loadMet();
  renderCategories();
  renderMet();
  setupKeyBackup();
  await refresh();
};

start().catch(err => message(err.message));
