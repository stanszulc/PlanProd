// ─── scheduler.worker.js ──────────────────────────────────────────────────────
// Web Worker: liczy scheduleAll w tle, nie blokuje UI
// Komunikacja przez postMessage:
//   IN:  { type: 'SCHEDULE', payload: { zpList, routingByProduct, wcSchedule, planStart } }
//   OUT: { type: 'DONE', payload: { fwdZP, zpStatus } }
//       { type: 'ERROR', payload: { message } }
//       { type: 'PROGRESS', payload: { pct, label } }
// ─────────────────────────────────────────────────────────────────────────────

// ─── STAŁE ───────────────────────────────────────────────────────────────────
const MS            = 3_600_000;
const DEFAULT_AVAIL = 16;
const EPSILON       = 0.0001;
const SAFETY_LIMIT  = 50_000;
const TOC_YELLOW    = 0.33;
const TOC_RED       = 0.67;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function localDateStr(dt) {
  const d = new Date(dt);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dayKey(dt) {
  // Szybszy klucz per dzień niż localDateStr — używany tylko dla occupancy
  const d = new Date(dt);
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

function getAvail(wc, dt, wcSchedule) {
  const sched = wcSchedule?.[wc];
  if (!sched) return DEFAULT_AVAIL;
  const d = new Date(dt);
  const jsDay = d.getDay();
  if (!Array.isArray(sched) && typeof sched === 'object') {
    const dk = localDateStr(d);
    if (sched[dk] !== undefined) return sched[dk];
    return (jsDay === 0 || jsDay === 6) ? 0 : DEFAULT_AVAIL;
  }
  const idx = jsDay === 0 ? 6 : jsDay - 1;
  return sched[idx] ?? 0;
}

function tocBuffer(backStart, planStart, dueDate, realEnd) {
  if (realEnd && realEnd > dueDate) {
    return { zone:'black', consumed:1, label:'SPÓŹNIONE', overH:(realEnd-dueDate)/MS };
  }
  const bufferTotal = dueDate - backStart;
  if (bufferTotal <= 0) return { zone:'black', consumed:1, label:'PRZEKROCZONY' };
  const consumed = 1 - (dueDate - planStart) / bufferTotal;
  if (consumed < TOC_YELLOW) return { zone:'green',  consumed, label:'OK' };
  if (consumed < TOC_RED)    return { zone:'yellow', consumed, label:'UWAGA' };
  if (consumed < 1.0)        return { zone:'red',    consumed, label:'ZAGROŻONE' };
  return                            { zone:'black',  consumed, label:'SPÓŹNIONE' };
}

// ─── NOWY ALGORYTM: occupancy per dzień ──────────────────────────────────────
// occupancy[wc][dayKey] = [{from, to}] posortowane malejąco po `from`
// Zamiast przeszukiwać WSZYSTKIE sloty → tylko sloty TEGO dnia → O(k) k≈2-5

function makeOccupancy() {
  // occupancy[wc] = [{from, to}] posortowane rosnąco po from
  return Object.create(null);
}

function addSlotToOcc(occ, wc, from, to) {
  if (!occ[wc]) occ[wc] = [];
  const slots = occ[wc];
  // binary insert posortowany rosnąco po from
  let lo = 0, hi = slots.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slots[mid].from < from) lo = mid + 1; else hi = mid;
  }
  slots.splice(lo, 0, { from: new Date(from), to: new Date(to) });
}

// ─── scheduleAll: forward scheduling z dzielonym occupancy ──────────────────
// Algorytm:
//   1. Sortuj ZP wg pilności (CR z buforem VIP)
//   2. Dla każdego ZP: planuj operacje w przód od planStart
//   3. Każda operacja czeka na koniec poprzedniej I na wolny slot maszyny
//   4. Maszyna 0h → przeskocz do następnego dostępnego dnia
//   5. realEnd > due_date → ZP spóźnione → czerwona ramka

