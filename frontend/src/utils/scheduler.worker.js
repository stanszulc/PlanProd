// ─── scheduler.worker.js ─────────────────────────────────────────────────────
// Sesja 9: pool capacity fix (3xxxx)
//   - findSlotForward: nowy parametr poolUsed, logika pool vs maszyna rozdzielona
//   - makePoolUsed / addPoolUsed / getPoolUsedToday — osobny licznik dla 3xxxx
//   - scheduleAll: przekazuje poolUsed
//   - OPTIMIZE_INSERT: buildOcc ujednolicony, wcToWc2 przekazywane z App.jsx
// ─────────────────────────────────────────────────────────────────────────────

const MS            = 3_600_000;
const DEFAULT_AVAIL = 16;
const DEFAULT_CAP   = 8;         // h/dzień fallback capacity — używane do przeliczania delayH -> delayDays
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

// ─── Occupancy (maszyny 2xxxx) ────────────────────────────────────────────────
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

// ─── Pool used (kanały / montaż 3xxxx) ───────────────────────────────────────
// Zamiast blokować przedział czasowy, liczymy zużyte godziny per dzień.
// Wiele ZP może wchodzić w ten sam dzień dopóki usedH < avail.
function makePoolUsed() { return Object.create(null); }  // occKey → {dateStr → usedH}

function addPoolUsed(poolUsed, occKey, dateStr, durH) {
  if (!poolUsed[occKey]) poolUsed[occKey] = Object.create(null);
  poolUsed[occKey][dateStr] = (poolUsed[occKey][dateStr] || 0) + durH;
}

function getPoolUsedToday(poolUsed, occKey, dateStr) {
  return poolUsed?.[occKey]?.[dateStr] || 0;
}

// ─── findSlotForward ──────────────────────────────────────────────────────────
// poolUsed: Object z makePoolUsed() — tylko dla 3xxxx (isPool)
// Maszyny 2xxxx: oryginalna logika slot-based (occ [{from,to}])
// Pool   3xxxx: nowa logika capacity-based (poolUsed {dateStr→usedH})
function findSlotForward(fromDt, needH, wc, wcSchedule, occ, getOccKey, getPoolAvail, poolUsed, shiftStart = 0) {
  const occKey  = getOccKey    ? getOccKey(wc)         : wc;
  const isPool  = occKey !== wc;                        // 3xxxx: POOL_<wc2> ≠ wc
  const availFn = getPoolAvail ? (dt) => getPoolAvail(wc, dt) : (dt) => getAvail(wc, dt, wcSchedule);

  let cursor    = new Date(fromDt);
  let remaining = needH;
  let safety    = 0;
  const segs    = [];

  while (remaining > EPSILON && safety++ < SAFETY_LIMIT) {
    const avail = availFn(cursor);
    if (avail === 0) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(shiftStart, 0, 0, 0);
      continue;
    }

    const dayStart = new Date(cursor); dayStart.setHours(shiftStart, 0, 0, 0);
    // Jeśli cursor jest przed startem zmiany (np. planStart=00:00, shift=06:00), przesuń na start
    if (cursor.getTime() < dayStart.getTime()) cursor = new Date(dayStart);
    const dateStr  = localDateStr(dayStart);
    const midnight = new Date(dayStart); midnight.setHours(24, 0, 0, 0);

    // ── POOL (3xxxx): capacity dzienna = suma maszyn, współdzielona przez wiele ZP ──
    if (isPool) {
      const usedToday = getPoolUsedToday(poolUsed, occKey, dateStr);
      const freeToday = avail - usedToday;

      if (freeToday <= EPSILON) {
        // Dzień pełny — następny
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(shiftStart, 0, 0, 0);
        continue;
      }

      const take   = Math.min(remaining, freeToday);
      remaining   -= take;

      // Slot czasowy: od cursor (lub początku dnia) przez take*MS, max do midnight
      const segStart = new Date(Math.max(cursor.getTime(), dayStart.getTime()));
      const segEnd   = new Date(Math.min(segStart.getTime() + take * MS, midnight.getTime()));

      segs.push({ segStart: new Date(segStart), segEnd: new Date(segEnd), durH: take });
      addPoolUsed(poolUsed, occKey, dateStr, take);
      // Pool NIE dodaje do occ (brak bloków czasowych per-segment — zasoby wymienne)
      cursor = new Date(segEnd);

      if (cursor >= midnight) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(shiftStart, 0, 0, 0);
      }
      continue;
    }

    // ── MASZYNA (2xxxx): slot-based, max 24h/dobę ────────────────────────────
    const dayCapH = Math.min(avail, 24);                // hard cap: 1 maszyna max 24h
    const dayEnd  = new Date(Math.min(dayStart.getTime() + dayCapH * MS, midnight.getTime()));

    if (cursor >= dayEnd) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(shiftStart, 0, 0, 0);
      continue;
    }
    const slots        = occ[occKey] || [];
    const windowStartT = advancePastSlots(slots, cursor.getTime());
    const windowStart  = new Date(Math.max(windowStartT, cursor.getTime()));
    if (windowStart >= dayEnd) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(shiftStart, 0, 0, 0);
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
    addSlotToOcc(occ, occKey, new Date(windowStart), segEnd);
    cursor = new Date(segEnd);
  }

  return {
    startDt: segs.length ? segs[0].segStart           : new Date(fromDt),
    endDt:   segs.length ? segs[segs.length-1].segEnd  : new Date(fromDt),
    segs,
  };
}

