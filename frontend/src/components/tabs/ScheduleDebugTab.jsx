import { useState, useMemo } from 'react';
import { T } from '../../constants/theme.js';
import { fmtDt } from '../../utils/scheduler.js';

export function ScheduleDebugTab({ fwdZP = [], zpStatus = [], planStart }) {

  const [filterZP,   setFilterZP]   = useState('');
  const [filterWC,   setFilterWC]   = useState('');
  const [filterLate, setFilterLate] = useState('');
  const [sortCol,    setSortCol]    = useState('start_dt');
  const [sortAsc,    setSortAsc]    = useState(true);

  const lateSet = useMemo(() =>
    new Set(zpStatus.filter(z => z.late || z.delayH > 0 || z.backDelay > 0).map(z => z.zp_id)),
  [zpStatus]);

  // Zbierz konflikty per segment (nie per start_dt/end_dt — operacje mogą być segmentowane)
  const segConflicts = useMemo(() => {
    const conflicts = new Set();
    const machines = [...new Set(fwdZP.map(op => op.workcenter))];
    for (const wc of machines) {
      const segs = [];
      fwdZP.filter(op => op.workcenter === wc).forEach(op => {
        (op.segments || []).forEach(seg => {
          segs.push({ parent_zp: op.parent_zp, from: new Date(seg.segStart), to: new Date(seg.segEnd) });
        });
      });
      segs.sort((a, b) => a.from - b.from);
      for (let i = 1; i < segs.length; i++) {
        if (segs[i].from < segs[i-1].to) {
          conflicts.add(segs[i].parent_zp);
          conflicts.add(segs[i-1].parent_zp);
        }
      }
    }
    return conflicts;
  }, [fwdZP]);

  const ops = useMemo(() => fwdZP.map(op => ({
    ...op,
    _late: lateSet.has(op.parent_zp) ||
           (op.end_dt && op.due_date &&
            new Date(op.end_dt) > new Date(op.due_date + 'T23:59:59')),
    _conflict: segConflicts.has(op.parent_zp),
  })), [fwdZP, lateSet, segConflicts]);

  const filtered = useMemo(() => {
    let rows = ops;
    if (filterZP.trim())
      rows = rows.filter(r =>
        (r.parent_zp||'').toLowerCase().includes(filterZP.toLowerCase()) ||
        (r.klient||'').toLowerCase().includes(filterZP.toLowerCase()));
    if (filterWC.trim())
      rows = rows.filter(r =>
        (r.workcenter||'').toLowerCase().includes(filterWC.toLowerCase()) ||
        (r.machine_name||'').toLowerCase().includes(filterWC.toLowerCase()));
    if (filterLate === 'late') rows = rows.filter(r => r._late);
    if (filterLate === 'ok')   rows = rows.filter(r => !r._late);
    return rows;
  }, [ops, filterZP, filterWC, filterLate]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (va instanceof Date) va = va.getTime();
      if (vb instanceof Date) vb = vb.getTime();
      if (va == null) va = '';
      if (vb == null) vb = '';
      if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? va - vb : vb - va;
    });
  }, [filtered, sortCol, sortAsc]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(v => !v);
    else { setSortCol(col); setSortAsc(true); }
  }

  function indicator(col) {
    if (sortCol !== col) return '';
    return sortAsc ? ' ▲' : ' ▼';
  }

  const planStartDt = planStart ? new Date(planStart + 'T00:00:00') : null;

  const stats = useMemo(() => ({
    ops:    filtered.length,
    zp:     new Set(filtered.map(r => r.parent_zp || r.zp_id)).size,
    wc:     new Set(filtered.map(r => r.workcenter)).size,
    late:   new Set(ops.filter(r => r._late).map(r => r.parent_zp || r.zp_id)).size,
    beforePlan: filtered.filter(r => planStartDt && r.start_dt && new Date(r.start_dt) < planStartDt).length,
  }), [filtered, ops, planStartDt]);

  const thStyle = (col) => ({
    padding: '6px 8px',
    textAlign: 'left',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '.06em',
    textTransform: 'uppercase',
    color: sortCol === col ? T.accent : T.text3,
    borderBottom: `1px solid ${T.border}`,
    background: T.surface2,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  });

  const tdStyle = {
    padding: '4px 8px',
    borderBottom: `1px solid ${T.border}`,
    fontSize: 11,
    whiteSpace: 'nowrap',
  };

  const mono = { fontFamily: 'monospace' };

  if (!fwdZP.length) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        padding: 48, color: T.text3, gap: 12 }}>
        <div style={{ fontSize: 32 }}>📋</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: T.text2 }}>Brak danych harmonogramu</div>
        <div style={{ fontSize: 12 }}>Wgraj plik ERP i załaduj demo aby zobaczyć wyniki planowania.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 0 16px' }}>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {[
          { label: 'Operacji',           val: stats.ops,        color: T.text },
          { label: 'ZP',                 val: stats.zp,         color: T.text },
          { label: 'Gniazd',             val: stats.wc,         color: T.text },
          { label: 'Spóźnionych ZP',     val: stats.late,       color: stats.late > 0 ? T.bn : T.ok },
          { label: 'Przed planStart',    val: stats.beforePlan, color: stats.beforePlan > 0 ? T.warn : T.ok },
          { label: 'Nakładki segm.',      val: segConflicts.size, color: segConflicts.size > 0 ? T.bn : T.ok },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ background: T.surface2, borderRadius: 8,
            padding: '10px 12px', border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 10, color: T.text3, marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Filtry */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { val: filterZP,   set: setFilterZP,   ph: 'ZP / klient...' },
          { val: filterWC,   set: setFilterWC,   ph: 'Gniazdo / maszyna...' },
        ].map(({ val, set, ph }) => (
          <input key={ph} value={val} onChange={e => set(e.target.value)} placeholder={ph}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6,
              border: `1px solid ${T.border2}`, background: T.surface2,
              color: T.text, outline: 'none', width: 180 }} />
        ))}
        <select value={filterLate} onChange={e => setFilterLate(e.target.value)}
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6,
            border: `1px solid ${T.border2}`, background: T.surface2, color: T.text }}>
          <option value=''>Wszystkie</option>
          <option value='late'>Tylko spóźnione</option>
          <option value='ok'>Tylko OK</option>
        </select>
        {(filterZP || filterWC || filterLate) && (
          <button onClick={() => { setFilterZP(''); setFilterWC(''); setFilterLate(''); }}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6,
              border: `1px solid ${T.border2}`, background: 'transparent',
              color: T.text3, cursor: 'pointer' }}>
            ✕ Wyczyść
          </button>
        )}
        <span style={{ fontSize: 11, color: T.text3, marginLeft: 'auto' }}>
          {sorted.length} / {ops.length} operacji
        </span>
      </div>

      {/* Tabela */}
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 320px)',
        border: `1px solid ${T.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              {[
                { col: null,        label: '#'          },
                { col: 'parent_zp', label: 'ZP'         },
                { col: 'klient',    label: 'Klient'     },
                { col: 'sequence',  label: 'OP'         },
                { col: 'workcenter',label: 'Gniazdo'    },
                { col: 'start_dt',  label: 'Start'      },
                { col: 'end_dt',    label: 'Koniec'     },
                { col: 'durH',      label: 'Czas [h]'   },
                { col: 'segs',      label: 'Segm.'      },
                { col: 'due_date',  label: 'Due date'   },
                { col: '_late',     label: 'Status'     },
              ].map(({ col, label }) => (
                <th key={label} style={thStyle(col)}
                  onClick={() => col && toggleSort(col)}>
                  {label}{col ? indicator(col) : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((op, i) => {
              const late = op._late;
              const beforePlan = planStartDt && op.start_dt && new Date(op.start_dt) < planStartDt;
              const endAfterDue = op.end_dt && op.due_date &&
                new Date(op.end_dt) > new Date(op.due_date + 'T23:59:59');
              const rowBg = late ? 'rgba(248,113,113,0.04)' : 'transparent';

              return (
                <tr key={`${op.zp_id}-${i}`} style={{ background: rowBg }}>
                  <td style={{ ...tdStyle, color: T.text3, ...mono }}>{i + 1}</td>
                  <td style={tdStyle}>
                    <code style={{ fontSize: 11, color: T.accent,
                      background: T.accentBg, padding: '1px 5px', borderRadius: 4 }}>
                      {op.parent_zp || op.zp_id || '—'}
                    </code>
                  </td>
                  <td style={{ ...tdStyle, color: T.text2, maxWidth: 130,
                    overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {op.klient || '—'}
                  </td>
                  <td style={{ ...tdStyle, ...mono, color: T.text2 }}>
                    {String(op.sequence || '').padStart(3, '0')}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-block', padding: '1px 7px',
                      borderRadius: 10, fontSize: 11,
                      background: T.surface3, color: T.text2,
                      border: `1px solid ${T.border}` }}>
                      {op.workcenter || '—'}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, ...mono,
                    color: beforePlan ? T.warn : T.text }}>
                    {op.start_dt ? fmtDt(op.start_dt) : '—'}
                    {beforePlan && <span title="Przed planStart" style={{ marginLeft: 4, color: T.warn }}>⚠</span>}
                    {(op.segments||[]).length > 1 && <span title={`${(op.segments||[]).length} segmenty`} style={{ marginLeft: 4, fontSize: 9, color: T.text3 }}>×{(op.segments||[]).length}</span>}
                  </td>
                  <td style={{ ...tdStyle, ...mono,
                    color: endAfterDue ? T.bn : T.text,
                    fontWeight: endAfterDue ? 600 : 400 }}>
                    {op.end_dt ? fmtDt(op.end_dt) : '—'}
                    {endAfterDue && <span title="Po due date" style={{ marginLeft: 4 }}>🔴</span>}
                  </td>
                  <td style={{ ...tdStyle, ...mono, color: T.text2 }}>
                    {(op.durH || 0).toFixed(2)}
                  </td>
                  <td style={{ ...tdStyle, ...mono, color: T.text3 }}>
                    {(op.segments || []).length}
                  </td>
                  <td style={{ ...tdStyle, ...mono, color: T.text3 }}>
                    {op.due_date || '—'}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block', padding: '2px 7px',
                      borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: late ? 'rgba(248,113,113,0.15)' : 'rgba(34,197,94,0.12)',
                      color: late ? T.bn : T.ok,
                    }}>
                      {late ? 'SPÓŹNIONE' : 'OK'}
                    </span>
                    {op._conflict && (
                      <span style={{ marginLeft: 4, fontSize: 10, color: T.bn, fontWeight: 600 }}>⚡ NAKŁ</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legenda */}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: T.text3 }}>
        <span><span style={{ color: T.warn }}>⚠</span> — operacja przed datą planStart</span>
        <span><span style={{ color: T.bn }}>🔴</span> — koniec po due date</span>
        <span style={{ color: T.warn }}>żółty start</span><span> — przed planStart</span>
        <span style={{ color: T.bn }}>czerwony koniec</span><span> — przekroczony termin</span>
      </div>
    </div>
  );
}