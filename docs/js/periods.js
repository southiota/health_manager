// Weekly and monthly totals, and how each one compares with the person's own recent periods.
// No page code here, so Node tests can run it.

export const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const md = (key) => { const [, m, d] = key.split('-'); return `${+m}/${+d}`; };
export const hm = (mins) => { if (mins == null) return '-'; const r = Math.round(mins); return `${Math.floor(r / 60)}h ${pad(r % 60)}m`; };
export const avg = (a) => { const x = a.filter((v) => v != null); return x.length ? x.reduce((p, q) => p + q, 0) / x.length : null; };
const sumOf = (a) => a.reduce((p, q) => p + (q ?? 0), 0);
const sdOf = (a) => {
  const x = a.filter((v) => v != null);
  if (x.length < 2) return null;
  const mean = avg(x);
  return Math.sqrt(avg(x.map((v) => (v - mean) ** 2)));
};

const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dayKey(d); };
export const weekdayIndex = (k) => (fromKey(k).getDay() + 6) % 7;
export const UNITS = { day: '일', week: '주', month: '월', year: '연' };
export function startOf(k, unit) {
  const d = fromKey(k);
  if (unit === 'year') { d.setMonth(0); d.setDate(1); } else if (unit === 'month') d.setDate(1);
  else if (unit === 'week') d.setDate(d.getDate() - weekdayIndex(k));
  return dayKey(d);
}
function endOf(start, unit) {
  const d = fromKey(start);
  if (unit === 'year') { d.setFullYear(d.getFullYear() + 1); d.setDate(0); } else if (unit === 'month') { d.setMonth(d.getMonth() + 1); d.setDate(0); } else if (unit === 'week') d.setDate(d.getDate() + 6);
  return dayKey(d);
}
const WEEKDAY = ['월', '화', '수', '목', '금', '토', '일'];
function labels(unit, start, end) {
  const [y, mo, d] = start.split('-');
  if (unit === 'year') return { label: `${y}년`, short: y };
  if (unit === 'month') return { label: `${y}년 ${+mo}월`, short: `${+mo}월` };
  if (unit === 'day') return { label: `${y}. ${+mo}. ${+d} (${WEEKDAY[weekdayIndex(start)]})`, short: md(start) };
  if (unit === 'range') return { label: `${start.slice(2).replaceAll('-', '.')} ~ ${end.slice(2).replaceAll('-', '.')}`, short: md(start) };
  return { label: `${md(start)} ~ ${md(end)}`, short: md(start) };
}
// The first and last day that have any record.
export function dataSpan(m) {
  const dates = [m.sleep, m.hrv, m.rhr, m.resp, m.steps, m.vo2, m.sessions, m.days].flatMap((a) => a.map((x) => x.date)).sort();
  return dates.length ? { first: dates[0], latest: dates.at(-1) } : null;
}
export function daysBetween(start, end) {
  const out = [];
  for (let k = start; k <= end; k = addDays(k, 1)) out.push(k);
  return out;
}

// Hours after 21:00 on the evening before the wake-up day.
export function hoursFromEvening(t, date) {
  const [y, mo, d] = date.split('-').map(Number);
  return (t - new Date(y, mo - 1, d - 1, 21).getTime()) / 36e5;
}
export const clock = (offset) => {
  if (offset == null) return '-';
  const mins = Math.round(offset * 60) + 21 * 60;
  return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
};

const FORMATS = {
  int: (v) => Math.round(v).toLocaleString('ko-KR'),
  dec1: (v) => v.toFixed(1),
  dec2: (v) => v.toFixed(2),
  min: (v) => hm(v),
  clock: (v) => clock(v),
  pct: (v) => `${Math.round(v)}%`,
  km: (v) => `${v.toFixed(1)}km`,
  pace: (v) => { const r = Math.round(v); return `${Math.floor(r / 60)}'${pad(r % 60)}"`; },
};
const DIFF = {
  min: (v) => `${Math.round(Math.abs(v))}분`,
  clock: (v) => `${Math.round(Math.abs(v) * 60)}분`,
  pace: (v) => `${Math.round(Math.abs(v))}초`,
  pct: (v) => `${Math.round(Math.abs(v))}%p`,
};
export const formatValue = (metric, v) => (v == null ? '-' : FORMATS[metric.fmt](v));
export const formatDiff = (metric, d) => {
  if (d == null) return '-';
  const text = DIFF[metric.fmt] ? DIFF[metric.fmt](d) : FORMATS[metric.fmt](Math.abs(d));
  if (Math.abs(d) < 1e-9) return text;
  if (metric.fmt === 'clock') return `${text} ${d > 0 ? '늦음' : '빠름'}`;
  return `${d > 0 ? '+' : '−'}${text}`;
};

