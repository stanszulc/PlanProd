export function localDateStr(dt) {
  const d = new Date(dt);
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

// Bezpieczny podział linii CSV
export function safeSplitCSV(line, sep) {
  const result = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === sep && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map(v => v.replace(/^"|"$/g, ''));
}

export function parseRouting(text) {
  const cleanText = text.replace(/^﻿/, ""); 
  const lines = cleanText.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = safeSplitCSV(lines[0], sep).map(h => h.toLowerCase());
  
  return lines.slice(1).map(line => {
    const vals = safeSplitCSV(line, sep);
    const r = {}; headers.forEach((h, i) => r[h] = vals[i] || "");
    
    const ct = Math.max(0, parseFloat(r.ct_min || r.ct || 0));
    const cap = parseFloat(r.capacity_h || r.cap || r.capacity || 8);

    return {
      product: r.product || "",
      operation: r.operation || "",
      workcenter: (r.workcenter || r.wc || "").toUpperCase(),
      ct_min: ct,
      sequence:     parseInt(r.sequence || r.seq || 1),
      predecessors: (r.predecessors || r.pred || '').split(/[,|]/)
                      .map(s => parseInt(s.trim())).filter(n => !isNaN(n)),
      capacity_h: cap <= 0 ? 8 : cap,
    };
  }).filter(r => r.product && r.workcenter && r.ct_min > 0);
}

export function parseZP(text) {
  const cleanText = text.replace(/^﻿/, ""); 
  const lines = cleanText.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = safeSplitCSV(lines[0], sep).map(h => h.toLowerCase());
  
  return lines.slice(1).map(line => {
    const vals = safeSplitCSV(line, sep);
    const r = {}; headers.forEach((h, i) => r[h] = vals[i] || "");
    return {
      zp_id: r.zp_id || r.zp || r.id || "",
      product: r.product || "",
      volume: Math.max(0, parseFloat(r.volume || r.vol || r.qty || 0)),
      due_date: r.due_date || r.due || r.data || "",
      priority: parseInt(r.priority || r.prio || 1),
    };
  }).filter(r => r.product && r.volume > 0 && r.due_date);
}


export function parseZS(text) {
  const cleanText = text.replace(/^\uFEFF/, "");
  const lines = cleanText.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = safeSplitCSV(lines[0], sep).map(h => h.toLowerCase());
  return lines.slice(1).map(line => {
    const vals = safeSplitCSV(line, sep);
    const r = {}; headers.forEach((h, i) => r[h] = vals[i] || "");
    return {
      zs_id:    r.zs_id || r.zs || "",
      pozycja:  parseInt(r.pozycja || r.poz || 1),
      klient:   r.klient || r.client || r.customer || "",
      product:  r.product || "",
      volume:   Math.max(0, parseFloat(r.volume || r.vol || 0)),
      due_date: r.due_date || r.due || "",
      priority: parseInt(r.priority || r.prio || 1),
    };
  }).filter(r => r.product && r.volume > 0 && r.due_date);
}

// Konwertuj ZS → ZP (1 pozycja ZS = 1 ZP wiodące)
export function zsToZP(zsList) {
  // Format zp_id: ZP-001/01/01 = nr_ZS / pozycja / nr_ZP_w_pozycji
  return zsList.map(zs => {
    const zsNum  = zs.zs_id.replace(/[^0-9]/g,'').padStart(3,'0') || '001';
    const pozNum = String(zs.pozycja || 1).padStart(2,'0');
    return {
      zp_id:    'ZP-' + zsNum + '/' + pozNum,
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

// Back-scheduling engine
// Wejście: ZP lista + routingByProduct + grafik (schedule per wc per dayName)
// Wyjście: lista pod-ZP z {zp_id, sub_id, workcenter, operation, start_dt, end_dt, durH}

// Back-scheduling engine
// wcSchedule: { "G-01": [pon,wt,sr,czw,pt,sob,nd] } — tablica 7 elementów, index 0=pon
// JS getDay(): 0=nd, 1=pon ... 6=sob → mapujemy na index w tablicy

// ─── SCHEDULER ENGINE ─────────────────────────────────────────────────────────
// wcSchedule: { "G-01": [pon,wt,sr,czw,pt,sob,nd] } — idx 0=pon
// JS getDay(): 0=nd,1=pon...6=sob

export function jsDay2idx(jsDay) {
  return jsDay === 0 ? 6 : jsDay - 1;
}

export function getAvail(wc, dt, wcSchedule) {
  const sched = wcSchedule && wcSchedule[wc];
  if (!sched) return 16;
  const d = new Date(dt);
  // Nowy format: obiekt z datami { "2026-05-25": 16 }
  if (!Array.isArray(sched) && typeof sched === 'object') {
    const dateKey = localDateStr(d);
    if (sched[dateKey] !== undefined) return sched[dateKey];
    // Fallback: domyślnie pon-pt=16, sob-nd=0
    const jsDay = d.getDay();
    return (jsDay===0||jsDay===6) ? 0 : 16;
  }
  // Stary format: tablica [pon..nd]
  return sched[jsDay2idx(d.getDay())] !== undefined ? sched[jsDay2idx(d.getDay())] : 0;
}

// Podziel operację na segmenty (bloki) z cięciem na granicach dni roboczych
// Zwraca: { startDt, segments: [{segStart, segEnd, durH}] }
export function backScheduleOp(endDt, hoursNeeded, wc, wcSchedule) {
  const segments = [];
  let cursor    = new Date(endDt);
  let remaining = hoursNeeded;
  let safety    = 0;

  while (remaining > 0.0001 && safety++ < 5000) {
    const avail  = getAvail(wc, cursor, wcSchedule);

    if (avail === 0) {
      cursor.setDate(cursor.getDate() - 1);
      cursor.setHours(23, 59, 0, 0);
      continue;
    }

    const dayEnd     = avail;
    const curH       = cursor.getHours() + cursor.getMinutes() / 60;
    const availToday = Math.min(curH, dayEnd);

    if (availToday <= 0.0001) {
      cursor.setDate(cursor.getDate() - 1);
      const prevAvail = getAvail(wc, cursor, wcSchedule);
      cursor.setHours(prevAvail > 0 ? prevAvail : 23, prevAvail > 0 ? 0 : 59, 0, 0);
      continue;
    }

    const take   = Math.min(remaining, availToday);
    remaining   -= take;
    const startH = curH - take;

    // Zachowaj koniec segmentu PRZED jakąkolwiek modyfikacją kursora
    const segEndDt   = new Date(cursor);
    // Teraz oblicz start
    const segStartDt = new Date(cursor);
    segStartDt.setHours(Math.floor(startH), Math.round((startH % 1) * 60), 0, 0);

    segments.unshift({ segStart: segStartDt, segEnd: segEndDt, durH: take });

    if (remaining > 0.0001) {
      cursor = new Date(segStartDt);
      cursor.setDate(cursor.getDate() - 1);
      const prevAvail = getAvail(wc, cursor, wcSchedule);
      cursor.setHours(prevAvail > 0 ? prevAvail : 23, prevAvail > 0 ? 0 : 59, 0, 0);
    } else {
      cursor = new Date(segStartDt);
    }
  }

  return { startDt: cursor, segments };
}

// Back-schedule wszystkich ZP z listy
// Zwraca listę pod-ZP, każde z tablicą segmentów (bloki na Ganttcie)
export function backSchedule(zpList, routingByProduct, wcSchedule) {
  const result = [];
  const zpOpCounter = {}; // per zp_id → licznik operacji

  zpList.forEach(zp => {
    const ops = (routingByProduct[zp.product] || [])
      .slice()
      .sort((a, b) => b.sequence - a.sequence); // od ostatniej do pierwszej
    if (!ops.length) return;

    // Kursor = koniec dnia due_date
    let cursor = new Date(zp.due_date + 'T00:00:00');
    const lastAvail = getAvail(ops[0].workcenter, cursor, wcSchedule) || 16;
    cursor.setHours(lastAvail, 0, 0, 0);

    const doneStarts = {}; // sequence → startDt (dla predecessors w back)

    ops.forEach(op => {
      const durH   = zp.volume * op.ct_min / 60;
      // W back-schedule: endDt = min(startów successors) jeśli ma predecessors
      let endDt = new Date(cursor);
      if (op.predecessors && op.predecessors.length > 0) {
        // Znajdź successors — operacje które mają ten sequence w predecessors
        const successorStarts = ops
          .filter(o => o.predecessors && o.predecessors.includes(op.sequence))
          .map(o => doneStarts[o.sequence])
          .filter(Boolean);
        if (successorStarts.length > 0)
          endDt = new Date(Math.min(...successorStarts.map(d => new Date(d).getTime())));
      }
      const { startDt, segments } = backScheduleOp(endDt, durH, op.workcenter, wcSchedule);
      doneStarts[op.sequence] = startDt;

      result.push({
        zp_id:      (() => { if (!zpOpCounter[zp.zp_id]) zpOpCounter[zp.zp_id]=0; zpOpCounter[zp.zp_id]++; return zp.zp_id+'/'+String(zpOpCounter[zp.zp_id]).padStart(3,'0'); })(),
         parent_zp:  zp.zp_id,
        zs_id:      zp.zs_id || '',
        klient:     zp.klient || '',
        sub_id:     result.length > 0 ? result[result.length] : zp.zp_id,
        product:    zp.product,
        workcenter: op.workcenter,
        operation:  op.operation,
        sequence:   op.sequence,
        volume:     zp.volume,
        durH,
        start_dt:   startDt,
        end_dt:     endDt,
        segments,           // bloki cięte na granicach dni
        due_date:   zp.due_date,
        priority:   zp.priority,
      });

      cursor = new Date(startDt);
    });
  });

  return result.sort((a, b) => a.start_dt - b.start_dt);
}


// ─── FORWARD SCHEDULER Z KOLEJKĄ ──────────────────────────────────────────
// Wejście: zpList (posortowane wg priorytetu), routingByProduct, wcSchedule, planStart (Date)
// Wyjście: tablica { zp_id, product, due_date, start_dt, end_dt, delay_h, bufferConsumed, segments[] }
//          + backStart (z back-schedule) per ZP dla TOC

export function forwardScheduleOp(fromDt, hoursNeeded, wc, wcSchedule, occupancy) {
  let cursor    = new Date(fromDt);
  let remaining = hoursNeeded;
  const segs    = [];
  let safety    = 0;

  while (remaining > 0.0001 && safety++ < 10000) {
    // Pomiń weekendy/dni wolne
    const avail = getAvail(wc, cursor, wcSchedule);
    if (avail === 0) {
      cursor = new Date(cursor); cursor.setDate(cursor.getDate()+1); cursor.setHours(0,0,0,0);
      continue;
    }

    // Okno dnia roboczego: cursor.day 00:00 → avail:00
    const dayEnd = new Date(cursor); dayEnd.setHours(avail, 0, 0, 0);

    // Jeśli cursor poza oknem — następny dzień
    if (cursor >= dayEnd) {
      cursor = new Date(cursor); cursor.setDate(cursor.getDate()+1); cursor.setHours(0,0,0,0);
      continue;
    }

    // Przesuń cursor za zajęte sloty
    let slotStart = new Date(cursor);
    let shifted = true;
    while (shifted) {
      shifted = false;
      for (const o of (occupancy[wc] || [])) {
        if (new Date(o.from) <= slotStart && new Date(o.to) > slotStart) {
          slotStart = new Date(o.to);
          shifted = true;
          break;
        }
      }
    }

    // Jeśli po przesunięciu wychodzimy poza dzień — następny dzień
    if (slotStart >= dayEnd) {
      cursor = new Date(slotStart);
      cursor.setDate(cursor.getDate()+1); cursor.setHours(0,0,0,0);
      continue;
    }

    // Koniec slotu = min(dayEnd, następna rezerwacja)
    let slotEnd = new Date(dayEnd);
    for (const o of (occupancy[wc] || [])) {
      const oFrom = new Date(o.from);
      if (oFrom > slotStart && oFrom < slotEnd) slotEnd = oFrom;
    }

    const availH = (slotEnd - slotStart) / 3600000;
    if (availH < 0.0001) { cursor = new Date(slotEnd); continue; }

    const take   = Math.min(remaining, availH);
    remaining   -= take;
    const segEnd = new Date(slotStart.getTime() + take * 3600000);

    segs.push({ segStart: new Date(slotStart), segEnd: new Date(segEnd), durH: take });

    if (!occupancy[wc]) occupancy[wc] = [];
    occupancy[wc].push({ from: new Date(slotStart), to: new Date(segEnd) });
    occupancy[wc].sort((a,b) => new Date(a.from)-new Date(b.from));

    cursor = new Date(segEnd);
  }

  return {
    startDt: segs.length ? segs[0].segStart    : new Date(fromDt),
    endDt:   segs.length ? segs[segs.length-1].segEnd : new Date(fromDt),
    segments: segs,
  };
}

export function forwardSchedule(zpList, routingByProduct, wcSchedule, planStart) {
  const occupancy = {};
  const result = [];
  const zpOpCounter = {};

  const sorted = [...zpList].sort((a, b) =>
    a.priority - b.priority || a.due_date.localeCompare(b.due_date)
  );

  sorted.forEach(zp => {
    const ops = (routingByProduct[zp.product] || [])
      .slice().sort((a, b) => a.sequence - b.sequence);
    if (!ops.length) return;

    const doneEnds = {}; // sequence → endDt (dla predecessors)
    const subOps = [];

    ops.forEach(op => {
      const durH = zp.volume * op.ct_min / 60;
      // cursor = max(końców predecessors) lub planStart
      let cursor = new Date(planStart);
      if (op.predecessors && op.predecessors.length > 0) {
        op.predecessors.forEach(seq => {
          if (doneEnds[seq] && doneEnds[seq] > cursor)
            cursor = new Date(doneEnds[seq]);
        });
      } else if (subOps.length > 0) {
        // brak predecessors i nie pierwsza op → sekwencja (stara logika)
        const prevEnd = subOps[subOps.length-1].end_dt;
        if (prevEnd && new Date(prevEnd) > cursor)
          cursor = new Date(prevEnd);
      }
      const { startDt, endDt, segments } = forwardScheduleOp(
        cursor, durH, op.workcenter, wcSchedule, occupancy
      );
      doneEnds[op.sequence] = endDt;
      subOps.push({
        zp_id:      (() => { if (!zpOpCounter[zp.zp_id]) zpOpCounter[zp.zp_id]=0; zpOpCounter[zp.zp_id]++; return zp.zp_id+'/'+String(zpOpCounter[zp.zp_id]).padStart(3,'0'); })(),
         parent_zp:  zp.zp_id,
        zs_id:      zp.zs_id || '',
        klient:     zp.klient || '',
        sub_id:     zp.zp_id + '/' + String(op.sequence).padStart(3,'0'),
        product:    zp.product,
        workcenter: op.workcenter,
        operation:  op.operation,
        sequence:   op.sequence,
        volume:     zp.volume,
        durH,
        start_dt:   startDt,
        end_dt:     endDt,
        segments,
        due_date:   zp.due_date,
        priority:   zp.priority,
      });
      cursor = new Date(endDt);
    });

    // realEnd = koniec ostatniej operacji
    const realEnd  = subOps.length ? subOps[subOps.length-1].end_dt : new Date(planStart);
    const dueDate  = new Date(zp.due_date + 'T23:59:59');
    const delayMs  = Math.max(0, realEnd - dueDate);
    const delayH   = delayMs / 3600000;
    const delayDays = +(delayH / 16).toFixed(1);

    result.push(...subOps.map(s => ({ ...s, realEnd, delayH, delayDays })));
  });

  return result;
}

// TOC buffer zones
// backStart = idealny start z back-schedule
// planStart = dziś
// dueDate   = termin
export function tocBuffer(backStartDt, planStartDt, dueDateDt, realEndDt) {
  // Jeśli realEnd > dueDate → zawsze spóźnione, niezależnie od bufora
  if (realEndDt && realEndDt > dueDateDt) {
    const overH = (realEndDt - dueDateDt) / 3600000;
    return { zone: 'black', consumed: 1, label: 'SPÓŹNIONE', overH };
  }
  const bufferTotal = dueDateDt - backStartDt;
  if (bufferTotal <= 0) return { zone: 'black', consumed: 1, label: 'PRZEKROCZONY' };
  const bufferRemaining = dueDateDt - planStartDt;
  const consumed = 1 - bufferRemaining / bufferTotal;
  if (consumed < 0)    return { zone: 'green',  consumed, label: 'OK' };
  if (consumed < 0.33) return { zone: 'green',  consumed, label: 'OK' };
  if (consumed < 0.67) return { zone: 'yellow', consumed, label: 'UWAGA' };
  if (consumed < 1.0)  return { zone: 'red',    consumed, label: 'ZAGROŻONE' };
  return                      { zone: 'black',  consumed, label: 'SPÓŹNIONE' };
}


export function fmtDt(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}



export function computeLoads(routingByProduct, zpList, wcSchedule, date) {
  const wcMap = {};

  // Wylicz cap per gniazdo z grafiku (jeśli podany)
  function getCapH(wc, fallback) {
    if (!wcSchedule || !date) return fallback || 8;
    const sched = wcSchedule[wc];
    if (!sched) return fallback || 16;
    // Nowy format: obiekt z datami { "2026-05-25": 16, ... }
    if (!Array.isArray(sched) && typeof sched === 'object') {
      const v = sched[date];
      return v !== undefined ? v : (() => {
        const jsDay = new Date(date+"T12:00:00").getDay();
        return (jsDay===0||jsDay===6) ? 0 : 16;
      })();
    }
    // Stary format: tablica [pon..nd]
    const jsDay = new Date(date + "T12:00:00").getDay();
    const idx = jsDay === 0 ? 6 : jsDay - 1;
    return sched[idx] !== undefined ? sched[idx] : 0;
  }

  zpList.forEach(z => {
    const ops = routingByProduct[z.product] || [];
    ops.forEach(op => {
      const capH = getCapH(op.workcenter, op.capacity_h);
      if (!wcMap[op.workcenter]) wcMap[op.workcenter] = { load: 0, cap: capH, contrib: {} };
      wcMap[op.workcenter].cap = capH; // odświeź
      const h = z.volume * op.ct_min / 60;
      wcMap[op.workcenter].load += h;
      if (!wcMap[op.workcenter].contrib[z.zp_id]) wcMap[op.workcenter].contrib[z.zp_id] = { h: 0, product: z.product };
      wcMap[op.workcenter].contrib[z.zp_id].h += h;
    });
  });
  Object.keys(wcMap).forEach(w => {
    wcMap[w].util = wcMap[w].cap > 0 ? wcMap[w].load / wcMap[w].cap : 999;
  });
  return wcMap;
}



export function dlCSV(rows, filename) {
  const csv = rows.map(r => r.map(v => typeof v === 'string' && v.includes(';') ? `"${v}"` : v).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = filename;
  a.click();
}


// ─── HYBRID SCHEDULE (BETA) ───────────────────────────────────────────────────
// WIP-initialized rescheduling — używa actual_end z CNF, liczy pozostały czas
// dla WIP, forward schedule dla PLAN.
// Nie modyfikuje istniejących funkcji — bezpieczny fallback gdy hybridMode=false.

export function calcHybridRealEnd(parentZpId, zpStatusData, routingByProduct, wcSchedule, planStart) {
  // Pobierz wszystkie operacje dla tego parent_zp, posortowane po sequence
  const ops = zpStatusData
    .filter(r => r.parent_zp === parentZpId)
    .sort((a, b) => a.sequence - b.sequence);

  if (!ops.length) return null;

  const product = ops[0].product;
  const routing = (routingByProduct[product] || []).sort((a, b) => a.sequence - b.sequence);

  // Znajdź anchor — koniec ostatniej CNF operacji
  const cnfOps  = ops.filter(o => o.status === 'CNF' && o.actual_end);
  const lastCNF = cnfOps.length
    ? cnfOps.reduce((best, o) => o.actual_end > best.actual_end ? o : best, cnfOps[0])
    : null;

  // Znajdź operację WIP (actual_start ale brak actual_end)
  const wipOp = ops.find(o => o.status === 'WIP' && o.actual_start && !o.actual_end);

  // Kursor startowy:
  // 1. WIP → actual_start + remaining time
  // 2. ostatnia CNF → jej actual_end
  // 3. brak → planStart
  let cursor = new Date(planStart);

  if (wipOp) {
    const routeOp  = routing.find(r => r.sequence === wipOp.sequence);
    const totalMin = routeOp ? routeOp.ct_min * wipOp.volume_plan : 0;
    const doneMin  = wipOp.volume_actual > 0 && wipOp.volume_plan > 0
      ? totalMin * (wipOp.volume_actual / wipOp.volume_plan)
      : 0;
    const remainMin = Math.max(0, totalMin - doneMin);
    cursor = new Date(wipOp.actual_start.getTime() + remainMin * 60000);
  } else if (lastCNF) {
    cursor = new Date(lastCNF.actual_end);
  }

  // Pozostałe operacje PLAN — forward schedule od kursora
  const planOps = ops.filter(o => o.status === 'PLAN');
  if (!planOps.length) return cursor; // wszystko CNF/WIP — cursor = realEnd

  const occupancy = {};
  let lastEnd = cursor;

  planOps.forEach(op => {
    const routeOp = routing.find(r => r.sequence === op.sequence);
    if (!routeOp) return;
    const durH = op.volume_plan * routeOp.ct_min / 60;
    const { endDt } = forwardScheduleOp(lastEnd, durH, op.workcenter, wcSchedule, occupancy);
    lastEnd = endDt;
  });

  return lastEnd;
}

// Przelicz zpStatus z hybrydowym realEnd dla wszystkich ZP
export function calcHybridZpStatus(zpStatus, zpStatusData, routingByProduct, wcSchedule, planStart) {
  if (!zpStatusData.length) return zpStatus; // fallback — brak danych realizacji

  return zpStatus.map(z => {
    try {
      const hybridEnd = calcHybridRealEnd(z.zp_id, zpStatusData, routingByProduct, wcSchedule, planStart);
      if (!hybridEnd) return z; // fallback per ZP

      const dueDate   = new Date(z.due_date + 'T23:59:59');
      const delayH    = Math.max(0, (hybridEnd - dueDate) / 3600000);
      const delayDays = +(delayH / 16).toFixed(1);
      const toc       = tocBuffer(z.backStart, new Date(planStart), dueDate, hybridEnd);

      return { ...z, realEnd: hybridEnd, delayH, delayDays, toc, hybridMode: true };
    } catch (err) {
      console.warn(`hybridSchedule fallback dla ${z.zp_id}:`, err);
      return z; // fallback do planu
    }
  });
}