// ─── ALAP: szacowany najpóźniejszy start (bez occupancy) ─────────────────────
function calcAlapStart(zp, ops, wcSchedule, planStartDt, safetyBufferDays = 1) {
  function getTypicalCapH(wc) {
    const sc = wcSchedule[wc];
    if (!sc) return 16;
    if (Array.isArray(sc)) {
      const workDays = [sc[0], sc[1], sc[2], sc[3], sc[4]].filter(h => h > 0);
      return workDays.length ? workDays.reduce((s, h) => s + h, 0) / workDays.length : 16;
    }
    if (typeof sc === 'object') {
      const vals = Object.values(sc).filter(h => h > 0).slice(0, 5);
      return vals.length ? vals.reduce((s, h) => s + h, 0) / vals.length : 16;
    }
    return 16;
  }

  let totalDays = 0;
  for (const op of ops) {
    const h = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
    if (h <= 0) continue;
    const capH = getTypicalCapH(op.workcenter);
    totalDays += Math.ceil(h / capH);
  }
  if (totalDays === 0) totalDays = 1;

  const dueDate = new Date(zp.due_date + 'T00:00:00');
  dueDate.setDate(dueDate.getDate() - safetyBufferDays);

  let cursor   = new Date(dueDate);
  let workDays = 0;
  while (workDays < totalDays) {
    cursor.setDate(cursor.getDate() - 1);
    const jsDay = cursor.getDay();
    if (jsDay !== 0 && jsDay !== 6) workDays++;
  }

  if (cursor < planStartDt) return new Date(planStartDt);
  return cursor;
}

