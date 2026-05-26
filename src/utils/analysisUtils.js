import { safeSplitCSV } from './scheduler.js';

// ─── KONWERSJA ZP_STATUS → FORMAT HISTORY ────────────────────────────────────
// Zastępuje parseHistory + sanitizeHistoryData
// Filtruje rekordy z actual_start + actual_end (status CNF lub WIP z końcem)
// Grupuje wait_min po parent_zp zamiast zp_id

export function zpStatusToHistoryFormat(zpStatusData, routing) {
  // 1. Filtruj tylko rekordy z faktycznie wypełnionym actual_start i actual_end
  const completed = zpStatusData.filter(r => r.actual_start && r.actual_end);

  if (!completed.length) return [];

  // 2. Mapuj na format history (taki sam jak wynik sanitizeHistoryData)
  const mapped = [];
  completed.forEach(r => {
    const start = r.actual_start instanceof Date ? r.actual_start : new Date(r.actual_start);
    const end   = r.actual_end   instanceof Date ? r.actual_end   : new Date(r.actual_end);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

    const raw_ct_min    = (end - start) / 60000;
    const volume        = r.volume_actual > 0 ? r.volume_actual : r.volume_plan || 1;
    const actual_ct_min = +(raw_ct_min / volume).toFixed(2);
    if (actual_ct_min < 0.1 || actual_ct_min > 72 * 60) return;

    mapped.push({
      // Klucze zgodne z formatem history używanym przez AnalysisTab
      zp_id:         r.parent_zp || r.zp_id,  // grupowanie wait po parent_zp
      product:       r.product,
      workcenter:    r.workcenter,
      operation:     r.operation,
      start_ts:      start,
      end_ts:        end,
      volume:        r.volume_actual || r.volume_plan || 0,
      reason_code:   r.reason_code || null,
      actual_ct_min: +actual_ct_min.toFixed(2),
      type:          'zp_status',
      // Zachowaj oryginalne pola na potrzeby Sankey
      zp_op_id:      r.zp_id,
      sequence:      r.sequence,
    });
  });

  // 3. Enrich ze standardami z routing
  const enriched = enrichWithStandards(mapped, routing);

  // 4. Wylicz wait_min — grupowanie po parent_zp (zp_id w mapped = parent_zp z oryginału)
  return calcWaitTimes(enriched);
}

// ─── JOIN Z ROUTING (std_ct_min) ─────────────────────────────────────────────

export function enrichWithStandards(sanitized, routing) {
  // Lookup: product+workcenter+operation → ct_min
  const lookup = {};
  routing.forEach(r => {
    const key = `${r.product}||${r.workcenter}||${r.operation}`;
    lookup[key] = r.ct_min;
  });

  // Fallback: product+workcenter (średnia jeśli kilka operacji)
  const wcLookup = {};
  routing.forEach(r => {
    const key = `${r.product}||${r.workcenter}`;
    if (!wcLookup[key]) wcLookup[key] = [];
    wcLookup[key].push(r.ct_min);
  });

  return sanitized.map(r => {
    const key   = `${r.product}||${r.workcenter}||${r.operation}`;
    const wcKey = `${r.product}||${r.workcenter}`;
    const std   = lookup[key] ?? (wcLookup[wcKey] ? avg(wcLookup[wcKey]) : null);
    const dev_min = std != null ? +(r.actual_ct_min - std).toFixed(2) : null;
    const dev_pct = std != null ? +((dev_min / std) * 100).toFixed(1) : null;
    return { ...r, std_ct_min: std, deviation_min: dev_min, deviation_pct: dev_pct };
  });
}

// ─── WAIT TIME ───────────────────────────────────────────────────────────────
// wait_min = start[n] - end[n-1] per zp_id, posortowane po start_ts
// Przy zpStatusToHistoryFormat: zp_id = parent_zp → grupuje per ZP nagłówek

