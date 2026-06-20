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

// ─── scheduleAll: jeden przebieg backward z dzielonym occupancy ───────────────
// Algorytm:
//   1. Sortuj ZP wg pilności (due_date, priority)
//   2. Dla każdego ZP: cofaj operacje od due_date wstecz, rejestrując sloty w occupancy
//   3. Każde kolejne ZP widzi już zajęte sloty → przesuwa się wcześniej
//   4. backStart = start pierwszej operacji → do TOC buffer
//   5. realEnd = koniec ostatniej operacji → do wykrycia spóźnienia

function scheduleAll(zpList, routingByProduct, wcSchedule, planStartDt, onProgress) {
  const occ         = makeOccupancy();
  const result      = [];   // sub-operacje (jak fwdZP)
  const zpStatus    = [];

  const sorted = [...zpList].sort((a, b) =>
    a.due_date.localeCompare(b.due_date) || a.priority - b.priority
  );

  const total = sorted.length;

  for (let zi = 0; zi < sorted.length; zi++) {
    const zp  = sorted[zi];
    const ops = (routingByProduct[zp.product] || [])
      .slice()
      .sort((a, b) => b.sequence - a.sequence); // cofamy → malejąco

    if (!ops.length) continue;

    // Progress co 50 ZP
    if (onProgress && zi % 50 === 0) {
      onProgress(Math.round(zi / total * 100), `Planuję ${zi}/${total} ZP...`);
    }

    const dueDate  = new Date(zp.due_date + 'T23:59:59');
    let cursor     = new Date(dueDate);
    const segments = {}; // sequence → [{segStart, segEnd, durH}]
    let backStart  = cursor;
    let realEnd    = planStartDt;

    // Cofamy operacje od due_date w tył
    const opResults = [];
    for (const op of ops) {
      const durH = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
      if (durH <= 0) continue;

      const { startDt, endDt, segs } = findSlotBackward(
        cursor, durH, op.workcenter, wcSchedule, occ, planStartDt
      );

      opResults.unshift({ op, startDt, endDt, segs, durH });
      cursor = new Date(startDt);
    }

    // Ustal backStart i realEnd z wyników
    if (opResults.length) {
      backStart = opResults[0].startDt;
      realEnd   = opResults[opResults.length - 1].endDt;
    }

    // Zbuduj sub-operacje (format zgodny z fwdZP)
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

    // Oblicz status
    // ZP jest spóźnione gdy:
    // 1. realEnd > dueDate (nie zdążono przed terminem), LUB
    // 2. backStart < planStartDt (musiałoby zacząć przed horyzontem planowania)
    const delayMs   = Math.max(0, realEnd - dueDate);
    const delayH    = delayMs / MS;
    const delayDays = +(delayH / DEFAULT_AVAIL).toFixed(1);
    const backDelay = backStart < planStartDt
      ? (planStartDt - backStart) / MS
      : 0;
    // Sprawdź czy wszystkie operacje mają pełne pokrycie godzin
    const totalPlanned = opResults.reduce((s, o) =>
      s + (o.segs || []).reduce((ss, seg) => ss + seg.durH, 0), 0);
    const totalNeeded  = opResults.reduce((s, o) => s + o.durH, 0);
    const incomplete   = totalNeeded > EPSILON && totalPlanned < totalNeeded - EPSILON;
    const toc       = tocBuffer(backStart, planStartDt, dueDate, realEnd);
    const bottleneck = opResults.length
      ? opResults.reduce((b, o) => o.durH > b.durH ? o : b, opResults[0]).op.workcenter
      : null;

    zpStatus.push({
      zp_id:      zp.zp_id,
      zs_id:      zp.zs_id    || '',
      pozycja:    zp.pozycja  || '',
      klient:     zp.klient   || '',
      product:    zp.product,
      due_date:   zp.due_date,
      priority:   zp.priority,
      backStart,
      realEnd,
      delayH,
      delayDays,
      toc,
      bottleneck,
      late:       delayH > 0 || backDelay > 0 || incomplete,
      backDelay,  // h przed planStart (0 jeśli OK)
    });
  }

  return { fwdZP: result, zpStatus };
}

