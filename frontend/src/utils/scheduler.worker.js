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

function findSlotForward(fromDt, needH, wc, wcSchedule, occ, getOccKey, getPoolAvail) {
  const occKey  = getOccKey    ? getOccKey(wc)         : wc;
  const availFn = getPoolAvail ? (dt) => getPoolAvail(wc, dt) : (dt) => getAvail(wc, dt, wcSchedule);

  let cursor    = new Date(fromDt);
  let remaining = needH;
  let safety    = 0;
  const segs    = [];

  while (remaining > EPSILON && safety++ < SAFETY_LIMIT) {
    const avail = availFn(cursor);
    if (avail === 0) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    const dayStart  = new Date(cursor); dayStart.setHours(0, 0, 0, 0);
    const midnight  = new Date(dayStart); midnight.setHours(24, 0, 0, 0);
    const dayEnd    = new Date(Math.min(dayStart.getTime() + avail * MS, midnight.getTime()));
    if (cursor >= dayEnd) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    const slots        = occ[occKey] || [];
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
    addSlotToOcc(occ, occKey, new Date(windowStart), segEnd);
    cursor = new Date(segEnd);
  }

  return {
    startDt: segs.length ? segs[0].segStart           : new Date(fromDt),
    endDt:   segs.length ? segs[segs.length-1].segEnd  : new Date(fromDt),
    segs,
  };
}