const bedTimes = (x) => x.sleep.map((n) => hoursFromEvening(n.start, n.date));
const wakeTimes = (x) => x.sleep.map((n) => hoursFromEvening(n.end, n.date));
const stage = (name) => (x) => avg(x.sleep.map((n) => n.totals[name]));
const nights = (x) => x.sleep.length;
const hrvN = (x) => x.hrv.length;
const rhrN = (x) => x.rhr.length;
const dayN = (x) => x.days.filter((d) => d.stress != null).length;
const stepN = (x) => x.steps.length;
const exN = (x) => x.ex.length;
const runs = (x) => x.ex.filter((s) => s.kind === 'run' && s.distance > 0 && s.seconds > 0);
const runN = (x) => runs(x).length;
const minutesOf = (list) => sumOf(list.map((s) => s.seconds)) / 60;

function loadRatio(x, m) {
  const end = x.lastDay;
  const start7 = addDays(end, -6);
  const start28 = addDays(end, -27);
  const all = m.sessions.filter((s) => s.kind !== 'dive' && s.load != null);
  if (!all.length || all.at(-1).date > start28) return null;
  const inRange = (from) => all.filter((s) => s.date >= from && s.date <= end).map((s) => s.load);
  const chronic = sumOf(inRange(start28)) / 4;
  return chronic > 0 ? sumOf(inRange(start7)) / chronic : null;
}

// Daily steps where the mortality curve flattens for people under 60 (meta-analysis, research note 261108).
export const STEP_GOAL = 8000;
// Metrics with large device error (sleep stages, calories, VO2max, stress). Shown as reference only.
export const REFERENCE = new Set(['sleepDeep', 'sleepRem', 'sleepLight', 'stress', 'stressAwake', 'stressHigh', 'stressRest', 'sleepStress', 'calories', 'activeCal', 'vo2']);

