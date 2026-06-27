import { useState, useMemo, useEffect, useRef } from 'react';
import { T } from '../../constants/theme.js';
import { fmtDt } from '../../utils/scheduler.js';

export function ScheduleDebugTab({ fwdZP = [], zpStatus = [], planStart, scheduleConfig = {},
  zpList = [], routingByProduct = {}, wcSchedule = {} }) {

  const [filterZP,   setFilterZP]   = useState('');
  const [filterWC,   setFilterWC]   = useState('');
  const [filterLate, setFilterLate] = useState('');
  const [sortCol,    setSortCol]    = useState('start_dt');
  const [sortAsc,    setSortAsc]    = useState(true);

  // ── PORÓWNANIE METOD ─────────────────────────────────────────────────────
  const [comparing,    setComparing]    = useState(false);
  const [orToolsRunning,  setOrToolsRunning]  = useState(false);
  const [greedyRunning,   setGreedyRunning]   = useState(false);
  const [saRunning,       setSaRunning]       = useState(false);
  const [orToolsAvailable, setOrToolsAvailable] = useState(null); // null=nieznany, true/false
  const [compareResults, setCompareResults] = useState(null);
  const workersRef = useRef([]);

  function runComparison() {
    if (!zpList.length || !Object.keys(routingByProduct).length) return;
    setComparing(true);
    setCompareResults(null);

    const methods = ['cr', 'due_date', 'slack', 'atc'];
    const modes   = ['asap', 'alap'];
    const configs = [];
    methods.forEach(m => modes.forEach(mode => configs.push({ urgencyMethod: m, schedulingMode: mode })));

    const results = {};
    let done = 0;

    // Terminate poprzednie workery
    workersRef.current.forEach(w => w.terminate());
    workersRef.current = [];

    configs.forEach(cfg => {
      const worker = new Worker(
        new URL('../../utils/scheduler.worker.js', import.meta.url),
        { type: 'module' }
      );
      workersRef.current.push(worker);

      let timer;

      worker.onmessage = (e) => {
        if (e.data.type === 'DONE') {
          clearTimeout(timer);
          const { zpStatus: zps } = e.data.payload;
          const lateCount = new Set(zps.filter(z => z.late || z.delayH > 0).map(z => z.zp_id)).size;
          const totalDelay = zps.reduce((s, z) => s + (z.delayH || 0), 0);
          const maxDelay   = Math.max(...zps.map(z => z.delayH || 0));
          const key = `${cfg.urgencyMethod}_${cfg.schedulingMode}`;
          results[key] = { lateCount, totalDelay, maxDelay, method: cfg.urgencyMethod, mode: cfg.schedulingMode };
          done++;
          worker.terminate();
          if (done === configs.length) {
            setCompareResults({ ...results });
            setComparing(false);
          }
        }
      };
      worker.onerror = () => { clearTimeout(timer); done++; worker.terminate(); if (done === configs.length) { setCompareResults({ ...results }); setComparing(false); } };

      timer = setTimeout(() => {
        done++;
        worker.terminate();
        console.warn('Worker timeout:', cfg);
        if (done === configs.length) { setCompareResults({ ...results }); setComparing(false); }
      }, 30000);

      worker.postMessage({
        type: 'SCHEDULE',
        payload: {
          zpList,
          routingByProduct,
          wcSchedule,
          planStart: planStart || new Date().toISOString().slice(0,10),
          config: { ...scheduleConfig, ...cfg },
        }
      });
    });
  }

  useEffect(() => {
    return () => workersRef.current.forEach(w => w.terminate());
  }, []);

  async function runPythonMethod(method, key, setRunning, label) {
    if (!zpList.length || !Object.keys(routingByProduct).length) return;
    setRunning(true);
    try {
      const res = await fetch('http://localhost:8765/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zpList,
          routingByProduct,
          wcSchedule,
          planStart: planStart || new Date().toISOString().slice(0,10),
          config: { ...scheduleConfig, cpSatTimeLimitSeconds: 30, method },
        }),
      });
      const data = await res.json();
      console.log(`${label} response:`, data);
      if (data.error || data.detail) { console.error(`${label} error:`, data.error || data.detail); return; }
      if (data.lateCount === undefined) { console.error(`${label}: brak lateCount`, data); return; }
      setCompareResults(prev => ({
        ...(prev || {}),
        [key]: {
          lateCount:  data.lateCount,
          totalDelay: data.totalDelay,
          maxDelay:   data.maxDelay,
          method:     key,
          mode:       label,
          elapsed:    data.elapsed || 0,
        },
      }));
    } catch(e) {
      console.error(`${label} fetch error:`, e);
    } finally {
      setRunning(false);
    }
  }

  // Sprawdź czy serwer OR-Tools jest dostępny
  useEffect(() => {
    fetch('http://localhost:8765/health', { signal: AbortSignal.timeout(2000) })
      .then(r => r.ok ? setOrToolsAvailable(true) : setOrToolsAvailable(false))
      .catch(() => setOrToolsAvailable(false));
  }, []);

  async function runOrTools() {
    await runPythonMethod('/optimize', 'ortools_cpsat', setOrToolsRunning, 'CP-SAT');
  }

  // ── GŁÓWNA TABELA ────────────────────────────────────────────────────────
  const lateSet = useMemo(() =>
    new Set(zpStatus.filter(z => z.late || z.delayH > 0).map(z => z.zp_id)),
  [zpStatus]);

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
           (op.end_dt && op.due_date && new Date(op.end_dt) > new Date(op.due_date + 'T23:59:59')),
    _conflict: segConflicts.has(op.parent_zp),
  })), [fwdZP, lateSet, segConflicts]);

  const filtered = useMemo(() => {
    let rows = ops;
    if (filterZP.trim()) rows = rows.filter(r =>
      (r.parent_zp||'').toLowerCase().includes(filterZP.toLowerCase()) ||
      (r.klient||'').toLowerCase().includes(filterZP.toLowerCase()));
    if (filterWC.trim()) rows = rows.filter(r =>
      (r.workcenter||'').toLowerCase().includes(filterWC.toLowerCase()));
    if (filterLate === 'late') rows = rows.filter(r => r._late);
    if (filterLate === 'ok')   rows = rows.filter(r => !r._late);
    return rows;
  }, [ops, filterZP, filterWC, filterLate]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (va instanceof Date) va = va.getTime();
    if (vb instanceof Date) vb = vb.getTime();
    if (va == null) va = ''; if (vb == null) vb = '';
    if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortAsc ? va - vb : vb - va;
  }), [filtered, sortCol, sortAsc]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(v => !v);
    else { setSortCol(col); setSortAsc(true); }
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
    padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600,
    letterSpacing: '.06em', textTransform: 'uppercase',
    color: sortCol === col ? T.accent : T.text3,
    borderBottom: `1px solid ${T.border}`, background: T.surface2,
    cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
    position: 'sticky', top: 0, zIndex: 1,
  });
  const tdStyle = { padding: '4px 8px', borderBottom: `1px solid ${T.border}`, fontSize: 11, whiteSpace: 'nowrap' };
  const mono = { fontFamily: 'monospace' };

  if (!fwdZP.length) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding: 48, color: T.text3, gap: 12 }}>
      <div style={{ fontSize: 32 }}>📋</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: T.text2 }}>Brak danych harmonogramu</div>
    </div>
  );

  const methodLabel = { cr: 'CR', due_date: 'Due date', slack: 'Slack', atc: 'ATC', ortools: 'OR-Tools CP-SAT', ortools_cpsat: 'OR-Tools CP-SAT', greedy_ls: 'Greedy LS', sa: 'Simul. Annealing' };
  const modeLabel   = { asap: '⏩ ASAP', alap: '⏪ ALAP', OPTIMAL: '✅ OPTIMAL', FEASIBLE: '🔶 FEASIBLE', UNKNOWN: '❓ UNKNOWN' };

  // Znajdź najlepszy wynik (min lateCount)
  const bestLate = compareResults
    ? Math.min(...Object.values(compareResults).map(r => r.lateCount))
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 0 16px' }}>

      {/* ── PANEL USTAWIEŃ ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 14px',
        background: T.surface2, borderRadius: 8, border: `1px solid ${T.border}`,
        alignItems: 'center', fontSize: 12 }}>
        <span style={{ color: T.text3, fontWeight: 600, fontSize: 11, letterSpacing: '.06em',
          textTransform: 'uppercase' }}>⚙️ Ustawienia</span>
        <div style={{ width: 1, height: 16, background: T.border, margin: '0 4px' }} />
        <span style={{ color: T.text3 }}>Tryb:</span>
        <span style={{ fontWeight: 700, color: T.accent, background: T.accentBg, padding: '2px 8px', borderRadius: 4 }}>
          {scheduleConfig.schedulingMode === 'alap' ? '⏪ ALAP' : '⏩ ASAP'}
        </span>
        <div style={{ width: 1, height: 16, background: T.border, margin: '0 4px' }} />
        <span style={{ color: T.text3 }}>Planuj od:</span>
        <span style={{ fontWeight: 700, color: T.text, fontFamily: 'monospace' }}>{planStart || '—'}</span>
        <div style={{ width: 1, height: 16, background: T.border, margin: '0 4px' }} />
        <span style={{ color: T.text3 }}>Bufor VIP:</span>
        <span style={{ fontWeight: 700, color: T.text }}>{scheduleConfig.vipBufferDays ?? 2}d</span>
        <div style={{ width: 1, height: 16, background: T.border, margin: '0 4px' }} />
        <span style={{ color: T.text3 }}>Bufor bezp.:</span>
        <span style={{ fontWeight: 700, color: T.text }}>{scheduleConfig.safetyBufferDays ?? 1}d</span>
        <div style={{ width: 1, height: 16, background: T.border, margin: '0 4px' }} />
        <span style={{ color: T.text3 }}>Horyzont:</span>
        <span style={{ fontWeight: 700, color: T.text }}>{scheduleConfig.horizonDays ?? 14}d</span>
        <div style={{ width: 1, height: 16, background: T.border, margin: '0 4px' }} />
        <span style={{ color: T.text3 }}>Sortowanie:</span>
        <span style={{ fontWeight: 700, color: T.text }}>{scheduleConfig.urgencyMethod || 'cr'}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={runComparison} disabled={comparing || !zpList.length}
            style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600,
              borderRadius: 7, border: 'none', cursor: comparing ? 'wait' : 'pointer',
              background: comparing ? T.surface3 : T.accent,
              color: comparing ? T.text3 : '#fff', opacity: !zpList.length ? 0.5 : 1 }}>
            {comparing ? '⏳ Liczę 6 scenariuszy...' : '⚖️ Porównaj metody'}
          </button>
          <button onClick={runOrTools}
            disabled={orToolsRunning || !zpList.length || orToolsAvailable === false}
            title={orToolsAvailable === false ? 'Uruchom: py server.py' : 'OR-Tools CP-SAT'}
            style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600,
              borderRadius: 7, border: `1px solid ${orToolsAvailable === false ? T.border2 : '#7c3aed'}`,
              cursor: orToolsRunning ? 'wait' : orToolsAvailable === false ? 'not-allowed' : 'pointer',
              background: orToolsRunning ? T.surface3 : orToolsAvailable === false ? T.surface2 : 'rgba(124,58,237,0.15)',
              color: orToolsAvailable === false ? T.text3 : '#a78bfa', opacity: !zpList.length ? 0.5 : 1 }}>
            {orToolsRunning ? '⏳ OR-Tools...' : orToolsAvailable === false ? '🔌 OR-Tools offline' : '🧮 CP-SAT'}
          </button>
          <button onClick={() => runPythonMethod('greedy', 'greedy_ls', setGreedyRunning, 'Greedy LS')}
            disabled={greedyRunning || !zpList.length || orToolsAvailable === false}
            style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600,
              borderRadius: 7, border: `1px solid ${orToolsAvailable === false ? T.border2 : '#059669'}`,
              cursor: greedyRunning ? 'wait' : 'pointer',
              background: greedyRunning ? T.surface3 : 'rgba(5,150,105,0.15)',
              color: orToolsAvailable === false ? T.text3 : '#34d399', opacity: !zpList.length ? 0.5 : 1 }}>
            {greedyRunning ? '⏳ Greedy...' : '🔀 Greedy LS'}
          </button>
          <button onClick={() => runPythonMethod('sa', 'sa', setSaRunning, 'SA')}
            disabled={saRunning || !zpList.length || orToolsAvailable === false}
            style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600,
              borderRadius: 7, border: `1px solid ${orToolsAvailable === false ? T.border2 : '#d97706'}`,
              cursor: saRunning ? 'wait' : 'pointer',
              background: saRunning ? T.surface3 : 'rgba(217,119,6,0.15)',
              color: orToolsAvailable === false ? T.text3 : '#fbbf24', opacity: !zpList.length ? 0.5 : 1 }}>
            {saRunning ? '⏳ SA...' : '🌡️ Simul. Annealing'}
          </button>
        </div>
      </div>

      {/* ── TABELA PORÓWNAWCZA ── */}
      {compareResults && (
        <div style={{ background: T.surface2, borderRadius: 8, border: `1px solid ${T.border}`, padding: '12px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text2, marginBottom: 10 }}>
            ⚖️ Porównanie metod — {zpList.length} ZP
          </div>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead>
              <tr>
                {['Metoda', 'Tryb', 'Spóźnione ZP', 'Suma opóźnień [h]', 'Max opóźnienie [h]'].map(h => (
                  <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10,
                    fontWeight: 600, color: T.text3, borderBottom: `1px solid ${T.border}`,
                    textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(compareResults)
                .sort((a, b) => a.lateCount - b.lateCount)
                .map((r, i) => {
                  const isBest = r.lateCount === bestLate;
                  const isCurrent = r.method === scheduleConfig.urgencyMethod &&
                                   r.mode === scheduleConfig.schedulingMode;
                  return (
                    <tr key={i} style={{
                      background: isBest ? 'rgba(34,197,94,0.06)' : 'transparent',
                    }}>
                      <td style={{ padding: '7px 12px', borderBottom: `1px solid ${T.border}`,
                        fontWeight: 600, color: T.text }}>
                        {isBest && <span style={{ marginRight: 6 }}>🏆</span>}
                        {isCurrent && <span style={{ marginRight: 6, color: T.accent }}>●</span>}
                        {methodLabel[r.method] || r.method}
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: `1px solid ${T.border}`, color: T.text2 }}>
                        {modeLabel[r.mode] || r.mode}
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: `1px solid ${T.border}`,
                        fontWeight: 700, fontFamily: 'monospace',
                        color: r.lateCount === bestLate ? T.ok : r.lateCount > bestLate * 1.2 ? T.bn : T.warn }}>
                        {r.lateCount}
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: `1px solid ${T.border}`,
                        fontFamily: 'monospace', color: T.text2 }}>
                        {r.totalDelay.toFixed(1)}h
                      </td>
                      <td style={{ padding: '7px 12px', borderBottom: `1px solid ${T.border}`,
                        fontFamily: 'monospace', color: T.text3 }}>
                        {r.maxDelay.toFixed(1)}h
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 8 }}>
            🏆 = najlepsza metoda · ● = aktualnie wybrana
          </div>
        </div>
      )}

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
        {[
          { label: 'Operacji',        val: stats.ops,         color: T.text },
          { label: 'ZP',              val: stats.zp,          color: T.text },
          { label: 'Gniazd',          val: stats.wc,          color: T.text },
          { label: 'Spóźnionych ZP',  val: stats.late,        color: stats.late > 0 ? T.bn : T.ok },
          { label: 'Przed planStart', val: stats.beforePlan,  color: stats.beforePlan > 0 ? T.warn : T.ok },
          { label: 'Nakładki segm.',  val: segConflicts.size, color: segConflicts.size > 0 ? T.bn : T.ok },
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
          { val: filterZP, set: setFilterZP, ph: 'ZP / klient...' },
          { val: filterWC, set: setFilterWC, ph: 'Gniazdo / maszyna...' },
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
              color: T.text3, cursor: 'pointer' }}>✕ Wyczyść</button>
        )}
        <span style={{ fontSize: 11, color: T.text3, marginLeft: 'auto' }}>
          {sorted.length} / {ops.length} operacji
        </span>
      </div>

      {/* Tabela */}
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 420px)',
        border: `1px solid ${T.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              {[
                { col: null,         label: '#'        },
                { col: 'parent_zp',  label: 'ZP'       },
                { col: 'klient',     label: 'Klient'   },
                { col: 'sequence',   label: 'OP'       },
                { col: 'workcenter', label: 'Gniazdo'  },
                { col: 'start_dt',   label: 'Start'    },
                { col: 'end_dt',     label: 'Koniec'   },
                { col: 'durH',       label: 'Czas [h]' },
                { col: 'segs',       label: 'Segm.'    },
                { col: 'due_date',   label: 'Due date' },
                { col: '_late',      label: 'Status'   },
              ].map(({ col, label }) => (
                <th key={label} style={thStyle(col)} onClick={() => col && toggleSort(col)}>
                  {label}{col ? (sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : '') : ''}
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
              return (
                <tr key={`${op.zp_id}-${i}`} style={{ background: late ? 'rgba(248,113,113,0.04)' : 'transparent' }}>
                  <td style={{ ...tdStyle, color: T.text3, ...mono }}>{i + 1}</td>
                  <td style={tdStyle}>
                    <code style={{ fontSize: 11, color: T.accent, background: T.accentBg,
                      padding: '1px 5px', borderRadius: 4 }}>
                      {op.parent_zp || op.zp_id || '—'}
                    </code>
                  </td>
                  <td style={{ ...tdStyle, color: T.text2, maxWidth: 130,
                    overflow: 'hidden', textOverflow: 'ellipsis' }}>{op.klient || '—'}</td>
                  <td style={{ ...tdStyle, ...mono, color: T.text2 }}>
                    {String(op.sequence || '').padStart(3, '0')}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 10,
                      fontSize: 11, background: T.surface3, color: T.text2, border: `1px solid ${T.border}` }}>
                      {op.workcenter || '—'}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, ...mono, color: beforePlan ? T.warn : T.text }}>
                    {op.start_dt ? fmtDt(op.start_dt) : '—'}
                    {beforePlan && <span style={{ marginLeft: 4, color: T.warn }}>⚠</span>}
                    {(op.segments||[]).length > 1 && <span style={{ marginLeft: 4, fontSize: 9, color: T.text3 }}>×{(op.segments||[]).length}</span>}
                  </td>
                  <td style={{ ...tdStyle, ...mono, color: endAfterDue ? T.bn : T.text, fontWeight: endAfterDue ? 600 : 400 }}>
                    {op.end_dt ? fmtDt(op.end_dt) : '—'}
                    {endAfterDue && <span style={{ marginLeft: 4 }}>🔴</span>}
                  </td>
                  <td style={{ ...tdStyle, ...mono, color: T.text2 }}>{(op.durH || 0).toFixed(2)}</td>
                  <td style={{ ...tdStyle, ...mono, color: T.text3 }}>{(op.segments || []).length}</td>
                  <td style={{ ...tdStyle, ...mono, color: T.text3 }}>{op.due_date || '—'}</td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4,
                      fontSize: 10, fontWeight: 600,
                      background: late ? 'rgba(248,113,113,0.15)' : 'rgba(34,197,94,0.12)',
                      color: late ? T.bn : T.ok }}>
                      {late ? 'SPÓŹNIONE' : 'OK'}
                    </span>
                    {op._conflict && <span style={{ marginLeft: 4, fontSize: 10, color: T.bn, fontWeight: 600 }}>⚡ NAKŁ</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: T.text3 }}>
        <span><span style={{ color: T.warn }}>⚠</span> — operacja przed datą planStart</span>
        <span><span style={{ color: T.bn }}>🔴</span> — koniec po due date</span>
        <span style={{ color: T.warn }}>żółty start</span><span> — przed planStart</span>
        <span style={{ color: T.bn }}>czerwony koniec</span><span> — przekroczony termin</span>
      </div>
    </div>
  );
}