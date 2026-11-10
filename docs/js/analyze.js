// Turns FIT files into the numbers the screens show. Runs in the browser worker and in Node tests.
import { Decoder, Stream } from '../vendor/fitsdk/src/index.js';

const FIT_EPOCH = 631065600000;
const USED = new Set(['Activity', 'Summary', 'Monitor', 'Sleep', 'HRVStatus', 'Metrics']);
const PROFILE_NAMES = { Gabber: 'GABBER' };
const MAX_POINTS = 240;

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const thin = (a, n = MAX_POINTS) => (a.length <= n ? a : Array.from({ length: n }, (_, i) => a[Math.floor((i * a.length) / n)]));
const semi = (v) => (v * 180) / 2147483648;

function decode(bytes) {
  try {
    const stream = Stream.fromByteArray(bytes);
    if (!Decoder.isFIT(stream)) return null;
    return new Decoder(stream).read({ mergeHeartRates: false }).messages;
  } catch {
    return null;
  }
}

function classify(s) {
  const profile = s.sportProfileName ?? '';
  if (PROFILE_NAMES[profile]) return { kind: 'dance', label: PROFILE_NAMES[profile] };
  if (s.sport === 'running') return { kind: 'run', label: '러닝' };
  if (s.sport === 'diving') return { kind: 'dive', label: '잠수' };
  return { kind: 'other', label: profile || '기타' };
}

function readZones(list, index) {
  const z = list.find((x) => x.referenceMesg === 'session' && (x.referenceIndex ?? 0) === index);
  const raw = z?.timeInHrZone;
  if (!Array.isArray(raw) || !raw.length) return null;
  // Longer arrays start with the time below zone 1. Count it in zone 1.
  const zones = raw.length > 5 ? raw.slice(1, 6) : [...raw];
  if (raw.length > 5) zones[0] += raw[0];
  while (zones.length < 5) zones.push(0);
  return zones;
}

function readSessions(m, out) {
  (m.sessionMesgs ?? []).forEach((s, i) => {
    if (!s.startTime) return;
    const start = +s.startTime;
    const end = start + (s.totalElapsedTime ?? 0) * 1000;
    const records = (m.recordMesgs ?? []).filter((r) => r.timestamp && +r.timestamp >= start && +r.timestamp <= end + 1000);
    const heart = records.filter((r) => r.heartRate != null).map((r) => [(+r.timestamp - start) / 1000, r.heartRate]);
    const route = records.filter((r) => r.positionLat != null && r.positionLong != null).map((r) => [semi(r.positionLong), semi(r.positionLat)]);
    const depth = records.filter((r) => r.depth != null).map((r) => [(+r.timestamp - start) / 1000, r.depth]);
    const temps = records.filter((r) => r.temperature != null).map((r) => r.temperature);
    const dive = (m.diveSummaryMesgs ?? []).find((d) => d.referenceMesg === 'session');
    const gas = (m.diveGasMesgs ?? []).find((g) => g.status === 'enabled') ?? (m.diveGasMesgs ?? [])[0];
    const zones = readZones(m.timeInZoneMesgs ?? [], s.messageIndex ?? i);
    const kind = classify(s);
    const candidate = {
      start, date: dayKey(start), ...kind,
      seconds: s.totalTimerTime ?? s.totalElapsedTime ?? 0,
      distance: s.totalDistance ?? null,
      avgHr: s.avgHeartRate ?? null, maxHr: s.maxHeartRate ?? null,
      calories: s.totalCalories ?? null,
      effect: s.totalTrainingEffect ?? null,
      anaerobic: s.totalAnaerobicTrainingEffect ?? null,
      load: s.trainingLoadPeak ?? null,
      speed: s.enhancedAvgSpeed ?? null,
      ascent: s.totalAscent ?? null,
      zones, high: zones ? zones[3] + zones[4] : null,
      heart: thin(heart), route: thin(route), depth: thin(depth),
      minTemp: temps.length ? Math.min(...temps) : (s.minTemperature ?? null),
      dive: dive ? {
        maxDepth: dive.maxDepth ?? null, bottom: dive.bottomTime ?? null, ascent: dive.avgAscentRate ?? null,
        n2: [dive.startN2 ?? null, dive.endN2 ?? null], cns: [dive.startCns ?? null, dive.endCns ?? null],
        oxygen: gas?.oxygenContent ?? null, helium: gas?.heliumContent ?? null,
      } : null,
    };
    const existing = out.get(start);
    // Activity files hold full records, Summary files only totals. Keep the fuller one.
    if (!existing || candidate.heart.length > existing.heart.length) out.set(start, candidate);
  });
}