// better: which way counts as an improvement. null means the number is shown without a verdict.
// step: the smallest change called a change. These are working values, not medical limits.
export const METRICS = [
  { id: 'sleepScore', group: '수면', label: '수면 점수', fmt: 'int', better: 'up', step: 3, n: nights, get: (x) => avg(x.sleep.map((n) => n.score)) },
  { id: 'sleepTime', group: '수면', label: '총 수면 시간', fmt: 'min', better: 'up', step: 15, n: nights, get: (x) => avg(x.sleep.map((n) => n.asleep)) },
  { id: 'sleepDeep', group: '수면', label: '깊은 잠', fmt: 'min', better: 'up', step: 10, n: nights, get: stage('deep') },
  { id: 'sleepRem', group: '수면', label: 'REM', fmt: 'min', better: 'up', step: 10, n: nights, get: stage('rem') },
  { id: 'sleepLight', group: '수면', label: '얕은 잠', fmt: 'min', better: null, step: 15, n: nights, get: stage('light') },
  { id: 'sleepAwake', group: '수면', label: '깬 시간', fmt: 'min', better: 'down', step: 5, n: nights, get: stage('awake') },
  { id: 'sleepWakes', group: '수면', label: '깬 횟수', fmt: 'dec1', better: 'down', step: 0.5, n: nights, get: (x) => avg(x.sleep.map((n) => n.awakenings)) },
  { id: 'sleepStress', group: '수면', label: '수면 중 스트레스', fmt: 'int', better: 'down', step: 3, n: nights, get: (x) => avg(x.sleep.map((n) => n.stress)) },
  { id: 'bedTime', group: '수면', label: '평균 취침', fmt: 'clock', better: null, step: 0.25, n: nights, get: (x) => avg(bedTimes(x)) },
  { id: 'wakeTime', group: '수면', label: '평균 기상', fmt: 'clock', better: null, step: 0.25, n: nights, get: (x) => avg(wakeTimes(x)) },
  { id: 'bedSd', group: '수면', label: '취침 시각 편차', fmt: 'min', better: 'down', step: 10, n: nights, get: (x) => { const v = sdOf(bedTimes(x)); return v == null ? null : v * 60; } },
  { id: 'wakeSd', group: '수면', label: '기상 시각 편차', fmt: 'min', better: 'down', step: 10, n: nights, get: (x) => { const v = sdOf(wakeTimes(x)); return v == null ? null : v * 60; } },

  { id: 'rhr', group: '회복', label: '안정 심박', fmt: 'dec1', better: 'down', step: 1.5, n: rhrN, get: (x) => avg(x.rhr.map((r) => r.v)) },
  { id: 'hrv', group: '회복', label: 'HRV', fmt: 'int', better: 'up', step: 3, n: hrvN, get: (x) => avg(x.hrv.map((h) => h.last)) },
  { id: 'hrvOut', group: '회복', label: 'HRV 범위 밖 밤', fmt: 'int', better: 'down', step: 1, kind: 'sum', n: hrvN, get: (x) => (x.hrv.length ? x.hrv.filter((h) => h.status && h.status !== 'balanced').length : null) },
  { id: 'resp', group: '회복', label: '수면 중 호흡수', fmt: 'dec1', better: null, step: 0.5, n: (x) => x.resp.length, get: (x) => avg(x.resp.map((r) => r.v)) },
  { id: 'hrDay', group: '회복', label: '하루 평균 심박', fmt: 'int', better: null, step: 2, n: dayN, get: (x) => avg(x.days.map((d) => d.hrAvg)) },

  { id: 'stress', group: '스트레스', label: '평균 스트레스', fmt: 'int', better: 'down', step: 3, n: dayN, get: (x) => avg(x.days.map((d) => d.stress)) },
  { id: 'stressAwake', group: '스트레스', label: '깨어 있을 때 스트레스', fmt: 'int', better: 'down', step: 3, n: dayN, get: (x) => avg(x.days.map((d) => d.stressAwake)) },
  { id: 'stressHigh', group: '스트레스', label: '고스트레스 비율', fmt: 'pct', better: 'down', step: 5, n: dayN, get: (x) => avg(x.days.map((d) => d.stressHigh)) },
  { id: 'stressRest', group: '스트레스', label: '휴식 비율', fmt: 'pct', better: 'up', step: 5, n: dayN, get: (x) => avg(x.days.map((d) => d.stressRest)) },

  { id: 'exTime', group: '운동', label: '운동 시간', fmt: 'min', better: null, step: 30, kind: 'sum', n: () => 3, get: (x) => minutesOf(x.ex) },
  { id: 'exCount', group: '운동', label: '운동 횟수', fmt: 'int', better: null, step: 1, kind: 'sum', n: () => 3, get: (x) => x.ex.length },
  { id: 'exDays', group: '운동', label: '운동한 날', fmt: 'int', better: null, step: 1, kind: 'sum', n: () => 3, get: (x) => new Set(x.ex.map((s) => s.date)).size },
  { id: 'danceTime', group: '운동', label: '춤 시간', fmt: 'min', better: null, step: 30, kind: 'sum', n: () => 3, get: (x) => minutesOf(x.ex.filter((s) => s.kind === 'dance')) },
  { id: 'runTime', group: '운동', label: '러닝 시간', fmt: 'min', better: null, step: 15, kind: 'sum', n: () => 3, get: (x) => minutesOf(x.ex.filter((s) => s.kind === 'run')) },
  { id: 'highTime', group: '운동', label: '고강도 시간', fmt: 'min', better: null, step: 10, kind: 'sum', n: () => 3, get: (x) => sumOf(x.ex.map((s) => s.high)) / 60 },
  { id: 'effect', group: '운동', label: '평균 유산소 효과', fmt: 'dec1', better: null, step: 0.3, n: exN, get: (x) => avg(x.ex.map((s) => s.effect)) },
  { id: 'anaerobic', group: '운동', label: '평균 무산소 효과', fmt: 'dec1', better: null, step: 0.3, n: exN, get: (x) => avg(x.ex.map((s) => s.anaerobic)) },
  { id: 'load', group: '운동', label: '운동 부하 합계', fmt: 'int', better: null, step: 50, kind: 'sum', n: () => 3, get: (x) => { const v = x.ex.map((s) => s.load).filter((l) => l != null); return v.length ? sumOf(v) : null; } },
  { id: 'loadRatio', group: '운동', label: '부하 비율 (7일/28일)', fmt: 'dec2', better: null, step: 0.2, n: () => 3, get: loadRatio },
  { id: 'calories', group: '운동', label: '운동 칼로리', fmt: 'int', better: null, step: 300, kind: 'sum', n: () => 3, get: (x) => sumOf(x.ex.map((s) => s.calories)) },

  { id: 'runDist', group: '러닝', label: '러닝 거리', fmt: 'km', better: null, step: 3, kind: 'sum', n: () => 3, get: (x) => sumOf(runs(x).map((s) => s.distance)) / 1000 },
  { id: 'runPace', group: '러닝', label: '평균 페이스', fmt: 'pace', better: 'down', step: 10, n: runN, get: (x) => { const r = runs(x); return r.length ? sumOf(r.map((s) => s.seconds)) / (sumOf(r.map((s) => s.distance)) / 1000) : null; } },
  { id: 'runEff', group: '러닝', label: '심박당 거리', fmt: 'dec2', better: 'up', step: 0.05, n: runN, get: (x) => avg(runs(x).filter((s) => s.avgHr > 0).map((s) => (s.distance / s.seconds) * 60 / s.avgHr)) },

  { id: 'steps', group: '일상', label: '하루 평균 걸음', fmt: 'int', better: 'up', step: 1000, n: stepN, get: (x) => avg(x.steps.map((s) => s.v)) },
  { id: 'stepGoal', group: '일상', label: `${STEP_GOAL.toLocaleString('ko-KR')}보 넘긴 날`, fmt: 'pct', better: 'up', step: 10, n: stepN, get: (x) => (x.steps.length ? (x.steps.filter((s) => s.v >= STEP_GOAL).length / x.steps.length) * 100 : null) },
  { id: 'activeCal', group: '일상', label: '하루 활동 칼로리', fmt: 'int', better: null, step: 50, n: stepN, get: (x) => avg(x.steps.map((s) => s.calories)) },
  { id: 'vo2', group: '일상', label: 'VO2max 추정', fmt: 'dec1', better: 'up', step: 0.5, n: (x) => x.vo2.length, get: (x) => avg(x.vo2.map((v) => v.v)) },
];
export const metricById = Object.fromEntries(METRICS.map((x) => [x.id, x]));

