// National health checkup items. Reference values follow the checkup result form.
// Personal results are not in this file; they come from the encrypted vault.
const within = (lo, hi) => (v) => (v >= lo && v <= hi ? ['정상', 'ok'] : ['참고치 밖', 'fix']);
const below = (limit, word = '참고치 밖') => (v) => (v < limit ? ['정상', 'ok'] : [word, 'fix']);
const upTo = (limit, word = '참고치 밖') => (v) => (v <= limit ? ['정상', 'ok'] : [word, 'fix']);
const atLeast = (limit, word = '참고치 밖') => (v) => (v >= limit ? ['정상', 'ok'] : [word, 'fix']);
const word = (v) => (v === '정상' ? ['정상', 'ok'] : [v, 'fix']);

// ref and judge take the sex ('M' or 'F'). judge returns [text, tone].
export const CHECKUP_ITEMS = [
  { id: 'height', group: '계측', label: '키', unit: 'cm', d: 1 },
  { id: 'weight', group: '계측', label: '몸무게', unit: 'kg', d: 1, better: 'down' },
  { id: 'bmi', group: '계측', label: '체질량지수', unit: 'kg/㎡', d: 1, better: 'down', ref: () => '18.5 ~ 24.9',
    judge: () => (v) => (v < 18.5 ? ['저체중', 'fix'] : v < 25 ? ['정상', 'ok'] : v < 30 ? ['과체중', 'fix'] : ['비만', 'no']) },
  { id: 'waist', group: '계측', label: '허리둘레', unit: 'cm', d: 1, better: 'down', ref: (sex) => (sex === 'F' ? '85 미만' : '90 미만'),
    judge: (sex) => below(sex === 'F' ? 85 : 90, '복부비만') },
  { id: 'bp', group: '계측', label: '혈압', unit: 'mmHg', better: 'down', ref: () => '120/80 미만', pair: ['sbp', 'dbp'],
    judge: () => ([s, d]) => (s >= 140 || d >= 90 ? ['고혈압 의심', 'no'] : s >= 120 || d >= 80 ? ['고혈압 전단계', 'fix'] : ['정상', 'ok']) },
  { id: 'vision', group: '계측', label: '시력 (좌/우)', d: 1, pair: ['visionL', 'visionR'] },
  { id: 'hearing', group: '계측', label: '청력 (좌/우)', ref: () => '40dB 미만', pair: ['hearingL', 'hearingR'],
    judge: () => ([l, r]) => (l === '정상' && r === '정상' ? ['정상', 'ok'] : ['질환 의심', 'fix']) },
  { id: 'hb', group: '혈액', label: '혈색소', unit: 'g/dL', d: 1, ref: (sex) => (sex === 'F' ? '12 ~ 15.5' : '13 ~ 16.5'),
    judge: (sex) => (v) => (v < (sex === 'F' ? 12 : 13) ? ['빈혈 의심', 'fix'] : within(0, sex === 'F' ? 15.5 : 16.5)(v)) },
  { id: 'glucose', group: '혈액', label: '공복혈당', unit: 'mg/dL', better: 'down', ref: () => '100 미만',
    judge: () => (v) => (v >= 126 ? ['당뇨병 의심', 'no'] : v >= 100 ? ['공복혈당장애 의심', 'fix'] : ['정상', 'ok']) },
  { id: 'tc', group: '혈액', label: '총콜레스테롤', unit: 'mg/dL', better: 'down', ref: () => '200 미만', judge: () => below(200) },
  { id: 'hdl', group: '혈액', label: 'HDL 콜레스테롤', unit: 'mg/dL', better: 'up', ref: () => '60 이상', judge: () => atLeast(60) },
  { id: 'tg', group: '혈액', label: '중성지방', unit: 'mg/dL', better: 'down', ref: () => '150 미만', judge: () => below(150) },
  { id: 'ldl', group: '혈액', label: 'LDL 콜레스테롤', unit: 'mg/dL', better: 'down', ref: () => '130 미만', judge: () => below(130) },
  { id: 'creatinine', group: '혈액', label: '혈청 크레아티닌', unit: 'mg/dL', d: 2, ref: () => '1.5 이하', judge: () => upTo(1.5, '신장기능 이상 의심') },
  { id: 'egfr', group: '혈액', label: '신사구체여과율', unit: 'mL/min/1.73㎡', better: 'up', ref: () => '60 이상', judge: () => atLeast(60, '신장기능 이상 의심') },
  { id: 'ast', group: '혈액', label: 'AST', unit: 'IU/L', better: 'down', ref: () => '40 이하', judge: () => upTo(40, '간기능 이상 의심') },
  { id: 'alt', group: '혈액', label: 'ALT', unit: 'IU/L', better: 'down', ref: () => '35 이하', judge: () => upTo(35, '간기능 이상 의심') },
  { id: 'ggt', group: '혈액', label: '감마지티피', unit: 'IU/L', better: 'down', ref: (sex) => (sex === 'F' ? '35 이하' : '63 이하'),
    judge: (sex) => upTo(sex === 'F' ? 35 : 63, '간기능 이상 의심') },
  { id: 'urineProtein', group: '소변·영상', label: '요단백', ref: () => '정상', judge: () => word },
  { id: 'chestXray', group: '소변·영상', label: '흉부 X선' },
];

const valueOf = (item, values) => (item.pair ? item.pair.map((k) => values?.[k] ?? null) : values?.[item.id] ?? null);
const missing = (v) => v == null || (Array.isArray(v) && v.some((x) => x == null));
const show = (item, v) => {
  if (missing(v)) return '-';
  const one = (x) => (typeof x === 'number' ? x.toFixed(item.d ?? 0) : x);
  return Array.isArray(v) ? v.map(one).join(' / ') : one(v);
};

// One row per item: this exam's value, its judgement, and the same item at the previous exam.
export function checkupRows(data, exam) {
  const general = data.exams.filter((e) => e.kind === 'general').sort((a, b) => a.date.localeCompare(b.date));
  const before = general.filter((e) => e.date < exam.date).at(-1) ?? null;
  return CHECKUP_ITEMS.map((item) => {
    const v = valueOf(item, exam.values);
    const prev = before ? valueOf(item, before.values) : null;
    const judged = !missing(v) && item.judge ? item.judge(data.sex)(v) : null;
    const numeric = !item.pair && typeof v === 'number' && typeof prev === 'number';
    return {
      item, value: show(item, v), tested: !missing(v), judged, ref: item.ref ? item.ref(data.sex) : null,
      prev: before ? show(item, prev) : null, diff: numeric ? v - prev : null,
      history: general.map((e) => { const x = valueOf(item, e.values); return typeof x === 'number' ? x : Array.isArray(x) && typeof x[0] === 'number' ? x[0] : null; }),
      historyDates: general.map((e) => e.date),
    };
  });
}

// The next exam date from the given exam and a number of years.
export const nextExam = (date, years) => { const [y, m] = date.split('-').map(Number); return `${y + years}-${String(m).padStart(2, '0')}`; };