export function calcWaitTimes(enriched) {
  const byZP = {};
  enriched.forEach(r => {
    if (!byZP[r.zp_id]) byZP[r.zp_id] = [];
    byZP[r.zp_id].push(r);
  });

  const result = [];
  Object.values(byZP).forEach(ops => {
    const sorted = [...ops].sort((a, b) => a.start_ts - b.start_ts);
    sorted.forEach((op, i) => {
      const prev = sorted[i - 1];
      const wait_min = prev
        ? Math.max(0, +(((op.start_ts - prev.end_ts) / 60000).toFixed(1)))
        : 0;
      result.push({ ...op, wait_min });
    });
  });

  return result;
}

// ─── CAPACITY LOSS ───────────────────────────────────────────────────────────
// capacity_loss_h = (wait_min / 60) × (wcLoad / 100)

export function calcCapacityLoss(records, wcLoadMap) {
  return records.map(r => {
    const wcLoad = Math.min(100, wcLoadMap[r.workcenter] ?? 50);
    const capacity_loss_h = +((r.wait_min / 60) * (wcLoad / 100)).toFixed(3);
    return { ...r, capacity_loss_h, wcLoad };
  });
}

// ─── AGREGATY PER GNIAZDO ────────────────────────────────────────────────────

export function calcWcStats(records) {
  const byWc = {};
  records.forEach(r => {
    if (!byWc[r.workcenter]) byWc[r.workcenter] = [];
    byWc[r.workcenter].push(r);
  });

  return Object.entries(byWc).map(([wc, recs]) => {
    const actuals   = recs.map(r => r.actual_ct_min);
    const stds      = recs.filter(r => r.std_ct_min != null).map(r => r.std_ct_min);
    const devs      = recs.filter(r => r.deviation_pct != null).map(r => r.deviation_pct);
    const waits     = recs.map(r => r.wait_min ?? 0);
    const capLosses = recs.map(r => r.capacity_loss_h ?? 0);

    const avg_actual  = avg(actuals);
    const avg_std     = stds.length ? avg(stds) : null;
    const avg_dev_pct = devs.length ? avg(devs) : null;
    const std_dev     = stdDev(actuals);
    const cv_pct      = avg_actual > 0 ? +((std_dev / avg_actual) * 100).toFixed(1) : 0;
    const total_wait_h   = +(sum(waits) / 60).toFixed(2);
    const total_cap_loss = +sum(capLosses).toFixed(3);

    const stability = cv_pct < 10 ? 'stable' : cv_pct < 25 ? 'moderate' : 'unstable';

    return {
      workcenter:    wc,
      count:         recs.length,
      avg_actual_ct: +avg_actual.toFixed(2),
      avg_std_ct:    avg_std != null ? +avg_std.toFixed(2) : null,
      avg_dev_pct:   avg_dev_pct != null ? +avg_dev_pct.toFixed(1) : null,
      std_dev:       +std_dev.toFixed(2),
      cv_pct,
      stability,
      total_wait_h,
      total_cap_loss,
    };
  }).sort((a, b) => a.workcenter.localeCompare(b.workcenter));
}

// ─── HEATMAPA STRAT (tygodnie × gniazda) ─────────────────────────────────────

export function calcHeatmapData(records) {
  const byWeekWc = {};

  records.forEach(r => {
    const week = isoWeek(r.start_ts);
    const key  = `${week}||${r.workcenter}`;
    if (!byWeekWc[key]) byWeekWc[key] = { week, workcenter: r.workcenter, wait_min: 0, cap_loss: 0, count: 0 };
    byWeekWc[key].wait_min += r.wait_min ?? 0;
    byWeekWc[key].cap_loss += r.capacity_loss_h ?? 0;
    byWeekWc[key].count    += 1;
  });

  const cells = Object.values(byWeekWc).map(c => ({
    ...c,
    wait_h:   +(c.wait_min / 60).toFixed(2),
    cap_loss: +c.cap_loss.toFixed(3),
  }));

  const weeks      = [...new Set(cells.map(c => c.week))].sort();
  const workcenter = [...new Set(cells.map(c => c.workcenter))].sort();

  return { cells, weeks, workcenter };
}

