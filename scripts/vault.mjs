#!/usr/bin/env node
// Copies watch records to this PC, keeps them encrypted in data/vault, analyzes them here,
// and publishes only the encrypted analysis result (docs/vault/model.bin) for the page.
//   node scripts/vault.mjs init                 create the access password and vault key (once)
//   node scripts/vault.mjs passwd               change the access password (run in a terminal; input is hidden)
//   node scripts/vault.mjs sync                 find the watch by name and import new files
//   node scripts/vault.mjs sync --source <dir>  import from a folder instead of the watch
//   node scripts/vault.mjs checkup              encrypt data/checkup/checkup.json (checkup results)
//   node scripts/vault.mjs publish              analyze the stored records again and rewrite model.bin
// sync and checkup run publish at the end.
// The raw store lives only on this PC. Run publish on the PC that holds it, in the same time zone as the page.
// Options for tests: --vault <dir> --store <dir> --plain <dir> --env <file> --checkup <file>
// The watch is only read. Passwords and health values are never printed.
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { analyze } from '../docs/js/analyze.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ITERATIONS = 600000;
const SKIP_DIRS = new Set(['REMOTESW', 'EXTDATA', 'TEXT', 'APPS']);
const SKIP_FILES = new Set(['GUPDATE.TMP']);
// A new copy of a record file is kept beside the old one, because the watch can reuse names
// and removes old records. The page removes duplicates by timestamp.
const RECORD_DIRS = new Set(['ACTIVITY', 'MONITOR', 'SLEEP', 'HRVSTATUS', 'METRICS', 'SUMMARY', 'DEVICE']);

function option(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const VAULT = option('--vault') ?? join(ROOT, 'docs', 'vault');
const STORE = option('--store') ?? join(ROOT, 'data', 'vault');
const PLAIN = option('--plain') ?? join(ROOT, 'data', 'garmin');
const ENV = option('--env') ?? join(ROOT, '.env');
const CHECKUP = option('--checkup') ?? join(ROOT, 'data', 'checkup', 'checkup.json');
const BACKUP = join(homedir(), 'Documents', 'health_vault_password_backup.txt');

function seal(key, aad, plain) {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([nonce, body, c.getAuthTag()]);
}
function open(key, aad, sealed) {
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([d.update(sealed.subarray(12, sealed.length - 16)), d.final()]);
}
function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, data);
  renameSync(`${path}.tmp`, path);
}
function readPassword() {
  if (!existsSync(ENV)) throw new Error('.env 가 없습니다. 먼저 init 을 실행하세요.');
  const m = readFileSync(ENV, 'utf8').match(/^HEALTH_VAULT_PASSWORD=(.+)$/m);
  if (!m) throw new Error('.env 에 HEALTH_VAULT_PASSWORD 가 없습니다.');
  return m[1].trim();
}
function loadKey() {
  const info = JSON.parse(readFileSync(join(VAULT, 'key.json'), 'utf8'));
  const kek = pbkdf2Sync(readPassword(), Buffer.from(info.salt, 'base64'), info.iterations, 32, 'sha256');
  try {
    return open(kek, 'key', Buffer.from(info.wrapped, 'base64'));
  } catch {
    throw new Error('.env 의 암호가 저장소의 키와 맞지 않습니다.');
  }
}

function init() {
  if (existsSync(join(VAULT, 'key.json')) || existsSync(ENV)) throw new Error('이미 만들어져 있습니다. 덮어쓰지 않습니다.');
  // 32 characters from a 32-letter alphabet: 160 bits.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789-';
  const password = [...randomBytes(32)].map((b) => alphabet[b & 31]).join('');
  const salt = randomBytes(16);
  const kek = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  const dataKey = randomBytes(32);
  writeFileSync(ENV, `HEALTH_VAULT_PASSWORD=${password}\n`, { mode: 0o600 });
  if (!option('--env')) {
    if (existsSync(BACKUP)) throw new Error('암호 백업 파일이 이미 있습니다. 덮어쓰지 않습니다.');
    writeFileSync(BACKUP, `건강관리 웹 접속 암호. 잃으면 복구할 수 없습니다.\n${password}\n`, { mode: 0o600 });
  }
  writeAtomic(join(VAULT, 'key.json'), JSON.stringify({
    v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
    salt: salt.toString('base64'), wrapped: seal(kek, 'key', dataKey).toString('base64'),
  }) + '\n');
  writeAtomic(join(STORE, 'index.bin'), seal(dataKey, 'index', gzipSync(JSON.stringify({ files: [] }))));
  console.log('암호와 저장소 키를 만들었습니다. 암호는 화면에 표시하지 않습니다.');
}

