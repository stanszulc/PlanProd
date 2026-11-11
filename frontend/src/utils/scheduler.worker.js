// ─── scheduler.worker.js ─────────────────────────────────────────────────────
// Sesja 9: pool capacity fix (3xxxx)
//   - findSlotForward: nowy parametr poolUsed, logika pool vs maszyna rozdzielona
//   - makePoolUsed / addPoolUsed / getPoolUsedToday — osobny licznik dla 3xxxx
//   - scheduleAll: przekazuje poolUsed
//   - OPTIMIZE_INSERT: buildOcc ujednolicony, wcToBrygada przekazywane z App.jsx
// ─────────────────────────────────────────────────────────────────────────────

import { WORK_DAY_H } from '../constants/schedule.js';

const MS               = 3_600_000;
const DEFAULT_AVAIL    = 16;
// delayH -> delayDays: dzień roboczy = WORK_DAY_H (constants/schedule.js)
const EPSILON          = 0.0001;
const SAFETY_LIMIT     = 50_000;
const TOC_YELLOW       = 0.33;
const TOC_RED          = 0.67;
const MACHINE_CEILING_H = 24;        // maszyna 2xxxx: jeden operator, fizyczny sufit kalendarzowy

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
  const windowMs = dueDate - planStart;
  if (windowMs <= 0) return { zone:'black', consumed:1, label:'PRZEKROCZONY' };
  // Zużycie okna planowania: jaka część czasu od planStart do terminu jest zajęta
  // przez plan (planStart → realEnd). Ten sam model co ratio w Buforze TOC
  // (potrzebne / dostępne). Wcześniejszy wzór używał backStart = najwcześniejszy
  // start zaplanowanej operacji (>= planStart), przez co consumed <= 0 i strefy
  // yellow/red były nieosiągalne.
  const consumed = Math.max(0, ((realEnd ?? planStart) - planStart) / windowMs);
  if (consumed < TOC_YELLOW) return { zone:'green',  consumed, label:'OK' };
  if (consumed < TOC_RED)    return { zone:'yellow', consumed, label:'UWAGA' };
  if (consumed < 1.0)        return { zone:'red',    consumed, label:'ZAGROŻONE' };
  return                            { zone:'black',  consumed, label:'SPÓŹNIONE' };
}

// ─── Occupancy (maszyny 2xxxx) ────────────────────────────────────────────────
function makeOccupancy() { return Object.create(null); }

function addSlotToOcc(occ, wc, from, to, opKey) {
  if (!occ[wc]) occ[wc] = [];
  const slots = occ[wc];
  let lo = 0, hi = slots.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slots[mid].from < from) lo = mid + 1; else hi = mid;
  }
  slots.splice(lo, 0, { from: new Date(from), to: new Date(to), opKey });
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

// ─── Pool used (kanały / montaż 3xxxx + maszyna 2xxxx w brygadzie mieszanej) ──
// Zamiast blokować przedział czasowy, liczymy zużyte godziny per dzień. Wiele ZP
// może wchodzić w ten sam dzień dopóki usedH < avail. `byWc` (per-zasób) istnieje
// TYLKO żeby dać maszynie sufit 24h/dobę WEWNĄTRZ wspólnej puli — bez tego pool
// wie tylko "ile zużyto łącznie", nie "ile zużyła KONKRETNIE ta maszyna" (patrz
// POOL_BRYGADY_2xxxx_3xxxx.md).
function makePoolUsed() { return Object.create(null); }  // occKey → {dateStr → {total, byWc}}

function addPoolUsed(poolUsed, occKey, dateStr, wc, durH) {
  if (!poolUsed[occKey]) poolUsed[occKey] = Object.create(null);
  if (!poolUsed[occKey][dateStr]) poolUsed[occKey][dateStr] = { total: 0, byWc: Object.create(null) };
  const entry = poolUsed[occKey][dateStr];
  entry.total += durH;
  entry.byWc[wc] = (entry.byWc[wc] || 0) + durH;
}

function removePoolUsed(poolUsed, occKey, dateStr, wc, durH) {
  const entry = poolUsed?.[occKey]?.[dateStr];
  if (!entry) return;
  entry.total = Math.max(0, entry.total - durH);
  entry.byWc[wc] = Math.max(0, (entry.byWc[wc] || 0) - durH);
}

function getPoolUsedToday(poolUsed, occKey, dateStr) {
  return poolUsed?.[occKey]?.[dateStr]?.total || 0;
}