// ─── PARETO PRZYCZYN ─────────────────────────────────────────────────────────

export function calcReasonPareto(records, filterWc = null) {
  const filtered   = filterWc ? records.filter(r => r.workcenter === filterWc) : records;
  const withReason = filtered.filter(r => r.reason_code);

  const byCode = {};
  withReason.forEach(r => {
    if (!byCode[r.reason_code]) byCode[r.reason_code] = { code: r.reason_code, count: 0, wait_min: 0 };
    byCode[r.reason_code].count    += 1;
    byCode[r.reason_code].wait_min += r.wait_min ?? 0;
  });

  const sorted = Object.values(byCode).sort((a, b) => b.count - a.count);
  const total  = sum(sorted.map(s => s.count));
  let cumPct   = 0;

  return sorted.map(s => {
    const pct = total > 0 ? +((s.count / total) * 100).toFixed(1) : 0;
    cumPct   += pct;
    return { ...s, pct, cum_pct: +cumPct.toFixed(1), wait_h: +(s.wait_min / 60).toFixed(2) };
  });
}

// ─── PARSER ZP_STATUS ────────────────────────────────────────────────────────

export function parseZpStatus(text) {
  const clean = text.replace(/^﻿/, '');
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
      zp_id:         r.zp_id || '',
      parent_zp:     r.parent_zp || r.zp_id?.split('/').slice(0, 2).join('/') || '',
      zs_id:         r.zs_id || '',
      pozycja:       parseInt(r.pozycja || 1),
      klient:        r.klient || r.client || '',
      product:       r.product || '',
      operation:     r.operation || r.op || '',
      workcenter:    (r.workcenter || r.wc || '').toUpperCase(),
      sequence:      parseInt(r.sequence || r.seq || 1),
      volume_plan:   Math.max(0, parseFloat(r.volume_plan || r.volume || 0)),
      volume_actual: Math.max(0, parseFloat(r.volume_actual || 0)),
      status:        (r.status || 'PLAN').toUpperCase(),
      need_date:     r.need_date || r.due_date || '',
      planned_start: r.planned_start || '',
      planned_end:   r.planned_end || '',
      actual_start:  r.actual_start || '',
      actual_end:    r.actual_end || '',
      priority:      parseInt(r.priority || r.prio || 1),
      reason_code:   r.reason_code || r.reason || '',
    };

    const err = validateZpStatus(raw);
    if (err) {
      rejected.push({ line: idx + 2, data: raw, reason: err });
    } else {
      const toDate = s => s ? new Date(s) : null;
      records.push({
        ...raw,
        planned_start: toDate(raw.planned_start),
        planned_end:   toDate(raw.planned_end),
        actual_start:  toDate(raw.actual_start),
        actual_end:    toDate(raw.actual_end),
        reason_code:   raw.reason_code || null,
      });
    }
  });

  return { records, rejected };
}

function validateZpStatus(r) {
  if (!r.zp_id)      return 'brak zp_id';
  if (!r.product)    return 'brak product';
  if (!r.workcenter) return 'brak workcenter';
  if (!r.need_date)  return 'brak need_date';
  if (!['PLAN', 'WIP', 'CNF', 'CNC'].includes(r.status))
    return `nieznany status: ${r.status}`;
  return null;
}

// ─── AGREGATY ZP_STATUS (status nagłówka ZP) ─────────────────────────────────

