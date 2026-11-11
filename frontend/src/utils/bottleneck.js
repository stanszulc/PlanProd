// ─── Wąskie gardła — JEDNA definicja dla całej aplikacji ─────────────────────
//
// Silnik planuje ze SKOŃCZONĄ zdolnością: praca, która nie mieści się w dobie, jest
// przesuwana na kolejne dni, więc dzienne obciążenie planu nigdy nie przekracza
// dostępności i samo „obciążenie dnia" nie pokazuje przeciążenia (zawsze ≤ 100%).
// Przeciążenie widać dopiero względem TERMINÓW: ile godzin ZP wymaga zrobić do
// danego terminu vs ile godzin brygada ma do tego terminu do dyspozycji
// (rough-cut capacity check, RCCP):
//
//   dla brygady i terminu D:   popyt(D)  = Σ godzin operacji ZP z terminem ≤ D
//                              zdolność(D) = Σ dostępności brygady od startu planu do D
//                              brakuje(D) = max(0, popyt(D) − zdolność(D))
//   brygada: shortfallH = max_D brakuje(D),  worstRatio = max_D popyt/zdolność,
//            overDates = liczba terminów z brakiem godzin
//   główne wąskie gardło (primary) = brygada z największym brakiem godzin;
//   null, gdy żadna brygada nie ma braku.
//
// Brygada = pula godzin maszyn i gniazd (patrz POOL_BRYGADY_2xxxx_3xxxx.md). Terminy
// przeterminowane (przed startem planu) liczone są od pierwszego dnia. Tolerancja
// zaokrągleń: różnice < max(0,01 h, 0,2% zdolności) to szum, nie przeciążenie.
//
// Dodatkowo (do paska dni w UI): dzienne obciążenie z segmentów planu (`days`),
// średnie (`avgUtil`) i szczytowe (`peakUtil`) wykorzystanie w oknie planu.
import { getAvail, localDateStr } from './scheduler.js';
import { U_OK, U_BN } from '../constants/theme.js';

const MAX_RATIO = 9.99;      // zdolność 0 przy popycie > 0 — wartość skończona do wyświetlania
const RATIO_TOL = 0.005;     // 0,5 p.p. ponad 100% to jeszcze nie przeciążenie
const tolH = (cap) => Math.max(0.01, 0.002 * cap);

function statusFromRatio(ratio) {
  if (ratio > U_BN) return 'KRYT';
  if (ratio > 1 + RATIO_TOL) return 'BN';
  if (ratio > U_OK) return 'UWAGA';
  return 'OK';
}

const toDate = (v) => (v instanceof Date ? v : new Date(v));

function eachDay(from, to) {
  const days = [];
  const cur = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  while (cur <= end) { days.push(localDateStr(cur)); cur.setDate(cur.getDate() + 1); }
  return days;
}