// Verdicts need this many records in a period, so a single odd night is not called a trend.
// A period of one or two days can only hold one record, so it needs one.
const MIN_SESSIONS = 2;
const minRecords = (metric, period) => {
  if (period.days <= 2) return 1;
  return ['runPace', 'runEff', 'effect', 'anaerobic', 'vo2', 'hrvOut'].includes(metric.id) ? MIN_SESSIONS : 3;
};
// How many earlier periods make the baseline: a week of days, otherwise four periods.
const baseCount = (period) => (period.unit === 'day' ? 7 : 4);

function sliceOf(m, start, end, latest) {
  const within = (a) => a.filter((x) => x.date >= start && x.date <= end);
  const sessions = within(m.sessions);
  return {
    start, end, lastDay: end < latest ? end : latest,
    sleep: within(m.sleep), hrv: within(m.hrv), rhr: within(m.rhr), resp: within(m.resp),
    steps: within(m.steps), vo2: within(m.vo2), days: within(m.days),
    sessions, ex: sessions.filter((s) => s.kind !== 'dive'),
  };
}

function period(m, unit, start, end, latest) {
  const x = sliceOf(m, start, end, latest);
  const values = {};
  const counts = {};
  for (const metric of METRICS) {
    values[metric.id] = metric.get(x, m);
    counts[metric.id] = metric.n(x);
  }
  return { unit, start, end, days: daysBetween(start, end).length, slice: x, values, counts, partial: end > latest, ...labels(unit, start, end) };
}

// Calendar periods: day, week (Monday to Sunday), month or year.
export function buildPeriods(m, unit) {
  const span = dataSpan(m);
  if (!span) return [];
  const out = [];
  for (let start = startOf(span.first, unit); start <= span.latest; start = addDays(endOf(start, unit), 1)) {
    out.push(period(m, unit, start, endOf(start, unit), span.latest));
  }
  return out;
}

// A chosen date range, preceded by back-to-back ranges of the same length for comparison.
export function buildRange(m, start, end, count = 12) {
  const span = dataSpan(m);
  if (!span || start > end) return [];
  const length = daysBetween(start, end).length;
  const out = [];
  for (let i = 0, to = end; i < count; i++, to = addDays(to, -length)) {
    const from = addDays(to, -(length - 1));
    if (i > 0 && to < span.first) break;
    out.unshift(period(m, 'range', from, to, span.latest));
  }
  return out;
}

