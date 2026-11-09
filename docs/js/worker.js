// Fetches and decrypts the analysis result off the main thread. Nothing leaves this browser.
// The PC analyzes the watch records and publishes one encrypted file (scripts/vault.mjs publish).

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const utf8 = (s) => new TextEncoder().encode(s);

async function fetchBytes(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const open = (key, aad, sealed) => crypto.subtle.decrypt(
  { name: 'AES-GCM', iv: sealed.subarray(0, 12), additionalData: utf8(aad) }, key, sealed.subarray(12));

self.onmessage = async ({ data: { password } }) => {
  try {
    const info = await (await fetch('../vault/key.json', { cache: 'no-cache' })).json();
    const base = await crypto.subtle.importKey('raw', utf8(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    const kek = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: b64(info.salt), iterations: info.iterations },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let raw;
    try {
      raw = await open(kek, 'key', b64(info.wrapped));
    } catch {
      self.postMessage({ type: 'badPassword' });
      return;
    }
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    self.postMessage({ type: 'progress', step: '기록 여는 중', done: 0, total: 1 });
    const model = JSON.parse(new TextDecoder().decode(
      await gunzip(new Uint8Array(await open(key, 'model', await fetchBytes('../vault/model.bin'))))));
    self.postMessage({ type: 'done', model });
  } catch {
    self.postMessage({ type: 'failed' });
  }
};
