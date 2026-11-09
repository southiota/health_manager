// Page shell and screens. All text is set with textContent and all sizes through el.style,
// so the strict Content-Security-Policy in index.html can stay on.
import {
  METRICS, addDays, afterExercise, avg, buildPeriods, changes, clock, compare, dayKey, daysBetween, formatDiff, formatValue,
  buildRange, dataSpan, hm, hoursFromEvening, md, metricById, nightSignals, pad, REFERENCE, startOf, stressHeat, weekdayTable,
} from './periods.js';
import { INFO, INFO_ORDER } from './info.js';
import { checkupRows, nextExam } from './checkup.js';

const SVG = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  return fill(el, props, kids);
}
function s(tag, props, ...kids) {
  const el = document.createElementNS(SVG, tag);
  return fill(el, props, kids);
}
function fill(el, props, kids) {
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
    else if (k === 'style') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

// ---------- formatting ----------
const hhmm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const kor = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };
const num = (v, d = 0) => (v == null ? '-' : Number(v).toFixed(d));
const last = (a) => (a.length ? a[a.length - 1] : null);
const daysAgo = (key) => Math.round((new Date(dayKey(Date.now())) - new Date(key)) / 864e5);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- explanations ----------
let openInfo = null;
function closeInfo(refocus) {
  if (!openInfo) return;
  openInfo.box.remove();
  openInfo.button.setAttribute('aria-expanded', 'false');
  if (refocus) openInfo.button.focus();
  openInfo = null;
}
function showInfo(button, key, label) {
  const same = openInfo?.key === key && openInfo.button === button;
  closeInfo(false);
  if (same) return;
  const data = INFO[key];
  const box = h('div', { class: 'infobox', role: 'dialog', 'aria-label': `${label} 설명`, on: { click: (e) => e.stopPropagation() } },
    h('div', { class: 'infohead' }, h('b', null, label),
      h('button', { class: 'infoclose', type: 'button', 'aria-label': '설명 닫기', on: { click: () => closeInfo(true) } }, '×')),
    INFO_ORDER.filter((name) => data[name]).map((name) => [h('h3', null, name), h('ul', null, data[name].map((t) => h('li', null, t)))]));
  document.body.append(box);
  const r = button.getBoundingClientRect();
  const width = box.offsetWidth;
  const left = clamp(r.left, 16, Math.max(16, document.documentElement.clientWidth - width - 16));
  const below = r.bottom + 6 + box.offsetHeight <= innerHeight || r.top < box.offsetHeight + 6;
  box.style.left = `${left + scrollX}px`;
  box.style.top = `${(below ? r.bottom + 6 : r.top - box.offsetHeight - 6) + scrollY}px`;
  button.setAttribute('aria-expanded', 'true');
  openInfo = { box, button, key };
}
const infoBtn = (key, label) => (INFO[key] ? h('button', {
  class: 'info', type: 'button', 'aria-label': `${label} 설명 보기`, 'aria-expanded': 'false', 'data-info': key,
  on: { click: (e) => { e.stopPropagation(); showInfo(e.currentTarget, key, label); } },
}, h('span', { 'aria-hidden': 'true' }, '!')) : null);
addEventListener('click', () => closeInfo(false));
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInfo(true); });

// ---------- pieces ----------
const titled = (tag, text, key) => h('div', { class: 'titled' }, h(tag, null, text), infoBtn(key, text));
const panel = (title, key, right, ...kids) => h('section', { class: 'panel' }, h('div', { class: 'head' }, titled('h2', title, key), right), kids);
const sub = (t) => h('span', { class: 'sub' }, t);
const note = (t) => h('p', { class: 'note' }, t);
const pill = (t, tone) => h('span', { class: `pill ${tone ?? ''}` }, t);
const empty = (t = '이 기간에는 기록이 없습니다.') => h('div', { class: 'empty' }, t);
const stat = (value, unit, cls = 'num') => h('div', { class: 'stat' }, h('span', { class: cls }, value), unit ? h('span', { class: 'unit' }, unit) : null);
const axis = (...t) => h('div', { class: 'axis' }, t.map((x) => h('span', null, x)));
const legend = (...items) => h('div', { class: 'legend' }, items.map(([cls, t]) => h('span', null, h('i', { class: `sw ${cls}` }), t)));
const grid = (cols, ...kids) => h('div', { class: `grid ${cols}` }, kids);
const heading = (t) => h('h2', { class: 'sec' }, t);
const th = (label, key, right) => h('th', { class: right ? 'r' : null }, h('span', { class: 'thwrap' }, label, key ? infoBtn(key, label) : null));

function judgeBand(tone, label, context, say, reasons, key) {
  return h('section', { class: 'judge' },
    h('div', { class: 'meta' }, pill(label, tone), h('span', null, context), key ? infoBtn(key, label) : null),
    h('p', { class: 'say' }, say),
    reasons.length ? h('ul', null, reasons.map((r) => h('li', null, r))) : null);
}