// Compares one period with the average of the periods before it (seven for days, four otherwise).
export function compare(periods, index, metric) {
  const cur = periods[index];
  const value = cur?.values[metric.id] ?? null;
  const need = cur ? minRecords(metric, cur) : 3;
  const earlier = cur ? periods.slice(Math.max(0, index - baseCount(cur)), index) : [];
  const basis = earlier.filter((p) => p.values[metric.id] != null && p.counts[metric.id] >= need && !p.partial).map((p) => p.values[metric.id]);
  const base = basis.length ? avg(basis) : null;
  const prev = index > 0 ? periods[index - 1].values[metric.id] : null;
  const diff = value != null && base != null ? value - base : null;
  let verdict = { text: '-', tone: '' };
  if (value != null) {
    if (basis.length < 2) verdict = { text: '기준 부족', tone: '' };
    else if (metric.kind === 'sum' && cur.partial) verdict = { text: '진행 중', tone: '' };
    else if (cur.counts[metric.id] < need) verdict = { text: '표본 적음', tone: '' };
    else if (Math.abs(diff) < metric.step) verdict = { text: '비슷', tone: '' };
    else if (metric.better == null) verdict = { text: diff > 0 ? '늘어남' : '줄어듦', tone: '' };
    else if ((diff > 0) === (metric.better === 'up')) verdict = { text: '좋아짐', tone: 'ok' };
    else verdict = { text: '나빠짐', tone: 'fix' };
  }
  return { value, prev, base, basisCount: basis.length, diff, verdict, count: cur?.counts[metric.id] ?? 0 };
}

export function changes(periods, index) {
  const better = [];
  const worse = [];
  for (const metric of METRICS) {
    const c = compare(periods, index, metric);
    if (c.verdict.tone === 'ok') better.push({ metric, ...c });
    if (c.verdict.tone === 'fix') worse.push({ metric, ...c });
  }
  return { better, worse };
}

// Stress by weekday and time slot for one period, weighted by how many samples each day has.
export function stressHeat(days, slots) {
  const cells = slots.map(() => Array.from({ length: 7 }, () => [0, 0]));
  for (const d of days) {
    const w = weekdayIndex(d.date);
    d.slots.forEach(([sum, n], i) => { cells[i][w][0] += sum; cells[i][w][1] += n; });
  }
  return cells.map((row) => row.map(([sum, n]) => (n ? Math.round(sum / n) : null)));
}

// How the next morning looked after each kind of day. Uses every record kept, because each group is small.
export function afterExercise(m) {
  const ex = m.sessions.filter((s) => s.kind !== 'dive');
  if (!ex.length) return [];
  const firstEx = ex.at(-1).date;
  const hrv = new Map(m.hrv.map((x) => [x.date, x.last]));
  const rhr = new Map(m.rhr.map((x) => [x.date, x.v]));
  const byDay = new Map();
  for (const s of ex) { if (!byDay.has(s.date)) byDay.set(s.date, []); byDay.get(s.date).push(s); }
  const bed = (n) => hoursFromEvening(n.start, n.date);
  const usualBed = (n) => avg(m.sleep.filter((p) => p.date < n.date && p.date >= addDays(n.date, -7)).map(bed));
  const groups = [
    ['쉰 날', (list) => !list],
    ['운동한 날', (list) => !!list],
    ['유산소 효과 3 이상', (list) => list?.some((s) => s.effect >= 3)],
    ['저녁 8시 이후 운동', (list) => list?.some((s) => new Date(s.start).getHours() >= 20)],
    // Exercise that ended within an hour before falling asleep.
    ['잠들기 1시간 안에 운동 끝', (list, n) => (list ?? []).concat(byDay.get(n.date) ?? []).some((s) => { const gap = n.start - (s.start + s.seconds * 1000); return gap >= 0 && gap <= 36e5; })],
    // Bedtime at least 30 minutes later than the average of the seven nights before.
    ['평소보다 30분 넘게 늦게 잠', (list, n) => { const u = usualBed(n); return u != null && bed(n) - u >= 0.5; }],
  ];
  return groups.map(([label, test]) => {
    const rows = m.sleep.filter((n) => { const before = addDays(n.date, -1); return before >= firstEx && test(byDay.get(before), n); });
    return {
      label, n: rows.length,
      score: avg(rows.map((n) => n.score)), asleep: avg(rows.map((n) => n.asleep)), deep: avg(rows.map((n) => n.totals.deep)),
      stress: avg(rows.map((n) => n.stress)), hrv: avg(rows.map((n) => hrv.get(n.date))), rhr: avg(rows.map((n) => rhr.get(n.date))),
    };
  });
}