function getPoolUsedForWcToday(poolUsed, occKey, dateStr, wc) {
  return poolUsed?.[occKey]?.[dateStr]?.byWc?.[wc] || 0;
}

// ─── Pool brygady (3xxxx + maszyna 2xxxx w brygadzie mieszanej) ──────────────
// Wspólna implementacja dla scheduleAll i OPTIMIZE_INSERT — dawniej dwie osobne,
// identyczne kopie (ryzyko rozjazdu przy każdej przyszłej zmianie tej logiki).
//
// Model (patrz POOL_BRYGADY_2xxxx_3xxxx.md): jedna wspólna pula godzin (RCP) na
// brygadę. Gniazda (3xxxx) nadal poolują się przez remapowanie occKey na
// `POOL_<brygada>` (bez zmian vs wcześniej). Maszyna (2xxxx) NIE zmienia occKey —
// zostaje w swojej slotowej gałęzi w findSlotForward (żeby dwie różne ZP nigdy
// nie dostały nakładających się w czasie segmentów na jednym operatorze) — ale
// w brygadzie mieszanej WIDZI i ZASILA tę samą wspólną pulę co gniazda, przez
// getPoolAvail (suma WSZYSTKICH zasobów brygady, nie tylko gniazd) i
// getSharedPoolKey (klucz do wspólnego licznika zużycia, patrz findSlotForward).
function buildBrygadaPool(wcToBrygada, wcSchedule) {
  const membersByBrygada = {};
  Object.entries(wcToBrygada).forEach(([wc, brygada]) => {
    if (!membersByBrygada[brygada]) membersByBrygada[brygada] = [];
    membersByBrygada[brygada].push(wc);
  });

  // Brygada jest "poolowalna" tylko jeśli ma choć jedno gniazdo 3xxxx — czysto-
  // maszynowe brygady (pojedyncza maszyna bez sąsiadów, np. Heager/Klinczarka)
  // zostają całkowicie bez zmian, bez wspólnej puli.
  function isPoolableBrygada(brygada) {
    const members = membersByBrygada[brygada];
    return !!members && members.some(w => String(w).startsWith('3'));
  }

  function getOccKey(wc) {
    if (!String(wc).startsWith('3')) return String(wc); // maszyna: zawsze własny slot
    const brygada = wcToBrygada[wc];
    return brygada && isPoolableBrygada(brygada) ? `POOL_${brygada}` : String(wc);
  }

  // Suma dostępności WSZYSTKICH zasobów brygady (maszyny + gniazda) — prawdziwy
  // wspólny budżet dnia. Dla brygady czysto-3xxxx to dokładnie to samo co dawniej
  // (brygadaToWcs miało tylko gniazda, bo maszyn tam po prostu nie było).
  function getPoolAvail(wc, dt) {
    const brygada = wcToBrygada[wc];
    if (!brygada || !isPoolableBrygada(brygada)) return getAvail(wc, dt, wcSchedule);
    return membersByBrygada[brygada].reduce((s, w) => s + getAvail(w, dt, wcSchedule), 0);
  }

  // Klucz wspólnego licznika zużycia dla MASZYNY w mieszanej brygadzie — gniazda
  // dostają ten sam klucz już przez getOccKey (POOL_<brygada>). null = maszyna
  // bez gniazd-sąsiadów (nic się nie zmienia, brak wspólnej puli).
  function getSharedPoolKey(wc) {
    if (String(wc).startsWith('3')) return null;
    const brygada = wcToBrygada[wc];
    return brygada && isPoolableBrygada(brygada) ? `POOL_${brygada}` : null;
  }

  return { getOccKey, getPoolAvail, getSharedPoolKey };
}