// Shows the value under the pointer. Works for a mouse and for a tap.
function addTips(el, tips) {
  if (!tips?.length) return el;
  const tip = h('div', { class: 'tip', hidden: true });
  const move = (e) => {
    const r = el.getBoundingClientRect();
    const f = clamp((e.clientX - r.left) / r.width, 0, 1);
    const i = el.classList.contains('bars') ? Math.min(tips.length - 1, Math.floor(f * tips.length)) : Math.round(f * (tips.length - 1));
    if (tips[i] == null) { tip.hidden = true; return; }
    tip.textContent = tips[i];
    tip.hidden = false;
    tip.style.left = f > 0.6 ? 'auto' : `${f * 100}%`;
    tip.style.right = f > 0.6 ? `${(1 - f) * 100}%` : 'auto';
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerdown', move);
  el.addEventListener('pointerleave', () => { tip.hidden = true; });
  el.append(tip);
  return el;
}

function lineChart(series, { lo, hi, band, area, cls = 'chart', label, tips, quiet }) {
  const values = series.flatMap((x) => x.v).concat(band ?? []).filter((v) => v != null);
  const points = series[series.length - 1].v.filter((v) => v != null).length;
  if (points < 2) return quiet ? h('span', { class: 'muted' }, '-') : empty(points ? '기록이 하나뿐이라 선을 그리지 않습니다.' : undefined);
  const min = lo ?? Math.min(...values);
  const max = hi ?? Math.max(...values);
  const span = max - min || 1;
  const y = (v) => 38 - ((v - min) / span) * 36;
  const pts = (v) => v.map((val, i) => (val == null ? null : `${v.length > 1 ? ((i / (v.length - 1)) * 100).toFixed(2) : 50},${y(val).toFixed(2)}`)).filter(Boolean).join(' ');
  const svg = s('svg', { viewBox: '0 0 100 40', preserveAspectRatio: 'none', role: 'img', 'aria-label': label });
  if (band) svg.append(s('rect', { class: 'bandfill', x: 0, width: 100, y: y(band[1]), height: y(band[0]) - y(band[1]) }));
  if (area) svg.append(s('polygon', { class: 'area', points: `0,40 ${area.map((v, i) => `${((i / (area.length - 1)) * 100).toFixed(2)},${(38 - ((v ?? 0) / 100) * 36).toFixed(2)}`).join(' ')} 100,40` }));
  for (const x of series) svg.append(s('polyline', { class: `ln ${x.cls ?? ''}`, points: pts(x.v) }));
  return addTips(h('div', { class: cls }, svg), tips);
}

function barChart(columns, label, tips) {
  return addTips(h('div', { class: `bars ${columns.length > 14 ? 'dense' : ''}`, role: 'img', 'aria-label': label }, columns.map((parts) =>
    h('div', { class: 'col' }, parts.map(([pct, cls]) => h('div', { class: `seg-part ${cls}`, style: { height: `${pct}%` } }))))), tips);
}
const nightBand = (n) => h('div', { class: 'seg-row', role: 'img', 'aria-label': '수면 단계 시간 띠' },
  n.stages.map((x) => h('div', { class: `seg s-${x.level}`, style: { flex: `${x.to - x.from} 1 0` } })));

const zoneRows = (zones) => {
  const total = zones.reduce((a, b) => a + b, 0) || 1;
  return zones.map((z, i) => h('div', { class: 'score-row' }, h('span', null, `구간 ${i + 1}`),
    h('div', { class: 'fill' }, h('i', { style: { width: `${(z / total) * 100}%` } })), h('b', null, Math.round((z / total) * 100))));
};

// ---------- periods ----------
const UNIT_TABS = [['day', '일'], ['week', '주'], ['month', '월'], ['year', '연'], ['range', '기간 지정']];
const ui = { unit: 'week', range: null, offset: 0, sport: 'all', session: null, dive: null, metric: null, exam: null };
// The chosen unit and range are remembered in this browser only. Health values are never stored.
const SAVED = 'health.period';
try {
  const saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null');
  if (UNIT_TABS.some(([k]) => k === saved?.unit)) ui.unit = saved.unit;
  if (/^\d{4}-\d{2}-\d{2}$/.test(saved?.range?.start ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(saved?.range?.end ?? '')) ui.range = saved.range;
} catch { /* storage may be blocked */ }
const remember = () => { try { localStorage.setItem(SAVED, JSON.stringify({ unit: ui.unit, range: ui.range })); } catch { /* storage may be blocked */ } };
let tables = {};
const TREND = 12;

// Keeps a chosen range inside the recorded days.
function fitRange(start, end) {
  const span = dataSpan(model);
  if (!span) return null;
  if (start > end) [start, end] = [end, start];
  const length = daysBetween(start, end).length;
  if (end > span.latest) { end = span.latest; start = addDays(end, -(length - 1)); }
  if (start < span.first && end < span.first) { start = span.first; end = addDays(start, length - 1); }
  return { start, end };
}
function current() {
  if (ui.unit === 'range') {
    const span = dataSpan(model);
    if (!span) return { periods: [], i: -1, cur: null };
    ui.range = fitRange(ui.range?.start ?? addDays(span.latest, -29), ui.range?.end ?? span.latest);
    const key = `range:${ui.range.start}:${ui.range.end}`;
    const periods = (tables[key] ??= buildRange(model, ui.range.start, ui.range.end, TREND));
    return { periods, i: periods.length - 1, cur: periods.at(-1) };
  }
  const periods = (tables[ui.unit] ??= buildPeriods(model, ui.unit));
  ui.offset = clamp(ui.offset, 0, Math.max(0, periods.length - 1));
  const i = periods.length - 1 - ui.offset;
  return { periods, i, cur: periods[i] };
}
const countWord = (n) => ({ day: `${n}일`, week: `${n}주`, month: `${n}개월`, year: `${n}년`, range: `${n}구간` })[ui.unit];

function setUnit(unit) { ui.unit = unit; ui.offset = 0; ui.metric = null; remember(); draw(); }
function setRange(start, end) { ui.range = fitRange(start, end); remember(); draw(); }
function stepPeriod(d) {
  if (ui.unit === 'range') {
    const length = daysBetween(ui.range.start, ui.range.end).length;
    setRange(addDays(ui.range.start, -d * length), addDays(ui.range.end, -d * length));
  } else { ui.offset += d; draw(); }
}
function jumpTo(date) {
  const { periods } = current();
  const k = periods.findIndex((p) => p.start <= date && date <= p.end);
  if (k >= 0) { ui.offset = periods.length - 1 - k; draw(); }
}
const dateInput = (label, value, span, change) => h('label', { class: 'datefield' }, h('span', null, label),
  h('input', { type: 'date', value, min: span.first, max: span.latest, on: { change: (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) change(e.target.value); } } }));

function periodBar({ periods, i, cur }) {
  if (!cur) return null;
  const span = dataSpan(model);
  const x = cur.slice;
  const running = cur.partial ? daysBetween(cur.start, x.lastDay).length : null;
  const isRange = ui.unit === 'range';
  const atStart = isRange ? cur.end < span.first || addDays(cur.start, -1) < span.first : i === 0;
  const atEnd = isRange ? cur.end >= span.latest : ui.offset === 0;
  const presets = [
    ['최근 7일', addDays(span.latest, -6), span.latest],
    ['최근 30일', addDays(span.latest, -29), span.latest],
    ['최근 90일', addDays(span.latest, -89), span.latest],
    ['올해', startOf(span.latest, 'year'), span.latest],
    ['전체', span.first, span.latest],
  ];
  return h('section', { class: 'periodbar' },
    h('div', { class: 'pbrow' },
      h('div', { class: 'filters', role: 'group', 'aria-label': '기간 단위' }, UNIT_TABS.map(([k, t]) =>
        h('button', { type: 'button', 'aria-pressed': String(ui.unit === k), on: { click: () => setUnit(k) } }, t))),
      h('div', { class: 'stepper' },
        h('button', { class: 'btn', type: 'button', 'aria-label': '이전 기간', 'aria-keyshortcuts': 'ArrowLeft', disabled: atStart, on: { click: () => stepPeriod(1) } }, '‹'),
        h('strong', { 'aria-live': 'polite' }, cur.label),
        h('button', { class: 'btn', type: 'button', 'aria-label': '다음 기간', 'aria-keyshortcuts': 'ArrowRight', disabled: atEnd, on: { click: () => stepPeriod(-1) } }, '›')),
      isRange ? pill(`${cur.days}일`) : null,
      running ? pill(`진행 중 ${running}일째`) : null,
      !isRange && ui.offset > 0 ? h('button', { class: 'btn small', type: 'button', on: { click: () => { ui.offset = 0; draw(); } } }, '최신') : null,
      infoBtn('period', '기간 보기')),
    h('div', { class: 'pbrow' },
      isRange ? [
        dateInput('시작', cur.start, span, (v) => setRange(v, ui.range.end)),
        dateInput('끝', cur.end, span, (v) => setRange(ui.range.start, v)),
        h('div', { class: 'filters presets', role: 'group', 'aria-label': '빠른 선택' }, presets.map(([t, a, b]) =>
          h('button', { type: 'button', 'aria-pressed': String(ui.range.start === a && ui.range.end === b), on: { click: () => setRange(a, b) } }, t))),
      ] : dateInput('날짜로 이동', cur.start < span.first ? span.first : cur.start > span.latest ? span.latest : cur.start, span, jumpTo),
      h('span', { class: 'coverage' }, `수면 ${x.sleep.length}밤 · HRV ${x.hrv.length}밤 · 일상 ${x.days.length}일 · 운동 ${x.ex.length}회`)));
}
// ← and → move between periods when no text field has focus.
addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const b = document.querySelector(`.periodbar [aria-label="${e.key === 'ArrowLeft' ? '이전' : '다음'} 기간"]`);
  if (b && !b.disabled) { e.preventDefault(); b.click(); }
});

// Marks metrics with large device error, so they are read as trends, not exact values.
const refTag = (id) => (REFERENCE.has(id) ? h('span', { class: 'reftag', title: '오차가 커서 절대값보다 변화 위주로 보는 참고 지표' }, '참고') : null);
function tile(view, id) {
  const metric = metricById[id];
  const c = compare(view.periods, view.i, metric);
  return h('section', { class: 'panel' }, h('div', { class: 'titled' }, h('h2', null, metric.label), refTag(id), infoBtn(id, metric.label)), stat(formatValue(metric, c.value)),
    h('div', { class: 'tilefoot' }, c.value != null ? pill(c.verdict.text, c.verdict.tone) : null,
      c.base != null ? note(`기준 ${formatValue(metric, c.base)}`) : null));
}

function metricChart(view, metric, cls) {
  const list = view.periods.slice(Math.max(0, view.i - TREND + 1), view.i + 1);
  const v = list.map((p) => p.values[metric.id]);
  const tips = list.map((p, k) => (v[k] == null ? null : `${p.label}: ${formatValue(metric, v[k])}`));
  if (metric.kind === 'sum') {
    const top = Math.max(1e-9, ...v.map((x) => x ?? 0));
    return { list, chart: barChart(v.map((x) => [[((x ?? 0) / top) * 100, 'bar']]), `${metric.label} 기간별 막대`, tips) };
  }
  return { list, chart: lineChart([{ v }], { cls, label: `${metric.label} 기간별 추세`, tips }) };
}
function trendPanel(view, id) {
  const metric = metricById[id];
  const { list, chart } = metricChart(view, metric);
  return panel(metric.label, id, sub(`최근 ${countWord(list.length)}`), chart, axis(list[0].short, last(list).short));
}