export function calcBottlenecks({ fwdZP = [], wcSchedule = {}, wcToBrygada = {}, dates, startDate } = {}) {
  const groupOf = (wc) => wcToBrygada[wc] || String(wc);

  const loadByGroup = new Map();    // group → Map(date → h)  (segmenty planu)
  const demandByGroup = new Map();  // group → Map(termin → h) (godziny operacji wg terminu ZP)
  const wcsInPlan = new Set();
  const segDates = new Set();
  const dueDates = new Set();
  const bump = (map, g, key, h) => {
    if (!map.has(g)) map.set(g, new Map());
    const m = map.get(g);
    m.set(key, (m.get(key) || 0) + h);
  };

  for (const op of fwdZP) {
    const wc = String(op.workcenter);
    const g = groupOf(wc);
    wcsInPlan.add(wc);
    if (op.due_date && Number.isFinite(Number(op.durH)) && Number(op.durH) > 0) {
      bump(demandByGroup, g, op.due_date, Number(op.durH));
      dueDates.add(op.due_date);
    }
    for (const sg of (op.segments || [])) {
      if (!sg.segStart) continue;
      const d = localDateStr(toDate(sg.segStart));
      bump(loadByGroup, g, d, sg.durH || 0);
      segDates.add(d);
    }
  }
  const groupNames = new Set([...loadByGroup.keys(), ...demandByGroup.keys()]);
  if (!groupNames.size) return { groups: [], primary: null, dates: [], startDate: null };

  const sortedSeg = [...segDates].sort();
  const start = startDate || sortedSeg[0] || [...dueDates].sort()[0];

  // okno dni planu (do paska dni): podane albo od pierwszego do ostatniego dnia z planem
  const planDays = dates || (sortedSeg.length ? eachDay(sortedSeg[0], sortedSeg[sortedSeg.length - 1]) : []);

  // członkowie grupy: gniazda z planu + gniazda z grafiku przypisane do brygady (pula)
  const membersOf = new Map();
  const addMember = (g, wc) => {
    if (!membersOf.has(g)) membersOf.set(g, new Set());
    membersOf.get(g).add(wc);
  };
  wcsInPlan.forEach(wc => addMember(groupOf(wc), wc));
  Object.keys(wcSchedule).forEach(wc => { if (wcToBrygada[wc]) addMember(wcToBrygada[wc], String(wc)); });
  Object.entries(wcToBrygada).forEach(([wc, g]) => { if (groupNames.has(g)) addMember(g, String(wc)); });

  const capOnDay = (members, date) =>
    members.reduce((sum, wc) => sum + getAvail(wc, date + 'T12:00:00', wcSchedule), 0);

  const groups = [];
  for (const name of groupNames) {
    const members = [...membersOf.get(name)].sort();

    // ── dzienne obciążenie z planu (pasek dni) ──
    const loads = loadByGroup.get(name) || new Map();
    const perDay = planDays.map(date => {
      const load = loads.get(date) || 0;
      const cap = capOnDay(members, date);
      const over = load - cap > tolH(cap);
      const raw = cap > 0 ? load / cap : (load > 0.01 ? Infinity : 0);
      const util = over ? raw : Math.min(raw, 1);
      return { date, load, cap, util, excess: over ? load - cap : 0 };
    });
    const totalLoad = perDay.reduce((s, d) => s + d.load, 0);
    const usable = perDay.filter(d => d.cap > 0);
    const capSum = usable.reduce((s, d) => s + d.cap, 0);
    const avgUtil = capSum > 0 ? usable.reduce((s, d) => s + d.load, 0) / capSum : 0;
    const peak = perDay.length ? perDay.reduce((best, d) => (d.util > best.util ? d : best), perDay[0]) : null;
    const finiteUtils = perDay.filter(d => Number.isFinite(d.util)).map(d => d.util);
    const peakUtil = !peak ? 0 : (Number.isFinite(peak.util) ? peak.util : Math.max(0, ...finiteUtils));

    // ── obciążenie narastające do terminów (RCCP) ──
    const demand = demandByGroup.get(name) || new Map();
    const clamp = (d) => (d < start ? start : d);
    const demandByDue = new Map();
    for (const [d, h] of demand) {
      const k = clamp(d);
      demandByDue.set(k, (demandByDue.get(k) || 0) + h);
    }
    const dues = [...demandByDue.keys()].sort();
    const points = [];
    let shortfallH = 0, worstRatio = 0, worstDate = null, overDates = 0;
    let demandTotal = 0, capTotal = 0;
    if (dues.length) {
      const days = eachDay(start, dues[dues.length - 1]);
      const capByDay = new Map(days.map(d => [d, capOnDay(members, d)]));
      let cumCap = 0, cumDemand = 0, di = 0;
      for (const d of days) {
        cumCap += capByDay.get(d);
        if (di < dues.length && dues[di] === d) {
          cumDemand += demandByDue.get(d);
          di++;
          const short = cumDemand - cumCap > tolH(cumCap) ? cumDemand - cumCap : 0;
          const ratio = cumCap > 0.01 ? Math.min(cumDemand / cumCap, MAX_RATIO) : (cumDemand > 0.01 ? MAX_RATIO : 0);
          points.push({ date: d, demand: cumDemand, cap: cumCap, ratio, shortfall: short });
          if (short > 0) overDates++;
          if (short > shortfallH) shortfallH = short;
          if (ratio > worstRatio) { worstRatio = ratio; worstDate = d; }
        }
      }
      demandTotal = cumDemand;
      capTotal = cumCap;
    }

    // status: wg obciążenia do terminów; bez terminów (brak danych) – wg szczytu z planu
    const status = dues.length ? statusFromRatio(worstRatio) : statusFromRatio(peakUtil);

    groups.push({
      name, members, days: perDay,
      totalLoad, totalCap: capSum, avgUtil,
      peakUtil, peakDate: peak ? peak.date : null,
      due: { points, demandH: demandTotal, capH: capTotal, worstRatio, worstDate, shortfallH, overDates },
      // aliasy zachowujące sens dla istniejących konsumentów (UI): brakujące godziny
      // do terminów i liczba przeciążonych terminów
      excessH: shortfallH, overloadDays: overDates,
      status,
    });
  }

  groups.sort((a, b) =>
    (b.due.shortfallH - a.due.shortfallH) || (b.due.worstRatio - a.due.worstRatio) || (b.totalLoad - a.totalLoad));
  const primary = groups.length && groups[0].due.shortfallH > 0 ? groups[0] : null;
  return { groups, primary, dates: planDays, startDate: start };
}
