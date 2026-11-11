// ─── Wąskie gardła — JEDNA definicja dla całej aplikacji ─────────────────────
//
// Wąskie gardło = brygada (pula godzin, patrz POOL_BRYGADY_2xxxx_3xxxx.md), której
// zaplanowane obciążenie przekracza dostępność w którymś dniu planu. Liczone z
// RZECZYWISTYCH segmentów planu (fwdZP z workera), nie z teoretycznego popytu wg
// terminów, i per brygada (suma godzin maszyn + gniazd), nie per gniazdo — inaczej
// brygada z zapasem wygląda jak przeciążone gniazdo obok pustego sąsiada.
//
//   dzień:  util = load / cap,   nadwyżka = max(0, load − cap)
//   brygada: excessH = Σ nadwyżek,  overloadDays = dni z nadwyżką,
//            peakUtil = max dzienny util,  avgUtil = Σ load / Σ cap (dni z cap > 0)
//   główne wąskie gardło (primary) = brygada z największą nadwyżką godzin;
//   null, gdy żadna brygada nie jest przeciążona.
//
// Status (OK / UWAGA / BN / KRYT) liczony wg wspólnych progów z theme.js.
import { getAvail, localDateStr } from './scheduler.js';
import { U_OK, U_WARN, U_BN } from '../constants/theme.js';

const EPS = 1e-6;

function statusFor(peakUtil, overloaded) {
  if (peakUtil > U_BN) return 'KRYT';
  if (overloaded || peakUtil > U_WARN) return 'BN';
  if (peakUtil > U_OK) return 'UWAGA';
  return 'OK';
}

function toDate(v) {
  return v instanceof Date ? v : new Date(v);
}

export function calcBottlenecks({ fwdZP = [], wcSchedule = {}, wcToBrygada = {}, dates } = {}) {
  const groupOf = (wc) => wcToBrygada[wc] || String(wc);

  // load per grupa per dzień (wg lokalnej daty początku segmentu — jak heatmapy)
  const loadByGroup = new Map();   // group → Map(date → h)
  const wcsInPlan = new Set();
  const allDates = new Set();
  for (const op of fwdZP) {
    const wc = String(op.workcenter);
    wcsInPlan.add(wc);
    for (const sg of (op.segments || [])) {
      if (!sg.segStart) continue;
      const d = localDateStr(toDate(sg.segStart));
      const g = groupOf(wc);
      if (!loadByGroup.has(g)) loadByGroup.set(g, new Map());
      const m = loadByGroup.get(g);
      m.set(d, (m.get(d) || 0) + (sg.durH || 0));
      allDates.add(d);
    }
  }
  if (!loadByGroup.size) return { groups: [], primary: null, dates: [] };

  // okno dni: podane albo od pierwszego do ostatniego dnia z planem (bez dziur)
  let days = dates;
  if (!days) {
    const sorted = [...allDates].sort();
    days = [];
    const cur = new Date(sorted[0] + 'T12:00:00');
    const end = new Date(sorted[sorted.length - 1] + 'T12:00:00');
    while (cur <= end) { days.push(localDateStr(cur)); cur.setDate(cur.getDate() + 1); }
  }

  // członkowie grupy: gniazda z planu + gniazda z grafiku przypisane do brygady (pula)
  const membersOf = new Map();
  const addMember = (g, wc) => {
    if (!membersOf.has(g)) membersOf.set(g, new Set());
    membersOf.get(g).add(wc);
  };
  wcsInPlan.forEach(wc => addMember(groupOf(wc), wc));
  Object.keys(wcSchedule).forEach(wc => { if (wcToBrygada[wc]) addMember(wcToBrygada[wc], String(wc)); });
  Object.entries(wcToBrygada).forEach(([wc, g]) => { if (loadByGroup.has(g)) addMember(g, String(wc)); });

  const groups = [];
  for (const [name, loads] of loadByGroup) {
    const members = [...membersOf.get(name)].sort();
    const perDay = days.map(date => {
      const load = loads.get(date) || 0;
      const cap = members.reduce((sum, wc) => sum + getAvail(wc, date + 'T12:00:00', wcSchedule), 0);
      const util = cap > 0 ? load / cap : (load > EPS ? Infinity : 0);
      return { date, load, cap, util, excess: Math.max(0, load - cap) };
    });

    const totalLoad = perDay.reduce((s, d) => s + d.load, 0);
    const usable = perDay.filter(d => d.cap > 0);
    const capSum = usable.reduce((s, d) => s + d.cap, 0);
    const loadOnUsable = usable.reduce((s, d) => s + d.load, 0);
    const avgUtil = capSum > 0 ? loadOnUsable / capSum : 0;
    const excessH = perDay.reduce((s, d) => s + d.excess, 0);
    const overloadDays = perDay.filter(d => d.excess > EPS).length;
    const peak = perDay.reduce((best, d) => (d.util > best.util ? d : best), perDay[0]);
    // peakUtil: dla dnia o cap=0 z pracą (Infinity) pokazujemy wartość skończoną na
    // potrzeby UI/średnich; flagę przeciążenia niesie excess/overloadDays.
    const peakUtil = Number.isFinite(peak.util) ? peak.util : Math.max(
      0, ...perDay.filter(d => Number.isFinite(d.util)).map(d => d.util)
    );

    groups.push({
      name, members, days: perDay,
      totalLoad, totalCap: capSum, avgUtil,
      peakUtil, peakDate: peak.date,
      overloadDays, excessH,
      status: statusFor(peakUtil, excessH > EPS),
    });
  }

  groups.sort((a, b) =>
    (b.excessH - a.excessH) || (b.peakUtil - a.peakUtil) || (b.totalLoad - a.totalLoad));
  const primary = groups.length && groups[0].excessH > EPS ? groups[0] : null;
  return { groups, primary, dates: days };
}
