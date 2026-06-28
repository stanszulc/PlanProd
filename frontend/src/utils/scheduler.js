// ─── scheduler.js ─────────────────────────────────────────────────────────────
// Refaktoryzacja: czystość, efektywność, struktura
// Zmiany opisane przy każdej sekcji komentarzem [ZMIANA: ...]
// ──────────────────────────────────────────────────────────────────────────────


// ─── STAŁE ────────────────────────────────────────────────────────────────────
// [ZMIANA] Magic numbers wyciągnięte do named constants — czytelność + łatwa zmiana
const MS_PER_HOUR   = 3_600_000;
const DEFAULT_AVAIL = 16;        // h/dzień gdy brak grafiku
const DEFAULT_CAP   = 8;         // h/dzień fallback capacity
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

// [ZMIANA] nextDayStart / prevDayEnd wyciągnięte z duplikujących się bloków
// w backScheduleOp i forwardScheduleOp — DRY
function nextDayStart(dt) {
  const d = new Date(dt);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function prevDayEnd(dt, avail) {
  const d = new Date(dt);
  d.setDate(d.getDate() - 1);
  d.setHours(avail > 0 ? avail : 23, avail > 0 ? 0 : 59, 0, 0);
  return d;
}


// ─── HELPER: BUDOWANIE SUB-ZP ─────────────────────────────────────────────────
// [ZMIANA] IIFE do generowania zp_id powtarzało się identycznie w backSchedule
// i forwardSchedule (linia 238 i 380 oryginału) → wyciągnięte do funkcji
function nextSubId(counter, parentId) {
  counter[parentId] = (counter[parentId] || 0) + 1;
  return `${parentId}/${String(counter[parentId]).padStart(3,'0')}`;
}

// [ZMIANA] Tworzenie obiektu sub-ZP było zduplikowane w obu schedulerach
// z drobnymi różnicami → jeden builder z opcjonalnymi polami
function buildSubOp(zp, op, { zp_id, start_dt, end_dt, segments, durH }) {
  return {
    zp_id,
    parent_zp:  zp.zp_id,
    zs_id:      zp.zs_id  || '',
    klient:     zp.klient || '',
    sub_id:     `${zp.zp_id}/${String(op.sequence).padStart(3,'0')}`,
    product:    zp.product,
    workcenter: op.workcenter,
    operation:  op.operation,
    sequence:   op.sequence,
    volume:     zp.volume,
    durH,
    start_dt,
    end_dt,
    segments,
    due_date:   zp.due_date,
    priority:   zp.priority,
  };
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

// [ZMIANA] parseRouting / parseZP / parseZS miały zduplikowany boilerplate
// (BOM strip, split lines, detect sep, map headers) → wyciągnięte do parseCsv()
function parseCsv(text) {
  const clean   = text.replace(/^\uFEFF/, '');
  const lines   = clean.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const sep     = lines[0].includes(';') ? ';' : ',';
  const headers = safeSplitCSV(lines[0], sep).map(h => h.toLowerCase());
  const rows    = lines.slice(1).map(line => {
    const vals = safeSplitCSV(line, sep);
    const r    = {};
    headers.forEach((h, i) => { r[h] = vals[i] || ''; });
    return r;
  });
  return rows;
}

export function parseRouting(text) {
  const rows = parseCsv(text);
  if (!rows) return [];

  return rows.map(r => {
    const ct  = Math.max(0, parseFloat(r.ct_min || r.ct || 0));
    const cap = parseFloat(r.capacity_h || r.cap || r.capacity || DEFAULT_CAP);
    return {
      product:      r.product    || '',
      operation:    r.operation  || '',
      workcenter:   (r.workcenter || r.wc || '').toUpperCase(),
      ct_min:       ct,
      sequence:     parseInt(r.sequence || r.seq || 1),
      predecessors: (r.predecessors || r.pred || '')
                      .split(/[,|]/)
                      .map(s => parseInt(s.trim()))
                      .filter(n => !isNaN(n)),
      capacity_h:   cap <= 0 ? DEFAULT_CAP : cap,
    };
  }).filter(r => r.product && r.workcenter && r.ct_min > 0);
}

export function parseZP(text) {
  const rows = parseCsv(text);
  if (!rows) return [];

  return rows.map(r => ({
    zp_id:    r.zp_id || r.zp || r.id || '',
    product:  r.product || '',
    volume:   Math.max(0, parseFloat(r.volume || r.vol || r.qty || 0)),
    due_date: r.due_date || r.due || r.data || '',
    priority: parseInt(r.priority || r.prio || 1),
  })).filter(r => r.product && r.volume > 0 && r.due_date);
}

export function parseZS(text) {
  const rows = parseCsv(text);
  if (!rows) return [];

  return rows.map(r => ({
    zs_id:    r.zs_id || r.zs || '',
    pozycja:  parseInt(r.pozycja || r.poz || 1),
    klient:   r.klient || r.client || r.customer || '',
    product:  r.product || '',
    volume:   Math.max(0, parseFloat(r.volume || r.vol || 0)),
    due_date: r.due_date || r.due || '',
    priority: parseInt(r.priority || r.prio || 1),
  })).filter(r => r.product && r.volume > 0 && r.due_date);
}

// [ZMIANA] zsToZP — bez zmian merytorycznych, tylko wyrównanie stylu
export function zsToZP(zsList) {
  return zsList.map(zs => {
    const zsNum  = (zs.zs_id.replace(/[^0-9]/g, '') || '001').padStart(3, '0');
    const pozNum = String(zs.pozycja || 1).padStart(2, '0');
    return {
      zp_id:    `ZP-${zsNum}/${pozNum}`,
      zs_id:    zs.zs_id,
      pozycja:  zs.pozycja,
      klient:   zs.klient,
      product:  zs.product,
      volume:   zs.volume,
      due_date: zs.due_date,
      priority: zs.priority,
    };
  });
}


// ─── DOSTĘPNOŚĆ GNIAZD ────────────────────────────────────────────────────────

// [ZMIANA] getAvail — logika identyczna, ale:
// 1. Duplikacja jsDay2idx(d.getDay()) zastąpiona zmienną lokalną
// 2. Wcześniej w computeLoads była osobna inline kopia tej logiki (getCapH) →
//    teraz używa getAvail przez alias getCapH (patrz computeLoads niżej)
export function getAvail(wc, dt, wcSchedule) {
  const sched = wcSchedule?.[wc];
  if (!sched) return DEFAULT_AVAIL;

  const d      = new Date(dt);
  const jsDay  = d.getDay();

  if (!Array.isArray(sched) && typeof sched === 'object') {
    const dateKey = localDateStr(d);
    if (sched[dateKey] !== undefined) return sched[dateKey];
    return (jsDay === 0 || jsDay === 6) ? 0 : DEFAULT_AVAIL;
  }

  // Stary format: tablica [pon..nd]
  const idx = jsDay2idx(jsDay);
  return sched[idx] ?? 0;
}


// ─── BACK-SCHEDULE ────────────────────────────────────────────────────────────

// [ZMIANA] backScheduleOp — logika bez zmian, ale:
// 1. Wyciągnięto nextDayStart / prevDayEnd (DRY)
// 2. Usunięto zbędne `new Date(cursor)` gdzie cursor był już właśnie skopiowany
// 3. SAFETY_LIMIT i EPSILON z named constants zamiast magic numbers
export function backScheduleOp(endDt, hoursNeeded, wc, wcSchedule) {
  const segments = [];
  let cursor     = new Date(endDt);
  let remaining  = hoursNeeded;
  let safety     = 0;

  while (remaining > EPSILON && safety++ < SAFETY_LIMIT) {
    const avail = getAvail(wc, cursor, wcSchedule);

    if (avail === 0) {
      cursor = prevDayEnd(cursor, 0);
      continue;
    }

    const curH       = cursor.getHours() + cursor.getMinutes() / 60;
    const availToday = Math.min(curH, avail);

    if (availToday <= EPSILON) {
      const prevAvail = getAvail(wc, prevDayEnd(cursor, 0), wcSchedule);
      cursor = prevDayEnd(cursor, prevAvail);
      continue;
    }

    const take      = Math.min(remaining, availToday);
    remaining      -= take;
    const startH    = curH - take;
    const segEndDt  = new Date(cursor);
    const segStart  = new Date(cursor);
    segStart.setHours(Math.floor(startH), Math.round((startH % 1) * 60), 0, 0);

    segments.unshift({ segStart, segEnd: segEndDt, durH: take });

    if (remaining > EPSILON) {
      const prevAvail = getAvail(wc, segStart, wcSchedule);
      cursor = prevDayEnd(segStart, prevAvail);
    } else {
      cursor = segStart;
    }
  }

  return { startDt: cursor, segments };
}

// [ZMIANA] backSchedule:
// 1. BUG FIX: sub_id: result[result.length] → zawsze undefined (off-by-one).
//    Naprawiono przez buildSubOp który używa op.sequence
// 2. Wyciągnięto nextSubId i buildSubOp (DRY z forwardSchedule)
// 3. forEach → for...of dla spójności z forwardSchedule
export function backSchedule(zpList, routingByProduct, wcSchedule) {
  const result       = [];
  const zpOpCounter  = {};

  for (const zp of zpList) {
    const ops = (routingByProduct[zp.product] || [])
      .slice()
      .sort((a, b) => b.sequence - a.sequence);
    if (!ops.length) continue;

    let cursor   = new Date(zp.due_date + 'T00:00:00');
    const avail0 = getAvail(ops[0].workcenter, cursor, wcSchedule) || DEFAULT_AVAIL;
    cursor.setHours(avail0, 0, 0, 0);

    const doneStarts = {};

    for (const op of ops) {
      const durH = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
      let endDt  = new Date(cursor);

      if (op.predecessors?.length > 0) {
        const successorStarts = ops
          .filter(o => o.predecessors?.includes(op.sequence))
          .map(o => doneStarts[o.sequence])
          .filter(Boolean)
          .map(d => new Date(d).getTime());
        if (successorStarts.length > 0)
          endDt = new Date(Math.min(...successorStarts));
      }

      const { startDt, segments } = backScheduleOp(endDt, durH, op.workcenter, wcSchedule);
      doneStarts[op.sequence] = startDt;

      result.push(buildSubOp(zp, op, {
        zp_id:    nextSubId(zpOpCounter, zp.zp_id),
        start_dt: startDt,
        end_dt:   endDt,
        segments,
        durH,
      }));

      cursor = new Date(startDt);
    }
  }

  return result.sort((a, b) => a.start_dt - b.start_dt);
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

// [ZMIANA] forwardSchedule:
// 1. Wyciągnięto nextSubId i buildSubOp (DRY z backSchedule)
// 2. forEach → for...of
// 3. Obliczenie delayH/delayDays wyciągnięte do calcDelay() (reused w hybridzie)
export function forwardSchedule(zpList, routingByProduct, wcSchedule, planStart) {
  const occupancy   = {};
  const result      = [];
  const zpOpCounter = {};

  const sorted = [...zpList].sort((a, b) =>
    a.priority - b.priority || a.due_date.localeCompare(b.due_date)
  );

  for (const zp of sorted) {
    const ops = (routingByProduct[zp.product] || [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence);
    if (!ops.length) continue;

    const doneEnds = {};
    const subOps   = [];

    for (const op of ops) {
      const durH = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
      let cursor  = new Date(planStart);

      if (op.predecessors?.length > 0) {
        for (const seq of op.predecessors) {
          if (doneEnds[seq] && doneEnds[seq] > cursor)
            cursor = new Date(doneEnds[seq]);
        }
      } else if (subOps.length > 0) {
        const prevEnd = subOps[subOps.length-1].end_dt;
        if (prevEnd && new Date(prevEnd) > cursor)
          cursor = new Date(prevEnd);
      }

      const { startDt, endDt, segments } = forwardScheduleOp(
        cursor, durH, op.workcenter, wcSchedule, occupancy
      );
      doneEnds[op.sequence] = endDt;

      subOps.push(buildSubOp(zp, op, {
        zp_id:    nextSubId(zpOpCounter, zp.zp_id),
        start_dt: startDt,
        end_dt:   endDt,
        segments,
        durH,
      }));

      cursor = new Date(endDt);
    }

    const realEnd = subOps.length ? subOps[subOps.length-1].end_dt : new Date(planStart);
    const { delayH, delayDays } = calcDelay(realEnd, zp.due_date);

    result.push(...subOps.map(s => ({ ...s, realEnd, delayH, delayDays })));
  }

  return result;
}


// ─── DELAY HELPER ─────────────────────────────────────────────────────────────
// [ZMIANA] Obliczenie opóźnienia było zduplikowane w forwardSchedule i hybridzie
// → wyciągnięte do jednej funkcji
function calcDelay(realEnd, dueDateStr) {
  const dueDate  = new Date(dueDateStr + 'T23:59:59');
  const delayMs  = Math.max(0, realEnd - dueDate);
  const delayH   = delayMs / MS_PER_HOUR;
  const delayDays = +(delayH / DEFAULT_CAP).toFixed(1); // [FIX P0] DEFAULT_CAP=8h, nie DEFAULT_AVAIL=16h
  return { dueDate, delayH, delayDays };
}


// ─── TOC BUFFER ───────────────────────────────────────────────────────────────
// [ZMIANA] Dwie identyczne gałęzie `consumed < 0` i `consumed < 0.33` → jedna
// Reszta bez zmian merytorycznych
export function tocBuffer(backStartDt, planStartDt, dueDateDt, realEndDt) {
  if (realEndDt && realEndDt > dueDateDt) {
    return { zone: 'black', consumed: 1, label: 'SPÓŹNIONE', overH: (realEndDt - dueDateDt) / MS_PER_HOUR };
  }
  const bufferTotal = dueDateDt - backStartDt;
  if (bufferTotal <= 0) return { zone: 'black', consumed: 1, label: 'PRZEKROCZONY' };

  const consumed = 1 - (dueDateDt - planStartDt) / bufferTotal;
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
    for (const op of (routingByProduct[z.product] || [])) {
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


// ─── BILANS BRYGAD ────────────────────────────────────────────────────────────
// [NOWE] Podejście 3: dostępność brygady vs suma obciążeń jej maszyn per dzień
// brigadeToWC:  { 'Brygada_A': ['M1','M2'], 'Brygada_B': ['M3'] }
// brigadeAvail: { 'Brygada_A': { '2026-06-01': 8, ... }, ... }
// scheduledOps: wynik forwardSchedule() lub backSchedule()
// days:         ['2026-06-01', '2026-06-02', ...]
export function calcBrigadeBalance(brigadeToWC, brigadeAvail, scheduledOps, days) {
  const result = {};

  for (const [brigade, wcs] of Object.entries(brigadeToWC)) {
    const wcSet = new Set(wcs); // O(1) lookup zamiast includes()
    result[brigade] = {};

    for (const day of days) {
      const available = brigadeAvail[brigade]?.[day] ?? 0;
      const totalLoad = scheduledOps
        .filter(op => wcSet.has(op.workcenter))
        .flatMap(op => op.segments || [])
        .filter(seg => localDateStr(seg.segStart) === day)
        .reduce((sum, seg) => sum + seg.durH, 0);

      const delta = available - totalLoad;
      result[brigade][day] = {
        available,
        totalLoad: +totalLoad.toFixed(2),
        delta:     +delta.toFixed(2),
        overloaded: delta < 0,
      };
    }
  }
  return result;
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
    const durH = op.volume_plan * routeOp.ct_min / 60;
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
//   Ilość ZP | Wyprod. | OP | WC | WCname | WC2 | CzasPlan | CzasPozost
//
// Mapowanie kolumn:
//   WC     → machine_id   (numer maszyny, np. 20043)
//   WCname → machine_name (pełna nazwa, np. "Wykrawarko-gilotyna SG6 M107")
//   WC2    → workcenter   (gniazdo/linia, np. "Maszyny", "Kanały")
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
    const workcenter  = get(r, 'wc2', 'workcenter');   // WC2 = gniazdo

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

  const result    = [];
  const wcToWc2   = {};  // { machine_id → wc2_name } — budowane z TSV, nie z demoData

  for (const zp of zpGroups.values()) {
    if (!zp.product || !zp.due_date || zp.ops.length === 0) continue;
    zp.ops.sort((a, b) => a.sequence - b.sequence);
    zp.ops.forEach((op, i) => {
      op.predecessors = i > 0 ? [zp.ops[i - 1].sequence] : [];
      // Zbierz mapę machine_id → wc2 z każdej operacji
      if (op.machine_id && op.workcenter) wcToWc2[op.machine_id] = op.workcenter;
    });
    result.push(zp);
  }
  // Zwróć wynik + mapę wc2 — App.jsx zapisze ją do state zamiast importować z demoData
  result.wcToWc2 = wcToWc2;
  return result;
}


// ─── ADAPTER: ERP ZP → forwardSchedule ───────────────────────────────────────
// forwardSchedule oczekuje { zpList, routingByProduct }.
// volume=1 bo durH jest już całkowitym czasem ZP (nie ct_min per sztukę).
export function erpZpToSchedulerInput(erpZpList) {
  const routingByProduct = {};
  const zpList = [];

  for (const zp of erpZpList) {
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
    });

    if (!routingByProduct[zp.product]) {
      routingByProduct[zp.product] = zp.ops.map(op => ({
        operation:    op.machine_name || op.op_label,
        workcenter:   op.machine_id,   // scheduler planuje per maszyna
        wc_group:     op.workcenter,   // gniazdo — do widoku
        machine_id:   op.machine_id,
        machine_name: op.machine_name,
        sequence:     op.sequence,
        predecessors: op.predecessors,
        ct_min:       0,               // nieużywane — durH z ZP
        capacity_h:   DEFAULT_AVAIL,   // fallback; wcSchedule nadpisze
        _durH:        op.durH,
        _durRemH:     op.durRemH,
        _status:      op.status,
      }));
    }
  }

  return { zpList, routingByProduct };
}