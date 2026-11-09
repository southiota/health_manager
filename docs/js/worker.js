// Fetches and decrypts the vault off the main thread, then analyzes it. Nothing leaves this browser.
import { analyze } from './analyze.js';

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
    const index = JSON.parse(new TextDecoder().decode(
      await gunzip(new Uint8Array(await open(key, 'index', await fetchBytes('../vault/index.bin'))))));

    const wanted = index.files.filter((f) => ['Activity', 'Summary', 'Monitor', 'Sleep', 'HRVStatus', 'Metrics'].includes(f.folder));
    const files = [];
    let next = 0;
    const load = async () => {
      while (next < wanted.length) {
        const f = wanted[next++];
        const sealed = await fetchBytes(`../vault/${f.id}.bin`);
        files.push({ folder: f.folder, bytes: await gunzip(new Uint8Array(await open(key, f.id, sealed))) });
        self.postMessage({ type: 'progress', step: '내려받는 중', done: files.length, total: wanted.length });
      }
    };
    await Promise.all(Array.from({ length: 8 }, load));
    const model = analyze(files, (done, total) => {
      if (done % 10 === 0 || done === total) self.postMessage({ type: 'progress', step: '분석 중', done, total });
    });
    model.synced = index.synced ?? null;
    const checkup = index.files.find((f) => f.folder === 'Checkup');
    model.checkup = checkup ? JSON.parse(new TextDecoder().decode(
      await gunzip(new Uint8Array(await open(key, checkup.id, await fetchBytes(`../vault/${checkup.id}.bin`)))))) : null;
    self.postMessage({ type: 'done', model });
  } catch {
    self.postMessage({ type: 'failed' });
  }
};