// ─── scheduleAll ──────────────────────────────────────────────────────────────
function scheduleAll(zpList, routingByProduct, wcSchedule, planStartDt, onProgress, config, wcToWc2 = {}) {
  const VIP_BUFFER_DAYS    = config?.vipBufferDays ?? 2;
  const SAFETY_BUFFER_DAYS = config?.safetyBufferDays ?? 1;
  const MODE               = config?.schedulingMode ?? 'asap';
  const URGENCY_METHOD     = config?.urgencyMethod ?? 'cr';
  const SHIFT_START        = config?.shiftStart ?? 6;
  const GRAPH_MODE         = (config?.schedulingGraphMode ?? 'graph') === 'graph';
  const occ      = makeOccupancy();
  const poolUsed = makePoolUsed();                      // sesja 9: pool capacity
  const result   = [];
  const zpStatus = [];

  // Mapa brygad: wc2 → [wc, ...] (tylko 3xxxx)
  const wc2ToWcs = {};
  Object.entries(wcToWc2).forEach(([wc, wc2]) => {
    if (!String(wc).startsWith('3')) return;
    if (!wc2ToWcs[wc2]) wc2ToWcs[wc2] = [];
    wc2ToWcs[wc2].push(wc);
  });

  function getOccKey(wc) {
    if (!String(wc).startsWith('3')) return wc;
    const wc2 = wcToWc2[wc];
    return wc2 ? `POOL_${wc2}` : wc;
  }

  function getPoolAvail(wc, dt) {
    if (!String(wc).startsWith('3')) return getAvail(wc, dt, wcSchedule);
    const wc2 = wcToWc2[wc];
    if (!wc2 || !wc2ToWcs[wc2]) return getAvail(wc, dt, wcSchedule);
    return wc2ToWcs[wc2].reduce((s, w) => s + getAvail(w, dt, wcSchedule), 0);
  }

  function totalH(zp) {
    const ops = routingByProduct[zp._routingKey || zp.product] || [];
    return ops.reduce((s, op) => {
      const h = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
      return s + h;
    }, 0);
  }

  // Cache per-ZP: totalH i effectiveDue są stałe przez cały przebieg scheduleAll
  // (nie zależą od cursor/tMs), a urgencyDynamic jest wywoływane w komparatorze
  // kopca — O(log n) razy na push/pop, więcej razy niż jest ZP. Bez cache totalH()
  // (pętla reduce po routingu) liczyłoby się od nowa przy każdym porównaniu.
  const zpCache = new Map();
  zpList.forEach(zp => {
    const th = totalH(zp);
    const bufferMs = (zp.priority === 1 ? VIP_BUFFER_DAYS : 0) * 24 * MS;
    const effectiveDue = new Date(zp.due_date + 'T23:59:59').getTime() - bufferMs;
    zpCache.set(zp, { th, effectiveDue });
  });

  const allTotalH = [...zpCache.values()].map(v => v.th);
  const p_avg = allTotalH.reduce((s, h) => s + h, 0) / Math.max(1, allTotalH.length);
  const ATC_K = config?.atcK ?? 2.5;

  function urgencyDynamic(zp, tMs) {
    const { th, effectiveDue } = zpCache.get(zp);
    const dueMs        = effectiveDue - planStartDt.getTime();
    const totalMs      = th * MS;
    const remainMs     = dueMs - tMs;

    if (URGENCY_METHOD === 'due_date') return effectiveDue;
    if (URGENCY_METHOD === 'slack')    return remainMs - totalMs;
    if (URGENCY_METHOD === 'atc') {
      const w     = zp.priority === 1 ? 2 : 1;
      const p     = th || 0.001;
      const slack = Math.max(0, remainMs - totalMs) / MS;
      return -(w / p) * Math.exp(-slack / (ATC_K * Math.max(p_avg, 0.001)));
    }
    return totalMs > 0 ? remainMs / totalMs : 999;
  }

  class MinHeap {
    constructor(cmp) { this.data = []; this.cmp = cmp; }
    push(v) {
      this.data.push(v);
      let i = this.data.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.cmp(this.data[i], this.data[p]) >= 0) break;
        [this.data[i], this.data[p]] = [this.data[p], this.data[i]];
        i = p;
      }
    }
    pop() {
      const top = this.data[0];
      const last = this.data.pop();
      if (this.data.length > 0) {
        this.data[0] = last;
        let i = 0;
        while (true) {
          let s = i, l = 2*i+1, r = 2*i+2;
          if (l < this.data.length && this.cmp(this.data[l], this.data[s]) < 0) s = l;
          if (r < this.data.length && this.cmp(this.data[r], this.data[s]) < 0) s = r;
          if (s === i) break;
          [this.data[i], this.data[s]] = [this.data[s], this.data[i]];
          i = s;
        }
      }
      return top;
    }
    get size() { return this.data.length; }
  }

  let done = 0;

  // Finalizacja ZP — współdzielona przez legacy i graph. Sortuje opResults po
  // starcie zamiast zakładać kolejność wstawienia: w trybie graph operacje
  // mogą kończyć się w innej kolejności niż w tablicy (gałęzie równoległe).
  function finalizeZp(zp, opResultsRaw) {
    done++;
    const sorted = [...opResultsRaw].sort((a, b) => a.startDt - b.startDt);
    const dueDate   = new Date(zp.due_date + 'T23:59:59');
    const backStart = sorted.reduce((min, o) => (o.startDt < min ? o.startDt : min), sorted[0].startDt);
    const realEnd   = sorted.reduce((max, o) => (o.endDt   > max ? o.endDt   : max), sorted[0].endDt);

    let seqCounter = 0;
    for (const { op: o, startDt: sd, endDt: ed, segs: sg, durH: dh } of sorted) {
      seqCounter++;
      result.push({
        zp_id:      `${zp.zp_id}/${String(seqCounter).padStart(3,'0')}`,
        parent_zp:  zp.zp_id,
        zs_id:      zp.zs_id   || '',
        klient:     zp.klient  || '',
        product:    zp.product,
        workcenter: o.workcenter,
        machine_id: o.machine_id || o.workcenter,
        wc_group:   o.wc_group  || '',
        operation:  o.operation || o.machine_name || '',
        sequence:   o.sequence,
        predecessors: o.predecessors || [], // z routingu — konsumenci (FlowMatrixTab, Sankey) mogą budować graf zamiast zgadywać po sequence
        _opUid:     o._opUid,
        volume:     zp.volume,
        durH:       dh,
        start_dt:   sd,
        end_dt:     ed,
        segments:   sg,
        due_date:   zp.due_date,
        priority:   zp.priority,
        realEnd,
      });
    }

    const delayMs   = Math.max(0, realEnd - dueDate);
    const delayH    = delayMs / MS;
    const delayDays = +(delayH / DEFAULT_CAP).toFixed(1);
    const toc       = tocBuffer(backStart, planStartDt, dueDate, realEnd);
    const bottleneck = sorted.reduce((b, o) => (o.durH > b.durH ? o : b), sorted[0]).op.workcenter;

    zpStatus.push({
      zp_id:   zp.zp_id, zs_id: zp.zs_id || '', pozycja: zp.pozycja || '',
      klient:  zp.klient || '', product: zp.product, due_date: zp.due_date,
      priority: zp.priority, backStart, realEnd, delayH, delayDays, toc,
      bottleneck, late: delayH > 0, backDelay: 0,
    });
  }

  // Operacje per ZP (>0h); ZP bez żadnej operacji dostają status od razu.
  const zpsWithOps = [];
  for (const zp of zpList) {
    const ops = (routingByProduct[zp._routingKey || zp.product] || [])
      .slice().sort((a, b) => a.sequence - b.sequence)
      .filter(op => {
        // W trybie graph operacje o zerowym czasie NIE są odrzucane, nawet jeśli same
        // nie mają realnej pracy — inna operacja może wskazywać na nie w predecessors
        // (np. maszyna równoległa z zerowym czasem). Odrzucenie ich tu zrywałoby graf
        // zależności: doneEnds[jej _opUid] nigdy by nie powstało, więc każdy, kto na nią
        // czeka, blokowałby się na zawsze — a wraz z nim całe ZP znikałoby z wyniku bez
        // żadnego błędu. findSlotForward bezpiecznie obsługuje durH=0 (zwraca od razu,
        // zero-długościowy segment), więc trzymanie ich w grafie nic nie kosztuje.
        if (GRAPH_MODE) return true;
        const h = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
        return h > 0;
      });
    if (!ops.length) {
      const dueDate = new Date(zp.due_date + 'T23:59:59');
      zpStatus.push({
        zp_id: zp.zp_id, zs_id: zp.zs_id || '', pozycja: zp.pozycja || '',
        klient: zp.klient || '', product: zp.product, due_date: zp.due_date,
        priority: zp.priority, backStart: new Date(planStartDt),
        realEnd: new Date(planStartDt), delayH: 0, delayDays: 0,
        toc: tocBuffer(planStartDt, planStartDt, dueDate, planStartDt),
        bottleneck: null, late: false, backDelay: 0,
      });
      continue;
    }
    zpsWithOps.push({ zp, ops });
  }

  const heap = new MinHeap((a, b) => {
    const tA = a.cursor.getTime() - planStartDt.getTime();
    const tB = b.cursor.getTime() - planStartDt.getTime();
    return urgencyDynamic(a.zp, tA) - urgencyDynamic(b.zp, tB);
  });

  const total = zpsWithOps.length;

  if (!GRAPH_MODE) {
    // ─── LEGACY: jeden kursor na ZP, operacje jedna-po-jednej wg kolejności w tablicy ───
    for (const { zp, ops } of zpsWithOps) {
      heap.push({
        zp, ops, opIdx: 0,
        cursor: new Date(MODE === 'alap'
          ? calcAlapStart(zp, ops, wcSchedule, planStartDt, SAFETY_BUFFER_DAYS)
          : planStartDt),
        opResults: [],
      });
    }

    while (heap.size > 0) {
      const state = heap.pop();
      const { zp, ops, opIdx, cursor } = state;

      if (onProgress && done % 50 === 0) {
        onProgress(Math.round(done / total * 100), `Planuję ${done}/${total} ZP...`);
      }

      const op   = ops[opIdx];
      const durH = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);

      const { startDt, endDt, segs } = findSlotForward(
        cursor, durH, op.workcenter, wcSchedule, occ, getOccKey, getPoolAvail, poolUsed, SHIFT_START
      );

      state.opResults.push({ op, startDt, endDt, segs, durH });
      state.opIdx++;
      state.cursor = new Date(endDt);

      if (state.opIdx < ops.length) {
        heap.push(state);
      } else {
        finalizeZp(zp, state.opResults);
      }
    }

    return { fwdZP: result, zpStatus };
  }

  // ─── GRAPH: wiele jednocześnie "gotowych" operacji na ZP, honoruje predecessors ───
  // Klucz zależności to op._opUid (jeśli applyParallelPredecessors go nadał) albo
  // op.sequence jako fallback dla naiwnego łańcucha z parseZPFromERP — oba warianty
  // są spójne wewnątrz jednego ZP, bo predecessors budowane są w tej samej przestrzeni kluczy.
  for (const { zp, ops } of zpsWithOps) {
    const initialCursor = new Date(MODE === 'alap'
      ? calcAlapStart(zp, ops, wcSchedule, planStartDt, SAFETY_BUFFER_DAYS)
      : planStartDt);

    const zpCtx = { zp, ops, doneEnds: {}, dispatched: new Set(), remaining: ops.length, opResults: [] };

    ops.forEach(op => {
      if (!op.predecessors || op.predecessors.length === 0) {
        zpCtx.dispatched.add(op._opUid ?? op.sequence);
        heap.push({ zpCtx, zp: zpCtx.zp, op, cursor: initialCursor });
      }
    });
  }

  while (heap.size > 0) {
    const entry = heap.pop();
    const { zpCtx, op, cursor } = entry;
    const { zp, ops } = zpCtx;

    if (onProgress && done % 50 === 0) {
      onProgress(Math.round(done / total * 100), `Planuję ${done}/${total} ZP...`);
    }

    const durH = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
    const { startDt, endDt, segs } = findSlotForward(
      cursor, durH, op.workcenter, wcSchedule, occ, getOccKey, getPoolAvail, poolUsed, SHIFT_START
    );

    zpCtx.opResults.push({ op, startDt, endDt, segs, durH });
    const opKey = op._opUid ?? op.sequence;
    zpCtx.doneEnds[opKey] = endDt;
    zpCtx.remaining--;

    // Odblokuj operacje, których WSZYSCY predecessors są już zakończeni (fan-in).
    for (const candidate of ops) {
      const candKey = candidate._opUid ?? candidate.sequence;
      if (zpCtx.dispatched.has(candKey)) continue;
      const preds = candidate.predecessors || [];
      if (preds.length === 0) continue; // już obsłużona przy seedowaniu
      if (preds.every(p => zpCtx.doneEnds[p] !== undefined)) {
        const joinCursor = preds.reduce(
          (max, p) => (zpCtx.doneEnds[p] > max ? zpCtx.doneEnds[p] : max),
          zpCtx.doneEnds[preds[0]]
        );
        zpCtx.dispatched.add(candKey);
        heap.push({ zpCtx, zp: zpCtx.zp, op: candidate, cursor: new Date(joinCursor) });
      }
    }

    if (zpCtx.remaining === 0) {
      finalizeZp(zp, zpCtx.opResults);
    }
  }

  return { fwdZP: result, zpStatus };
}