// ---------- judgement ----------
function judgeToday(m) {
  const reasons = [];
  let warnings = 0;
  const known = [];
  const night = last(m.sleep);
  if (night?.score != null) {
    known.push(1);
    const base = avg(m.sleep.slice(-15, -1).map((n) => n.score));
    if (base != null) {
      const diff = Math.round(night.score - base);
      reasons.push(`수면 점수 평소보다 ${Math.abs(diff)}점 ${diff >= 0 ? '높음' : '낮음'}`);
      if (diff <= -10) warnings++;
    } else reasons.push(`수면 점수 ${night.score}`);
  }
  const hrv = last(m.hrv);
  if (hrv) {
    known.push(1);
    if (hrv.status === 'balanced') reasons.push('HRV 기준 범위 안');
    else if (hrv.status) { reasons.push('HRV 기준 범위 밖'); warnings++; }
  }
  const rhr = last(m.rhr);
  if (rhr) {
    const base = avg(m.rhr.slice(-29, -1).map((x) => x.v));
    if (base != null) {
      known.push(1);
      const diff = Math.round(rhr.v - base);
      reasons.push(diff === 0 ? '안정 심박 28일 평균과 같음' : `안정 심박 28일 평균보다 ${Math.abs(diff)} ${diff > 0 ? '높음' : '낮음'}`);
      if (diff >= 4) warnings++;
    }
  }
  const lastEx = m.sessions[0];
  if (lastEx && daysAgo(lastEx.date) <= 1) reasons.push(`최근 ${lastEx.label} ${kor(lastEx.seconds)}`);
  if (!known.length) return { tone: '', label: '판단 보류', say: '판단할 기록이 아직 부족합니다.', reasons };
  if (warnings >= 2) return { tone: 'no', label: '쉬어가기', say: '오늘은 가볍게 움직이고 쉬는 편이 좋겠습니다.', reasons };
  if (warnings === 1) return { tone: 'fix', label: '보통', say: '몸 상태를 보면서 강도를 조금 낮추세요.', reasons };
  return { tone: 'ok', label: '회복 양호', say: '평소 강도로 운동해도 좋은 날입니다.', reasons };
}

// Last night against the person's own baseline. A signal needs two or more items off together.
const NIGHT_SAY = {
  signal: ['평소와 다른 변화', 'fix', '두 가지 이상이 함께 평소와 다릅니다. 피로, 음주, 늦은 취침, 감기 기운이 있었는지 돌아보고 오늘은 가볍게 지내세요. 진단이 아니며, 증상이 있으면 진료를 받으세요.'],
  one: ['한 가지만 다름', '', '한 가지만 평소와 다릅니다. 하루 값은 흔들리기 쉬워 신호로 보지 않습니다.'],
  usual: ['평소 범위', 'ok', '간밤 값이 평소 범위에 있습니다.'],
  none: ['비교 불가', '', '간밤 기록이 없거나 기준선이 아직 만들어지는 중입니다.'],
};
function nightPanel(m) {
  const list = nightSignals(m, 14);
  const now = list.at(-1);
  if (!now) return null;
  const [label, tone, say] = NIGHT_SAY[now.level];
  const fmt = (r, v) => (v == null ? '-' : `${v.toFixed(r.d)}${r.unit ? ` ${r.unit}` : ''}`);
  return panel('간밤 신호', 'nightSignal', h('span', { class: 'tilefoot' }, pill(label, tone), pill(now.stage.text, now.stage.tone)),
    note(`${md(now.date)} 아침 · ${say}`),
    h('div', { class: 'tbl' }, h('table', { class: 'nighttable' },
      h('thead', null, h('tr', null, th('항목'), th('간밤', null, true), th('평소', null, true), th('차이', null, true), th('기준선'), th('상태'))),
      h('tbody', null, now.rows.map((r) => h('tr', null, h('td', null, r.label),
        h('td', { class: 'r strong' }, fmt(r, r.value)), h('td', { class: 'r' }, fmt(r, r.mean)),
        h('td', { class: 'r' }, r.diff == null ? '-' : Number(Math.abs(r.diff).toFixed(r.d)) === 0 ? '0' : `${r.diff > 0 ? '+' : '−'}${Math.abs(r.diff).toFixed(r.d)}`),
        h('td', null, r.stage.text),
        h('td', null, r.value == null ? '-' : r.off ? pill('평소와 다름', 'fix') : r.stage.ready ? pill('평소', 'ok') : pill('비교 전'))))))),
    h('div', { class: 'nightstrip', role: 'img', 'aria-label': '최근 14밤 동안 평소와 다른 항목 수' }, list.map((x) => h('div', { class: `ns ${x.level}`, title: `${md(x.date)}: ${x.off}개 다름` },
      h('b', null, x.level === 'none' ? '-' : x.off), h('span', null, md(x.date))))),
    note('칸 숫자는 그날 평소와 다른 항목 수. 2 이상이면 신호입니다.'));
}

const changeRows = (list, tone) => list.map((c) => h('div', { class: 'changerow' }, pill(c.verdict.text, tone), h('span', null, c.metric.label),
  h('b', null, `${formatValue(c.metric, c.value)} (${formatDiff(c.metric, c.diff)})`)));

// ---------- screens ----------
function today(m) {
  const j = judgeToday(m);
  const night = last(m.sleep);
  const hrv = last(m.hrv);
  const rhr = last(m.rhr);
  const scores = m.sleep.slice(-14).map((n) => n.score);
  const newest = [...m.sleep.map((n) => n.date), ...m.rhr.map((x) => x.date)].sort().at(-1);
  const stale = newest && daysAgo(newest) >= 2;
  const dates = Object.keys(m.hrHourly).sort();
  const yesterday = dates.filter((d) => d < dayKey(Date.now())).at(-1) ?? last(dates);
  const ex = m.sessions[0];
  const weeks = (tables.week ??= buildPeriods(m, 'week'));
  const moved = weeks.length ? changes(weeks, weeks.length - 1) : { better: [], worse: [] };
  const hrvTrack = () => {
    if (hrv?.lo == null || hrv?.hi == null) return null;
    const min = Math.min(hrv.lo, hrv.last) - 8;
    const max = Math.max(hrv.hi, hrv.last) + 8;
    const pos = (v) => `${((v - min) / (max - min)) * 100}%`;
    return [
      h('div', { class: 'track', role: 'img', 'aria-label': hrv.status === 'balanced' ? '기준 범위 안' : '기준 범위 밖' },
        h('div', { class: 'band', style: { left: pos(hrv.lo), width: `${((hrv.hi - hrv.lo) / (max - min)) * 100}%` } }),
        h('div', { class: 'mark', style: { left: pos(hrv.last) } })),
      axis('기준 범위', `${Math.round(hrv.lo)} ~ ${Math.round(hrv.hi)}`),
    ];
  };
  return [
    judgeBand(j.tone, j.label, stale ? `최신 기록 ${md(newest)}. 시계를 연결하면 갱신됩니다` : '내 기준선과 비교한 판단', j.say, j.reasons, 'judgeToday'),
    nightPanel(m),
    grid('g4',
      panel('수면 점수', 'sleepScore', null, stat(night?.score ?? '-', '/ 100'),
        lineChart([{ v: scores }], { cls: 'chart short', lo: 40, hi: 100, label: '최근 14일 수면 점수 추세' }),
        note(`14일 평균 ${num(avg(scores))}`)),
      panel('간밤 HRV', 'hrv', hrv?.status ? pill(hrv.status === 'balanced' ? '균형' : '범위 밖', hrv.status === 'balanced' ? 'ok' : 'fix') : null,
        stat(hrv ? num(hrv.last) : '-', 'ms'), hrv ? hrvTrack() : null, note(`${m.hrv.length}밤치 기록`)),
      panel('안정 심박', 'rhr', null, stat(rhr?.v ?? '-', 'bpm'),
        lineChart([{ v: m.rhr.slice(-14).map((x) => x.v) }], { cls: 'chart short', label: '최근 14일 안정 심박 추세' }),
        note(`28일 평균 ${num(avg(m.rhr.slice(-28).map((x) => x.v)))}`)),
      panel('최근 운동 효과', 'recentEffect', ex ? sub(md(ex.date)) : null, stat(ex ? num(ex.effect, 1) : '-', '훈련 효과'),
        ex?.zones ? h('div', { class: 'seg-row h-16', role: 'img', 'aria-label': '심박 구간 비율' }, ex.zones.map((z, i) => h('div', { class: `seg z${i + 1}`, style: { flex: `${z} 1 0` } }))) : null,
        ex?.zones ? axis('구간 1', '구간 5') : null, ex ? note(`${ex.label} ${kor(ex.seconds)}`) : null)),
    panel('이번 주 달라진 점', 'weekChange', h('a', { href: '#track', class: 'sub' }, '추적 화면에서 전체 보기'),
      moved.better.length || moved.worse.length ? h('div', { class: 'changes' }, changeRows(moved.worse, 'fix'), changeRows(moved.better, 'ok')) : note('기준과 뚜렷하게 달라진 항목이 없거나 비교할 기록이 아직 부족합니다.')),
    grid('g2',
      panel('어젯밤 수면', 'lastNight', night ? sub(`${hhmm(night.start)} ~ ${hhmm(night.end)} · ${hm(night.asleep)}`) : null,
        night ? [nightBand(night), legend(['s-deep', `깊은 잠 ${hm(night.totals.deep)}`], ['s-light', `얕은 잠 ${hm(night.totals.light)}`], ['s-rem', `REM ${hm(night.totals.rem)}`], ['s-awake', `깸 ${hm(night.totals.awake)}`])] : empty()),
      panel(yesterday ? `${md(yesterday)} 하루` : '하루', 'dayChart', sub('심박과 스트레스'),
        yesterday ? [lineChart([{ v: m.hrHourly[yesterday] }], {
          label: '시간대별 심박과 스트레스', area: m.stressHourly[yesterday],
          tips: m.hrHourly[yesterday].map((v, i) => (v == null ? null : `${pad(i)}시 심박 ${Math.round(v)} · 스트레스 ${num(m.stressHourly[yesterday]?.[i])}`)),
        }), axis('00시', '06시', '12시', '18시', '24시'), legend(['swatch-fg', '심박'], ['swatch-sunk', '스트레스'])] : empty())),
    sessionTable(m.sessions.slice(0, 5), '최근 운동', null),
  ];
}

