import { useState, useMemo } from 'react';
import { T, s } from '../../constants/theme.js';
import { computeLoads, getAvail, localDateStr } from '../../utils/scheduler.js';
import { EmptyState } from '../common/EmptyState.jsx';

export function HeatmapTab({ routing, zp, globalLookups, wcSchedule, fwdZP = [], planStart, horizonDays = 14 }) {
  const [groupBy, setGroupBy] = useState('due'); // 'due' (wg terminu) | 'plan' (wg planu)

  const allWC = useMemo(() => [...new Set(routing.map(r => r.workcenter))].sort(), [routing.length]);

  // Cały zakres czasu planowania — od "Planuj od" do końca horyzontu (albo do
  // najpóźniejszego due_date, jeśli wykracza poza horyzont) — bez dziur, nawet
  // dla dni bez żadnego ZP/operacji.
  const dates = useMemo(() => {
    if (!planStart) return [...new Set(zp.map(z => z.due_date))].filter(Boolean).sort();

    const start = new Date(planStart + 'T12:00:00');
    let end = new Date(planStart + 'T12:00:00');
    end.setDate(end.getDate() + horizonDays);

    zp.forEach(z => {
      if (!z.due_date) return;
      const d = new Date(z.due_date + 'T12:00:00');
      if (d > end) end = d;
    });

    const result = [];
    const cur = new Date(start);
    while (cur <= end) {
      result.push(localDateStr(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }, [zp, planStart, horizonDays]);

  // wg terminu (istniejące zachowanie): obciążenie z ZP pogrupowanych po due_date.
  const loadsByDueDate = useMemo(() => {
    const c = {};
    dates.forEach(d => {
      const zpForDate = zp.filter(z => z.due_date === d);
      c[d] = zpForDate.length ? computeLoads(globalLookups.routingByProduct, zpForDate, wcSchedule, d) : {};
    });
    return c;
  }, [zp, dates, globalLookups, wcSchedule]);

  // wg planu (nowe): obciążenie z faktycznie zaplanowanych segmentów (fwdZP) —
  // pokazuje kiedy praca REALNIE ma się wykonać, nie kiedy ZP jest wymagane.
  const plannedLoadByWc = useMemo(() => {
    const m = {};
    fwdZP.forEach(op => {
      (op.segments || []).forEach(seg => {
        if (!seg.segStart) return;
        const d = localDateStr(seg.segStart);
        if (!m[op.workcenter]) m[op.workcenter] = {};
        m[op.workcenter][d] = (m[op.workcenter][d] || 0) + (seg.durH || 0);
      });
    });
    return m;
  }, [fwdZP]);

  function utilFor(wc, d) {
    if (groupBy === 'plan') {
      const load = plannedLoadByWc[wc]?.[d] || 0;
      const cap  = getAvail(wc, d + 'T12:00:00', wcSchedule);
      return cap > 0 ? load / cap : (load > 0 ? 999 : 0);
    }
    return loadsByDueDate[d]?.[wc]?.util || 0;
  }

  if (!dates.length) return <EmptyState icon="🌡️" title="Brak danych" sub="Wgraj pliki CSV" />;

  function hmStyle(u) {
    if (u <= 0)   return { bg: T.surface2, color: T.text3 };
    if (u <= .85) return { bg: 'rgba(34,197,94,0.12)',  color: '#22c55e' };
    if (u <= 1.0) return { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' };
    if (u <= 1.1) return { bg: 'rgba(249,115,22,0.15)', color: '#f97316' };
    if (u <= 1.3) return { bg: 'rgba(239,68,68,0.15)',  color: '#ef4444' };
    return               { bg: 'rgba(220,38,38,0.25)',  color: '#fca5a5' };
  }

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={s.cardTitle}>Obłożenie gniazd w czasie (Gniazdo × {groupBy === 'plan' ? 'Data planowana' : 'Termin'})</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={{ ...s.btn(groupBy === 'due'), fontSize: 12 }} onClick={() => setGroupBy('due')}>
            wg terminu
          </button>
          <button type="button" style={{ ...s.btn(groupBy === 'plan'), fontSize: 12 }} onClick={() => setGroupBy('plan')}>
            wg planu
          </button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ padding: '0 16px 12px 0', textAlign: 'left', fontSize: 10,
                fontWeight: 600, textTransform: 'uppercase', color: T.text3 }}>Gniazdo</th>
              {dates.map(d => (
                <th key={d} style={{ padding: '0 6px 12px', textTransform: 'uppercase',
                  color: T.text3, fontSize: 10 }}>{d.slice(5)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allWC.map(w => (
              <tr key={w}>
                <td style={{ padding: '6px 16px 6px 0', fontWeight: 700,
                  color: T.text, fontSize: 13 }}>{w}</td>
                {dates.map(d => {
                  const u = utilFor(w, d);
                  const hs = hmStyle(u);
                  return (
                    <td key={d} style={{ padding: 4 }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center',
                        justifyContent: 'center', width: 68, height: 28,
                        borderRadius: 6, background: hs.bg, color: hs.color,
                        fontSize: 11, fontWeight: 600, fontFamily: 'monospace' }}>
                        {u > 0 ? `${Math.round(u * 100)}%` : '–'}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