// ─── findSlotBackward: cofanie z globalnym occupancy ─────────────────────────
// occupancy[wc] = [{from, to}] posortowane rosnąco po from
// Szukamy wolnych okien wstecz od endDt uwzględniając WSZYSTKIE sloty maszyny
function findSlotBackward(endDt, needH, wc, wcSchedule, occ, planStartDt) {
  let cursor    = new Date(endDt);
  let remaining = needH;
  let safety    = 0;
  const segs    = [];

  while (remaining > EPSILON && safety++ < SAFETY_LIMIT) {
    const avail = getAvail(wc, cursor, wcSchedule);
    if (avail === 0) {
      cursor.setDate(cursor.getDate() - 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    // Nie planuj przed planStartDt — przerwij pętlę
    if (planStartDt && cursor < planStartDt) break;

    const curH = cursor.getHours() + cursor.getMinutes() / 60;
    if (curH <= EPSILON) {
      cursor.setDate(cursor.getDate() - 1);
      const prevAvail = getAvail(wc, cursor, wcSchedule);
      cursor.setHours(prevAvail > 0 ? prevAvail : 16, 0, 0, 0);
      continue;
    }

    const dayStart = new Date(cursor); dayStart.setHours(0, 0, 0, 0);
    const dayAvailEnd = new Date(dayStart); dayAvailEnd.setHours(avail, 0, 0, 0);

    // Górna granica okna = min(cursor, koniec zmiany)
    const windowTop = cursor < dayAvailEnd ? new Date(cursor) : new Date(dayAvailEnd);

    // Znajdź wolne okno: cofaj windowTop za każdy nakładający się slot
    const slots = occ[wc] || [];
    let windowEnd = new Date(windowTop);

    // Przeszukuj sloty od końca (posortowane rosnąco po from)
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = slots.length - 1; i >= 0; i--) {
        const b = slots[i];
        if (b.from >= windowEnd) continue;  // zaczyna się po oknie
        if (b.to <= dayStart) break;         // kończy się przed dniem
        // Nakłada się na [dayStart, windowEnd] — cofnij koniec okna
        if (b.from < windowEnd) {
          windowEnd = new Date(b.from);
          changed = true;
          break;
        }
      }
    }

    // Dostępna ilość godzin w tym oknie (max: avail godzin danego dnia)
    const availH = Math.min((windowEnd - dayStart) / MS, avail);
    if (availH <= EPSILON) {
      // Cały dzień zajęty — cofnij do poprzedniego
      cursor.setDate(cursor.getDate() - 1);
      const prevAvail = getAvail(wc, cursor, wcSchedule);
      cursor.setHours(prevAvail > 0 ? prevAvail : 16, 0, 0, 0);
      continue;
    }

    const take     = Math.min(remaining, availH);
    remaining     -= take;
    const segStart = new Date(windowEnd.getTime() - take * MS);
    const segEnd   = new Date(windowEnd);

    segs.unshift({ segStart, segEnd, durH: take });

    // Rejestruj slot globalnie (posortowane rosnąco po from)
    addSlotToOcc(occ, wc, segStart, segEnd);

    cursor = new Date(segStart);
  }

  return {
    startDt: segs.length ? segs[0].segStart          : new Date(endDt),
    endDt:   segs.length ? segs[segs.length-1].segEnd : new Date(endDt),
    segs,
  };
}

// ─── WORKER MESSAGE HANDLER ──────────────────────────────────────────────────
self.onmessage = function(e) {
  const { type, payload } = e.data;

  if (type === 'SCHEDULE') {
    try {
      const { zpList, routingByProduct, wcSchedule, planStart } = payload;
      const planStartDt = new Date(planStart + 'T00:00:00');

      const t0 = Date.now();

      const { fwdZP, zpStatus } = scheduleAll(
        zpList,
        routingByProduct,
        wcSchedule,
        planStartDt,
        (pct, label) => self.postMessage({ type: 'PROGRESS', payload: { pct, label } })
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