function sessionTable(rows, title, right, pickRow, selected) {
  return panel(title, 'sessions', right, rows.length ? h('div', { class: 'tbl' }, h('table', null,
    h('thead', null, h('tr', null, th('날짜'), th('종목'),
      th('시간', 'exDuration', true), th('평균 심박', 'avgHr', true), th('최고 심박', 'maxHr', true), th('고강도', 'highTime', true),
      th('유산소', 'effect', true), th('무산소', 'anaerobic', true), th('부하', 'load', true), th('칼로리', 'calories', true))),
    h('tbody', null, rows.map((x) => h('tr', { class: x === selected ? 'pick' : null },
      h('td', null, pickRow ? h('button', { class: 'rowbtn', type: 'button', on: { click: () => pickRow(x) } }, md(x.date)) : md(x.date)),
      h('td', null, x.label),
      [kor(x.seconds), num(x.avgHr), num(x.maxHr), x.high == null ? '-' : hm(x.high / 60), num(x.effect, 1), num(x.anaerobic, 1), num(x.load), num(x.calories)].map((v) => h('td', { class: 'r' }, v))))))) : empty());
}

function historyRow(view, metric) {
  const { list, chart } = metricChart(view, metric);
  const fixed = metric.kind === 'sum' || metric.id === 'loadRatio';
  return h('tr', { class: 'history' }, h('td', { colspan: 7 }, h('div', { class: 'flex-col' },
    titled('h3', `${metric.label} 기간별 값`, 'metricHistory'), chart, axis(list[0].short, last(list).short),
    h('div', { class: 'tbl' }, h('table', null,
      h('thead', null, h('tr', null, th('기간'), th('값', null, true), fixed ? null : th('건수', null, true))),
      h('tbody', null, [...list].reverse().map((p) => h('tr', null, h('td', null, `${p.label}${p.partial ? ' (진행 중)' : ''}`),
        h('td', { class: 'r' }, formatValue(metric, p.values[metric.id])), fixed ? null : h('td', { class: 'r' }, p.counts[metric.id])))))))));
}

function trackScreen(m) {
  const view = current();
  if (!view.cur) return [empty('기록이 없습니다.')];
  const { better, worse } = changes(view.periods, view.i);
  const tone = worse.length > better.length ? 'fix' : worse.length ? '' : 'ok';
  const groups = [...new Set(METRICS.map((x) => x.group))];
  const spark = (metric) => {
    const list = view.periods.slice(Math.max(0, view.i - TREND + 1), view.i + 1);
    return lineChart([{ v: list.map((p) => p.values[metric.id]) }], { cls: 'chart spark', label: `${metric.label} 추세`, quiet: true });
  };
  const after = afterExercise(m);
  return [
    periodBar(view),
    judgeBand(tone, `나빠짐 ${worse.length} · 좋아짐 ${better.length}`, `${view.cur.label}, 앞선 기간과 비교`,
      worse.length ? `${worse.slice(0, 3).map((c) => c.metric.label).join(', ')} 항목을 먼저 살펴보세요.` : better.length ? '나빠진 항목 없이 좋아진 항목이 있습니다.' : '기준과 뚜렷하게 달라진 항목이 없습니다.',
      better.slice(0, 4).map((c) => `${c.metric.label} 좋아짐`), 'trackTable'),
    groups.map((group) => panel(group, group === groups[0] ? 'trackTable' : null, null, h('div', { class: 'tbl' }, h('table', { class: 'tracktable' },
      h('thead', null, h('tr', null, th('항목'), th('이번', null, true), th('직전', null, true), th('기준', null, true), th('변화', null, true), th('판단'), th('추세'))),
      h('tbody', null, METRICS.filter((x) => x.group === group).map((metric) => {
        const c = compare(view.periods, view.i, metric);
        const open = ui.metric === metric.id;
        return [h('tr', { class: open ? 'pick' : null },
          h('td', null, h('span', { class: 'thwrap' },
            h('button', { class: 'rowbtn', type: 'button', 'aria-expanded': String(open), on: { click: () => { ui.metric = open ? null : metric.id; draw(); } } }, metric.label),
            refTag(metric.id), infoBtn(metric.id, metric.label))),
          h('td', { class: 'r strong' }, formatValue(metric, c.value)),
          h('td', { class: 'r' }, formatValue(metric, c.prev)),
          h('td', { class: 'r' }, formatValue(metric, c.base)),
          h('td', { class: 'r' }, formatDiff(metric, c.diff)),
          h('td', null, c.value != null ? pill(c.verdict.text, c.verdict.tone) : '-'),
          h('td', null, spark(metric))), open ? historyRow(view, metric) : null];
      })))))),
    panel('행동별 다음 날 아침', 'afterExercise', sub('보관된 전체 기록'), after.length ? [h('div', { class: 'tbl' }, h('table', null,
      h('thead', null, h('tr', null, th('전날'), th('밤 수', null, true), th('수면 점수', 'sleepScore', true), th('수면 시간', 'sleepTime', true), th('깊은 잠', 'sleepDeep', true), th('수면 중 스트레스', 'sleepStress', true), th('HRV', 'hrv', true), th('안정 심박', 'rhr', true))),
      h('tbody', null, after.map((x) => h('tr', null, h('td', null, x.label), h('td', { class: 'r' }, x.n),
        [num(x.score), hm(x.asleep), hm(x.deep), num(x.stress), num(x.hrv), num(x.rhr, 1)].map((v) => h('td', { class: 'r' }, v))))))),
      note('10밤 미만인 묶음은 우연일 수 있습니다.')] : empty()),
    panel('요일별 패턴', 'weekdays', sub('보관된 전체 기록'), h('div', { class: 'tbl' }, h('table', null,
      h('thead', null, h('tr', null, th('요일'), th('수면 점수', 'sleepScore', true), th('수면 시간', 'sleepTime', true), th('취침', 'bedTime', true), th('걸음', 'steps', true), th('운동 시간', 'exTime', true))),
      h('tbody', null, weekdayTable(m).map((x) => h('tr', null, h('td', null, x.label),
        [num(x.score), hm(x.asleep), clock(x.bed), x.steps == null ? '-' : Math.round(x.steps).toLocaleString('ko-KR'), hm(x.exercise)].map((v) => h('td', { class: 'r' }, v)))))))),
  ];
}

function sleepInsight(list, prior) {
  const collect = (rows) => {
    const scored = {};
    for (const n of rows) for (const [k, v] of Object.entries(n.parts)) if (v != null) (scored[k] ??= []).push(v);
    return Object.fromEntries(Object.entries(scored).map(([k, v]) => [k, avg(v)]));
  };
  const now = collect(list);
  const before = collect(prior);
  const parts = Object.entries(now).map(([k, v]) => ({ k, v: Math.round(v), diff: before[k] == null ? null : Math.round(v - before[k]) })).sort((a, b) => a.v - b.v);
  return { parts, weakest: parts[0] };
}