// Reads one line without showing it. Piped input is accepted so the command can be tested.
function askHidden(label, stdin) {
  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    let text = '';
    const finish = (error) => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(text);
    };
    const onEnd = () => finish();
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') return finish(new Error('취소했습니다. 암호는 그대로입니다.'));
        if (ch === '\b' || ch === '\u007f') text = [...text].slice(0, -1).join('');
        else text += ch;
      }
    };
    stdin.setEncoding('utf8');
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.resume();
  });
}
function checkNewPassword(password) {
  if ([...password].length < 4) throw new Error('암호는 4자 이상이어야 합니다. 암호는 그대로입니다.');
  if (password !== password.trim()) throw new Error('암호의 앞뒤에는 공백을 넣을 수 없습니다. 암호는 그대로입니다.');
  if (/[\p{Cc}]/u.test(password)) throw new Error('암호에 제어 문자가 들어 있습니다. 암호는 그대로입니다.');
}
async function passwd() {
  const dataKey = loadKey();
  let first, second;
  if (process.stdin.isTTY) {
    first = await askHidden('새 암호(4자 이상, 화면에 보이지 않음): ', process.stdin);
    second = await askHidden('한 번 더: ', process.stdin);
  } else {
    let piped = '';
    for await (const chunk of process.stdin) piped += chunk;
    if (!piped) throw new Error('입력을 받을 수 없습니다. 별도 터미널 창에서 직접 실행하세요.');
    [first, second] = piped.split(/\r?\n/);
  }
  if (first !== second) throw new Error('두 번 입력한 암호가 다릅니다. 암호는 그대로입니다.');
  // The page applies the same form, so a phone and a PC produce the same bytes.
  const password = first.normalize('NFC');
  checkNewPassword(password);
  const salt = randomBytes(16);
  const kek = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  const wrapped = seal(kek, 'key', dataKey);
  if (!open(kek, 'key', wrapped).equals(dataKey)) throw new Error('새 키를 확인하지 못했습니다. 암호는 그대로입니다.');
  // Everything is written beside the originals first, so a failed write changes nothing.
  // The vault key is replaced last. After a push the old key.json stays in git history,
  // so a change made then also needs a new data key.
  const keyPath = join(VAULT, 'key.json');
  const targets = [
    [ENV, `HEALTH_VAULT_PASSWORD=${password}\n`],
    [keyPath, JSON.stringify({
      v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
      salt: salt.toString('base64'), wrapped: wrapped.toString('base64'),
    }) + '\n'],
  ];
  if (!option('--env')) targets.unshift([BACKUP, `건강관리 웹 접속 암호. 잃으면 복구할 수 없습니다.\n${password}\n`]);
  for (const [path, text] of targets) writeFileSync(`${path}.tmp`, text, { mode: 0o600 });
  for (const [path] of targets) renameSync(`${path}.tmp`, path);
  console.log('암호를 바꿨습니다. 암호는 화면에 표시하지 않습니다.');
}

function findWatch() {
  if (platform() === 'darwin') {
    const dir = '/Volumes/GARMIN/GARMIN';
    return existsSync(join(dir, 'GarminDevice.xml')) ? dir : null;
  }
  if (platform() !== 'win32') return null;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "(Get-Volume | Where-Object { $_.FileSystemLabel -eq 'GARMIN' -and $_.DriveLetter }).DriveLetter"], { encoding: 'utf8' });
  for (const letter of out.split(/\s+/).filter(Boolean)) {
    const dir = `${letter}:\\GARMIN`;
    const xml = join(dir, 'GarminDevice.xml');
    if (existsSync(xml) && readFileSync(xml, 'utf8').includes('<Description>Descent G1 Solar</Description>')) return dir;
  }
  return null;
}
function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === base && SKIP_DIRS.has(entry.name.toUpperCase())) continue;
      walk(path, base, out);
    } else if (entry.isFile() && !(dir === base && SKIP_FILES.has(entry.name.toUpperCase()))) {
      out.push(path);
    }
  }
  return out;
}

const indexPath = () => join(STORE, 'index.bin');
const readIndex = (key) => JSON.parse(gunzipSync(open(key, 'index', readFileSync(indexPath()))).toString('utf8'));
const writeIndex = (key, index) => writeAtomic(indexPath(), seal(key, 'index', gzipSync(JSON.stringify(index))));