function scheduleAll(zpList, routingByProduct, wcSchedule, planStartDt, onProgress, config) {
  const VIP_BUFFER_DAYS = config?.vipBufferDays ?? 2;
  const occ    = makeOccupancy();
  const result = [];
  const zpStatus = [];

  // Funkcja pilności — Critical Ratio z buforem VIP
  function urgency(zp) {
    const ops = routingByProduct[zp.product] || [];
    const totalH = ops.reduce((s, op) => {
      const h = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
      return s + h;
    }, 0);
    const bufferMs = (zp.priority === 1 ? VIP_BUFFER_DAYS : 0) * 24 * MS;
    const effectiveDue = new Date(zp.due_date + 'T23:59:59').getTime() - bufferMs;
    const dueMs  = effectiveDue - planStartDt.getTime();
    const totalMs = totalH * MS;
    return totalMs > 0 ? dueMs / totalMs : 999;
  }

  const sorted = [...zpList].sort((a, b) => urgency(a) - urgency(b));
  const total  = sorted.length;

  for (let zi = 0; zi < sorted.length; zi++) {
    const zp  = sorted[zi];
    const ops = (routingByProduct[zp.product] || [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence); // forward → rosnąco

    if (!ops.length) continue;

    if (onProgress && zi % 50 === 0) {
      onProgress(Math.round(zi / total * 100), `Planuję ${zi}/${total} ZP...`);
    }

    const dueDate  = new Date(zp.due_date + 'T23:59:59');
    let cursor     = new Date(planStartDt); // start od planStart
    const opResults = [];

    for (const op of ops) {
      const durH = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
      if (durH <= 0) continue;

      // Czekaj na koniec poprzedniej operacji
      // (cursor jest już ustawiony na endDt poprzedniej)

      const { startDt, endDt, segs } = findSlotForward(
        cursor, durH, op.workcenter, wcSchedule, occ
      );

      opResults.push({ op, startDt, endDt, segs, durH });
      cursor = new Date(endDt); // następna op zaczyna po końcu tej
    }

    const backStart = opResults.length ? opResults[0].startDt : new Date(planStartDt);
    const realEnd   = opResults.length ? opResults[opResults.length - 1].endDt : new Date(planStartDt);

    // Zbuduj sub-operacje
    let seqCounter = 0;
    for (const { op, startDt, endDt, segs, durH } of opResults) {
      seqCounter++;
      result.push({
        zp_id:      `${zp.zp_id}/${String(seqCounter).padStart(3,'0')}`,
        parent_zp:  zp.zp_id,
        zs_id:      zp.zs_id   || '',
        klient:     zp.klient  || '',
        product:    zp.product,
        workcenter: op.workcenter,
        machine_id: op.machine_id || op.workcenter,
        wc_group:   op.wc_group  || '',
        operation:  op.operation || op.machine_name || '',
        sequence:   op.sequence,
        volume:     zp.volume,
        durH,
        start_dt:   startDt,
        end_dt:     endDt,
        segments:   segs,
        due_date:   zp.due_date,
        priority:   zp.priority,
        realEnd,
      });
    }

    // Status
    const delayMs   = Math.max(0, realEnd - dueDate);
    const delayH    = delayMs / MS;
    const delayDays = +(delayH / DEFAULT_AVAIL).toFixed(1);
    const toc       = tocBuffer(backStart, planStartDt, dueDate, realEnd);
    const bottleneck = opResults.length
      ? opResults.reduce((b, o) => o.durH > b.durH ? o : b, opResults[0]).op.workcenter
      : null;

    zpStatus.push({
      zp_id:      zp.zp_id,
      zs_id:      zp.zs_id   || '',
      pozycja:    zp.pozycja || '',
      klient:     zp.klient  || '',
      product:    zp.product,
      due_date:   zp.due_date,
      priority:   zp.priority,
      backStart,
      realEnd,
      delayH,
      delayDays,
      toc,
      bottleneck,
      late: delayH > 0,
      backDelay: 0,
    });
  }

  return { fwdZP: result, zpStatus };
}

// ─── findSlotForward: zoptymalizowana wersja z binary search ─────────────────
// occupancy[wc] = [{from, to}] posortowane rosnąco po from
// Binary search zamiast liniowego skanowania → O(log n) zamiast O(n)

// Znajdź pierwszą pozycję w slots gdzie slot.from >= t
function lowerBound(slots, t) {
  let lo = 0, hi = slots.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slots[mid].from < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Przesuń windowStart za wszystkie nakładające się sloty (binary search start)
function advancePastSlots(slots, windowStart) {
  let t = windowStart;
  // Znajdź sloty które zaczynają się przed t i kończą po t
  // Szukamy od lewej - sloty posortowane rosnąco po from
  let i = lowerBound(slots, t);
  // Sprawdź też slot poprzedni (może nakrywać t)
  if (i > 0) i--;
  while (i < slots.length) {
    const b = slots[i];
    if (b.from > t) break;          // slot zaczyna się po naszym oknie
    if (b.to > t) t = b.to;        // slot nakrywa t → przesuń za jego koniec
    i++;
  }
  return t;
}

// Znajdź najbliższy slot zaczynający się po windowStart (koniec wolnego okna)
function nextSlotAfter(slots, windowStart) {
  const i = lowerBound(slots, windowStart);
  // Znajdź pierwszy slot który zaczyna się STRICTNIE po windowStart
  for (let j = i; j < slots.length; j++) {
    if (slots[j].from > windowStart) return slots[j].from;
  }
  return null;
}

function findSlotForward(fromDt, needH, wc, wcSchedule, occ) {
  let cursor    = new Date(fromDt);
  let remaining = needH;
  let safety    = 0;
  const segs    = [];

  while (remaining > EPSILON && safety++ < SAFETY_LIMIT) {
    const avail = getAvail(wc, cursor, wcSchedule);

    if (avail === 0) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    const dayStart = new Date(cursor); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(dayStart); dayEnd.setHours(avail, 0, 0, 0);

    if (cursor >= dayEnd) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    const slots = occ[wc] || [];

    // Przesuń za zajęte sloty — O(log n + k) gdzie k = liczba nakładających się
    const windowStartT = advancePastSlots(slots, cursor.getTime());
    const windowStart  = new Date(Math.max(windowStartT, cursor.getTime()));

    if (windowStart >= dayEnd) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    // Koniec wolnego okna — O(log n)
    const nextFrom = nextSlotAfter(slots, windowStart.getTime());
    const windowEnd = nextFrom !== null
      ? new Date(Math.min(nextFrom, dayEnd.getTime()))
      : new Date(dayEnd);

    const availH = (windowEnd - windowStart) / MS;
    if (availH <= EPSILON) {
      cursor = new Date(windowEnd);
      continue;
    }

    const take   = Math.min(remaining, availH);
    remaining   -= take;
    const segEnd = new Date(windowStart.getTime() + take * MS);

    segs.push({ segStart: new Date(windowStart), segEnd, durH: take });
    addSlotToOcc(occ, wc, new Date(windowStart), segEnd);
    cursor = new Date(segEnd);
  }

  return {
    startDt: segs.length ? segs[0].segStart          : new Date(fromDt),
    endDt:   segs.length ? segs[segs.length-1].segEnd : new Date(fromDt),
    segs,
  };
}

// ─── WORKER MESSAGE HANDLER ──────────────────────────────────────────────────
self.onmessage = function(e) {
  const { type, payload } = e.data;

  if (type === 'SCHEDULE') {
    try {
      const { zpList, routingByProduct, wcSchedule, planStart, config } = payload;
      const planStartDt = new Date(planStart + 'T00:00:00');

      const t0 = Date.now();

      const { fwdZP, zpStatus } = scheduleAll(
        zpList,
        routingByProduct,
        wcSchedule,
        planStartDt,
        (pct, label) => self.postMessage({ type: 'PROGRESS', payload: { pct, label } }),
        config
      );

      const elapsed = Date.now() - t0;

      self.postMessage({
        type: 'DONE',
        payload: { fwdZP, zpStatus, elapsed }
      });
    } catch (err) {
      self.postMessage({
        type: 'ERROR',
        payload: { message: err.message, stack: err.stack }
      });
    }
  }
};