// Daily charts cover at least 14 days, so a single day is still shown in context (it is the last bar).
const shortView = (view) => view.cur.days < 7;
const chartDays = (view) => daysBetween(shortView(view) ? addDays(view.cur.end, -13) : view.cur.start, view.cur.end);
const inDays = (arr, days) => { const set = new Set(days); return arr.filter((x) => set.has(x.date)); };
const windowSub = (view, fallback) => (shortView(view) ? sub('최근 14일 · 맨 오른쪽이 고른 기간') : fallback);

function sleepScreen(m) {
  const view = current();
  if (!view.cur) return [empty('수면 기록이 없습니다.')];
  const list = view.cur.slice.sleep;
  const prior = view.periods[view.i - 1]?.slice.sleep ?? [];
  const info = sleepInsight(list, prior);
  const worst = info.weakest;
  const days = chartDays(view);
  const shown = inDays(m.sleep, days);
  const byDate = new Map(shown.map((n) => [n.date, n]));
  const nights = days.map((d) => byDate.get(d) ?? null);
  const hrv = new Map(m.hrv.map((x) => [x.date, x.last]));
  const rhr = new Map(m.rhr.map((x) => [x.date, x.v]));
  const mean = view.cur.values.sleepScore;
  const scoreTips = days.map((d, i) => (nights[i]?.score == null ? null : `${md(d)}: ${nights[i].score}점`));
  const bedSd = view.cur.values.bedSd;
  return [
    periodBar(view),
    judgeBand(worst && worst.v < 60 ? 'fix' : list.length ? 'ok' : '', worst && worst.v < 60 ? '살펴볼 점' : list.length ? '평소 범위' : '기록 없음', `${view.cur.label}, ${list.length}밤 기준`,
      worst ? `세부 점수 중 가장 낮은 항목은 ${worst.k}입니다.` : '이 기간의 세부 점수가 없습니다.', [
        worst ? `${worst.k} 평균 ${worst.v}점` : null,
        bedSd != null ? `취침 시각 편차 약 ${Math.round(bedSd)}분` : null,
      ].filter(Boolean)),
    grid('g4', ['sleepScore', 'sleepTime', 'sleepDeep', 'sleepRem', 'sleepAwake', 'sleepWakes', 'sleepStress', 'bedTime', 'wakeTime', 'bedSd', 'wakeSd'].map((id) => tile(view, id))),
    panel('밤별 수면 점수', 'sleepScore', windowSub(view, sub('점선은 기간 평균')), shown.length ? [
      lineChart([{ v: days.map(() => mean), cls: 'dash' }, { v: nights.map((n) => n?.score ?? null) }], { lo: 40, hi: 100, label: '수면 점수 추세', tips: scoreTips }),
      axis(md(days[0]), md(last(days)))] : empty()),
    grid('g3', ['sleepScore', 'sleepTime', 'bedSd'].map((id) => trendPanel(view, id))),
    grid('g2',
      panel('밤별 수면 단계', 'sleepStages', windowSub(view, null), shown.length ? [barChart(nights.map((n) => {
        if (!n) return [];
        const total = n.asleep + n.totals.awake || 1;
        return [[(n.totals.awake / total) * 100, 's-awake'], [(n.totals.rem / total) * 100, 's-rem'], [(n.totals.light / total) * 100, 's-light'], [(n.totals.deep / total) * 100, 's-deep']];
      }), '밤별 수면 단계 비율', nights.map((n, i) => (n ? `${md(days[i])} 깊은 잠 ${hm(n.totals.deep)} · REM ${hm(n.totals.rem)} · 깸 ${hm(n.totals.awake)}` : null))),
      axis(md(days[0]), md(last(days))), legend(['s-deep', '깊은 잠'], ['s-light', '얕은 잠'], ['s-rem', 'REM'], ['s-awake', '깸'])] : empty()),
      panel('취침·기상 시각', 'sleepClock', sub(shortView(view) ? '최근 14일 · 막대 위가 취침, 아래가 기상' : '막대 위가 취침, 아래가 기상'), shown.length ? [
        addTips(h('div', { class: `bars ${days.length > 14 ? 'dense' : ''}`, role: 'img', 'aria-label': '밤별 취침과 기상 시각' }, nights.map((n) => {
          if (!n) return h('div', { class: 'range-col' });
          const top = Math.max(0, hoursFromEvening(n.start, n.date) / 16) * 100;
          const bottom = Math.min(1, hoursFromEvening(n.end, n.date) / 16) * 100;
          return h('div', { class: 'range-col' }, h('i', { style: { top: `${top}%`, height: `${Math.max(1, bottom - top)}%` } }));
        })), nights.map((n, i) => (n ? `${md(days[i])} ${hhmm(n.start)} ~ ${hhmm(n.end)}` : null))),
        axis('21시', '13시까지')] : empty())),
    panel('세부 점수', 'sleepParts', sub('기간 평균. 오른쪽은 직전 기간 대비. 60점 미만은 빨강'), info.parts.length ? info.parts.map(({ k, v, diff }) => h('div', { class: `score-row wide ${v < 60 ? 'low' : ''}` },
      h('span', { class: 'thwrap' }, k, infoBtn(`part:${k}`, k)), h('div', { class: 'fill' }, h('i', { style: { width: `${v}%` } })), h('b', null, v),
      h('span', { class: 'diff' }, diff == null ? '-' : diff === 0 ? '0' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`))) : empty()),
    panel('밤별 기록', 'sleepLog', null, list.length ? h('div', { class: 'tbl' }, h('table', null,
      h('thead', null, h('tr', null, th('날짜'), th('점수', 'sleepScore', true), th('취침', 'bedTime', true), th('기상', 'wakeTime', true), th('수면', 'sleepTime', true), th('깊은 잠', 'sleepDeep', true), th('REM', 'sleepRem', true), th('깸', 'sleepAwake', true), th('깬 횟수', 'sleepWakes', true), th('스트레스', 'sleepStress', true), th('HRV', 'hrv', true), th('안정 심박', 'rhr', true))),
      h('tbody', null, [...list].reverse().map((n) => h('tr', null, h('td', null, md(n.date)),
        [n.score ?? '-', hhmm(n.start), hhmm(n.end), hm(n.asleep), hm(n.totals.deep), hm(n.totals.rem), hm(n.totals.awake), n.awakenings ?? '-', num(n.stress), num(hrv.get(n.date)), rhr.get(n.date) ?? '-'].map((v) => h('td', { class: 'r' }, v))))))) : empty()),
  ];
}

function rolling(list, n) {
  return list.map((_, i) => avg(list.slice(Math.max(0, i - n + 1), i + 1).map((x) => x.v)));
}

function recoveryScreen(m) {
  const view = current();
  if (!view.cur) return [empty('기록이 없습니다.')];
  const x = view.cur.slice;
  const days = chartDays(view);
  const rolled = rolling(m.rhr, 28);
  const roll = new Map(m.rhr.map((r, i) => [r.date, rolled[i]]));
  const rhrBy = new Map(inDays(m.rhr, days).map((r) => [r.date, r.v]));
  const hrvShown = inDays(m.hrv, days);
  const hrvBy = new Map(hrvShown.map((r) => [r.date, r.last]));
  const dayBy = new Map(inDays(m.days, days).map((d) => [d.date, d]));
  const lastHrv = last(hrvShown);
  const band = lastHrv?.lo != null && lastHrv?.hi != null ? [lastHrv.lo, lastHrv.hi] : null;
  const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
  const cells = stressHeat(x.days, m.stressSlots);
  let top = null;
  cells.forEach((row, i) => row.forEach((v, j) => { if (v != null && (!top || v > top.v)) top = { v, i, j }; }));
  const slot = (i) => `${pad(m.stressSlots[i])}~${pad(m.stressSlots[i + 1] ?? 24)}시`;
  const worse = ['rhr', 'hrv', 'hrvOut', 'stress', 'stressAwake', 'stressHigh'].map((id) => [metricById[id], compare(view.periods, view.i, metricById[id])]).filter(([, c]) => c.verdict.tone === 'fix');
  return [
    periodBar(view),
    judgeBand(worse.length ? 'fix' : 'ok', worse.length ? '피로 신호' : '눈에 띄는 피로 신호 없음', `${view.cur.label}, 앞선 기간과 비교`,
      worse.length ? `${worse.map(([metric]) => metric.label).join(', ')} 항목이 평소보다 나쁩니다.` : '회복과 스트레스 항목이 평소 범위에 있습니다.', [
        top ? `스트레스 최고 구간: ${DAYS[top.j]} ${slot(top.i)}` : null,
      ].filter(Boolean)),
    grid('g4', ['rhr', 'hrv', 'hrvOut', 'resp', 'stress', 'stressAwake', 'stressHigh', 'stressRest', 'hrDay'].map((id) => tile(view, id))),
    grid('g2',
      panel('안정 심박', 'rhrChart', windowSub(view, sub('bpm')), rhrBy.size ? [
        lineChart([{ v: days.map((d) => roll.get(d) ?? null), cls: 'dash' }, { v: days.map((d) => rhrBy.get(d) ?? null) }], { label: '안정 심박 일별 값과 28일 평균', tips: days.map((d) => (rhrBy.has(d) ? `${md(d)}: ${rhrBy.get(d)} bpm` : null)) }),
        axis(md(days[0]), md(last(days))), legend(['swatch-fg', '하루 값'], ['swatch-grey', '28일 평균 (점선)'])] : empty()),
      panel('HRV', 'hrvChart', windowSub(view, pill(`${m.hrv.length}밤 보관`)), hrvBy.size ? [
        lineChart([{ v: days.map((d) => hrvBy.get(d) ?? null) }], { band, label: '밤별 HRV와 시계 기준 범위', tips: days.map((d) => (hrvBy.has(d) ? `${md(d)}: ${Math.round(hrvBy.get(d))} ms` : null)) }),
        axis(md(days[0]), md(last(days))), legend(['swatch-fg', '간밤 평균'], ['swatch-ok', '시계가 준 기준 범위'])] : empty())),
    panel('날짜별 스트레스', 'stressChart', windowSub(view, null), dayBy.size ? [
      lineChart([{ v: days.map((d) => dayBy.get(d)?.stressAwake ?? null), cls: 'dash' }, { v: days.map((d) => dayBy.get(d)?.stress ?? null) }], { lo: 0, label: '날짜별 평균 스트레스', tips: days.map((d) => (dayBy.get(d)?.stress == null ? null : `${md(d)}: 평균 ${Math.round(dayBy.get(d).stress)} · 깨어 있을 때 ${num(dayBy.get(d).stressAwake)}`)) }),
      axis(md(days[0]), md(last(days))), legend(['swatch-fg', '평균'], ['swatch-grey', '깨어 있을 때 (점선)'])] : empty()),
    grid('g3', ['rhr', 'hrv', 'stress'].map((id) => trendPanel(view, id))),
    grid('g2',
      panel('요일·시간대별 스트레스', 'heat', sub(view.cur.label), x.days.length ? [
        h('div', { class: 'heat' }, h('div', { class: 'h' }), DAYS.map((d) => h('div', { class: 'h' }, d)),
          cells.map((row, i) => [h('div', { class: 'h' }, `${pad(m.stressSlots[i])}시`),
            row.map((v) => h('div', { class: `c ${v == null ? 'none' : v <= 25 ? 'c0' : v <= 50 ? 'c1' : v <= 75 ? 'c2' : 'c3'}` }, v ?? '-'))])),
        legend(['c0', '0~25 휴식'], ['c1', '26~50 낮음'], ['c2', '51~75 보통'], ['c3', '76~ 높음'])] : empty()),
      h('div', { class: 'grid stack-start' },
        trendPanel(view, 'resp'),
        trendPanel(view, 'vo2'),
        note('일상 기록과 수면은 시계에 약 5주치만 남습니다. 빠짐없이 쌓으려면 한 달에 한 번은 연결하세요.'))),
  ];
}

function routeView(route) {
  const lons = route.map((p) => p[0]);
  const lats = route.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const w = (x1 - x0) * k || 1e-6;
  const ht = y1 - y0 || 1e-6;
  const scale = Math.min(96 / w, 56 / ht);
  const pts = route.map(([x, y]) => `${(2 + (x - x0) * k * scale).toFixed(2)},${(58 - (y - y0) * scale).toFixed(2)}`).join(' ');
  return h('div', { class: 'route' }, s('svg', { viewBox: '0 0 100 60', preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': '배경 지도 없는 경로 선' }, s('polyline', { class: 'ln', points: pts })));
}

function sessionDetail(x) {
  const pace = x.speed > 0 ? 1000 / x.speed : null;
  const paceText = pace ? `${Math.floor(pace / 60)}'${pad(Math.round(pace % 60))}"/km` : '-';
  const beats = x.speed > 0 && x.avgHr > 0 ? (x.speed * 60) / x.avgHr : null;
  return panel(`${md(x.date)} ${x.label} 상세`, 'sessionHeart', sub(`유산소 ${num(x.effect, 1)} · 무산소 ${num(x.anaerobic, 1)} · 칼로리 ${num(x.calories)}`),
    x.heart.length ? [lineChart([{ v: x.heart.map((p) => p[1]) }], { label: '운동 중 심박', tips: x.heart.map((p) => `${Math.round(p[0] / 60)}분: ${p[1]} bpm`) }), axis('0분', kor(x.seconds))] : note('이 운동은 요약 기록만 남아 있습니다.'),
    grid('g2',
      h('div', { class: 'flex-col' }, titled('h2', '심박 구간별 시간', 'sessionZones'), x.zones ? [zoneRows(x.zones), note('단위는 전체 시간 대비 %')] : empty('구간 기록이 없습니다.')),
      x.kind === 'dance' ? h('div', { class: 'flex-col' }, titled('h2', '춤은 강도로 봅니다', 'danceDetail'),
        grid('g2',
          h('div', null, note('고강도 시간 (구간 4·5)'), stat(x.high == null ? '-' : hm(x.high / 60), null, 'num md')),
          h('div', null, note('무산소 효과'), stat(num(x.anaerobic, 1), null, 'num md'))))
        : h('div', { class: 'flex-col' }, titled('h2', x.distance ? `경로 · ${paceText} · ${(x.distance / 1000).toFixed(1)}km${beats ? ` · 심박당 ${beats.toFixed(2)}m` : ''}` : '경로', 'route'),
          x.ascent != null ? note(`오른 고도 ${Math.round(x.ascent)}m`) : null,
          x.route.length > 1 ? [routeView(x.route), note('위치가 외부로 나가지 않도록 배경 지도 없이 선만 그립니다.')] : empty('GPS 기록이 없습니다.'))));
}

function activityScreen(m) {
  const view = current();
  if (!view.cur) return [empty('운동 기록이 없습니다.')];
  const x = view.cur.slice;
  const days = chartDays(view);
  const list = [...x.ex].sort((a, b) => b.start - a.start);
  const minutes = (rows) => rows.reduce((p, r) => p + r.seconds, 0) / 60;
  const exShown = inDays(m.sessions, days).filter((r) => r.kind !== 'dive');
  const perDay = days.map((d) => exShown.filter((r) => r.date === d));
  const topDay = Math.max(1, ...perDay.map(minutes));
  const stepShown = inDays(m.steps, days);
  const stepBy = new Map(stepShown.map((r) => [r.date, r.v]));
  const peak = Math.max(1, ...stepShown.map((r) => r.v));
  const shown = list.filter((r) => ui.sport === 'all' || r.kind === ui.sport);
  const cur = shown.includes(ui.session) ? ui.session : shown[0];
  const zoneList = view.periods.slice(Math.max(0, view.i - TREND + 1), view.i + 1).map((p) => {
    const z = [0, 0, 0, 0, 0];
    for (const r of p.slice.ex) if (r.zones) r.zones.forEach((v, i) => { z[i] += v; });
    return { p, z, total: z.reduce((a, b) => a + b, 0) };
  });
  return [
    periodBar(view),
    heading('운동량'),
    grid('g4', ['exTime', 'exCount', 'exDays', 'danceTime', 'runTime', 'calories'].map((id) => tile(view, id))),
    heading('강도와 부하'),
    grid('g4', ['highTime', 'effect', 'anaerobic', 'load', 'loadRatio'].map((id) => tile(view, id))),
    heading('러닝과 체력'),
    grid('g4', ['runDist', 'runPace', 'runEff', 'vo2'].map((id) => tile(view, id))),
    heading('일상 활동'),
    grid('g4', ['steps', 'stepGoal', 'activeCal'].map((id) => tile(view, id))),
    grid('g2',
      panel('날짜별 운동 시간', 'exDaily', windowSub(view, null), exShown.length ? [barChart(perDay.map((rows) => [
        [(minutes(rows.filter((r) => r.kind !== 'dance')) / topDay) * 100, 'bar dim'], [(minutes(rows.filter((r) => r.kind === 'dance')) / topDay) * 100, 'bar'],
      ]), '날짜별 운동 시간', perDay.map((rows, i) => (rows.length ? `${md(days[i])}: ${hm(minutes(rows))}` : null))),
      axis(md(days[0]), md(last(days))), legend(['swatch-fg', '춤'], ['swatch-grey', '러닝·기타'])] : empty()),
      panel('날짜별 걸음', 'stepsDaily', windowSub(view, null), stepShown.length ? [barChart(days.map((d) => [[((stepBy.get(d) ?? 0) / peak) * 100, 'bar']]), '날짜별 걸음 수', days.map((d) => (stepBy.has(d) ? `${md(d)}: ${stepBy.get(d).toLocaleString('ko-KR')}걸음` : null))),
        axis(md(days[0]), md(last(days)))] : empty())),
    grid('g3', ['exTime', 'highTime', 'load'].map((id) => trendPanel(view, id))),
    grid('g2',
      trendPanel(view, 'loadRatio'),
      panel('심박 구간 변화', 'zoneTrend', sub(`최근 ${countWord(zoneList.length)}`),
        barChart(zoneList.map(({ z, total }) => (total ? [4, 3, 2, 1, 0].map((i) => [(z[i] / total) * 100, `z${i + 1}`]) : [])), '기간별 심박 구간 비율',
          zoneList.map(({ p, z, total }) => (total ? `${p.short} 구간 4·5 ${Math.round(((z[3] + z[4]) / total) * 100)}%` : null))),
        axis(zoneList[0].p.short, last(zoneList).p.short),
        legend(['z1', '구간 1'], ['z2', '구간 2'], ['z3', '구간 3'], ['z4', '구간 4'], ['z5', '구간 5']))),
    sessionTable(shown, '운동 기록',
      h('div', { class: 'filters', role: 'group', 'aria-label': '종목' }, [['all', '전체'], ['dance', '춤'], ['run', '러닝']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(ui.sport === k), on: { click: () => { ui.sport = k; draw(); } } }, t))),
      (r) => { ui.session = r; draw(); }, cur),
    cur ? sessionDetail(cur) : null,
  ];
}

const diveTile = (title, key, value, unit) => h('section', { class: 'panel' }, titled('h2', title, key), stat(value, unit));

function diveScreen(m) {
  const dives = m.sessions.filter((x) => x.kind === 'dive');
  if (!dives.length) return [empty('잠수 기록이 없습니다.')];
  const cur = dives.includes(ui.dive) ? ui.dive : dives[0];
  const depths = cur.depth.map((p) => p[1]);
  const maxDepth = cur.dive?.maxDepth ?? (depths.length ? Math.max(...depths) : null);
  const rows = cur.dive ? [
    ['산소 비율', cur.dive.oxygen == null ? '-' : `${cur.dive.oxygen}%`],
    ['평균 상승 속도', cur.dive.ascent == null ? '-' : `${num(cur.dive.ascent, 1)} m/s`],
    ['CNS 시작 → 종료', `${num(cur.dive.cns[0])}% → ${num(cur.dive.cns[1])}%`],
    ['N2 시작 → 종료', `${num(cur.dive.n2[0])}% → ${num(cur.dive.n2[1])}%`],
  ] : [];
  return [
    grid('g4',
      diveTile('최대 수심', 'diveDepth', num(maxDepth, 1), 'm'),
      diveTile('잠수 시간', 'diveTime', hm((cur.dive?.bottom ?? cur.seconds) / 60)),
      diveTile('최저 수온', 'diveTemp', num(cur.minTemp), '°C'),
      diveTile('평균 심박', 'diveHr', num(cur.avgHr), 'bpm')),
    panel('수심', 'diveChart', sub('아래로 갈수록 깊음'), depths.length ? [
      lineChart([{ v: depths.map((d) => -d) }], { cls: 'chart tall', hi: 0, label: '시간별 수심', tips: cur.depth.map((p) => `${Math.round(p[0] / 60)}분: ${p[1].toFixed(1)}m`) }), axis('0분', kor(cur.seconds))] : empty()),
    grid('g2',
      panel('잠수 기록', 'diveList', null, h('div', { class: 'tbl' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, '날짜'), h('th', null, '유형'), h('th', { class: 'r' }, '시간'))),
        h('tbody', null, dives.map((x) => h('tr', { class: x === cur ? 'pick' : null },
          h('td', null, h('button', { class: 'rowbtn', type: 'button', on: { click: () => { ui.dive = x; draw(); } } }, md(x.date))), h('td', null, x.label), h('td', { class: 'r' }, kor(x.seconds))))))),
        note('기록 확인용이며 잠수 계획에 쓰면 안 됩니다.')),
      panel('기체와 부하', 'diveGas', null, rows.length ? h('div', { class: 'tbl' }, h('table', null, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('td', null, k), h('td', { class: 'r' }, v)))))) : empty())),
  ];
}