// ─── Worker message handler ───────────────────────────────────────────────────
self.onmessage = function(e) {
  const { type, payload } = e.data;

  // ── SCHEDULE ───────────────────────────────────────────────────────────────
  if (type === 'SCHEDULE') {
    try {
      const { zpList, routingByProduct, wcSchedule, planStart, config, wcToWc2 } = payload;
      const planStartDt = new Date(planStart + 'T00:00:00');
      const t0 = Date.now();
      const { fwdZP, zpStatus } = scheduleAll(
        zpList, routingByProduct, wcSchedule, planStartDt,
        (pct, label) => self.postMessage({ type: 'PROGRESS', payload: { pct, label } }),
        config, wcToWc2 || {}
      );
      self.postMessage({ type: 'DONE', payload: { fwdZP, zpStatus, elapsed: Date.now() - t0 } });
    } catch (err) {
      self.postMessage({ type: 'ERROR', payload: { message: err.message, stack: err.stack } });
    }
  }

  // ── OPTIMIZE_INSERT ────────────────────────────────────────────────────────
  if (type === 'OPTIMIZE_INSERT') {
    try {
      const { wcSchedule, planStart, fwdZP, zpStatus, wcToWc2: wcToWc2Payload, config } = payload;
      const t0 = Date.now();

      console.log('[Worker] OPTIMIZE_INSERT start, fwdZP:', fwdZP?.length, 'zpStatus:', zpStatus?.length);

      // Lokalne mapy brygad dla OPTIMIZE_INSERT
      const wcToWc2Local = wcToWc2Payload || {};
      const wc2ToWcsLocal = {};
      Object.entries(wcToWc2Local).forEach(([wc, wc2]) => {
        if (!String(wc).startsWith('3')) return;
        if (!wc2ToWcsLocal[wc2]) wc2ToWcsLocal[wc2] = [];
        wc2ToWcsLocal[wc2].push(wc);
      });

      // getOccKey / getPoolAvail lokalne (mirror scheduleAll)
      function localGetOccKey(wc) {
        if (!String(wc).startsWith('3')) return String(wc);
        const wc2 = wcToWc2Local[wc];
        return wc2 ? `POOL_${wc2}` : String(wc);
      }
      function localGetPoolAvail(wc, dt) {
        if (!String(wc).startsWith('3')) return getAvail(wc, dt, wcSchedule);
        const wc2 = wcToWc2Local[wc];
        if (!wc2 || !wc2ToWcsLocal[wc2]) return getAvail(wc, dt, wcSchedule);
        return wc2ToWcsLocal[wc2].reduce((s, m) => s + getAvail(m, dt, wcSchedule), 0);
      }

      const lateList = zpStatus
        .filter(z => z.late)
        .sort((a, b) => (b.delayH || 0) - (a.delayH || 0));

      console.log('[Worker] lateList:', lateList.length);

      if (!lateList.length) {
        console.log('[Worker] No late ZPs, skipping');
        self.postMessage({ type: 'DONE', payload: {
          fwdZP, zpStatus, elapsed: Date.now() - t0,
          optimizeStats: { lateStart: 0, lateEnd: 0, moved: 0, skipped: true }
        }});
        return;
      }

      const lateStart = lateList.length;

      // buildOcc — ujednolicony format: {from,to} dla maszyn, poolUsed dla 3xxxx
      function buildOcc(ops) {
        const occ      = makeOccupancy();
        const poolUsed = makePoolUsed();
        for (const op of ops) {
          const wc     = String(op.workcenter);
          const isPool = wc.startsWith('3');
          for (const seg of (op.segments || [])) {
            if (!seg.segStart || !seg.segEnd) continue;
            const segStart = new Date(typeof seg.segStart === 'number' ? seg.segStart : seg.segStart);
            const segEnd   = new Date(typeof seg.segEnd   === 'number' ? seg.segEnd   : seg.segEnd);
            if (isPool) {
              const occKey  = localGetOccKey(wc);
              const dateStr = localDateStr(segStart);
              addPoolUsed(poolUsed, occKey, dateStr, seg.durH || 0);
            } else {
              addSlotToOcc(occ, wc, segStart, segEnd);
            }
          }
        }
        return { occ, poolUsed };
      }

      function findEarliestSlot(wc, fromDt, durH, occ, poolUsed) {
        const result = findSlotForward(
          fromDt, durH, wc, wcSchedule, occ,
          localGetOccKey,
          localGetPoolAvail,
          poolUsed,
          config?.shiftStart ?? 6
        );
        if (!result.segs.length) return null;
        return {
          start: result.startDt,
          end:   result.endDt,
          segs:  result.segs.map(s => ({
            segStart: s.segStart instanceof Date ? s.segStart.getTime() : s.segStart,
            segEnd:   s.segEnd   instanceof Date ? s.segEnd.getTime()   : s.segEnd,
            durH:     s.durH,
          })),
        };
      }

      let workOps    = fwdZP.map(op => ({ ...op, segments: op.segments ? [...op.segments] : [] }));
      let workStatus = zpStatus.map(z => ({ ...z }));
      let { occ, poolUsed } = buildOcc(workOps);
      let moved      = 0;
      let iterations = 0;
      const MAX_ITER = 20;
      const planStartDt = new Date(planStart + 'T00:00:00');

      let improved = true;
      while (improved && iterations < MAX_ITER) {
        improved = false;
        iterations++;

        // Odśwież lateList na podstawie aktualnego workStatus — kolejność może się zmieniać
        const currentLate = workStatus
          .filter(z => z.late)
          .sort((a, b) => (b.delayH || 0) - (a.delayH || 0));

        if (!currentLate.length) break;

      for (let li = 0; li < currentLate.length; li++) {
        const zpId = currentLate[li].zp_id;

        self.postMessage({ type: 'PROGRESS', payload: {
          pct:   Math.round((li / currentLate.length) * 100),
          label: `Iter ${iterations}: przesuwam ${li + 1}/${currentLate.length} ZP (opóźnienie: ${currentLate[li].delayH?.toFixed(1)}h)`
        }});

        const zpOps = workOps
          .filter(op => op.parent_zp === zpId)
          .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

        if (!zpOps.length) continue;

        // Usuń occupancy tego ZP
        for (const op of zpOps) {
          const wc     = String(op.workcenter);
          const isPool = wc.startsWith('3');
          for (const seg of (op.segments || [])) {
            if (!seg.segStart) continue;
            if (isPool) {
              const occKey  = localGetOccKey(wc);
              const segStart = new Date(typeof seg.segStart === 'number' ? seg.segStart : seg.segStart);
              const dateStr  = localDateStr(segStart);
              if (poolUsed[occKey]) {
                poolUsed[occKey][dateStr] = Math.max(0, (poolUsed[occKey][dateStr] || 0) - (seg.durH || 0));
              }
            } else {
              // Maszyny: usuń slot z occ
              const slots = occ[wc];
              if (slots) {
                const segStart = new Date(typeof seg.segStart === 'number' ? seg.segStart : seg.segStart);
                const segEnd   = new Date(typeof seg.segEnd   === 'number' ? seg.segEnd   : seg.segEnd);
                const idx = slots.findIndex(s =>
                  Math.abs(s.from.getTime() - segStart.getTime()) < 1000 &&
                  Math.abs(s.to.getTime()   - segEnd.getTime())   < 1000
                );
                if (idx >= 0) slots.splice(idx, 1);
              }
            }
          }
        }

        // Planuj operacje ZP od planStart sekwencyjnie
        let cursor = new Date(planStartDt);
        let ok = true;
        const newSlots = [];

        for (const op of zpOps) {
          const slot = findEarliestSlot(op.workcenter, cursor, op.durH, occ, poolUsed);
          if (!slot) { ok = false; break; }
          newSlots.push({ op, slot });
          cursor = slot.end;
        }

        const oldStatus  = workStatus.find(z => z.zp_id === zpId);
        const newRealEnd = ok ? newSlots[newSlots.length - 1].slot.end : null;
        const oldRealEnd = oldStatus ? new Date(oldStatus.realEnd) : null;

        if (!ok || (oldRealEnd && newRealEnd >= oldRealEnd)) {
          // Nie poprawia — przywróć occupancy
          for (const op of zpOps) {
            const wc     = String(op.workcenter);
            const isPool = wc.startsWith('3');
            for (const seg of (op.segments || [])) {
              if (!seg.segStart) continue;
              if (isPool) {
                const occKey   = localGetOccKey(wc);
                const segStart = new Date(typeof seg.segStart === 'number' ? seg.segStart : seg.segStart);
                const dateStr  = localDateStr(segStart);
                addPoolUsed(poolUsed, occKey, dateStr, seg.durH || 0);
              } else {
                const segStart = new Date(typeof seg.segStart === 'number' ? seg.segStart : seg.segStart);
                const segEnd   = new Date(typeof seg.segEnd   === 'number' ? seg.segEnd   : seg.segEnd);
                addSlotToOcc(occ, wc, segStart, segEnd);
              }
            }
          }
          continue;
        }

        // Zaakceptuj — zaktualizuj workOps i occupancy
        for (const { op, slot } of newSlots) {
          const wc     = String(op.workcenter);
          const isPool = wc.startsWith('3');
          const idx    = workOps.findIndex(o => o.zp_id === op.zp_id);
          if (idx >= 0) {
            workOps[idx] = { ...workOps[idx], start_dt: slot.start, end_dt: slot.end, segments: slot.segs, realEnd: newRealEnd };
          }
          for (const seg of slot.segs) {
            if (isPool) {
              const occKey   = localGetOccKey(wc);
              const segStart = new Date(typeof seg.segStart === 'number' ? seg.segStart : seg.segStart);
              const dateStr  = localDateStr(segStart);
              addPoolUsed(poolUsed, occKey, dateStr, seg.durH || 0);
            } else {
              const segStart = new Date(typeof seg.segStart === 'number' ? seg.segStart : seg.segStart);
              const segEnd   = new Date(typeof seg.segEnd   === 'number' ? seg.segEnd   : seg.segEnd);
              addSlotToOcc(occ, wc, segStart, segEnd);
            }
          }
        }

        // Zaktualizuj zpStatus
        if (oldStatus) {
          const dueMs     = new Date(oldStatus.due_date + 'T23:59:59').getTime();
          const delayH    = Math.max(0, newRealEnd.getTime() - dueMs) / MS;
          const statusIdx = workStatus.findIndex(z => z.zp_id === zpId);
          if (statusIdx >= 0) {
            workStatus[statusIdx] = {
              ...workStatus[statusIdx],
              realEnd:   newRealEnd,
              delayH,
              delayDays: +(delayH / DEFAULT_CAP).toFixed(1),
              late:      delayH > 0,
            };
          }
        }
        moved++;
        improved = true;          // przynajmniej jedno ZP poprawione — iteruj dalej
      }
      }                           // koniec while (improved)

      const lateEnd = workStatus.filter(z => z.late).length;
      self.postMessage({ type: 'DONE', payload: {
        fwdZP: workOps, zpStatus: workStatus, elapsed: Date.now() - t0,
        optimizeStats: { lateStart, lateEnd, moved, iterations }
      }});

    } catch (err) {
      self.postMessage({ type: 'ERROR', payload: { message: err.message, stack: err.stack } });
    }
  }
};

// Eksport wyłącznie do testów (Node/Vitest) — worker (self.onmessage) go nie używa,
// przeglądarka ładuje ten plik jako module worker więc nieużywany export jest nieszkodliwy.
export { scheduleAll };