// ─── ALAP: oblicz najwcześniejszy możliwy start JIT ──────────────────────────
// Szacuje ile dni roboczych potrzeba dla ZP i cofa od due_date
function calcAlapStart(zp, ops, wcSchedule, planStartDt, safetyBufferDays = 1) {
  // Oblicz daysNeeded per operacja używając rzeczywistej capacity maszyny
  // Bierzemy typową capacity z wcSchedule (pierwszy wpis per-date lub fallback)
  function getTypicalCapH(wc) {
    const sc = wcSchedule[wc];
    if (!sc) return 16;
    if (Array.isArray(sc)) {
      // Średnia dni roboczych (pon-pt)
      const workDays = [sc[0], sc[1], sc[2], sc[3], sc[4]].filter(h => h > 0);
      return workDays.length ? workDays.reduce((s, h) => s + h, 0) / workDays.length : 16;
    }
    if (typeof sc === 'object') {
      // Weź kilka pierwszych wartości roboczych
      const vals = Object.values(sc).filter(h => h > 0).slice(0, 5);
      return vals.length ? vals.reduce((s, h) => s + h, 0) / vals.length : 16;
    }
    return 16;
  }

  // Suma dni potrzebnych per operacja (z rzeczywistą capacity maszyny)
  let totalDays = 0;
  for (const op of ops) {
    const h = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
    if (h <= 0) continue;
    const capH = getTypicalCapH(op.workcenter);
    totalDays += Math.ceil(h / capH);
  }
  if (totalDays === 0) totalDays = 1; // minimum 1 dzień bufora

  // Cofaj od due_date - safetyBuffer licząc dni robocze
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

function scheduleAll(zpList, routingByProduct, wcSchedule, planStartDt, onProgress, config, wcToWc2 = {}) {
  const VIP_BUFFER_DAYS    = config?.vipBufferDays ?? 2;
  const SAFETY_BUFFER_DAYS = config?.safetyBufferDays ?? 1;
  const MODE               = config?.schedulingMode ?? 'asap';
  const URGENCY_METHOD     = config?.urgencyMethod ?? 'cr';
  const occ    = makeOccupancy();
  const result = [];
  const zpStatus = [];

  // Buduj mapę brygad dla 3xxxx — pool capacity
  // wc2ToWcs['Maszyny'] = ['30042', '30043', ...] — tylko 3xxxx
  const wc2ToWcs = {};
  Object.entries(wcToWc2).forEach(([wc, wc2]) => {
    if (!String(wc).startsWith('3')) return;
    if (!wc2ToWcs[wc2]) wc2ToWcs[wc2] = [];
    wc2ToWcs[wc2].push(wc);
  });
  // Klucz pool dla 3xxxx: 'POOL_<wc2>'
  function getOccKey(wc) {
    if (!String(wc).startsWith('3')) return wc; // 2xxxx → osobny klucz
    const wc2 = wcToWc2[wc];
    return wc2 ? `POOL_${wc2}` : wc;
  }
  // Capacity pool = suma wcSchedule wszystkich 3xxxx w brygadzie
  function getPoolAvail(wc, dt) {
    if (!String(wc).startsWith('3')) return getAvail(wc, dt, wcSchedule);
    const wc2 = wcToWc2[wc];
    if (!wc2 || !wc2ToWcs[wc2]) return getAvail(wc, dt, wcSchedule);
    return wc2ToWcs[wc2].reduce((s, w) => s + getAvail(w, dt, wcSchedule), 0);
  }

  function totalH(zp) {
    const ops = routingByProduct[zp.product] || [];
    return ops.reduce((s, op) => {
      const h = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
      return s + h;
    }, 0);
  }

  // ATC: oblicz p_avg raz przed sortowaniem
  const allTotalH = zpList.map(zp => totalH(zp));
  const p_avg = allTotalH.reduce((s, h) => s + h, 0) / Math.max(1, allTotalH.length);
  const ATC_K = config?.atcK ?? 2.5; // parametr strojenia

  function urgency(zp) {
    const th = totalH(zp);
    const bufferMs    = (zp.priority === 1 ? VIP_BUFFER_DAYS : 0) * 24 * MS;
    const effectiveDue = new Date(zp.due_date + 'T23:59:59').getTime() - bufferMs;
    const dueMs  = effectiveDue - planStartDt.getTime();
    const totalMs = th * MS;

    if (URGENCY_METHOD === 'due_date') {
      return effectiveDue;
    }
    if (URGENCY_METHOD === 'slack') {
      return dueMs - totalMs;
    }
    if (URGENCY_METHOD === 'atc') {
      // ATC = (w/p) × exp(-max(0, d - p - t) / (k × p_avg))
      // Większa wartość = pilniejsze → negujemy dla sort rosnącego
      const w = zp.priority === 1 ? 2 : 1;
      const p = th || 0.001;
      const t = 0; // planujemy od planStart → t=0
      const slack = Math.max(0, dueMs - totalMs) / MS; // w godzinach
      const atc = (w / p) * Math.exp(-slack / (ATC_K * Math.max(p_avg, 0.001)));
      return -atc; // negacja bo sort rosnący = malejący ATC
    }
    // CR (domyślne)
    return totalMs > 0 ? dueMs / totalMs : 999;
  }

  // ── DYNAMICZNE DISPATCHING Z MINHEAP ──────────────────────────────────────
  // Zamiast sortować raz — przy każdym kroku wybierz ZP z najlepszym CR
  // uwzględniając aktualny czas (cursor per ZP)

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

  // Dynamiczne urgency — obliczane w czasie t (ms od planStart)
  function urgencyDynamic(zp, tMs) {
    const th = totalH(zp);
    const bufferMs     = (zp.priority === 1 ? VIP_BUFFER_DAYS : 0) * 24 * MS;
    const effectiveDue = new Date(zp.due_date + 'T23:59:59').getTime() - bufferMs;
    const dueMs        = effectiveDue - planStartDt.getTime();
    const totalMs      = th * MS;
    const remainMs     = dueMs - tMs; // ile czasu zostało od teraz do terminu

    if (URGENCY_METHOD === 'due_date') return effectiveDue;
    if (URGENCY_METHOD === 'slack')    return remainMs - totalMs;
    if (URGENCY_METHOD === 'atc') {
      const w     = zp.priority === 1 ? 2 : 1;
      const p     = th || 0.001;
      const slack = Math.max(0, remainMs - totalMs) / MS;
      return -(w / p) * Math.exp(-slack / (ATC_K * Math.max(p_avg, 0.001)));
    }
    // CR — dynamiczne: remainMs / totalMs (im mniejsze tym pilniejsze)
    return totalMs > 0 ? remainMs / totalMs : 999;
  }

  // Stan per ZP
  const zpState = new Map(); // zp_id → { zp, ops, opIdx, cursor, opResults }
  for (const zp of zpList) {
    const ops = (routingByProduct[zp.product] || [])
      .slice().sort((a, b) => a.sequence - b.sequence)
      .filter(op => {
        const h = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
        return h > 0;
      });
    if (!ops.length) {
      // ZP bez operacji — od razu do statusu
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
    zpState.set(zp.zp_id, {
      zp, ops, opIdx: 0,
      cursor: new Date(MODE === 'alap'
        ? calcAlapStart(zp, ops, wcSchedule, planStartDt, SAFETY_BUFFER_DAYS)
        : planStartDt),
      opResults: [],
    });
  }

  // Inicjalizuj heap — wszystkie ZP z pierwszą operacją gotową od planStart
  const heap = new MinHeap((a, b) => {
    const tA = a.cursor.getTime() - planStartDt.getTime();
    const tB = b.cursor.getTime() - planStartDt.getTime();
    // Klucz: urgency dynamiczne w momencie cursor danego ZP
    const uA = urgencyDynamic(a.zp, tA);
    const uB = urgencyDynamic(b.zp, tB);
    return uA - uB;
  });

  for (const state of zpState.values()) heap.push(state);

  const total = zpState.size;
  let done    = 0;

  while (heap.size > 0) {
    const state = heap.pop();
    const { zp, ops, opIdx, cursor } = state;

    if (onProgress && done % 50 === 0) {
      onProgress(Math.round(done / total * 100), `Planuję ${done}/${total} ZP...`);
    }

    const op   = ops[opIdx];
    const durH = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);

    const { startDt, endDt, segs } = findSlotForward(
      cursor, durH, op.workcenter, wcSchedule, occ, getOccKey, getPoolAvail
    );

    state.opResults.push({ op, startDt, endDt, segs, durH });
    state.opIdx++;
    state.cursor = new Date(endDt);

    if (state.opIdx < ops.length) {
      // Jeszcze są operacje — wróć do heap z nowym cursorem
      heap.push(state);
    } else {
      // Wszystkie operacje zaplanowane — zapisz wynik
      done++;
      const opResults = state.opResults;
      const dueDate   = new Date(zp.due_date + 'T23:59:59');
      const backStart = opResults[0].startDt;
      const realEnd   = opResults[opResults.length - 1].endDt;

      let seqCounter = 0;
      for (const { op: o, startDt: sd, endDt: ed, segs: sg, durH: dh } of opResults) {
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
      const delayDays = +(delayH / DEFAULT_AVAIL).toFixed(1);
      const toc       = tocBuffer(backStart, planStartDt, dueDate, realEnd);
      const bottleneck = opResults.reduce((b, o) => o.durH > b.durH ? o : b, opResults[0]).op.workcenter;

      zpStatus.push({
        zp_id:   zp.zp_id, zs_id: zp.zs_id || '', pozycja: zp.pozycja || '',
        klient:  zp.klient || '', product: zp.product, due_date: zp.due_date,
        priority: zp.priority, backStart, realEnd, delayH, delayDays, toc,
        bottleneck, late: delayH > 0, backDelay: 0,
      });
    }
  }

  return { fwdZP: result, zpStatus };
}

self.onmessage = function(e) {
  const { type, payload } = e.data;

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


  if (type === 'OPTIMIZE_INSERT') {
    try {
      const { wcSchedule, planStart, fwdZP, zpStatus } = payload;
      const t0 = Date.now();

      console.log('[Worker] OPTIMIZE_INSERT start, fwdZP:', fwdZP?.length, 'zpStatus:', zpStatus?.length);

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

      // Buduj occ w tym samym formacie co główny scheduler: { [wc]: [[startMs, endMs], ...] }
      function buildOcc(ops) {
        const occ = makeOccupancy();
        for (const op of ops) {
          const wc = op.workcenter;
          for (const seg of (op.segments || [])) {
            if (!seg.segStart || !seg.segEnd) continue;
            addSlotToOcc(occ, wc,
              new Date(typeof seg.segStart === 'number' ? seg.segStart : seg.segStart),
              new Date(typeof seg.segEnd   === 'number' ? seg.segEnd   : seg.segEnd)
            );
          }
        }
        return occ;
      }

      // Użyj głównej funkcji findSlotForward — identyczna logika, te same weekendy
      function findEarliestSlot(wc, fromDt, durH, occ) {
        const result = findSlotForward(fromDt, durH, wc, wcSchedule, occ, null, null);
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
      let occ        = buildOcc(workOps);
      let moved      = 0;
      const planStartDt = new Date(planStart + 'T00:00:00');

      for (let li = 0; li < lateList.length; li++) {
        const zpId = lateList[li].zp_id;

        self.postMessage({ type: 'PROGRESS', payload: {
          pct:   Math.round((li / lateList.length) * 100),
          label: `Przesuwam ${li + 1}/${lateList.length}: ZP ${zpId} (opóźnienie: ${lateList[li].delayH?.toFixed(1)}h)`
        }});

        const zpOps = workOps
          .filter(op => op.parent_zp === zpId)
          .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

        if (!zpOps.length) continue;

        // Usuń obecne occupancy tego ZP
        for (const op of zpOps) {
          const wc = op.workcenter;
          if (!occ[wc]) occ[wc] = {};
          for (const seg of (op.segments || [])) {
            const dk = localDateStr(new Date(seg.segStart));
            occ[wc][dk] = Math.max(0, (occ[wc][dk] || 0) - (seg.durH || 0));
          }
        }

        // Planuj operacje ZP od planStart sekwencyjnie
        let cursor = new Date(planStartDt);
        let ok = true;
        const newSlots = [];

        for (const op of zpOps) {
          const slot = findEarliestSlot(op.workcenter, cursor, op.durH, occ);
          if (!slot) { ok = false; break; }
          newSlots.push({ op, slot });
          cursor = slot.end;
        }

        const oldStatus = workStatus.find(z => z.zp_id === zpId);
        const newRealEnd = ok ? newSlots[newSlots.length - 1].slot.end : null;
        const oldRealEnd = oldStatus ? new Date(oldStatus.realEnd) : null;

        if (!ok || (oldRealEnd && newRealEnd >= oldRealEnd)) {
          // Nie poprawia — przywróć occupancy
          for (const op of zpOps) {
            const wc = op.workcenter;
            for (const seg of (op.segments || [])) {
              const dk = localDateStr(new Date(seg.segStart));
              if (!occ[wc]) occ[wc] = {};
              occ[wc][dk] = (occ[wc][dk] || 0) + (seg.durH || 0);
            }
          }
          continue;
        }

        // Zaakceptuj — zaktualizuj workOps
        for (const { op, slot } of newSlots) {
          const wc = op.workcenter;
          const idx = workOps.findIndex(o => o.zp_id === op.zp_id);
          if (idx >= 0) {
            workOps[idx] = { ...workOps[idx], start_dt: slot.start, end_dt: slot.end, segments: slot.segs, realEnd: newRealEnd };
          }
          for (const seg of slot.segs) {
            const dk = localDateStr(new Date(seg.segStart));
            if (!occ[wc]) occ[wc] = {};
            occ[wc][dk] = (occ[wc][dk] || 0) + (seg.durH || 0);
          }
        }

        // Zaktualizuj zpStatus
        if (oldStatus) {
          const dueMs   = new Date(oldStatus.due_date + 'T23:59:59').getTime();
          const delayH  = Math.max(0, newRealEnd.getTime() - dueMs) / MS;
          const statusIdx = workStatus.findIndex(z => z.zp_id === zpId);
          if (statusIdx >= 0) {
            workStatus[statusIdx] = { ...workStatus[statusIdx], realEnd: newRealEnd, delayH, delayDays: +(delayH / 16).toFixed(1), late: delayH > 0 };
          }
        }
        moved++;
      }

      const lateEnd = workStatus.filter(z => z.late).length;
      self.postMessage({ type: 'DONE', payload: {
        fwdZP: workOps, zpStatus: workStatus, elapsed: Date.now() - t0,
        optimizeStats: { lateStart, lateEnd, moved }
      }});

    } catch (err) {
      self.postMessage({ type: 'ERROR', payload: { message: err.message, stack: err.stack } });
    }
  }
};