// ---------- checkup ----------
const VERDICT_TONE = { 정상A: 'ok', 정상B: '', 양성질환: 'fix' };
const SIGNAL_TONE = { 안전: 'ok', 주의: 'fix', 위험: 'no' };
const monthsUntil = (ym) => { const [y, mo] = ym.split('-').map(Number); const now = new Date(); return (y - now.getFullYear()) * 12 + mo - (now.getMonth() + 1); };
const ymText = (ym) => { const [y, mo] = ym.split('-').map(Number); return `${y}년 ${mo}월`; };
const keyValue = (rows) => h('div', { class: 'tbl' }, h('table', { class: 'kv' }, h('tbody', null, rows.filter(Boolean).map(([k, v, key]) =>
  h('tr', null, h('td', null, h('span', { class: 'thwrap' }, k, key ? infoBtn(key, k) : null)), h('td', { class: 'r' }, v))))));

// Weekly exercise days from the watch, for the checkup goal "5 times a week".
function activityGoal(m) {
  const weeks = (tables.week ??= buildPeriods(m, 'week'));
  const done = weeks.filter((p) => !p.partial).slice(-4);
  const mean = avg(done.map((p) => p.values.exDays));
  const now = weeks.at(-1)?.partial ? weeks.at(-1).values.exDays : null;
  if (mean == null) return { text: '시계 운동 기록 없음', tone: '' };
  return { text: `최근 ${done.length}주 평균 주 ${num(mean, 1)}일${now != null ? ` · 이번 주 ${now}일` : ''}`, tone: mean >= 5 ? 'ok' : 'fix', pill: mean >= 5 ? '목표 달성' : '목표 미달' };
}