// Night signal: last night's values against the person's own recent nights.
// A signal is raised only when two or more go the unhealthy way together (research note 261108, Apple Vitals style).
// Baseline: up to 28 nights before. Fewer than 7 is still forming, 7 to 20 is provisional, 21 or more is settled.
// Thresholds are working values, not medical limits.
const NIGHT_ITEMS = [
  { id: 'rhr', label: '안정 심박', unit: 'bpm', worse: 1, floor: 1, min: 2, d: 0, read: (m) => m.rhr.map((x) => [x.date, x.v]) },
  { id: 'hrv', label: 'HRV', unit: 'ms', worse: -1, floor: 3, min: 5, d: 0, read: (m) => m.hrv.map((x) => [x.date, x.last]) },
  { id: 'resp', label: '수면 중 호흡수', unit: '회/분', worse: 1, floor: 0.3, min: 0.5, d: 1, read: (m) => m.resp.map((x) => [x.date, x.v]) },
  { id: 'sleepStress', label: '수면 중 스트레스', unit: '', worse: 1, floor: 2, min: 4, d: 0, read: (m) => m.sleep.map((x) => [x.date, x.stress]) },
];
export const NIGHT_Z = 1.5;
export function baselineStage(n) {
  if (n >= 21) return { text: `확정 기준선 ${n}밤`, tone: 'ok', ready: true };
  if (n >= 7) return { text: `잠정 기준선 ${n}밤`, tone: '', ready: true };
  return { text: `기준선 형성 중 ${n}/7밤`, tone: '', ready: false };
}
export function nightSignal(m, date) {
  const rows = NIGHT_ITEMS.map((item) => {
    const all = item.read(m).filter(([, v]) => v != null);
    const today = all.find(([d]) => d === date)?.[1] ?? null;
    const past = all.filter(([d]) => d < date && d >= addDays(date, -28)).map(([, v]) => v);
    const stage = baselineStage(past.length);
    const mean = past.length ? avg(past) : null;
    const sd = Math.max(item.floor, sdOf(past) ?? 0);
    const diff = today != null && mean != null ? today - mean : null;
    const off = stage.ready && diff != null && (diff * item.worse) / sd >= NIGHT_Z && Math.abs(diff) >= item.min;
    return { ...item, value: today, mean, diff, n: past.length, stage, off };
  });
  const measured = rows.filter((r) => r.value != null && r.stage.ready);
  const off = rows.filter((r) => r.off).length;
  const level = !measured.length ? 'none' : off >= 2 ? 'signal' : off === 1 ? 'one' : 'usual';
  return { date, rows, off, level, stage: baselineStage(Math.min(...rows.map((r) => r.n))) };
}
// Signals for each of the last nights, newest last.
export function nightSignals(m, count = 14) {
  const dates = [...new Set([...m.rhr, ...m.hrv, ...m.sleep].map((x) => x.date))].sort().slice(-count);
  return dates.map((d) => nightSignal(m, d));
}

export function weekdayTable(m) {
  const ex = m.sessions.filter((s) => s.kind !== 'dive');
  const dates = [m.sleep, m.steps, ex].flatMap((a) => a.map((x) => x.date)).sort();
  const seen = Array(7).fill(0);
  if (dates.length) for (const k of daysBetween(dates[0], dates.at(-1))) seen[weekdayIndex(k)]++;
  return ['월', '화', '수', '목', '금', '토', '일'].map((label, i) => {
    const on = (x) => weekdayIndex(x.date) === i;
    const night = m.sleep.filter(on);
    return {
      label,
      score: avg(night.map((n) => n.score)), asleep: avg(night.map((n) => n.asleep)),
      bed: avg(night.map((n) => hoursFromEvening(n.start, n.date))),
      steps: avg(m.steps.filter(on).map((s) => s.v)),
      exercise: seen[i] ? minutesOf(ex.filter(on)) / seen[i] : null,
    };
  });
}
