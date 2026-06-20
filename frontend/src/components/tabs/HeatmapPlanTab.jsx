import { useState, useMemo } from 'react';
import { T, s } from '../../constants/theme.js';
import { localDateStr } from '../../utils/scheduler.js';
import { EmptyState } from '../common/EmptyState.jsx';

export function HeatmapPlanTab({ fwdZP = [], routing = [], wcSchedule = {} }) {

  const [showDetail, setShowDetail] = useState(false);
  const [expanded,   setExpanded]   = useState(new Set());
  const [mode,       setMode]       = useState('pct');
  const [groupBy,    setGroupBy]    = useState('plan'); // 'plan' | 'due'

  // Buduj mapę wc → wc_group i wc → machine_name z routingu
  const wcMeta = useMemo(() => {
    const map = {};
    routing.forEach(r => {
      if (!r.workcenter) return;
      if (!map[r.workcenter]) map[r.workcenter] = { group: r.wc_group || r.workcenter, name: r.machine_name || r.workcenter };
    });
    return map;
  }, [routing.length]);

  // Obciążenie z segmentów fwdZP per maszyna per dzień (lub per due_date)
  const { loadMap, dates, groups, lateKeys } = useMemo(() => {
    const loadMap = {};
    const dateSet = new Set();

    for (const op of fwdZP) {
      const wc = op.workcenter;
      if (!loadMap[wc]) loadMap[wc] = {};
      if (groupBy === 'due') {
        // Tryb "wg terminu" — całe durH operacji trafia do due_date ZP
        if (!op.due_date) continue;
        dateSet.add(op.due_date);
        loadMap[wc][op.due_date] = (loadMap[wc][op.due_date] || 0) + (op.durH || 0);
      } else {
        // Tryb "wg planu" — obciążenie wg faktycznych dat segmentów
        for (const seg of (op.segments || [])) {
          if (!seg.segStart) continue;
          const d = localDateStr(seg.segStart);
          dateSet.add(d);
          loadMap[wc][d] = (loadMap[wc][d] || 0) + seg.durH;
        }
      }
    }

    // Dodaj maszyny z routingu bez obciążenia
    routing.forEach(r => {
      if (r.workcenter && !loadMap[r.workcenter]) loadMap[r.workcenter] = {};
    });

    const dates = [...dateSet].sort();

    // Grupuj wg wc_group
    const groupMap = {};
    Object.keys(loadMap).forEach(wc => {
      const meta = wcMeta[wc] || { group: wc, name: wc };
      if (!groupMap[meta.group]) groupMap[meta.group] = [];
      if (!groupMap[meta.group].find(m => m.wc === wc))
        groupMap[meta.group].push({ wc, name: meta.name });
    });

    const groups = Object.entries(groupMap)
      .map(([wc2, machines]) => ({ wc2, machines: machines.sort((a,b) => a.wc.localeCompare(b.wc)) }))
      .sort((a, b) => a.wc2.localeCompare(b.wc2));

    // Zbiór kluczy "wc|date" gdzie pracuje spóźnione ZP
    const lateKeys = new Set();
    for (const op of fwdZP) {
      const isLate = op.realEnd && op.due_date &&
        new Date(op.realEnd) > new Date(op.due_date + 'T23:59:59');
      if (!isLate) continue;
      if (groupBy === 'due') {
        if (op.due_date) lateKeys.add(`${op.workcenter}|${op.due_date}`);
      } else {
        for (const seg of (op.segments || [])) {
          if (!seg.segStart) continue;
          lateKeys.add(`${op.workcenter}|${localDateStr(seg.segStart)}`);
        }
      }
    }

    return { loadMap, dates, groups, lateKeys };
  }, [fwdZP.length, routing.length, wcMeta, groupBy]);

  function getAvailH(wc, dateStr) {
    const sched = wcSchedule[wc];
    if (!sched) return 16;
    if (typeof sched === 'object' && !Array.isArray(sched)) return sched[dateStr] ?? 16;
    if (Array.isArray(sched)) {
      const d = new Date(dateStr);
      const idx = d.getDay() === 0 ? 6 : d.getDay() - 1;
      return sched[idx] ?? 0;
    }
    return 16;
  }

  function hmStyle(avail, load) {
    if (avail === 0 && load === 0) return { bg: T.surface2, color: T.text3, text: '0h' };
    if (load === 0)                return { bg: T.surface2, color: T.text3, text: '–' };
    const u = avail > 0 ? load / avail : 999;
    const text = mode === 'h' ? load.toFixed(1) + 'h' : Math.round(u * 100) + '%';
    if (u <= 0.85) return { bg: 'rgba(34,197,94,0.12)',  color: '#22c55e', text };
    if (u <= 1.00) return { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', text };
    if (u <= 1.10) return { bg: 'rgba(249,115,22,0.15)', color: '#f97316', text };
    return               { bg: 'rgba(239,68,68,0.2)',    color: '#ef4444', text };
  }

  function fmtDate(d) {
    const [, m, day] = d.split('-');
    return `${day}.${m}`;
  }

  function toggleExpand(wc2) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(wc2) ? next.delete(wc2) : next.add(wc2);
      return next;
    });
  }

  if (!fwdZP.length) return <EmptyState icon="📊" title="Brak danych planu" sub="Załaduj dane ERP aby zobaczyć heatmapę" />;
  if (!dates.length)  return <EmptyState icon="📊" title="Brak zaplanowanych operacji" sub="Harmonogram jest pusty" />;

  const thStyle = {
    padding: '0 6px 10px', fontSize: 10, fontWeight: 600,
    textTransform: 'uppercase', color: T.text3, textAlign: 'center',
    position: 'sticky', top: 0, background: T.bg, zIndex: 1,
  };

  return (
    <div style={s.card}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ ...s.cardTitle, margin: 0 }}>
          Heatmapa planu — gniazda × {groupBy === 'due' ? 'terminy' : 'dni'}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>

          {/* Przełącznik grupowania */}
          <div style={{ display: 'flex', gap: 2, background: T.surface3, borderRadius: 7, padding: 2 }}>
            {[['plan', '📅 wg planu'], ['due', '🏁 wg terminu']].map(([val, label]) => (
              <button key={val} onClick={() => setGroupBy(val)}
                style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 5, border: 'none',
                  background: groupBy === val ? T.accent : 'transparent',
                  color: groupBy === val ? '#fff' : T.text3, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>

          {/* Toggle maszyn */}
          <span style={{ fontSize: 12, color: T.text3 }}>Maszyny:</span>
          <div onClick={() => { setShowDetail(v => !v); setExpanded(new Set()); }}
            style={{
              width: 38, height: 20, borderRadius: 10, cursor: 'pointer',
              background: showDetail ? T.accent : T.surface3,
              border: `1px solid ${showDetail ? T.accent : T.border2}`,
              position: 'relative', transition: 'all .15s',
            }}>
            <div style={{
              position: 'absolute', top: 2, left: showDetail ? 19 : 2,
              width: 16, height: 16, borderRadius: '50%',
              background: '#fff', transition: 'left .15s',
            }} />
          </div>

          {/* Tryb wartości */}
          <select value={mode} onChange={e => setMode(e.target.value)}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6,
              border: `1px solid ${T.border2}`, background: T.surface2, color: T.text }}>
            <option value="pct">%</option>
            <option value="h">godz.</option>
          </select>
        </div>
      </div>

      {/* Info dla trybu wg terminu */}
      {groupBy === 'due' && (
        <div style={{ fontSize: 11, color: T.text3, marginBottom: 10, padding: '6px 10px',
          background: T.surface2, borderRadius: 6, border: `1px solid ${T.border}` }}>
          ℹ️ Tryb <strong style={{ color: T.text2 }}>wg terminu</strong> — kolumny = due_date ZP.
          Pokazuje ile godzin pracy przypada na każdy termin, niezależnie od faktycznego dnia wykonania.
        </div>
      )}

      {/* Tabela */}
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 240px)' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', padding: '0 16px 10px 0', minWidth: 180 }}>
                Gniazdo / Maszyna
              </th>
              {dates.map(d => (
                <th key={d} style={thStyle}>{fmtDate(d)}</th>
              ))}
              <th style={{ ...thStyle }}>Suma</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ wc2, machines }) => {
              const isOpen = expanded.has(wc2) || showDetail;

              // Agregat gniazda
              const aggLoad  = dates.map(d => machines.reduce((s, m) => s + (loadMap[m.wc]?.[d] || 0), 0));
              const aggAvail = dates.map(d => machines.reduce((s, m) => s + getAvailH(m.wc, d), 0));
              const totLoad  = aggLoad.reduce((s, v) => s + v, 0);
              const totAvail = aggAvail.reduce((s, v) => s + v, 0);
              const sumCell  = hmStyle(totAvail, totLoad);

              return [
                <tr key={wc2} onClick={() => toggleExpand(wc2)}
                  style={{ cursor: 'pointer', background: T.surface2 }}>
                  <td style={{ padding: '6px 16px 6px 0', fontWeight: 700,
                    color: T.text, fontSize: 13, whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 10, color: T.text3, marginRight: 4,
                      display: 'inline-block',
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                      transition: 'transform .15s' }}>▶</span>
                    {wc2}
                    <span style={{ fontSize: 10, color: T.text3, fontWeight: 400, marginLeft: 6 }}>
                      ({machines.length})
                    </span>
                  </td>
                  {aggLoad.map((load, i) => {
                    const hs = hmStyle(aggAvail[i], load);
                    const isLateCell = machines.some(m => lateKeys.has(`${m.wc}|${dates[i]}`));
                    return (
                      <td key={i} style={{ padding: 4, textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center',
                          justifyContent: 'center', minWidth: 56, height: 26,
                          borderRadius: 5, background: hs.bg, color: hs.color,
                          fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
                          boxShadow: isLateCell ? 'inset 0 0 0 2px #ef4444' : 'none',
                        }}>
                          {hs.text}
                        </div>
                      </td>
                    );
                  })}
                  <td style={{ padding: 4, textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center',
                      justifyContent: 'center', minWidth: 56, height: 26,
                      borderRadius: 5, background: sumCell.bg, color: sumCell.color,
                      fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>
                      {sumCell.text}
                    </div>
                  </td>
                </tr>,

                ...(isOpen ? machines.map(m => {
                  const mLoads = dates.map(d => loadMap[m.wc]?.[d] || 0);
                  const mAvail = dates.map(d => getAvailH(m.wc, d));
                  const mSum   = hmStyle(mAvail.reduce((s,v)=>s+v,0), mLoads.reduce((s,v)=>s+v,0));
                  return (
                    <tr key={m.wc} style={{ background: T.surface }}>
                      <td style={{ padding: '4px 16px 4px 16px', color: T.text2,
                        fontSize: 11, whiteSpace: 'nowrap' }}>
                        <span style={{ color: T.text3, marginRight: 4 }}>└</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{m.wc}</span>
                        <span style={{ color: T.text3, marginLeft: 6, fontSize: 10 }}>{m.name}</span>
                      </td>
                      {mLoads.map((load, i) => {
                        const hs = hmStyle(mAvail[i], load);
                        const isLateMCell = lateKeys.has(`${m.wc}|${dates[i]}`);
                        return (
                          <td key={i} style={{ padding: 4, textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center',
                              justifyContent: 'center', minWidth: 56, height: 24,
                              borderRadius: 5, background: hs.bg, color: hs.color,
                              fontSize: 11, fontWeight: 500, fontFamily: 'monospace',
                              boxShadow: isLateMCell ? 'inset 0 0 0 2px #ef4444' : 'none',
                            }}>
                              {hs.text}
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ padding: 4, textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center',
                          justifyContent: 'center', minWidth: 56, height: 24,
                          borderRadius: 5, background: mSum.bg, color: mSum.color,
                          fontSize: 11, fontWeight: 600, fontFamily: 'monospace' }}>
                          {mSum.text}
                        </div>
                      </td>
                    </tr>
                  );
                }) : []),
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* Legenda */}
      <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
        {[
          { bg: 'rgba(34,197,94,0.12)',  color: '#22c55e', label: '≤85% OK'          },
          { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: '85–100% Uwaga'    },
          { bg: 'rgba(249,115,22,0.15)', color: '#f97316', label: '100–110%'          },
          { bg: 'rgba(239,68,68,0.2)',   color: '#ef4444', label: '>110% Przeciążone' },
        ].map(({ bg, color, label }) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 11, color: T.text3 }}>
            <span style={{ background: bg, color, display: 'inline-block',
              padding: '1px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>■</span>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}