function checkupScreen(m) {
  const data = m.checkup;
  if (!data?.exams?.length) return [empty('검진 기록이 없습니다. data\\checkup\\checkup.json 을 만든 뒤 node scripts/vault.mjs checkup 을 실행하세요.')];
  const desc = (a, b) => b.date.localeCompare(a.date);
  const generals = data.exams.filter((e) => e.kind === 'general').sort(desc);
  const stomachs = data.exams.filter((e) => e.kind === 'stomach').sort(desc);
  const exam = generals.find((e) => e.id === ui.exam) ?? generals[0];
  const stomach = stomachs.find((e) => exam && e.date.slice(0, 4) === exam.date.slice(0, 4)) ?? stomachs[0];
  const out = [];
  if (generals.length > 1) {
    out.push(h('section', { class: 'periodbar' }, h('div', { class: 'filters', role: 'group', 'aria-label': '검진 연도' }, generals.map((e) =>
      h('button', { type: 'button', 'aria-pressed': String(e === exam), on: { click: () => { ui.exam = e.id; draw(); } } }, e.date.slice(0, 4)))),
    h('span', { class: 'coverage' }, `일반검진 ${generals.length}회 · 위암 검진 ${stomachs.length}회`)));
  }
  if (exam) {
    const rows = checkupRows(data, exam);
    const byId = Object.fromEntries(rows.map((r) => [r.item.id, r]));
    const warn = (exam.factors ?? []).filter((f) => f.signal && f.signal !== '안전');
    const reasons = [
      stomach ? `위암 검진(${stomach.method}) ${stomach.verdict}: ${stomach.advice}` : null,
      ...warn.map((f) => `건강신호등 ${f.signal}: ${f.name} 지금 ${f.now}, 목표 ${f.goal}`),
      ...rows.filter((r) => r.judged && r.judged[1] !== 'ok').map((r) => `${r.item.label} ${r.judged[0]}`),
      exam.notTested?.length ? `이번 대상이 아니라 하지 않은 검사 ${exam.notTested.length}종 (아래 목록)` : null,
    ].filter(Boolean);
    const verdictTone = VERDICT_TONE[exam.verdict] ?? 'fix';
    const tileOf = (id, key) => {
      const r = byId[id];
      return h('section', { class: 'panel' }, titled('h2', r.item.label, key), stat(r.value, r.item.unit),
        h('div', { class: 'tilefoot' }, r.judged ? pill(r.judged[0], r.judged[1]) : null, r.ref ? note(`참고치 ${r.ref}`) : null));
    };
    const groups = [...new Set(rows.map((r) => r.item.group))];
    const hasPrev = rows.some((r) => r.prev != null);
    const goal = activityGoal(m);
    const risk = exam.risk;
    out.push(
      judgeBand(verdictTone, exam.verdict, `${exam.date} ${exam.title}`, `${exam.summary}.`, reasons, 'checkupSummary'),
      grid('g4', tileOf('bmi', 'ck_bmi'), tileOf('bp', 'ck_bp'), tileOf('glucose', 'ck_glucose'),
        h('section', { class: 'panel' }, titled('h2', '10년 심뇌혈관 위험', 'checkupRisk'), stat(risk ? num(risk.tenYear, 1) : '-', '%'),
          h('div', { class: 'tilefoot' }, risk ? note(`같은 연령·성별 평균 ${num(risk.average, 1)}%`) : null))),
      groups.map((group) => panel(`검사 결과 · ${group}`, group === groups[0] ? 'checkupItems' : null, group === groups[0] ? sub(`${exam.date} · ${exam.place}`) : null,
        h('div', { class: 'tbl' }, h('table', { class: 'cktable' },
          h('thead', null, h('tr', null, th('항목'), th('결과', null, true), th('참고치', null, true), th('판정'), hasPrev ? th('직전 검진', null, true) : null, th('추세', 'checkupTrend'))),
          h('tbody', null, rows.filter((r) => r.item.group === group).map((r) => h('tr', null,
            h('td', null, h('span', { class: 'thwrap' }, r.item.label, infoBtn(`ck_${r.item.id}`, r.item.label))),
            h('td', { class: 'r strong' }, r.tested ? `${r.value}${r.item.unit && typeof r.value === 'string' && /\d/.test(r.value) ? ` ${r.item.unit}` : ''}` : '이번 대상 아님'),
            h('td', { class: 'r' }, r.ref ?? '-'),
            h('td', null, r.judged ? pill(r.judged[0], r.judged[1]) : r.tested ? '-' : pill('검사 없음')),
            hasPrev ? h('td', { class: 'r' }, r.prev ?? '-') : null,
            h('td', null, lineChart([{ v: r.history }], { cls: 'chart spark', label: `${r.item.label} 검진별 추세`, quiet: true }))))))))),
      grid('g2',
        panel('건강위험요인과 목표', 'checkupFactors', sub('통보서의 건강신호등'), h('div', { class: 'tbl' }, h('table', null,
          h('thead', null, h('tr', null, th('요인'), th('지금'), th('목표'), th('신호등'))),
          h('tbody', null, (exam.factors ?? []).map((f) => h('tr', null, h('td', null, f.name), h('td', null, f.now), h('td', null, f.goal),
            h('td', null, f.signal ? pill(f.signal, SIGNAL_TONE[f.signal]) : '-'))))))),
        panel('검진 목표와 시계 기록', 'checkupWatch', null, keyValue([
          ['신체활동 목표 주 5회', goal.text, null],
          ['운동 판단', goal.pill ? pill(goal.pill, goal.tone) : '-', null],
          ['체중·혈압·혈당', '시계로 재지 않음. 다음 검진에서 확인', null],
        ]), note('시계에 운동으로 기록한 날만 셉니다. 걷기만 한 날과 잠수는 빠집니다.'))),
      grid('g2',
        panel('심뇌혈관 위험', 'checkupRisk', null, risk ? keyValue([
          ['10년 안에 발생할 확률', `${num(risk.tenYear, 1)}%`],
          ['같은 연령·성별 평균', `${num(risk.average, 1)}%`],
          ['평균 대비', `${num(risk.ratio, 1)}배`],
          ['심뇌혈관 나이', `${risk.heartAge}세 (검진 때 나이 ${exam.age ?? '-'}세)`],
          ['위험요인을 고치면', `${num(risk.improvedTenYear, 1)}% · ${risk.improvedHeartAge}세`],
        ]) : empty('위험 평가가 없습니다.')),
        panel('문진과 하지 않은 검사', 'checkupSkipped', null, keyValue([
          ['과거 병력', exam.interview?.pastDisease ?? '-'],
          ['약물 치료', exam.interview?.medication ?? '-'],
          ['생활습관 권고', exam.interview?.lifestyleAdvice?.length ? exam.interview.lifestyleAdvice.join(', ') : '없음'],
        ]), exam.notTested?.length ? h('ul', { class: 'cklist' }, exam.notTested.map((t) => h('li', null, t))) : null)),
    );
  }
  const nextRows = [
    exam ? ['일반건강검진', nextExam(exam.date, exam.nextYears ?? 1)] : null,
    stomach ? ['위암 검진(위내시경)', nextExam(stomach.date, stomach.nextYears ?? 2)] : null,
  ].filter(Boolean);
  out.push(grid('g2',
    stomach ? panel('위암 검진', 'checkupStomach', pill(stomach.verdict, VERDICT_TONE[stomach.verdict] ?? 'fix'), keyValue([
      ['검사일', stomach.date],
      ['방법', stomach.method],
      ['소견', stomach.finding],
      ['권고', stomach.advice],
    ])) : null,
    panel('다음 검진', 'checkupNext', null, keyValue(nextRows.map(([k, ym]) => {
      const left = monthsUntil(ym);
      return [k, `${ymText(ym)} 무렵 (${left > 0 ? `${left}개월 남음` : left === 0 ? '이번 달' : `${-left}개월 지남`})`];
    })), note('일반검진은 매년, 위암 검진은 통보서 권고 주기로 계산했습니다.'))));
  return out;
}

