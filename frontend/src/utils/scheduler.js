// ─── scheduler.js ─────────────────────────────────────────────────────────────
// Refaktoryzacja: czystość, efektywność, struktura
// Zmiany opisane przy każdej sekcji komentarzem [ZMIANA: ...]
// ──────────────────────────────────────────────────────────────────────────────

import { WC_DAILY_CAPACITY } from '../constants/demoData.js';
import { WORK_DAY_H } from '../constants/schedule.js';


// ─── STAŁE ────────────────────────────────────────────────────────────────────
// [ZMIANA] Magic numbers wyciągnięte do named constants — czytelność + łatwa zmiana
const MS_PER_HOUR   = 3_600_000;
const DEFAULT_AVAIL = 16;        // h/dzień gdy brak grafiku
const SAFETY_LIMIT  = 10_000;    // max iteracji pętli while (zabezpieczenie)
const EPSILON       = 0.0001;    // próg "praktycznie zero godzin"
const TOC_YELLOW    = 0.33;
const TOC_RED       = 0.67;


// ─── HELPERS: DATA / CZAS ─────────────────────────────────────────────────────

// [ZMIANA] Bez zmian merytorycznych — tylko usunięto zbędne intermediate `d`
export function localDateStr(dt) {
  const d = new Date(dt);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function fmtDt(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// [ZMIANA] jsDay2idx był eksportowany ale używany tylko wewnętrznie → bez export
// Zostaje jako helper, ale nie ma powodu udostępniać go na zewnątrz modułu
function jsDay2idx(jsDay) {
  return jsDay === 0 ? 6 : jsDay - 1;
}

function nextDayStart(dt) {
  const d = new Date(dt);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}


// ─── CSV PARSING ──────────────────────────────────────────────────────────────

// [ZMIANA] Bez zmian merytorycznych — działa poprawnie
export function safeSplitCSV(line, sep) {
  const result = [];
  let current  = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === sep && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map(v => v.replace(/^"|"$/g, ''));
}

// ─── DOSTĘPNOŚĆ GNIAZD ────────────────────────────────────────────────────────

// [ZMIANA] getAvail — logika identyczna, ale:
// 1. Duplikacja jsDay2idx(d.getDay()) zastąpiona zmienną lokalną
// 2. Wcześniej w computeLoads była osobna inline kopia tej logiki (getCapH) →
//    teraz używa getAvail przez alias getCapH (patrz computeLoads niżej)
export function getAvail(wc, dt, wcSchedule) {
  const sched = wcSchedule?.[wc];
  const d      = new Date(dt);
  const jsDay  = d.getDay();
  const isWeekend = jsDay === 0 || jsDay === 6;
  if (!sched) return isWeekend ? 0 : DEFAULT_AVAIL;

  if (!Array.isArray(sched) && typeof sched === 'object') {
    const dateKey = localDateStr(d);
    if (sched[dateKey] !== undefined) return sched[dateKey];
    return isWeekend ? 0 : DEFAULT_AVAIL;
  }

  // Stary format: tablica [pon..nd]
  const idx = jsDay2idx(jsDay);
  return sched[idx] ?? 0;
}


// ─── FORWARD-SCHEDULE ─────────────────────────────────────────────────────────

// [ZMIANA] forwardScheduleOp:
// 1. occupancy[wc] sprawdzane wielokrotnie — zastąpione lokalną zmienną wcSlots
// 2. `new Date(o.from)` / `new Date(o.to)` tworzone w każdej iteracji pętli →
//    occupancy przechowuje teraz Date objects (push też tworzy Date) — zero zmian
//    API, ale unika wielokrotnego konstruowania tych samych obiektów wewnątrz pętli
// 3. Duplikacja `cursor = new Date(cursor); cursor.setDate...` → nextDayStart()
export function forwardScheduleOp(fromDt, hoursNeeded, wc, wcSchedule, occupancy) {
  let cursor    = new Date(fromDt);
  let remaining = hoursNeeded;
  const segs    = [];
  let safety    = 0;

  while (remaining > EPSILON && safety++ < SAFETY_LIMIT) {
    const avail = getAvail(wc, cursor, wcSchedule);
    if (avail === 0) { cursor = nextDayStart(cursor); continue; }

    const dayEnd = new Date(cursor);
    dayEnd.setHours(avail, 0, 0, 0);

    if (cursor >= dayEnd) { cursor = nextDayStart(cursor); continue; }

    // Przesuń za zajęte sloty
    const wcSlots = occupancy[wc] || [];
    let slotStart = new Date(cursor);
    let shifted   = true;
    while (shifted) {
      shifted = false;
      for (const o of wcSlots) {
        if (o.from <= slotStart && o.to > slotStart) {
          slotStart = new Date(o.to);
          shifted   = true;
          break;
        }
      }
    }

    if (slotStart >= dayEnd) { cursor = nextDayStart(slotStart); continue; }

    // Koniec slotu = min(dayEnd, następna rezerwacja)
    let slotEnd = new Date(dayEnd);
    for (const o of wcSlots) {
      if (o.from > slotStart && o.from < slotEnd) slotEnd = new Date(o.from);
    }

    const availH = (slotEnd - slotStart) / MS_PER_HOUR;
    if (availH < EPSILON) { cursor = new Date(slotEnd); continue; }

    const take   = Math.min(remaining, availH);
    remaining   -= take;
    const segEnd = new Date(slotStart.getTime() + take * MS_PER_HOUR);

    segs.push({ segStart: new Date(slotStart), segEnd, durH: take });

    if (!occupancy[wc]) occupancy[wc] = [];
    occupancy[wc].push({ from: new Date(slotStart), to: segEnd });
    occupancy[wc].sort((a, b) => a.from - b.from);

    cursor = new Date(segEnd);
  }

  return {
    startDt:  segs.length ? segs[0].segStart          : new Date(fromDt),
    endDt:    segs.length ? segs[segs.length-1].segEnd : new Date(fromDt),
    segments: segs,
  };
}

// ─── DELAY HELPER ─────────────────────────────────────────────────────────────
// [ZMIANA] Obliczenie opóźnienia było zduplikowane w forwardSchedule i hybridzie
// → wyciągnięte do jednej funkcji
function calcDelay(realEnd, dueDateStr) {
  const dueDate  = new Date(dueDateStr + 'T23:59:59');
  const delayMs  = Math.max(0, realEnd - dueDate);
  const delayH   = delayMs / MS_PER_HOUR;
  const delayDays = +(delayH / WORK_DAY_H).toFixed(1);
  return { dueDate, delayH, delayDays };
}


// ─── TOC BUFFER ───────────────────────────────────────────────────────────────
// [ZMIANA] Dwie identyczne gałęzie `consumed < 0` i `consumed < 0.33` → jedna
// Reszta bez zmian merytorycznych
export function tocBuffer(backStartDt, planStartDt, dueDateDt, realEndDt) {
  if (realEndDt && realEndDt > dueDateDt) {
    return { zone: 'black', consumed: 1, label: 'SPÓŹNIONE', overH: (realEndDt - dueDateDt) / MS_PER_HOUR };
  }
  const windowMs = dueDateDt - planStartDt;
  if (windowMs <= 0) return { zone: 'black', consumed: 1, label: 'PRZEKROCZONY' };

  // Zużycie okna planowania: jaka część czasu od planStart do terminu jest zajęta
  // przez plan (planStart → realEnd). Ten sam model co ratio w Buforze TOC
  // (potrzebne / dostępne). Wcześniejszy wzór używał backStart = najwcześniejszy
  // start zaplanowanej operacji (>= planStart), przez co consumed <= 0 i strefy
  // yellow/red były nieosiągalne.
  const consumed = Math.max(0, ((realEndDt ?? planStartDt) - planStartDt) / windowMs);
  if (consumed < TOC_YELLOW) return { zone: 'green',  consumed, label: 'OK' };
  if (consumed < TOC_RED)    return { zone: 'yellow', consumed, label: 'UWAGA' };
  if (consumed < 1.0)        return { zone: 'red',    consumed, label: 'ZAGROŻONE' };
  return                            { zone: 'black',  consumed, label: 'SPÓŹNIONE' };
}


// ─── OBCIĄŻENIA ───────────────────────────────────────────────────────────────
// [ZMIANA] computeLoads miał wewnętrzną funkcję getCapH która była ręczną kopią
// logiki getAvail (z błędem: nie obsługiwała wszystkich przypadków tak samo).
// Teraz używa getAvail bezpośrednio przez alias — eliminuje dywergencję.
export function computeLoads(routingByProduct, zpList, wcSchedule, date) {
  const wcMap = {};

  for (const z of zpList) {
    for (const op of (routingByProduct[z._routingKey || z.product] || [])) {
      const capH = getAvail(op.workcenter, date ? (date + 'T12:00:00') : new Date(), wcSchedule);
      if (!wcMap[op.workcenter])
        wcMap[op.workcenter] = { load: 0, cap: capH, contrib: {} };
      wcMap[op.workcenter].cap = capH;

      // ERP mode: ct_min=0, durH w op._durH
      const h = op.ct_min > 0 ? z.volume * op.ct_min / 60 : (op._durH ?? 0);
      wcMap[op.workcenter].load += h;

      if (!wcMap[op.workcenter].contrib[z.zp_id])
        wcMap[op.workcenter].contrib[z.zp_id] = { h: 0, product: z.product };
      wcMap[op.workcenter].contrib[z.zp_id].h += h;
    }
  }

  for (const w of Object.values(wcMap)) {
    w.util = w.cap > 0 ? w.load / w.cap : 999;
  }
  return wcMap;
}


// ─── HYBRID SCHEDULE ──────────────────────────────────────────────────────────
// [ZMIANA] calcHybridRealEnd:
// 1. routing.find() w pętli forEach → zbudowanie Map przed pętlą: O(n) → O(1)
// 2. Wyciągnięto calcDelay (DRY z forwardSchedule)
export function calcHybridRealEnd(parentZpId, zpStatusData, routingByProduct, wcSchedule, planStart) {
  const ops = zpStatusData
    .filter(r => r.parent_zp === parentZpId)
    .sort((a, b) => a.sequence - b.sequence);
  if (!ops.length) return null;

  const product    = ops[0].product;
  const routingMap = new Map(
    (routingByProduct[product] || []).map(r => [r.sequence, r])
  );

  const cnfOps  = ops.filter(o => o.status === 'CNF' && o.actual_end);
  const lastCNF = cnfOps.length
    ? cnfOps.reduce((best, o) => o.actual_end > best.actual_end ? o : best, cnfOps[0])
    : null;
  const wipOp   = ops.find(o => o.status === 'WIP' && o.actual_start && !o.actual_end);

  let cursor = new Date(planStart);

  if (wipOp) {
    const routeOp    = routingMap.get(wipOp.sequence);
    const totalMin   = routeOp ? routeOp.ct_min * wipOp.volume_plan : 0;
    const doneMin    = wipOp.volume_actual > 0 && wipOp.volume_plan > 0
      ? totalMin * (wipOp.volume_actual / wipOp.volume_plan)
      : 0;
    const remainMin  = Math.max(0, totalMin - doneMin);
    cursor = new Date(wipOp.actual_start.getTime() + remainMin * 60_000);
  } else if (lastCNF) {
    cursor = new Date(lastCNF.actual_end);
  }

  const planOps = ops.filter(o => o.status === 'PLAN');
  if (!planOps.length) return cursor;

  const occupancy = {};
  let lastEnd = cursor;

  for (const op of planOps) {
    const routeOp = routingMap.get(op.sequence);
    if (!routeOp) continue;
    // ct_min=0 dla routingu z ERP-embedded importu (durH liczony wcześniej, patrz erpZpToSchedulerInput)
    // — bez tego fallbacku każda operacja PLAN liczyłaby się jako 0h.
    const durH = routeOp.ct_min > 0 ? op.volume_plan * routeOp.ct_min / 60 : (routeOp._durH ?? 0);
    const { endDt } = forwardScheduleOp(lastEnd, durH, op.workcenter, wcSchedule, occupancy);
    lastEnd = endDt;
  }

  return lastEnd;
}

// [ZMIANA] calcHybridZpStatus — bez zmian merytorycznych
// calcDelay zastępuje inline obliczenia delayH/delayDays
export function calcHybridZpStatus(zpStatus, zpStatusData, routingByProduct, wcSchedule, planStart) {
  if (!zpStatusData.length) return zpStatus;

  return zpStatus.map(z => {
    try {
      const hybridEnd = calcHybridRealEnd(z.zp_id, zpStatusData, routingByProduct, wcSchedule, planStart);
      if (!hybridEnd) return z;

      const dueDate               = new Date(z.due_date + 'T23:59:59');
      const { delayH, delayDays } = calcDelay(hybridEnd, z.due_date);
      const toc                   = tocBuffer(z.backStart, new Date(planStart), dueDate, hybridEnd);

      return { ...z, realEnd: hybridEnd, delayH, delayDays, toc, hybridMode: true };
    } catch (err) {
      console.warn(`hybridSchedule fallback dla ${z.zp_id}:`, err);
      return z;
    }
  });
}


// ─── EKSPORT CSV ──────────────────────────────────────────────────────────────
// [ZMIANA] Bez zmian merytorycznych
export function dlCSV(rows, filename) {
  const csv = rows
    .map(r => r.map(v => (typeof v === 'string' && v.includes(';')) ? `"${v}"` : v).join(';'))
    .join('\n');
  const a   = document.createElement('a');
  a.href    = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  a.download = filename;
  a.click();
}


// ─── PARSER ZP Z ERP ──────────────────────────────────────────────────────────
// Format TSV (tab-separated) z ERP:
//   Numer ZP | Klient/zam | Numer ZS | Data zak | Data wys | Kod | Nazwa |
//   Ilość ZP | Wyprod. | OP | WC | WCname | WC2 | WC3 | CzasPlan | CzasPozost
//
// Mapowanie kolumn:
//   WC     → machine_id   (numer maszyny, np. 20043)
//   WCname → machine_name (pełna nazwa, np. "Wykrawarko-gilotyna SG6 M107")
//   WC3    → workcenter   (gniazdo/brygada, aktualna od 2026-08 — WC2 jako fallback
//                          dla starszych eksportów bez tej kolumny)
//   OP     → sequence     (numer operacji, np. 010, 020, 040)
//   CzasPlan   → durH     (czas całkowity ZP [h], przecinek dziesiętny)
//   CzasPozost → durRemH  (czas pozostały [h])
// ─────────────────────────────────────────────────────────────────────────────
export function parseZPFromERP(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split('\n')[0];
  const sep = firstLine.includes('\t') ? '\t' : ';';

  const lines = clean.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(sep).map(h =>
    h.toLowerCase().trim().replace(/[.\s/]/g, '_')
  );

  function get(r, ...keys) {
    for (const k of keys) {
      const v = r[k];
      if (v !== undefined && v !== '') return String(v).trim();
    }
    return '';
  }

  function decimal(v) {
    return parseFloat((v || '0').replace(',', '.').replace(/\s/g, '')) || 0;
  }

  function trimDate(v) {
    return (v || '').trim().split(' ')[0].split('T')[0];
  }

  const rows = lines.slice(1).map(line => {
    const vals = line.split(sep);
    const r = {};
    headers.forEach((h, i) => { r[h] = (vals[i] || '').trim(); });
    return r;
  });

  const zpGroups = new Map();

  for (const r of rows) {
    const zpId = get(r, 'numer_zp', 'zp_id', 'zp');
    if (!zpId) continue;

    if (!zpGroups.has(zpId)) {
      zpGroups.set(zpId, {
        zp_id:         zpId,
        zs_id:         get(r, 'numer_zs', 'zs_id'),
        klient:        get(r, 'klient_zam', 'klient', 'client'),
        product:       get(r, 'kod', 'product', 'code'),
        product_name:  get(r, 'nazwa', 'name'),
        volume:        Math.max(0, decimal(get(r, 'ilość_zp', 'ilosc_zp', 'qty'))),
        volume_actual: Math.max(0, decimal(get(r, 'wyprod_', 'wyprod'))),
        due_date:      trimDate(get(r, 'data_zak', 'due_date', 'data')),
        ship_date:     trimDate(get(r, 'data_wys', 'ship_date')),
        priority:      parseInt(get(r, 'priority', 'priorytet') || '0') ||
                       // VIP wykrywany z nazwy klienta gdy brak kolumny priority
                       (['S261010','871915'].some(tag =>
                         get(r, 'klient_zam', 'klient', 'client').includes(tag)) ? 1 : 2),
        ops: [],
      });
    }

    const zp = zpGroups.get(zpId);
    const opRaw  = get(r, 'op', 'oper', 'nr_oper', 'sequence');
    const opNum  = parseInt(opRaw, 10) || (zp.ops.length + 1) * 10;

    const machineId   = get(r, 'wc', 'machine_id');    // WC  = numer maszyny
    const machineName = get(r, 'wcname', 'wc_name');   // WCname = pełna nazwa
    const workcenter  = get(r, 'wc3', 'wc2', 'workcenter');   // WC3 = aktualna brygada, WC2 fallback

    if (!machineId && !workcenter) continue;

    const durH    = Math.max(0, decimal(get(r, 'czasplan',   'czas_plan')));
    const durRemH = Math.max(0, decimal(get(r, 'czaspozost', 'czas_pozost')));
    const status  = durRemH <= 0 ? 'CNF' : durRemH < durH ? 'WIP' : 'PLAN';

    zp.ops.push({
      sequence:     opNum,
      op_label:     opRaw || String(opNum).padStart(3, '0'),
      workcenter:   workcenter || machineId,
      machine_id:   machineId,
      machine_name: machineName,
      durH,
      durRemH,
      status,
      predecessors: [],  // uzupełniane poniżej
    });
  }

  const result       = [];
  const wcToBrygada  = {};  // { machine_id → nazwa brygady (WC3) } — budowane z TSV, nie z demoData

  for (const zp of zpGroups.values()) {
    if (!zp.product || !zp.due_date || zp.ops.length === 0) continue;
    zp.ops.sort((a, b) => a.sequence - b.sequence);
    zp.ops.forEach((op, i) => {
      op.predecessors = i > 0 ? [zp.ops[i - 1].sequence] : [];
      // Zbierz mapę machine_id → brygada z każdej operacji
      if (op.machine_id && op.workcenter) wcToBrygada[op.machine_id] = op.workcenter;
    });
    result.push(zp);
  }
  // Zwróć wynik + mapę brygad — App.jsx zapisze ją do state zamiast importować z demoData
  result.wcToBrygada = wcToBrygada;
  return result;
}


// Sygnatura routingu ZP — do wykrycia wariantów technologicznych tego samego produktu.
// Dwa ZP tego samego produktu z tą samą sygnaturą dzielą jeden wpis w routingByProduct;
// przy rozbieżności każdy dostaje własny wpis (patrz erpZpToSchedulerInput).
function _opsSignature(ops) {
  return [...ops]
    .sort((a, b) => a.sequence - b.sequence)
    .map(op => `${op.sequence}:${op.machine_id}:${(op.predecessors || []).join(',')}`)
    .join('|');
}

// ─── PARALLEL MACHINES: graf zależności zamiast sztywnego łańcucha ───────────
// Operacje na maszynach z `parallelMachines` startują niezależnie od siebie
// (predecessors: []); pierwsza "normalna" operacja czeka na WSZYSTKIE z nich
// (fan-in). Identyfikacja po `machine_id`/`workcenter`, NIE po numerze OP —
// numer OP może się dublować (te maszyny bywają zawsze pod tym samym numerem)
// i nie nadaje się jako unikalny klucz zależności. Zamiast tego każda operacja
// dostaje świeży, wewnętrzny `_opUid` (indeks w tablicy), po którym referuje
// predecessors.
//
// Maszyna z listy ZAWSZE liczy się jako "równoległa" (koncepcyjnie "OP=0") —
// niezależnie od jej faktycznego numeru OP w konkretnej trasie. Zasada
// uzgodniona z użytkownikiem: lista maszyn równoległych to zamknięty,
// świadomie utrzymywany zbiór (np. wykrawarki/piły przygotowawcze), które
// zawsze startują na samym początku produkcji, niezależnie od siebie —
// wszystkie razem, bez względu na to, gdzie w surowej kolejności ERP akurat
// wypadł ich numer operacji. Pierwsza "normalna" (nie z listy) operacja
// czeka na WSZYSTKIE naraz (fan-in).
export function applyParallelPredecessors(ops, parallelMachines) {
  const parallelSet = parallelMachines instanceof Set ? parallelMachines : new Set(parallelMachines);
  const indexed = ops.map((op, idx) => ({ ...op, _opUid: idx }));

  function matchesList(op) {
    return parallelSet.has(String(op.machine_id ?? op.workcenter));
  }

  const parallelOps = indexed.filter(matchesList);
  const parallelKeys = new Set(parallelOps.map(op => op._opUid));
  const normalOps    = indexed.filter(op => !parallelKeys.has(op._opUid)).sort((a, b) => a.sequence - b.sequence);

  parallelOps.forEach(op => { op.predecessors = []; });
  normalOps.forEach((op, i) => {
    op.predecessors = i === 0
      ? parallelOps.map(p => p._opUid)
      : [normalOps[i - 1]._opUid];
  });

  return indexed;
}

// ─── ADAPTER: ERP ZP → forwardSchedule ───────────────────────────────────────
// forwardSchedule oczekuje { zpList, routingByProduct }.
// volume=1 bo durH jest już całkowitym czasem ZP (nie ct_min per sztukę).
// Każdy ZP niesie własne `ops` z ERP — jeśli różnią się od kanonicznego routingu
// przyjętego dla danego produktu (pierwszy napotkany ZP), dostaje osobny wpis
// w routingByProduct pod kluczem `${product}::${zp_id}` (zp._routingKey), żeby
// nie zgubić jego rzeczywistej sekwencji operacji/maszyn.
//
// options.parallelMachines — lista kodów WC (z osobnego pliku wsadowego)
//   zawsze traktowanych jako niezależne operacje startowe, patrz
//   applyParallelPredecessors.
// options.mode — 'graph' (honoruje parallelMachines) | 'legacy' (zachowanie
//   sprzed tej funkcji — predecessors to naiwny łańcuch po indeksie, i tak
//   ignorowany przez żywy silnik w tym trybie).
export function erpZpToSchedulerInput(erpZpList, options = {}) {
  const { parallelMachines = [], mode = 'legacy' } = options;
  const parallelSet = new Set(parallelMachines.map(String));

  const routingByProduct  = {};
  const canonicalSig      = {}; // product -> sygnatura pierwszego napotkanego ZP
  const zpList = [];

  function buildOps(ops) {
    const graphOps = mode === 'graph' && parallelSet.size > 0
      ? applyParallelPredecessors(ops, parallelSet)
      : ops;
    return graphOps.map(op => ({
      operation:    op.machine_name || op.op_label,
      workcenter:   op.machine_id,   // scheduler planuje per maszyna
      wc_group:     op.workcenter,   // gniazdo — do widoku
      machine_id:   op.machine_id,
      machine_name: op.machine_name,
      sequence:     op.sequence,
      predecessors: op.predecessors,
      _opUid:       op._opUid,       // klucz zależności z applyParallelPredecessors (undefined = fallback na sequence)
      ct_min:       0,               // nieużywane — durH z ZP
      capacity_h:   DEFAULT_AVAIL,   // fallback; wcSchedule nadpisze
      _durH:        op.durH,
      _durRemH:     op.durRemH,
      _status:      op.status,
    }));
  }

  for (const zp of erpZpList) {
    const sig = _opsSignature(zp.ops);
    let routingKey; // undefined = użyj zp.product wprost (przypadek bez wariantów)

    if (!(zp.product in canonicalSig)) {
      canonicalSig[zp.product] = sig;
      routingByProduct[zp.product] = buildOps(zp.ops);
    } else if (sig !== canonicalSig[zp.product]) {
      routingKey = `${zp.product}::${zp.zp_id}`;
      routingByProduct[routingKey] = buildOps(zp.ops);
    }

    zpList.push({
      zp_id:     zp.zp_id,
      zs_id:     zp.zs_id,
      klient:    zp.klient,
      product:   zp.product,
      product_name: zp.product_name || '',
      volume:    1,           // durH już jest całkowity — nie mnożymy
      due_date:  zp.due_date,
      ship_date: zp.ship_date,
      priority:  zp.priority,
      ...(routingKey ? { _routingKey: routingKey } : {}),
    });
  }

  return { zpList, routingByProduct };
}

// ─── Parser pliku "maszyny równoległe" ───────────────────────────────────────
// Osobny plik wsadowy: jedna kolumna WC (kod maszyny) na wiersz, opcjonalny
// nagłówek "WC", format TSV/CSV/zwykła lista — bierze pierwszą kolumnę,
// ignoruje puste linie i duplikaty.
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));