// ─── findSlotForward ──────────────────────────────────────────────────────────
// poolUsed: Object z makePoolUsed() — dla 3xxxx (isPool) ORAZ dla maszyny 2xxxx
// w brygadzie mieszanej (sharedKey, patrz niżej).
// Maszyny 2xxxx: oryginalna logika slot-based (occ [{from,to}]) — bez zmian, żeby
// dwie różne ZP nigdy nie dostały nakładających się w czasie segmentów na jednym
// operatorze. Sufit dzienny liczy się jednak ze wspólnej puli brygady, gdy istnieje.
// Pool   3xxxx: capacity-based (poolUsed {dateStr→{total,byWc}})
function findSlotForward(fromDt, needH, wc, wcSchedule, occ, getOccKey, getPoolAvail, poolUsed, shiftStart = 0, getSharedPoolKey, opKey) {
  const wcStr     = String(wc);                         // kod bywa liczbą — porównujemy jako tekst
  const occKey    = getOccKey    ? getOccKey(wc)         : wcStr;
  const isPool    = occKey !== wcStr;                   // 3xxxx: POOL_<brygada> ≠ wc
  const sharedKey = getSharedPoolKey ? getSharedPoolKey(wc) : null; // maszyna w brygadzie mieszanej
  const availFn   = getPoolAvail ? (dt) => getPoolAvail(wc, dt) : (dt) => getAvail(wc, dt, wcSchedule);

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

    // Maszyna (2xxxx): okno dnia ma długość min(dostępność, 24h). Gdy start zmiany
    // + okno wychodziłoby poza północ (np. 24h od 06:00), okno przesuwa się wcześniej
    // tak, żeby się zmieściło w dobie — inaczej sufit 24h/dobę byłby obcinany do
    // 24h − shiftStart (domyślnie 18h). Gniazda (pool) liczą godziny, nie okno.
    const machineWinH = isPool ? 0 : Math.min(avail, MACHINE_CEILING_H);
    const floorH = (!isPool && shiftStart + machineWinH > 24) ? Math.max(0, 24 - machineWinH) : shiftStart;
    const dayStart = new Date(cursor);
    dayStart.setHours(Math.floor(floorH), Math.round((floorH % 1) * 60), 0, 0);
    // Jeśli cursor jest przed początkiem okna (np. planStart=00:00, shift=06:00), przesuń na start
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
        cursor.setHours(0, 0, 0, 0);
        continue;
      }

      const take   = Math.min(remaining, freeToday);
      remaining   -= take;

      // Slot czasowy: od cursor (lub początku dnia) przez take*MS, max do midnight
      const segStart = new Date(Math.max(cursor.getTime(), dayStart.getTime()));
      const segEnd   = new Date(Math.min(segStart.getTime() + take * MS, midnight.getTime()));

      segs.push({ segStart: new Date(segStart), segEnd: new Date(segEnd), durH: take });
      addPoolUsed(poolUsed, occKey, dateStr, wc, take);
      // Pool NIE dodaje do occ (brak bloków czasowych per-segment — zasoby wymienne)
      cursor = new Date(segEnd);

      if (cursor >= midnight) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
      }
      continue;
    }

    // ── MASZYNA (2xxxx): slot-based, max 24h/dobę ────────────────────────────
    // Geometria: okno dnia = min(dostępność, 24h) od startu okna; zajęte sloty
    // blokuje `occ`. Budżet godzin (tylko w brygadzie mieszanej) = min(wolne we
    // WSPÓLNEJ puli brygady, 24h minus to co TA maszyna już dziś zużyła) i ogranicza
    // `take`, a NIE długość okna — inaczej zużycie liczyłoby się dwa razy (raz jako
    // zajęty slot w `occ`, drugi raz jako skrócone okno).
    let budgetH = Infinity;
    if (sharedKey) {
      const poolFreeToday = avail - getPoolUsedToday(poolUsed, sharedKey, dateStr);
      const selfUsedToday = getPoolUsedForWcToday(poolUsed, sharedKey, dateStr, wc);
      budgetH = Math.max(0, Math.min(poolFreeToday, MACHINE_CEILING_H - selfUsedToday));
      if (budgetH <= EPSILON) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
        continue;
      }
    }
    const dayEnd  = new Date(Math.min(dayStart.getTime() + machineWinH * MS, midnight.getTime()));

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
    const take   = Math.min(remaining, availH, budgetH);
    remaining   -= take;
    const segEnd = new Date(windowStart.getTime() + take * MS);
    segs.push({ segStart: new Date(windowStart), segEnd, durH: take });
    addSlotToOcc(occ, occKey, new Date(windowStart), segEnd, opKey);
    if (sharedKey) addPoolUsed(poolUsed, sharedKey, dateStr, wc, take);
    cursor = new Date(segEnd);
  }

  return {
    startDt: segs.length ? segs[0].segStart           : new Date(fromDt),
    endDt:   segs.length ? segs[segs.length-1].segEnd  : new Date(fromDt),
    segs,
    // true gdy nie udało się zaplanować całości (grafik z zerami / wyczerpany SAFETY_LIMIT)
    incomplete: remaining > EPSILON,
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
function scheduleAll(zpList, routingByProduct, wcSchedule, planStartDt, onProgress, config, wcToBrygada = {}) {
  const VIP_BUFFER_DAYS    = config?.vipBufferDays ?? 2;
  const SAFETY_BUFFER_DAYS = config?.safetyBufferDays ?? 1;
  const MODE               = config?.schedulingMode ?? 'asap';
  const URGENCY_METHOD     = config?.urgencyMethod ?? 'cr';
  const SHIFT_START        = config?.shiftStart ?? 6;
  const GRAPH_MODE         = (config?.schedulingGraphMode ?? 'graph') === 'graph';
  // Domyślny priorytet maszyny (2xxxx) w brygadzie mieszanej — handicap odjęty od
  // pilności operacji na gniazdach 3xxxx tej samej brygady, tak żeby maszyna wygrywała
  // typową konkurencję o wspólną pulę, ale przegrywała gdy konkurencyjne ZP na gnieździe
  // ma realnie wyższą pilność (VIP/bliski termin) — patrz urgencyDynamic(biasH).
  const MACHINE_BIAS_H     = config?.machineBiasH ?? 8;
  // Czas logistyki (transport) między operacjami — próg minimalny, nie bezwarunkowe
  // wydłużenie: dodaje się do kursora PRZED szukaniem wolnego okna, więc jeśli
  // maszyna docelowa i tak jest zajęta dłużej, transfer nie sumuje się z tym
  // oczekiwaniem. Stosowany tylko gdy operacja faktycznie zmienia gniazdo/maszynę
  // (ta sama maszyna pod rząd = nic do przewiezienia).
  const TRANSFER_TIME_H    = config?.transferTimeH ?? 2;
  const occ      = makeOccupancy();
  const poolUsed = makePoolUsed();                      // sesja 9: pool capacity
  const result   = [];
  const zpStatus = [];

  const { getOccKey, getPoolAvail, getSharedPoolKey } = buildBrygadaPool(wcToBrygada, wcSchedule);

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

  // biasH (godziny, patrz MACHINE_BIAS_H) — handicap dodawany do pilności operacji na
  // maszynie w brygadzie mieszanej. Przeliczany do jednostek AKTYWNEJ metody, bo każda
  // liczy pilność w innej skali (ms, ms, godziny-w-wykładniku, bezwymiarowy ratio) —
  // stałe odjęcie tej samej liczby od wyniku byłoby niespójne między metodami.
  function urgencyDynamic(zp, tMs, biasH = 0) {
    const { th, effectiveDue } = zpCache.get(zp);
    const dueMs        = effectiveDue - planStartDt.getTime();
    const totalMs      = th * MS;
    const remainMs     = dueMs - tMs;

    if (URGENCY_METHOD === 'due_date') return effectiveDue - biasH * MS;
    if (URGENCY_METHOD === 'slack')    return (remainMs - totalMs) - biasH * MS;
    if (URGENCY_METHOD === 'atc') {
      const w     = zp.priority === 1 ? 2 : 1;
      const p     = th || 0.001;
      const slack = Math.max(0, remainMs - totalMs) / MS - biasH;
      return -(w / p) * Math.exp(-slack / (ATC_K * Math.max(p_avg, 0.001)));
    }
    return totalMs > 0 ? (remainMs / totalMs) - (biasH / Math.max(th, 0.001)) : 999;
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
    const delayDays = +(delayH / WORK_DAY_H).toFixed(1);
    const toc       = tocBuffer(backStart, planStartDt, dueDate, realEnd);
    const bottleneck = sorted.reduce((b, o) => (o.durH > b.durH ? o : b), sorted[0]).op.workcenter;

    zpStatus.push({
      zp_id:   zp.zp_id, zs_id: zp.zs_id || '', pozycja: zp.pozycja || '',
      klient:  zp.klient || '', product: zp.product, due_date: zp.due_date,
      priority: zp.priority, backStart, realEnd, delayH, delayDays, toc,
      bottleneck, late: delayH > 0, backDelay: 0,
    });
    const unplanned = sorted.filter(o => o.incomplete);
    if (unplanned.length) {
      zpStatus[zpStatus.length - 1].planWarning =
        `Brak dostępnej zdolności (grafik z zerami lub przekroczony horyzont): ${unplanned.length} operacji nie zaplanowano w całości`;
    }
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

  // Wpis w kopcu wskazuje "aktualną" (następną do zaplanowania) operację inaczej w obu
  // trybach: legacy = ops[opIdx], graph = op wprost. Bias dotyczy TYLKO tej operacji,
  // nie całego ZP — inny op tego samego ZP może być na zupełnie innym zasobie.
  function biasFor(entry) {
    const op = entry.op ?? entry.ops[entry.opIdx];
    return (op && getSharedPoolKey(op.workcenter) !== null) ? MACHINE_BIAS_H : 0;
  }

  const heap = new MinHeap((a, b) => {
    const tA = a.cursor.getTime() - planStartDt.getTime();
    const tB = b.cursor.getTime() - planStartDt.getTime();
    return urgencyDynamic(a.zp, tA, biasFor(a)) - urgencyDynamic(b.zp, tB, biasFor(b));
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

      const { startDt, endDt, segs, incomplete } = findSlotForward(
        cursor, durH, op.workcenter, wcSchedule, occ, getOccKey, getPoolAvail, poolUsed, SHIFT_START, getSharedPoolKey
      );

      state.opResults.push({ op, startDt, endDt, segs, durH, incomplete });
      state.opIdx++;
      const nextOp = ops[state.opIdx];
      const transferMs = (nextOp && nextOp.workcenter !== op.workcenter) ? TRANSFER_TIME_H * MS : 0;
      state.cursor = new Date(endDt.getTime() + transferMs);

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
  const graphCtxs = [];
  for (const { zp, ops } of zpsWithOps) {
    const initialCursor = new Date(MODE === 'alap'
      ? calcAlapStart(zp, ops, wcSchedule, planStartDt, SAFETY_BUFFER_DAYS)
      : planStartDt);

    const opByKey = new Map(ops.map(o => [o._opUid ?? o.sequence, o]));
    const zpCtx = { zp, ops, opByKey, doneEnds: {}, dispatched: new Set(), remaining: ops.length, opResults: [], initialCursor };
    graphCtxs.push(zpCtx);

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
    const { startDt, endDt, segs, incomplete } = findSlotForward(
      cursor, durH, op.workcenter, wcSchedule, occ, getOccKey, getPoolAvail, poolUsed, SHIFT_START, getSharedPoolKey
    );

    zpCtx.opResults.push({ op, startDt, endDt, segs, durH, incomplete });
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
        // Czas logistyki liczony per-poprzednik (jego gniazdo -> gniazdo kandydata),
        // dopiero potem bierzemy max — inaczej jeden poprzednik na tej samej maszynie
        // dostałby niepotrzebny transfer tylko dlatego, że INNY poprzednik zmienia gniazdo.
        const readyTimes = preds.map(p => {
          const predOp = zpCtx.opByKey.get(p);
          const transferMs = (predOp && predOp.workcenter !== candidate.workcenter) ? TRANSFER_TIME_H * MS : 0;
          return zpCtx.doneEnds[p].getTime() + transferMs;
        });
        const joinCursor = Math.max(...readyTimes);
        zpCtx.dispatched.add(candKey);
        heap.push({ zpCtx, zp: zpCtx.zp, op: candidate, cursor: new Date(joinCursor) });
      }
    }

    if (zpCtx.remaining === 0) {
      finalizeZp(zp, zpCtx.opResults);
    }
  }

  // Straż po pętli: ZP, którego operacji nie dało się odblokować (zduplikowany numer
  // OP, cykl albo brakujący poprzednik) nie może zniknąć po cichu. Brakujące operacje
  // układamy szeregowo (wg sequence) po tym co już zaplanowano i oznaczamy ZP
  // ostrzeżeniem `graphWarning`, żeby UI/diagnostyka mogły je pokazać.
  for (const zpCtx of graphCtxs) {
    if (zpCtx.remaining <= 0) continue;
    const { zp, ops } = zpCtx;
    const scheduled = new Set(zpCtx.opResults.map(r => r.op));
    const stuck = ops.filter(o => !scheduled.has(o))
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    let cursor = zpCtx.opResults.reduce((m, r) => (r.endDt > m ? r.endDt : m), zpCtx.initialCursor);
    for (const op of stuck) {
      const durH = op.ct_min > 0 ? zp.volume * op.ct_min / 60 : (op._durH ?? 0);
      const { startDt, endDt, segs, incomplete } = findSlotForward(
        cursor, durH, op.workcenter, wcSchedule, occ, getOccKey, getPoolAvail, poolUsed, SHIFT_START, getSharedPoolKey
      );
      zpCtx.opResults.push({ op, startDt, endDt, segs, durH, incomplete });
      cursor = endDt;
    }
    zpCtx.remaining = 0;
    if (zpCtx.opResults.length) {
      finalizeZp(zp, zpCtx.opResults);
      zpStatus[zpStatus.length - 1].graphWarning =
        `Graf operacji niespójny (zduplikowany numer OP, cykl lub brakujący poprzednik): ${stuck.length} operacji ułożono szeregowo`;
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
      const { zpList, routingByProduct, wcSchedule, planStart, config, wcToBrygada } = payload;
      const planStartDt = new Date(planStart + 'T00:00:00');
      const t0 = Date.now();
      const { fwdZP, zpStatus } = scheduleAll(
        zpList, routingByProduct, wcSchedule, planStartDt,
        (pct, label) => self.postMessage({ type: 'PROGRESS', payload: { pct, label } }),
        config, wcToBrygada || {}
      );
      self.postMessage({ type: 'DONE', payload: { fwdZP, zpStatus, elapsed: Date.now() - t0 } });
    } catch (err) {
      self.postMessage({ type: 'ERROR', payload: { message: err.message, stack: err.stack } });
    }
  }

  // ── OPTIMIZE_INSERT ────────────────────────────────────────────────────────
  if (type === 'OPTIMIZE_INSERT') {
    try {
      const { wcSchedule, planStart, fwdZP, zpStatus, wcToBrygada: wcToBrygadaPayload, config } = payload;
      const t0 = Date.now();

      const { getOccKey: localGetOccKey, getPoolAvail: localGetPoolAvail, getSharedPoolKey: localGetSharedPoolKey } =
        buildBrygadaPool(wcToBrygadaPayload || {}, wcSchedule);

      const lateList = zpStatus
        .filter(z => z.late)
        .sort((a, b) => (b.delayH || 0) - (a.delayH || 0));

      if (!lateList.length) {
        self.postMessage({ type: 'DONE', payload: {
          fwdZP, zpStatus, elapsed: Date.now() - t0,
          optimizeStats: { lateStart: 0, lateEnd: 0, moved: 0, skipped: true }
        }});
        return;
      }

      const lateStart = lateList.length;

      // Ta sama definicja puli co w findSlotForward: pool = gniazdo, którego klucz
      // zajętości to POOL_<brygada> (gniazdo 3xxxx w poolowalnej brygadzie). Gniazdo
      // 3xxxx bez brygady jest w SCHEDULE zwykłą maszyną ze slotami.
      const isPoolWc = (wc) => localGetOccKey(String(wc)) !== String(wc);

      // buildOcc — ujednolicony format: {from,to} dla maszyn, poolUsed dla 3xxxx
      // (oraz dla maszyny 2xxxx w brygadzie mieszanej, przez sharedKey).
      function buildOcc(ops) {
        const occ      = makeOccupancy();
        const poolUsed = makePoolUsed();
        for (const op of ops) {
          const wc        = String(op.workcenter);
          const isPool    = isPoolWc(wc);
          const sharedKey = isPool ? null : localGetSharedPoolKey(wc);
          for (const seg of (op.segments || [])) {
            if (!seg.segStart || !seg.segEnd) continue;
            const segStart = new Date(typeof seg.segStart === 'number' ? seg.segStart : seg.segStart);
            const segEnd   = new Date(typeof seg.segEnd   === 'number' ? seg.segEnd   : seg.segEnd);
            if (isPool) {
              const occKey  = localGetOccKey(wc);
              const dateStr = localDateStr(segStart);
              addPoolUsed(poolUsed, occKey, dateStr, wc, seg.durH || 0);
            } else {
              addSlotToOcc(occ, wc, segStart, segEnd, op.zp_id);
              if (sharedKey) addPoolUsed(poolUsed, sharedKey, localDateStr(segStart), wc, seg.durH || 0);
            }
          }
        }
        return { occ, poolUsed };
      }

      // findSlotForward ZAPISUJE rezerwacje do occ/poolUsed (z opKey, żeby dało się je
      // wycofać) — wywołujący odpowiada za rollback, gdy próba zostanie odrzucona.
      function findEarliestSlot(wc, fromDt, durH, occ, poolUsed, opKey) {
        const result = findSlotForward(
          fromDt, durH, wc, wcSchedule, occ,
          localGetOccKey,
          localGetPoolAvail,
          poolUsed,
          config?.shiftStart ?? 6,
          localGetSharedPoolKey,
          opKey
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

      // Wycofuje rezerwacje zapisane przez findSlotForward dla odrzuconej próby:
      // sloty maszyn po opKey (= op.zp_id), godziny puli po segmentach.
      function rollbackReservations(slots) {
        for (const { op, slot } of slots) {
          const wc        = String(op.workcenter);
          const isPool    = isPoolWc(wc);
          const sharedKey = isPool ? null : localGetSharedPoolKey(wc);
          if (!isPool) {
            const list = occ[wc];
            if (list) {
              for (let i = list.length - 1; i >= 0; i--) {
                if (list[i].opKey === op.zp_id) list.splice(i, 1);
              }
            }
          }
          for (const seg of slot.segs) {
            const dateStr = localDateStr(new Date(seg.segStart));
            if (isPool) removePoolUsed(poolUsed, localGetOccKey(wc), dateStr, wc, seg.durH || 0);
            else if (sharedKey) removePoolUsed(poolUsed, sharedKey, dateStr, wc, seg.durH || 0);
          }
        }
      }

      let workOps    = fwdZP.map(op => ({ ...op, segments: op.segments ? [...op.segments] : [] }));
      let workStatus = zpStatus.map(z => ({ ...z }));
      let { occ, poolUsed } = buildOcc(workOps);
      let moved      = 0;
      let iterations = 0;
      const MAX_ITER = 20;
      const planStartDt = new Date(planStart + 'T00:00:00');

      const TRANSFER_MS = (config?.transferTimeH ?? 2) * MS;
      const USE_GRAPH   = (config?.schedulingGraphMode ?? 'graph') === 'graph';

      // Układa operacje jednego ZP. Operacja 0h nie rezerwuje nic (slot długości 0),
      // zamiast zwracać null i blokować przesunięcie całego ZP.
      function planZpOps(zpOps) {
        const newSlots = [];
        const place = (op, from) => {
          if ((op.durH || 0) <= EPSILON) return { start: new Date(from), end: new Date(from), segs: [] };
          return findEarliestSlot(op.workcenter, from, op.durH, occ, poolUsed, op.zp_id);
        };
        const keyOf = (o) => o._opUid ?? o.sequence;
        const useGraph = USE_GRAPH && zpOps.some(o => o.predecessors && o.predecessors.length);

        if (!useGraph) {
          let cursor = new Date(planStartDt);
          for (let i = 0; i < zpOps.length; i++) {
            const op = zpOps[i];
            const slot = place(op, cursor);
            if (!slot) return { ok: false, newSlots };
            newSlots.push({ op, slot });
            const next = zpOps[i + 1];
            const tr = next && String(next.workcenter) !== String(op.workcenter) ? TRANSFER_MS : 0;
            cursor = new Date(slot.end.getTime() + tr);
          }
          return { ok: true, newSlots };
        }

        const byKey   = new Map(zpOps.map(o => [keyOf(o), o]));
        const ends    = new Map();
        const pending = [...zpOps];
        while (pending.length) {
          // pierwsza gotowa operacja (wg sequence); przy cyklu wymuś pierwszą z kolejki
          let idx = pending.findIndex(o => (o.predecessors || []).every(p => ends.has(p) || !byKey.has(p)));
          if (idx < 0) idx = 0;
          const op = pending.splice(idx, 1)[0];
          let from = planStartDt.getTime();
          for (const p of (op.predecessors || [])) {
            if (!ends.has(p)) continue;
            const po = byKey.get(p);
            const tr = String(po.workcenter) !== String(op.workcenter) ? TRANSFER_MS : 0;
            from = Math.max(from, ends.get(p) + tr);
          }
          const slot = place(op, new Date(from));
          if (!slot) return { ok: false, newSlots };
          newSlots.push({ op, slot });
          ends.set(keyOf(op), slot.end.getTime());
        }
        return { ok: true, newSlots };
      }

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
          const wc        = String(op.workcenter);
          const isPool    = isPoolWc(wc);
          const sharedKey = isPool ? null : localGetSharedPoolKey(wc);
          if (isPool) {
            for (const seg of (op.segments || [])) {
              if (!seg.segStart) continue;
              const occKey   = localGetOccKey(wc);
              const segStart = new Date(typeof seg.segStart === 'number' ? seg.segStart : seg.segStart);
              const dateStr  = localDateStr(segStart);
              removePoolUsed(poolUsed, occKey, dateStr, wc, seg.durH || 0);
            }
          } else {
            // Maszyny: usuń sloty tej operacji po unikalnym op.zp_id, nie po dopasowaniu
            // czasu z tolerancją — dwie operacje kończące/zaczynające się <1s od siebie
            // mogłyby inaczej trafić na złą krawędź i cicho rozjechać occupancy.
            const slots = occ[wc];
            if (slots) {
              for (let i = slots.length - 1; i >= 0; i--) {
                if (slots[i].opKey === op.zp_id) slots.splice(i, 1);
              }
            }
            if (sharedKey) {
              for (const seg of (op.segments || [])) {
                if (!seg.segStart) continue;
                const segStart = new Date(typeof seg.segStart === 'number' ? seg.segStart : seg.segStart);
                const dateStr  = localDateStr(segStart);
                removePoolUsed(poolUsed, sharedKey, dateStr, wc, seg.durH || 0);
              }
            }
          }
        }

        // Planuj operacje ZP od planStart, z grafem (predecessors) i transferem
        // między gniazdami tak jak scheduleAll — wcześniej: łańcuch po sequence.
        const planned    = planZpOps(zpOps);
        const ok         = planned.ok;
        const newSlots   = planned.newSlots;

        const oldStatus  = workStatus.find(z => z.zp_id === zpId);
        const newRealEnd = ok
          ? new Date(Math.max(...newSlots.map(ns => ns.slot.end.getTime())))
          : null;
        const oldRealEnd = oldStatus ? new Date(oldStatus.realEnd) : null;

        if (!ok || (oldRealEnd && newRealEnd >= oldRealEnd)) {
          // Nie poprawia — najpierw wycofaj rezerwacje próby (findSlotForward zapisał je
          // do occ/poolUsed), dopiero potem przywróć stare. Bez tego odrzucona próba
          // zostawiała „fantomowe" sloty i zawyżone zużycie puli.
          rollbackReservations(newSlots);
          // Przywróć occupancy
          for (const op of zpOps) {
            const wc        = String(op.workcenter);
            const isPool    = isPoolWc(wc);
            const sharedKey = isPool ? null : localGetSharedPoolKey(wc);
            for (const seg of (op.segments || [])) {
              if (!seg.segStart) continue;
              const segStart = new Date(typeof seg.segStart === 'number' ? seg.segStart : seg.segStart);
              const dateStr  = localDateStr(segStart);
              if (isPool) {
                const occKey = localGetOccKey(wc);
                addPoolUsed(poolUsed, occKey, dateStr, wc, seg.durH || 0);
              } else {
                const segEnd = new Date(typeof seg.segEnd === 'number' ? seg.segEnd : seg.segEnd);
                addSlotToOcc(occ, wc, segStart, segEnd, op.zp_id);
                if (sharedKey) addPoolUsed(poolUsed, sharedKey, dateStr, wc, seg.durH || 0);
              }
            }
          }
          continue;
        }

        // Zaakceptuj — zaktualizuj workOps. Rezerwacje w occ/poolUsed już zapisał
        // findSlotForward podczas próby, więc nie dodajemy ich drugi raz.
        for (const { op, slot } of newSlots) {
          const idx = workOps.findIndex(o => o.zp_id === op.zp_id);
          if (idx >= 0) {
            workOps[idx] = { ...workOps[idx], start_dt: slot.start, end_dt: slot.end, segments: slot.segs, realEnd: newRealEnd };
          }
        }

        // Zaktualizuj zpStatus
        if (oldStatus) {
          const dueDate    = new Date(oldStatus.due_date + 'T23:59:59');
          const delayH     = Math.max(0, newRealEnd.getTime() - dueDate.getTime()) / MS;
          const newBackStart = newSlots.reduce(
            (min, ns) => (ns.slot.start < min ? ns.slot.start : min),
            newSlots[0].slot.start
          );
          const statusIdx = workStatus.findIndex(z => z.zp_id === zpId);
          if (statusIdx >= 0) {
            workStatus[statusIdx] = {
              ...workStatus[statusIdx],
              backStart: newBackStart,
              realEnd:   newRealEnd,
              delayH,
              delayDays: +(delayH / WORK_DAY_H).toFixed(1),
              late:      delayH > 0,
              toc:       tocBuffer(newBackStart, planStartDt, dueDate, newRealEnd),
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