// ---------- shell ----------
const SCREENS = { today: ['오늘', today], track: ['추적', trackScreen], sleep: ['수면', sleepScreen], recovery: ['회복·스트레스', recoveryScreen], activity: ['활동·운동', activityScreen], dive: ['잠수', diveScreen], checkup: ['검진', checkupScreen] };
let model = null;

function draw() {
  closeInfo(false);
  const key = SCREENS[location.hash.slice(1)] ? location.hash.slice(1) : 'today';
  const [title, screen] = SCREENS[key];
  const synced = model.synced ? new Date(model.synced) : null;
  const app = $('app');
  const y = scrollY;
  app.replaceChildren(h('div', { class: 'wrap' },
    h('header', { class: 'top' },
      h('div', null, h('div', { class: 'prompt' }, h('b', null, '>'), ' 건강관리'), h('h1', null, title)),
      h('div', { class: 'meta' }, synced ? h('span', null, `마지막 동기화 ${synced.getMonth() + 1}/${synced.getDate()} ${hhmm(synced)}`) : null,
        h('button', { class: 'btn', type: 'button', on: { click: () => location.reload() } }, '잠금'))),
    h('nav', { class: 'tabs', 'aria-label': '화면' }, Object.entries(SCREENS).map(([k, [t]]) => h('a', { href: `#${k}`, 'aria-current': k === key ? 'page' : null }, t))),
    screen(model)));
  scrollTo(0, y);
}
addEventListener('hashchange', () => { if (model) { draw(); scrollTo(0, 0); } });

$('unlock').addEventListener('submit', (e) => {
  e.preventDefault();
  const button = $('open');
  const status = $('status');
  const input = $('pw');
  button.disabled = true;
  status.className = 'note';
  status.textContent = '암호를 확인하는 중입니다.';
  const worker = new Worker('js/worker.js', { type: 'module' });
  const stop = (message) => {
    worker.terminate();
    button.disabled = false;
    status.className = 'note err';
    status.textContent = message;
  };
  worker.onerror = () => stop('페이지를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.');
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') status.textContent = `${data.step} ${data.done}/${data.total}`;
    else if (data.type === 'badPassword') { stop('암호가 맞지 않습니다.'); input.select(); }
    else if (data.type === 'failed') stop('기록을 읽지 못했습니다. 잠시 뒤 다시 시도하세요.');
    else if (data.type === 'done') {
      worker.terminate();
      model = data.model;
      tables = {};
      input.value = '';
      $('lock').hidden = true;
      $('app').hidden = false;
      document.title = '건강관리';
      draw();
    }
  };
  worker.postMessage({ password: input.value });
});