export function calcZpHeaderStatus(records) {
  const byParent = {};
  records.forEach(r => {
    if (!byParent[r.parent_zp]) byParent[r.parent_zp] = [];
    byParent[r.parent_zp].push(r);
  });

  return Object.entries(byParent).map(([parent_zp, ops]) => {
    const first      = ops[0];
    const totalOps   = ops.length;
    const cnfOps     = ops.filter(o => o.status === 'CNF').length;
    const wipOps     = ops.filter(o => o.status === 'WIP').length;
    const cncOps     = ops.filter(o => o.status === 'CNC').length;
    const anyStarted = ops.some(o => o.actual_start);
    const lastActual = ops
      .filter(o => o.actual_end)
      .reduce((best, o) => (!best || o.actual_end > best) ? o.actual_end : best, null);

    let status = 'PLAN';
    if (cncOps === totalOps)                               status = 'CNC';
    else if (cnfOps === totalOps)                          status = 'CNF';
    else if (cnfOps > 0 || wipOps > 0 || anyStarted)      status = 'WIP';

    const progress_pct = Math.round((cnfOps / totalOps) * 100);
    const need         = first.need_date ? new Date(first.need_date + 'T23:59:59') : null;
    const isLate       = need && lastActual && lastActual > need;
    const isAtRisk     = need && status !== 'CNF' && new Date() > need;
    const volume_actual = Math.min(...ops.map(o => o.volume_actual));

    return {
      parent_zp,
      zs_id:           first.zs_id,
      pozycja:         first.pozycja,
      klient:          first.klient,
      product:         first.product,
      need_date:       first.need_date,
      priority:        first.priority,
      status,
      progress_pct,
      total_ops:       totalOps,
      cnf_ops:         cnfOps,
      volume_plan:     first.volume_plan,
      volume_actual,
      last_actual_end: lastActual,
      is_late:         isLate || false,
      is_at_risk:      isAtRisk || false,
      ops,
    };
  });
}

// ─── EKSPORT ZP_STATUS CSV ────────────────────────────────────────────────────

export function exportZpStatusCsv(zp, fwdZP, routing) {
  const routingByProduct = {};
  routing.forEach(r => {
    if (!routingByProduct[r.product]) routingByProduct[r.product] = [];
    routingByProduct[r.product].push(r);
  });
  Object.values(routingByProduct).forEach(ops =>
    ops.sort((a, b) => a.sequence - b.sequence)
  );

  const rows = [[
    'zp_id', 'parent_zp', 'zs_id', 'pozycja', 'klient', 'product',
    'operation', 'workcenter', 'sequence',
    'volume_plan', 'volume_actual', 'status',
    'need_date', 'planned_start', 'planned_end',
    'actual_start', 'actual_end', 'priority', 'reason_code',
  ]];

  zp.forEach(zpItem => {
    const ops = routingByProduct[zpItem.product] || [];
    ops.forEach((op, idx) => {
      const fwd = fwdZP.find(f =>
        (f.parent_zp === zpItem.zp_id || f.zp_id?.startsWith(zpItem.zp_id)) &&
        f.workcenter === op.workcenter &&
        f.sequence   === op.sequence
      );
      const zpOpId = `${zpItem.zp_id}/${String(idx + 1).padStart(2, '0')}`;
      const fmtDt  = dt => dt ? new Date(dt).toISOString().slice(0, 16).replace('T', ' ') : '';

      rows.push([
        zpOpId, zpItem.zp_id, zpItem.zs_id || '', zpItem.pozycja || 1,
        zpItem.klient || '', zpItem.product, op.operation, op.workcenter, op.sequence,
        zpItem.volume, 0, 'PLAN', zpItem.due_date,
        fwd ? fmtDt(fwd.start_dt) : '', fwd ? fmtDt(fwd.end_dt) : '',
        '', '', zpItem.priority || 1, '',
      ]);
    });
  });

  const csv = rows.map(r =>
    r.map(v => String(v).includes(',') ? `"${v}"` : v).join(',')
  ).join('\n');

  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'zp_status.csv';
  a.click();
}

// ─── POMOCNICZE ──────────────────────────────────────────────────────────────

export function hasReasonCodes(records) {
  return records.some(r => r.reason_code);
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function sum(arr) {
  return arr.reduce((s, v) => s + v, 0);
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m        = avg(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function isoWeek(dt) {
  const d = new Date(dt);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const wn    = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(wn).padStart(2, '0')}`;
}