export function parseParallelMachines(text) {
  const lines = text.replace(BOM_RE, '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const first = lines[0].toLowerCase();
  const start = ['wc', 'machine', 'maszyna', 'machine_id'].includes(first) ? 1 : 0;
  const codes = lines.slice(start)
    .map(l => l.split(/[,;\t]/)[0].trim())
    .filter(Boolean);
  return [...new Set(codes)];
}

// ─── Parser pliku "formatki do rozkroju" (nesting BETA) ──────────────────────
// Jeden wiersz = jedna operacja na wykrawarce (1 element = 1 operacja).
// Klucz złączenia z operacją: zp_id + sequence (te same wartości co Numer ZP/OP
// w eksporcie ERP). Wzorowany na parseZpStatus (analysisUtils.js) — nagłówek
// mapowany po nazwie kolumny, nie po pozycji, auto-detekcja separatora ,/;.
export function parseBomFormatek(text) {
  const clean = text.replace(BOM_RE, '');
  const lines = clean.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { records: [], rejected: [] };
  const sep     = lines[0].includes(';') ? ';' : ',';
  const headers = safeSplitCSV(lines[0], sep).map(h => h.toLowerCase());

  const records  = [];
  const rejected = [];

  lines.slice(1).forEach((line, idx) => {
    const vals = safeSplitCSV(line, sep);
    const r    = {};
    headers.forEach((h, i) => { r[h] = (vals[i] || '').trim(); });

    const raw = {
      zp_id:                r.zp_id || '',
      sequence:             parseInt(r.sequence || r.op || '0', 10),
      szerokosc_mm:         parseFloat((r.szerokosc_mm || '0').replace(',', '.')),
      wysokosc_mm:          parseFloat((r.wysokosc_mm || '0').replace(',', '.')),
      material:             r.material || '',
      grubosc_mm:           parseFloat((r.grubosc_mm || '0').replace(',', '.')),
      arkusz_szerokosc_mm:  parseFloat((r.arkusz_szerokosc_mm || '0').replace(',', '.')),
      arkusz_wysokosc_mm:   parseFloat((r.arkusz_wysokosc_mm || '0').replace(',', '.')),
    };

    if (!raw.zp_id || !raw.sequence || raw.szerokosc_mm <= 0 || raw.wysokosc_mm <= 0
        || raw.arkusz_szerokosc_mm <= 0 || raw.arkusz_wysokosc_mm <= 0) {
      rejected.push({ line: idx + 2, data: raw, reason: 'brak zp_id/sequence lub nieprawidłowe wymiary' });
    } else {
      records.push(raw);
    }
  });

  return { records, rejected };
}

// ─── buildWcSchedule ──────────────────────────────────────────────────────────
// Buduje wcSchedule (per-data dict per gniazdo) na oknie planStart..(max due_date
// ZP + 30 dni). Dostępne godziny są danymi WEJŚCIOWYMI (ręczne edycje w Heatmapie,
// zaimportowany grafik godzin z loadplanner) — trwałymi niezależnie od okna
// planowania. `prev` pozwala je zachować: daty w oknie, których jeszcze nie ma,
// dostają wartość domyślną; daty JUŻ ustawione (w oknie i poza nim — np. gdy
// "Planuj od" przesunięto na datę PO nich) nie są nigdy usuwane, tylko ewentualnie
// nadpisywane kolejnym importem/edycją tej samej daty. Wołający MUSI przekazać
// aktualny wcSchedule jako `prev` przy każdym przebudowaniu (np. re-import ERP,
// zmiana planStart), inaczej te wpisy cicho przepadają.
//
// `template` ({ machine_id: { 0..6: h } }, patrz grafikGodzinImport.buildWeeklyTemplateFromGrafik)
// to powtarzalny wzorzec dzień-tygodnia z ostatniego importu grafiku godzin —
// używany jako fallback DRUGI w kolejności (po `prev`, przed płaskim `capH`), żeby
// jeden import 7 dni pokrywał cały horyzont planowania, nie tylko te 7 dat.
export function buildWcSchedule(wcList, planStartStr, zpList, horizonDays = 14, prev = {}, wcCapacity = {}, template = {}) {
  const planStart = new Date(planStartStr + 'T00:00:00');

  const horizonEnd = new Date(planStart);
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);

  let maxDue = new Date(horizonEnd);
  if (zpList && zpList.length) {
    zpList.forEach(z => {
      if (z.due_date) {
        const d = new Date(z.due_date + 'T00:00:00');
        if (d > maxDue) maxDue = d;
      }
    });
  }

  const endDate = new Date(maxDue);
  endDate.setDate(endDate.getDate() + 30);

  const next = {};
  for (const wc of wcList) {
    const capH   = wcCapacity[wc] ?? WC_DAILY_CAPACITY[wc] ?? 16;
    const prevSc = prev[wc];
    // Start od kopii WSZYSTKICH już ustawionych dat (nie tylko tych w aktualnym
    // oknie) — okno tylko dokłada brakujące dni, nigdy nie usuwa istniejących.
    const obj    = (prevSc && typeof prevSc === 'object' && !Array.isArray(prevSc)) ? { ...prevSc } : {};

    const cur = new Date(planStart);
    while (cur <= endDate) {
      const dateStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
      const jsDay   = cur.getDay();
      const isWe    = jsDay === 0 || jsDay === 6;

      if (prevSc && typeof prevSc === 'object' && !Array.isArray(prevSc) && prevSc[dateStr] !== undefined) {
        obj[dateStr] = prevSc[dateStr];
      } else if (Array.isArray(prevSc)) {
        const idx = jsDay === 0 ? 6 : jsDay - 1;
        obj[dateStr] = prevSc[idx] ?? 0;
      } else if (template[wc] && template[wc][jsDay] !== undefined) {
        obj[dateStr] = template[wc][jsDay];
      } else {
        obj[dateStr] = isWe ? 0 : capH;
      }

      cur.setDate(cur.getDate() + 1);
    }
    next[wc] = obj;
  }
  return next;
}
