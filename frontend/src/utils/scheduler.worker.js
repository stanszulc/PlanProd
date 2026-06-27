// ─── scheduler.worker.js ──────────────────────────────────────────────────────
const MS            = 3_600_000;
const DEFAULT_AVAIL = 16;
const EPSILON       = 0.0001;
const SAFETY_LIMIT  = 50_000;
const TOC_YELLOW    = 0.33;
const TOC_RED       = 0.67;

function localDateStr(dt) {
  const d = new Date(dt);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getAvail(wc, dt, wcSchedule) {
  const d         = new Date(dt);
  const jsDay     = d.getDay();
  const isWeekend = jsDay === 0 || jsDay === 6;
  const sched     = wcSchedule?.[wc];
  if (!sched) return isWeekend ? 0 : DEFAULT_AVAIL;
  if (!Array.isArray(sched) && typeof sched === 'object') {
    const dk = localDateStr(d);
    if (sched[dk] !== undefined) return sched[dk];
    return isWeekend ? 0 : DEFAULT_AVAIL;
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

function makeOccupancy() { return Object.create(null); }

function addSlotToOcc(occ, wc, from, to) {
  if (!occ[wc]) occ[wc] = [];
  const slots = occ[wc];
  let lo = 0, hi = slots.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slots[mid].from < from) lo = mid + 1; else hi = mid;
  }
  slots.splice(lo, 0, { from: new Date(from), to: new Date(to) });
}

function lowerBound(slots, t) {
  let lo = 0, hi = slots.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slots[mid].from < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function advancePastSlots(slots, windowStart) {
  let t = windowStart;
  let i = lowerBound(slots, t);
  if (i > 0) i--;
  while (i < slots.length) {
    const b = slots[i];
    if (b.from > t) break;
    if (b.to > t) t = b.to;
    i++;
  }
  return t;
}

function nextSlotAfter(slots, windowStart) {
  const i = lowerBound(slots, windowStart);
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
    const dayStart  = new Date(cursor); dayStart.setHours(0, 0, 0, 0);
    const safeAvail = Math.min(avail, 24);
    const dayEnd    = new Date(dayStart); dayEnd.setHours(safeAvail, 0, 0, 0);
    if (cursor >= dayEnd) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    const slots        = occ[wc] || [];
    const windowStartT = advancePastSlots(slots, cursor.getTime());
    const windowStart  = new Date(Math.max(windowStartT, cursor.getTime()));
    if (windowStart >= dayEnd) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    const nextFrom  = nextSlotAfter(slots, windowStart.getTime());
    const windowEnd = nextFrom !== null
      ? new Date(Math.min(nextFrom, dayEnd.getTime()))
      : new Date(dayEnd);
    const availH = (windowEnd - windowStart) / MS;
    if (availH <= EPSILON) { cursor = new Date(windowEnd); continue; }
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

// ─── ALAP: oblicz najwcześniejszy możliwy start JIT ──────────────────────────
// Szacuje ile dni roboczych potrzeba dla ZP i cofa od due_date
function calcAlapStart(zp, ops, wcSchedule, planStartDt) {
  // Suma godzin wszystkich operacji
  const totalH = ops.reduce((s, op) => {
    const h = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
    return s + h;
  }, 0);
  if (totalH <= 0) return new Date(planStartDt);

  // Cofaj od due_date licząc dostępne godziny
  // Używamy najwąższego gniazda (bottleneck) jako proxy — uproszczenie
  // Szacuj: totalH / avg_daily_avail dni wstecz
  const avgAvail = 16; // uproszczenie — 2 zmiany
  const daysNeeded = Math.ceil(totalH / avgAvail);

  const dueDate = new Date(zp.due_date + 'T00:00:00');
  let cursor = new Date(dueDate);
  let workDays = 0;

  // Cofaj liczac dni robocze
  while (workDays < daysNeeded) {
    cursor.setDate(cursor.getDate() - 1);
    const jsDay = cursor.getDay();
    if (jsDay !== 0 && jsDay !== 6) workDays++;
  }

  // Nie wcześniej niż planStart
  if (cursor < planStartDt) return new Date(planStartDt);
  return cursor;
}

function scheduleAll(zpList, routingByProduct, wcSchedule, planStartDt, onProgress, config) {
  const VIP_BUFFER_DAYS = config?.vipBufferDays ?? 2;
  const MODE            = config?.schedulingMode ?? 'asap'; // 'asap' | 'alap'
  const occ    = makeOccupancy();
  const result = [];
  const zpStatus = [];

  function urgency(zp) {
    const ops = routingByProduct[zp.product] || [];
    const totalH = ops.reduce((s, op) => {
      const h = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
      return s + h;
    }, 0);
    const bufferMs    = (zp.priority === 1 ? VIP_BUFFER_DAYS : 0) * 24 * MS;
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
      .sort((a, b) => a.sequence - b.sequence);

    if (!ops.length) continue;
    if (onProgress && zi % 50 === 0) {
      onProgress(Math.round(zi / total * 100), `Planuję ${zi}/${total} ZP...`);
    }

    const dueDate = new Date(zp.due_date + 'T23:59:59');

    // ALAP: oblicz JIT start
    let startCursor;
    if (MODE === 'alap') {
      startCursor = calcAlapStart(zp, ops, wcSchedule, planStartDt);
    } else {
      startCursor = new Date(planStartDt);
    }

    let cursor = new Date(startCursor);
    const opResults = [];

    for (const op of ops) {
      const durH = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
      if (durH <= 0) continue;

      const { startDt, endDt, segs } = findSlotForward(
        cursor, durH, op.workcenter, wcSchedule, occ
      );

      opResults.push({ op, startDt, endDt, segs, durH });
      cursor = new Date(endDt);
    }

    const backStart = opResults.length ? opResults[0].startDt    : new Date(planStartDt);
    const realEnd   = opResults.length ? opResults[opResults.length-1].endDt : new Date(planStartDt);

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

self.onmessage = function(e) {
  const { type, payload } = e.data;
  if (type === 'SCHEDULE') {
    try {
      const { zpList, routingByProduct, wcSchedule, planStart, config } = payload;
      const planStartDt = new Date(planStart + 'T00:00:00');
      const t0 = Date.now();
      const { fwdZP, zpStatus } = scheduleAll(
        zpList, routingByProduct, wcSchedule, planStartDt,
        (pct, label) => self.postMessage({ type: 'PROGRESS', payload: { pct, label } }),
        config
      );
      self.postMessage({ type: 'DONE', payload: { fwdZP, zpStatus, elapsed: Date.now() - t0 } });
    } catch (err) {
      self.postMessage({ type: 'ERROR', payload: { message: err.message, stack: err.stack } });
    }
  }
};