function readSleep(m, out, windows) {
  const a = (m.sleepAssessmentMesgs ?? [])[0];
  const events = (m.eventMesgs ?? []).filter((e) => e.timestamp).map((e) => +e.timestamp).sort((x, y) => x - y);
  const levels = (m.sleepLevelMesgs ?? []).filter((l) => l.timestamp).sort((x, y) => x.timestamp - y.timestamp);
  if (!levels.length) return;
  const start = events[0] ?? +levels[0].timestamp;
  const end = events.at(-1) ?? +levels.at(-1).timestamp;
  // Each level lasts until the next one. The last ends at the stop event.
  const stages = levels.map((l, i) => {
    const from = +l.timestamp;
    return { level: l.sleepLevel, from, to: i + 1 < levels.length ? +levels[i + 1].timestamp : end };
  }).filter((s) => s.to > s.from);
  const totals = { deep: 0, light: 0, rem: 0, awake: 0 };
  for (const s of stages) if (s.level in totals) totals[s.level] += (s.to - s.from) / 60000;
  const night = {
    date: dayKey(end), start, end, stages, totals,
    asleep: totals.deep + totals.light + totals.rem,
    score: a?.overallSleepScore ?? null,
    awakenings: a?.awakeningsCount ?? null,
    stress: a?.averageStressDuringSleep ?? null,
    parts: a ? {
      '지속 시간': a.sleepDurationScore, '깊은 잠': a.deepSleepScore, '얕은 잠': a.lightSleepScore, REM: a.remSleepScore,
      '깬 시간': a.awakeTimeScore, '깬 횟수': a.awakeningsCountScore, '뒤척임': a.sleepRestlessnessScore,
      '수면 질': a.sleepQualityScore, '회복': a.sleepRecoveryScore, '끊김': a.interruptionsScore,
    } : {},
  };
  const old = out.get(night.date);
  if (!old || night.asleep > old.asleep) out.set(night.date, night);
  windows.push([start, end]);
}

function readMonitor(m, st) {
  let full = null;
  let firstDay = null;
  const peak = {};
  const calories = {};
  for (const x of m.monitoringMesgs ?? []) {
    if (x.timestamp) full = Math.floor((+x.timestamp - FIT_EPOCH) / 1000);
    else if (x.timestamp16 != null && full != null) full += (x.timestamp16 - (full & 0xffff)) & 0xffff;
    if (full == null) continue;
    const t = full * 1000 + FIT_EPOCH;
    firstDay ??= dayKey(t);
    if (x.heartRate > 0) st.hr.set(t, x.heartRate);
    const type = x.activityType;
    if (type != null) {
      // Counts accumulate through a file, so the largest value is the total.
      const count = Math.max((x.cycles ?? 0) * 2, x.steps ?? 0);
      if ((type === 'walking' || type === 'running') && count > (peak[type] ?? 0)) peak[type] = count;
      if (x.activeCalories > (calories[type] ?? 0)) calories[type] = x.activeCalories;
    }
  }
  if (firstDay) {
    const d = st.daily.get(firstDay) ?? { steps: {}, calories: {} };
    for (const [k, v] of Object.entries(peak)) d.steps[k] = Math.max(d.steps[k] ?? 0, v);
    for (const [k, v] of Object.entries(calories)) d.calories[k] = Math.max(d.calories[k] ?? 0, v);
    st.daily.set(firstDay, d);
  }
  for (const x of m.stressLevelMesgs ?? []) {
    if (x.stressLevelTime && x.stressLevelValue >= 0 && x.stressLevelValue <= 100) st.stress.set(+x.stressLevelTime, x.stressLevelValue);
  }
  for (const x of m.respirationRateMesgs ?? []) {
    if (x.timestamp && x.respirationRate >= 5 && x.respirationRate <= 40) st.resp.set(+x.timestamp, x.respirationRate);
  }
  for (const x of m.monitoringHrDataMesgs ?? []) {
    const v = x.currentDayRestingHeartRate ?? x.restingHeartRate;
    if (x.timestamp && v > 0) st.rhr.set(dayKey(+x.timestamp - 1000), v);
  }
}

function hourly(map) {
  const days = new Map();
  for (const [t, v] of map) {
    const d = new Date(t);
    const key = dayKey(t);
    if (!days.has(key)) days.set(key, Array.from({ length: 24 }, () => []));
    days.get(key)[d.getHours()].push(v);
  }
  return Object.fromEntries([...days].map(([k, hours]) => [k, hours.map(avg)]));
}

export const STRESS_SLOTS = [0, 6, 9, 12, 15, 18, 21];

