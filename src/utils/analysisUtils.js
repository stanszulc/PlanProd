import { safeSplitCSV } from './scheduler.js';

// ─── PARSER ──────────────────────────────────────────────────────────────────

export function parseHistory(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { records: [], rejected: [] };
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = safeSplitCSV(lines[0], sep).map(h => h.toLowerCase());

  const records = [];
  const rejected = [];

  lines.slice(1).forEach((line, idx) => {
    const vals = safeSplitCSV(line, sep);
    const r = {};
    headers.forEach((h, i) => { r[h] = (vals[i] || '').trim(); });

    const raw = {
      zp_id:       r.zp_id || r.zp || '',
      product:     r.product || '',
      workcenter:  (r.workcenter || r.wc || '').toUpperCase(),
      operation:   r.operation || r.op || '',
      start_ts:    r.start_ts || r.start || '',
      end_ts:      r.end_ts   || r.end   || '',
      volume:      Math.max(0, parseFloat(r.volume || r.vol || r.qty || 0)),
      reason_code: r.reason_code || r.reason || '',
    };

    const rejectReason = validateRecord(raw, idx + 2);
    if (rejectReason) {
      rejected.push({ line: idx + 2, data: raw, reason: rejectReason });
    } else {
      records.push(raw);
    }
  });

  return { records, rejected };
}

function validateRecord(r, lineNum) {
  if (!r.zp_id)      return 'brak zp_id';
  if (!r.workcenter) return 'brak workcenter';
  if (!r.operation)  return 'brak operation';
  if (!r.start_ts)   return 'brak start_ts';
  if (!r.end_ts)     return 'brak end_ts';
  const s = new Date(r.start_ts);
  const e = new Date(r.end_ts);
  if (isNaN(s.getTime())) return `nieprawidłowy start_ts: ${r.start_ts}`;
  if (isNaN(e.getTime())) return `nieprawidłowy end_ts: ${r.end_ts}`;
  if (e <= s)             return `end_ts <= start_ts`;
  return null;
}

// ─── SANITIZE + ENRICH ───────────────────────────────────────────────────────

export function sanitizeHistoryData(records, rejected) {
  const sanitized = [];
  const allRejected = [...rejected];

  records.forEach((r, idx) => {
    const start = new Date(r.start_ts);
    const end   = new Date(r.end_ts);
    const actual_ct_min = (end - start) / 60000;

    if (actual_ct_min < 0.1) {
      allRejected.push({ line: idx, data: r, reason: `actual_ct_min zbyt niski: ${actual_ct_min.toFixed(2)} min` });
      return;
    }
    if (actual_ct_min > 72 * 60) {
      allRejected.push({ line: idx, data: r, reason: `actual_ct_min nierealnie wysoki: ${(actual_ct_min/60).toFixed(1)} h` });
      return;
    }

    sanitized.push({
      ...r,
      start_ts:      start,
      end_ts:        end,
      actual_ct_min: +actual_ct_min.toFixed(2),
      reason_code:   r.reason_code || null,
      type:          'history',
    });
  });

  return { sanitized, rejected: allRejected };
}

// ─── JOIN Z ROUTING (std_ct_min) ─────────────────────────────────────────────

export function enrichWithStandards(sanitized, routing) {
  // Buduj lookup: product+workcenter+operation → ct_min
  const lookup = {};
  routing.forEach(r => {
    const key = `${r.product}||${r.workcenter}||${r.operation}`;
    lookup[key] = r.ct_min;
  });

  // Fallback: product+workcenter (jeśli operacja nie pasuje dokładnie)
  const wcLookup = {};
  routing.forEach(r => {
    const key = `${r.product}||${r.workcenter}`;
    if (!wcLookup[key]) wcLookup[key] = [];
    wcLookup[key].push(r.ct_min);
  });

  return sanitized.map(r => {
    const key     = `${r.product}||${r.workcenter}||${r.operation}`;
    const wcKey   = `${r.product}||${r.workcenter}`;
    const std     = lookup[key] ?? (wcLookup[wcKey] ? avg(wcLookup[wcKey]) : null);
    const dev_min = std != null ? +(r.actual_ct_min - std).toFixed(2) : null;
    const dev_pct = std != null ? +((dev_min / std) * 100).toFixed(1) : null;
    return { ...r, std_ct_min: std, deviation_min: dev_min, deviation_pct: dev_pct };
  });
}

// ─── WAIT TIME ───────────────────────────────────────────────────────────────
// Wylicza wait_min = start[n] - end[n-1] per zp_id, posortowane po start_ts

export function calcWaitTimes(enriched) {
  // Pogrupuj per zp_id
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
// wcLoad pochodzi z wcSchedule (obciążenie gniazda)

export function calcCapacityLoss(records, wcLoadMap) {
  return records.map(r => {
    // wcLoad w % — cap do 100 żeby nie pompować wyników przy przeciążeniu
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

    // Stabilność: CV < 10% → stable, < 25% → moderate, >= 25% → unstable
    const stability = cv_pct < 10 ? 'stable' : cv_pct < 25 ? 'moderate' : 'unstable';

    return {
      workcenter: wc,
      count: recs.length,
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
  // Klucz tygodnia: ISO week string "2026-W19"
  const byWeekWc = {};

  records.forEach(r => {
    const week   = isoWeek(r.start_ts);
    const key    = `${week}||${r.workcenter}`;
    if (!byWeekWc[key]) byWeekWc[key] = { week, workcenter: r.workcenter, wait_min: 0, cap_loss: 0, count: 0 };
    byWeekWc[key].wait_min  += r.wait_min ?? 0;
    byWeekWc[key].cap_loss  += r.capacity_loss_h ?? 0;
    byWeekWc[key].count     += 1;
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
  const filtered = filterWc ? records.filter(r => r.workcenter === filterWc) : records;
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
    const pct  = total > 0 ? +((s.count / total) * 100).toFixed(1) : 0;
    cumPct    += pct;
    return { ...s, pct, cum_pct: +cumPct.toFixed(1), wait_h: +(s.wait_min / 60).toFixed(2) };
  });
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
  const m = avg(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function isoWeek(dt) {
  const d = new Date(dt);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(wn).padStart(2, '0')}`;
}