// Health checkup results typed in from the paper report. Only the latest file is kept.
function checkup() {
  if (!existsSync(CHECKUP)) throw new Error(`검진 파일이 없습니다: ${relative(ROOT, CHECKUP)}`);
  const bytes = readFileSync(CHECKUP);
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('검진 파일이 JSON 형식이 아닙니다.'); }
  const bad = !Array.isArray(data.exams) || data.exams.some((e) => !/^\d{4}-\d{2}-\d{2}$/.test(e?.date ?? '') || !['general', 'stomach'].includes(e.kind));
  if (bad) throw new Error('검진 파일 형식이 맞지 않습니다. exams 안 각 항목에 date(YYYY-MM-DD)와 kind(general 또는 stomach)가 있어야 합니다.');
  const key = loadKey();
  const index = readIndex(key);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const previous = index.files.filter((f) => f.folder === 'Checkup');
  if (previous.length === 1 && previous[0].sha256 === sha256) { console.log('검진 기록이 그대로입니다.'); return; }
  const id = randomBytes(16).toString('hex');
  writeAtomic(join(STORE, `${id}.bin`), seal(key, id, gzipSync(bytes)));
  for (const old of previous) {
    rmSync(join(STORE, `${old.id}.bin`), { force: true });
    index.files.splice(index.files.indexOf(old), 1);
  }
  index.files.push({ id, path: 'Checkup/checkup.json', folder: 'Checkup', name: 'checkup.json', sha256, size: bytes.length, added: new Date().toISOString() });
  writeIndex(key, index);
  console.log(`검진 기록 ${data.exams.length}건을 암호화했습니다.`);
  publish(key, index);
}

// Analyzes every stored record on this PC and writes one encrypted result for the page.
function publish(key = loadKey(), index = readIndex(key)) {
  const read = (f) => gunzipSync(open(key, f.id, readFileSync(join(STORE, `${f.id}.bin`))));
  const files = index.files.filter((f) => f.folder !== 'Checkup').map((f) => ({ folder: f.folder, bytes: new Uint8Array(read(f)) }));
  const model = analyze(files);
  model.synced = index.synced ?? null;
  const checkupFile = index.files.find((f) => f.folder === 'Checkup');
  model.checkup = checkupFile ? JSON.parse(read(checkupFile).toString('utf8')) : null;
  model.published = new Date().toISOString();
  writeAtomic(join(VAULT, 'model.bin'), seal(key, 'model', gzipSync(JSON.stringify(model))));
  console.log(`분석 결과를 만들었습니다. 읽은 파일 ${model.read.files}개, 못 읽은 파일 ${model.read.unreadable}개`);
}

function sync() {
  const source = option('--source') ?? findWatch();
  if (!source) throw new Error('시계를 찾지 못했습니다. USB 연결을 확인하세요.');
  const key = loadKey();
  const index = readIndex(key);
  const known = new Set(index.files.map((f) => `${f.path}|${f.sha256}`));
  let added = 0, replaced = 0, same = 0;
  for (const path of walk(source)) {
    const rel = relative(source, path).split(sep).join('/');
    const bytes = readFileSync(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (known.has(`${rel}|${sha256}`)) { same++; continue; }
    const folder = rel.includes('/') ? rel.split('/')[0] : '';
    const keepBoth = RECORD_DIRS.has(folder.toUpperCase());
    const previous = index.files.filter((f) => f.path === rel);
    const id = randomBytes(16).toString('hex');
    const plainPath = join(PLAIN, keepBoth && previous.length ? `${rel}.${sha256.slice(0, 8)}` : rel);
    mkdirSync(dirname(plainPath), { recursive: true });
    copyFileSync(path, plainPath);
    writeAtomic(join(STORE, `${id}.bin`), seal(key, id, gzipSync(bytes)));
    if (!keepBoth) {
      for (const old of previous) {
        rmSync(join(STORE, `${old.id}.bin`), { force: true });
        index.files.splice(index.files.indexOf(old), 1);
        replaced++;
      }
    }
    index.files.push({ id, path: rel, folder, name: rel.split('/').at(-1), sha256, size: statSync(path).size, added: new Date().toISOString() });
    added++;
  }
  index.synced = new Date().toISOString();
  writeIndex(key, index);
  console.log(`새 파일 ${added}개, 교체 ${replaced}개, 그대로 ${same}개, 저장소 전체 ${index.files.length}개`);
  publish(key, index);
}

try {
  const command = process.argv[2];
  if (command === 'init') init();
  else if (command === 'sync') sync();
  else if (command === 'passwd') await passwd();
  else if (command === 'checkup') checkup();
  else if (command === 'publish') publish();
  else throw new Error('사용법: node scripts/vault.mjs init | passwd | sync [--source <폴더>] | checkup | publish');
} catch (e) {
  console.error(`실패: ${e.message}`);
  process.exit(1);
}