// One row per day, so the page can total any week or month without the raw samples.
function dailyStats(hr, stress, windows) {
  const days = new Map();
  const row = (key) => {
    if (!days.has(key)) days.set(key, { hr: [], stress: 0, n: 0, high: 0, rest: 0, awake: 0, awakeN: 0, slots: STRESS_SLOTS.map(() => [0, 0]) });
    return days.get(key);
  };
  const sorted = [...windows].sort((a, b) => a[0] - b[0]);
  const asleep = (t) => {
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t < sorted[mid][0]) hi = mid - 1;
      else if (t > sorted[mid][1]) lo = mid + 1;
      else return true;
    }
    return false;
  };
  for (const [t, v] of hr) row(dayKey(t)).hr.push(v);
  for (const [t, v] of stress) {
    const r = row(dayKey(t));
    r.stress += v;
    r.n++;
    if (v > 50) r.high++;
    if (v <= 25) r.rest++;
    if (!asleep(t)) { r.awake += v; r.awakeN++; }
    const hour = new Date(t).getHours();
    let slot = STRESS_SLOTS.length - 1;
    while (STRESS_SLOTS[slot] > hour) slot--;
    r.slots[slot][0] += v;
    r.slots[slot][1]++;
  }
  return [...days].map(([date, r]) => ({
    date,
    hrAvg: avg(r.hr), hrMax: r.hr.length ? Math.max(...r.hr) : null,
    stress: r.n ? r.stress / r.n : null,
    stressAwake: r.awakeN ? r.awake / r.awakeN : null,
    stressHigh: r.n ? (r.high / r.n) * 100 : null,
    stressRest: r.n ? (r.rest / r.n) * 100 : null,
    slots: r.slots,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

export function analyze(files, onProgress = () => {}) {
  const sessions = new Map();
  const nights = new Map();
  const windows = [];
  const hrv = new Map();
  const vo2 = new Map();
  const st = { hr: new Map(), stress: new Map(), resp: new Map(), rhr: new Map(), daily: new Map() };
  let unreadable = 0;
  const used = files.filter((f) => USED.has(f.folder));
  used.forEach((f, i) => {
    onProgress(i + 1, used.length);
    const m = decode(f.bytes);
    if (!m) { unreadable++; return; }
    if (f.folder === 'Activity' || f.folder === 'Summary') readSessions(m, sessions);
    else if (f.folder === 'Sleep') readSleep(m, nights, windows);
    else if (f.folder === 'Monitor') readMonitor(m, st);
    else if (f.folder === 'HRVStatus') {
      for (const x of m.hrvStatusSummaryMesgs ?? []) {
        if (!x.timestamp || x.lastNightAverage == null) continue;
        hrv.set(dayKey(+x.timestamp), {
          date: dayKey(+x.timestamp), last: x.lastNightAverage, week: x.weeklyAverage ?? null,
          lo: x.baselineBalancedLower ?? null, hi: x.baselineBalancedUpper ?? null, status: x.status ?? null,
        });
      }
    } else if (f.folder === 'Metrics') {
      for (const x of m.maxMetDataMesgs ?? []) if (x.updateTime && x.vo2Max > 0) vo2.set(dayKey(+x.updateTime), x.vo2Max);
    }
  });

  const respNight = [...nights.values()].map((n) => {
    const values = [];
    for (const [t, v] of st.resp) if (t >= n.start && t <= n.end) values.push(v);
    return { date: n.date, v: avg(values) };
  }).filter((x) => x.v != null).sort((a, b) => a.date.localeCompare(b.date));

  return {
    sessions: [...sessions.values()].sort((a, b) => b.start - a.start),
    sleep: [...nights.values()].sort((a, b) => a.date.localeCompare(b.date)),
    hrv: [...hrv.values()].sort((a, b) => a.date.localeCompare(b.date)),
    vo2: [...vo2].map(([date, v]) => ({ date, v })).sort((a, b) => a.date.localeCompare(b.date)),
    rhr: [...st.rhr].map(([date, v]) => ({ date, v })).sort((a, b) => a.date.localeCompare(b.date)),
    resp: respNight,
    steps: [...st.daily].map(([date, d]) => ({
      date, v: Object.values(d.steps).reduce((x, y) => x + y, 0),
      calories: Object.values(d.calories).reduce((x, y) => x + y, 0),
    })).sort((a, b) => a.date.localeCompare(b.date)),
    hrHourly: hourly(st.hr),
    stressHourly: hourly(st.stress),
    days: dailyStats(st.hr, st.stress, windows),
    stressSlots: STRESS_SLOTS,
    read: { files: used.length, unreadable },
  };
}
