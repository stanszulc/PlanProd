import { useState, useMemo } from 'react';
import { T, s } from '../../constants/theme.js';
import { localDateStr } from '../../utils/scheduler.js';
import { EmptyState } from '../common/EmptyState.jsx';
import { WC_DAILY_CAPACITY, WC_TO_WC2 } from '../../constants/demoData.js';

const DAY_NAMES_SHORT = ['Nd','Pon','Wt','Śr','Czw','Pt','Sob'];

const BRIGADE_CAPACITY = {
  'Maszyny':             202.6,
  'Kanały':              180.4,
  'Kratki Stalowe':      156.7,
  'Kratki Aluminium':    140.0,
  'Regulatory VAV/NSDZ': 124.6,
  'Przepustnice':         92.4,
  'Gniazdo KTM/KTS':      84.9,
  'Pilarnia Aluminium':   80.0,
  'Linia WKP':            73.4,
  'Pilarnia Stalowa':     72.0,
  'iSWAY':                48.0,
  'Spawalnia':            56.0,
  'Montaż Podzespołów':   60.1,
  'Linia KWP/KWP-L':      54.9,
  'Gniazdo montażu SN':   32.0,
  'Gniazdo NSDZ':         16.0,
  'Gniazdo ZS':           16.0,
  'Heager':                8.0,
  'Klinczarka':            8.0,
  'Szlifiernia Stal':      8.0,
};

export function HeatmapPlanTab({ fwdZP = [], routing = [], wcSchedule = {}, onScheduleChange, onRecalc, ganttDirty, isScheduling, planStart }) {

  const [showDetail, setShowDetail] = useState(false);
  const [expanded,   setExpanded]   = useState(new Set());
  const [mode,       setMode]       = useState('pct');
  const [groupBy,       setGroupBy]       = useState('plan');
  const [expandedBr,    setExpandedBr]    = useState(new Set());

  // wc → { group, name }
  const wcMeta = useMemo(() => {
    const map = {};
    // Najpierw z routingu (ma pełne dane)
    routing.forEach(r => {
      if (!r.workcenter) return;
      if (!map[r.workcenter]) map[r.workcenter] = {
        group: r.wc_group || r.workcenter,
        name:  r.machine_name || r.workcenter,
      };
    });
    // Uzupełnij z WC_TO_WC2 — maszyny bez ZP w routingu
    Object.entries(WC_TO_WC2).forEach(([wc, wc2]) => {
      if (!map[wc]) map[wc] = { group: wc2, name: wc };
    });
    return map;
  }, [routing.length]);

  const { loadMap, brigadeLoadMap, dates, groups, lateKeys, lateBrigadeKeys, weekendSet } = useMemo(() => {
    const loadMap     = {};
    const brigadeLoad = {};
    const dateSet     = new Set();

    for (const op of fwdZP) {
      const wc  = op.workcenter;
      const wc2 = wcMeta[wc]?.group || wc;
      if (!loadMap[wc])      loadMap[wc]      = {};
      if (!brigadeLoad[wc2]) brigadeLoad[wc2] = {};

      if (groupBy === 'due') {
        if (!op.due_date) continue;
        dateSet.add(op.due_date);
        loadMap[wc][op.due_date]      = (loadMap[wc][op.due_date]      || 0) + (op.durH || 0);
        brigadeLoad[wc2][op.due_date] = (brigadeLoad[wc2][op.due_date] || 0) + (op.durH || 0);
      } else {
        for (const seg of (op.segments || [])) {
          if (!seg.segStart) continue;
          const d = localDateStr(seg.segStart);
          dateSet.add(d);
          loadMap[wc][d]      = (loadMap[wc][d]      || 0) + seg.durH;
          brigadeLoad[wc2][d] = (brigadeLoad[wc2][d] || 0) + seg.durH;
        }
      }
    }

    routing.forEach(r => {
      if (r.workcenter && !loadMap[r.workcenter]) loadMap[r.workcenter] = {};
    });

    // Dodaj WSZYSTKIE maszyny z WC_DAILY_CAPACITY — nawet bez ZP i bez routingu
    // Dzięki temu grafik brygad pokazuje pełną strukturę z zerami
    Object.keys(WC_DAILY_CAPACITY).forEach(wc => {
      if (!loadMap[wc]) loadMap[wc] = {};
    });

    const dates = [...dateSet].sort();

    const weekendSet = new Set();
    dates.forEach(d => {
      const jsDay = new Date(d + 'T12:00:00').getDay();
      if (jsDay === 0 || jsDay === 6) weekendSet.add(d);
    });

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

    const lateKeys        = new Set();
    const lateBrigadeKeys = new Set();
    for (const op of fwdZP) {
      const isLate = op.realEnd && op.due_date &&
        new Date(op.realEnd) > new Date(op.due_date + 'T23:59:59');
      if (!isLate) continue;
      const wc2 = wcMeta[op.workcenter]?.group || op.workcenter;
      if (groupBy === 'due') {
        if (op.due_date) {
          lateKeys.add(`${op.workcenter}|${op.due_date}`);
          lateBrigadeKeys.add(`${wc2}|${op.due_date}`);
        }
      } else {
        for (const seg of (op.segments || [])) {
          if (!seg.segStart) continue;
          const d = localDateStr(seg.segStart);
          lateKeys.add(`${op.workcenter}|${d}`);
          lateBrigadeKeys.add(`${wc2}|${d}`);
        }
      }
    }

    return { loadMap, brigadeLoadMap: brigadeLoad, dates, groups, lateKeys, lateBrigadeKeys, weekendSet };
  }, [fwdZP.length, routing.length, wcMeta, groupBy]);

  const brigades = useMemo(() => [...new Set(groups.map(g => g.wc2))].sort(), [groups]);

  function getAvailH(wc, dateStr) {
    const sched = wcSchedule[wc];
    if (!sched) return 16;
    if (Array.isArray(sched)) {
      const idx = new Date(dateStr + 'T12:00:00').getDay();
      return sched[idx === 0 ? 6 : idx - 1] ?? 0;
    }
    if (typeof sched === 'object') return sched[dateStr] ?? 16;
    return 16;
  }

  // Godziny maszyny z wcSchedule dla danej daty
  function getWcH(wc, dateStr) {
    const isWe = weekendSet.has(dateStr);
    const defaultH = isWe ? 0 : (WC_DAILY_CAPACITY[wc] ?? 0);
    const sc = wcSchedule[wc];
    if (!sc) return defaultH;
    if (Array.isArray(sc)) {
      const idx = new Date(dateStr + 'T12:00:00').getDay();
      return sc[idx === 0 ? 6 : idx - 1] ?? defaultH;
    }
    if (typeof sc === 'object') {
      return sc[dateStr] !== undefined ? sc[dateStr] : defaultH;
    }
    return defaultH;
  }

  // Capacity brygady = suma godzin jej maszyn z wcSchedule
  // Fallback do BRIGADE_CAPACITY gdy maszyny nie mają danych
  function getBrigadeCapH(wc2, dateStr) {
    if (weekendSet.has(dateStr)) return 0;
    // Użyj wcMeta — zawiera WSZYSTKIE maszyny z routingu, nie tylko te z obciążeniem
    const wcs = Object.entries(wcMeta)
      .filter(([, meta]) => meta.group === wc2)
      .map(([wc]) => wc);
    if (!wcs.length) return BRIGADE_CAPACITY[wc2] ?? 0;
    const sum = wcs.reduce((s, wc) => s + getWcH(wc, dateStr), 0);
    return Math.round((sum > 0 ? sum : (BRIGADE_CAPACITY[wc2] ?? 0)) * 10) / 10;
  }

  // +8h/-8h → zapisuje per-date do wcSchedule (już jest per-date po refaktorze App.jsx)
  function adjustBrigade(wc2, dateStr, delta) {
    if (!onScheduleChange) return;
    const grp = groups.find(g => g.wc2 === wc2);
    if (!grp) return;
    const nMachines = grp.machines.length || 1;
    const next = { ...wcSchedule };
    grp.machines.forEach(m => {
      const sc  = next[m.wc] || {};
      const cur = typeof sc === 'object' && !Array.isArray(sc) ? (sc[dateStr] ?? getWcH(m.wc, dateStr)) : getWcH(m.wc, dateStr);
      next[m.wc] = { ...sc, [dateStr]: Math.max(0, cur + delta / nMachines) };
    });
    onScheduleChange(next);
  }

  function adjustMachine(wc, dateStr, delta) {
    if (!onScheduleChange) return;
    const sc  = wcSchedule[wc] || {};
    const cur = typeof sc === 'object' && !Array.isArray(sc) ? (sc[dateStr] ?? getWcH(wc, dateStr)) : getWcH(wc, dateStr);
    onScheduleChange({ ...wcSchedule, [wc]: { ...sc, [dateStr]: Math.max(0, cur + delta) } });
  }

  function hmStyle(avail, load) {
    if (load === 0) return { bg: T.surface2, color: T.text3, text: '–' };
    const u    = avail > 0 ? load / avail : 999;
    const text = mode === 'h' ? load.toFixed(1) + 'h' : Math.round(u * 100) + '%';
    if (u <= 0.85) return { bg: 'rgba(34,197,94,0.12)',  color: '#22c55e', text };
    if (u <= 1.00) return { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', text };
    if (u <= 1.10) return { bg: 'rgba(249,115,22,0.15)', color: '#f97316', text };
    return               { bg: 'rgba(239,68,68,0.2)',    color: '#ef4444', text };
  }

  function brStyle(capH, loadH) {
    if (loadH === 0) return { bg: T.surface2, color: T.text3, text: '–', sub: '' };
    const u    = capH > 0 ? loadH / capH : 999;
    const pct  = Math.round(u * 100) + '%';
    const hrs  = loadH.toFixed(0) + 'h';
    const text = mode === 'h' ? hrs : pct;
    const sub  = mode === 'h' ? pct : hrs;
    if (u <= 0.85) return { bg: 'rgba(34,197,94,0.12)',  color: '#22c55e', text, sub };
    if (u <= 1.00) return { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', text, sub };
    if (u <= 1.10) return { bg: 'rgba(249,115,22,0.15)', color: '#f97316', text, sub };
    return               { bg: 'rgba(239,68,68,0.2)',    color: '#ef4444', text, sub };
  }

  function fmtDate(d) {
    const [, m, day] = d.split('-');
    const jsDay = new Date(d + 'T12:00:00').getDay();
    return `${day}.${m} ${DAY_NAMES_SHORT[jsDay]}`;
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
    padding: '0 4px 10px', fontSize: 10, fontWeight: 600,
    textTransform: 'uppercase', color: T.text3, textAlign: 'center',
    position: 'sticky', top: 0, background: T.bg, zIndex: 1,
    whiteSpace: 'nowrap',
  };

  const legend = [
    { bg: 'rgba(34,197,94,0.12)',  color: '#22c55e', label: '≤85%' },
    { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: '85–100%' },
    { bg: 'rgba(249,115,22,0.15)', color: '#f97316', label: '100–110%' },
    { bg: 'rgba(239,68,68,0.2)',   color: '#ef4444', label: '>110%' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── TOOLBAR ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 2, background: T.surface3, borderRadius: 7, padding: 2 }}>
          {[['plan', '📅 wg planu'], ['due', '🏁 wg terminu']].map(([val, label]) => (
            <button key={val} onClick={() => setGroupBy(val)}
              style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                border: 'none', background: groupBy === val ? T.accent : 'transparent',
                color: groupBy === val ? '#fff' : T.text3, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>
        <select value={mode} onChange={e => setMode(e.target.value)}
          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6,
            border: `1px solid ${T.border2}`, background: T.surface2, color: T.text }}>
          <option value="pct">%</option>
          <option value="h">godz.</option>
        </select>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {legend.map(l => (
            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.text3 }}>
              <span style={{ background: l.bg, color: l.color, padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600 }}>■</span>
              {l.label}
            </span>
          ))}
          <span style={{ fontSize: 11, color: '#ef4444' }}>🔴 spóźnione</span>
        </div>
        {onRecalc && (
          <button onClick={onRecalc} disabled={isScheduling}
            style={{ marginLeft: 'auto', padding: '4px 14px', fontSize: 12, fontWeight: 600,
              borderRadius: 8, border: 'none', cursor: isScheduling ? 'wait' : 'pointer',
              background: ganttDirty ? T.accent : T.surface3,
              color: ganttDirty ? '#fff' : T.text3, opacity: isScheduling ? 0.6 : 1 }}>
            {isScheduling ? '⏳ Liczę...' : ganttDirty ? '⟳ Przelicz' : '✓ OK'}
          </button>
        )}
      </div>

      {/* ── PANEL 1: HEATMAPA GNIAZD ── */}
      <div style={s.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ ...s.cardTitle, margin: 0 }}>📊 Obciążenie gniazd × {groupBy === 'due' ? 'terminy' : 'dni'}</div>
          <span style={{ fontSize: 12, color: T.text3 }}>Maszyny:</span>
          <div onClick={() => { setShowDetail(v => !v); setExpanded(new Set()); }}
            style={{ width: 38, height: 20, borderRadius: 10, cursor: 'pointer',
              background: showDetail ? T.accent : T.surface3,
              border: `1px solid ${showDetail ? T.accent : T.border2}`,
              position: 'relative', transition: 'all .15s' }}>
            <div style={{ position: 'absolute', top: 2, left: showDetail ? 19 : 2,
              width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
          </div>
        </div>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '38vh' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left', minWidth: 160 }}>Gniazdo</th>
                {dates.map(d => <th key={d} style={thStyle}>{fmtDate(d)}</th>)}
                <th style={thStyle}>Suma</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ wc2, machines }) => {
                const isOpen   = expanded.has(wc2) || showDetail;
                const aggLoad  = dates.map(d => machines.reduce((s, m) => s + (loadMap[m.wc]?.[d] || 0), 0));
                const aggAvail = dates.map(d => machines.reduce((s, m) => s + getAvailH(m.wc, d), 0));
                const totLoad  = aggLoad.reduce((s, v) => s + v, 0);
                const totAvail = aggAvail.reduce((s, v) => s + v, 0);
                const sumSt    = hmStyle(totAvail, totLoad);
                return [
                  <tr key={wc2} onClick={() => toggleExpand(wc2)} style={{ cursor: 'pointer', background: T.surface2 }}>
                    <td style={{ padding: '6px 8px 6px 0', fontWeight: 700, color: T.text, fontSize: 12, whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 9, color: T.text3, marginRight: 4, display: 'inline-block',
                        transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                      {wc2}
                      <span style={{ fontSize: 10, color: T.text3, fontWeight: 400, marginLeft: 4 }}>({machines.length})</span>
                    </td>
                    {aggLoad.map((load, i) => {
                      const hs     = hmStyle(aggAvail[i], load);
                      const isLate = machines.some(m => lateKeys.has(`${m.wc}|${dates[i]}`));
                      return (
                        <td key={i} style={{ padding: 3, textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            minWidth: 52, height: 24, borderRadius: 4, background: hs.bg, color: hs.color,
                            fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
                            boxShadow: isLate ? 'inset 0 0 0 2px #ef4444' : 'none' }}>
                            {hs.text}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{ padding: 3, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 52, height: 24, borderRadius: 4, background: sumSt.bg, color: sumSt.color,
                        fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>{sumSt.text}</div>
                    </td>
                  </tr>,
                  ...(isOpen ? machines.map(m => {
                    const mLoads = dates.map(d => loadMap[m.wc]?.[d] || 0);
                    const mAvail = dates.map(d => getAvailH(m.wc, d));
                    const mSum   = hmStyle(mAvail.reduce((s,v)=>s+v,0), mLoads.reduce((s,v)=>s+v,0));
                    return (
                      <tr key={m.wc} style={{ background: T.surface }}>
                        <td style={{ padding: '3px 8px 3px 16px', color: T.text2, fontSize: 11, whiteSpace: 'nowrap' }}>
                          <span style={{ color: T.text3, marginRight: 4 }}>└</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 10 }}>{m.wc}</span>
                          <span style={{ color: T.text3, marginLeft: 6, fontSize: 10 }}>{m.name}</span>
                        </td>
                        {mLoads.map((load, i) => {
                          const hs     = hmStyle(mAvail[i], load);
                          const isLate = lateKeys.has(`${m.wc}|${dates[i]}`);
                          return (
                            <td key={i} style={{ padding: 3, textAlign: 'center' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                minWidth: 52, height: 22, borderRadius: 4, background: hs.bg, color: hs.color,
                                fontSize: 10, fontWeight: 500, fontFamily: 'monospace',
                                boxShadow: isLate ? 'inset 0 0 0 2px #ef4444' : 'none' }}>{hs.text}</div>
                            </td>
                          );
                        })}
                        <td style={{ padding: 3, textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            minWidth: 52, height: 22, borderRadius: 4, background: mSum.bg, color: mSum.color,
                            fontSize: 10, fontWeight: 600, fontFamily: 'monospace' }}>{mSum.text}</div>
                        </td>
                      </tr>
                    );
                  }) : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── PANEL 2: GRAFIK PRACY BRYGAD ── */}
      <div style={s.card}>
        <div style={{ ...s.cardTitle, marginBottom: 12 }}>👷 Grafik pracy brygad</div>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '38vh' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left', minWidth: 160 }}>Brygada</th>
                <th style={{ ...thStyle, minWidth: 60 }}>Cap/d</th>
                {dates.map(d => <th key={d} style={{ ...thStyle, opacity: weekendSet.has(d) ? 0.4 : 1 }}>{fmtDate(d)}</th>)}
                <th style={thStyle}>Tydzień</th>
              </tr>
            </thead>
            <tbody>
              {brigades.map((br, bi) => {
                // Cap/d = stała demo capacity (nie zmienia się po +8h)
                const capH    = BRIGADE_CAPACITY[br] ?? 0;
                // weekSum = suma aktualnych godzin z wcSchedule per dzień roboczy
                const weekSum = Math.round(dates.reduce((s, d) => s + getBrigadeCapH(br, d), 0) * 10) / 10;
                const grp = groups.find(g => g.wc2 === br);
                return [
                  <tr key={br} style={{ background: bi % 2 === 0 ? T.surface : T.surface2 }}>
                    <td style={{ padding: '5px 8px 5px 0', fontWeight: 700, color: T.text, fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer' }}
                      onClick={() => setExpandedBr(prev => { const n = new Set(prev); n.has(br) ? n.delete(br) : n.add(br); return n; })}>
                      <span style={{ fontSize: 9, color: T.text3, marginRight: 4, display: 'inline-block',
                        transform: expandedBr.has(br) ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                      {br}
                      {grp && <span style={{ fontSize: 10, color: T.text3, fontWeight: 400, marginLeft: 4 }}>({grp.machines.length})</span>}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: 11, fontFamily: 'monospace', color: T.accent, fontWeight: 600 }}>
                      {capH > 0 ? capH + 'h' : '—'}
                    </td>
                    {dates.map(d => {
                      const cap  = getBrigadeCapH(br, d);
                      const isWe = weekendSet.has(d);
                      return (
                        <td key={d} style={{ padding: 3, textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            minWidth: 52, height: isWe ? 24 : 34, borderRadius: 4,
                            background: isWe ? T.surface2 : cap > 0 ? 'rgba(34,197,94,0.08)' : T.surface2,
                            color: isWe ? T.text3 : cap > 0 ? '#22c55e' : T.text3,
                            fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
                            {isWe ? '—' : <>{Math.round(cap * 10) / 10}h
                              {onScheduleChange && (
                                <span style={{ display: 'flex', gap: 2, marginTop: 2 }}>
                                  <button onClick={() => adjustBrigade(br, d, +8)}
                                    style={{ fontSize: 9, padding: '0 3px', borderRadius: 3, lineHeight: 1.5,
                                      border: `1px solid ${T.border2}`, background: T.surface3, color: T.ok, cursor: 'pointer' }}>+8</button>
                                  <button onClick={() => adjustBrigade(br, d, -8)}
                                    style={{ fontSize: 9, padding: '0 3px', borderRadius: 3, lineHeight: 1.5,
                                      border: `1px solid ${T.border2}`, background: T.surface3, color: T.bn, cursor: 'pointer' }}>-8</button>
                                  <button onClick={() => adjustBrigade(br, d, -9999)}
                                    style={{ fontSize: 9, padding: '0 3px', borderRadius: 3, lineHeight: 1.5,
                                      border: `1px solid ${T.border2}`, background: T.surface3, color: T.text3, cursor: 'pointer' }}>0</button>
                                </span>
                              )}
                            </>}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{ padding: 3, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 52, height: 34, borderRadius: 4, background: T.surface3,
                        color: T.accent, fontSize: 11, fontWeight: 700, fontFamily: 'monospace' }}>
                        {weekSum}h
                      </div>
                    </td>
                  </tr>,
                  ...(expandedBr.has(br) && grp ? grp.machines.map(m => {
                    return (
                    <tr key={`${br}-${m.wc}`} style={{ background: T.surface3 }}>
                      <td style={{ padding: '3px 8px 3px 20px', color: T.text2, fontSize: 11, whiteSpace: 'nowrap' }}>
                        <span style={{ color: T.text3, marginRight: 4 }}>└</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 10 }}>{m.wc}</span>
                        <span style={{ color: T.text3, marginLeft: 6, fontSize: 10 }}>{m.name}</span>
                      </td>
                      <td style={{ padding: '3px 8px', textAlign: 'center', fontSize: 10, color: T.text3, fontFamily: 'monospace' }}>
                        {Math.round(getWcH(m.wc, dates.find(d => !weekendSet.has(d)) || '') * 10) / 10}h
                      </td>
                      {dates.map(d => {
                        const h    = getWcH(m.wc, d);
                        const isWe = weekendSet.has(d);
                        return (
                          <td key={d} style={{ padding: 3, textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', flexDirection: 'column',
                              alignItems: 'center', justifyContent: 'center',
                              minWidth: 52, height: isWe ? 24 : 34, borderRadius: 4,
                              background: isWe ? T.surface2 : h > 0 ? 'rgba(34,197,94,0.06)' : T.surface2,
                              color: isWe ? T.text3 : h > 0 ? '#22c55e' : T.text3,
                              fontFamily: 'monospace', fontSize: 10, fontWeight: 500 }}>
                              {isWe ? '—' : <>{Math.round(h * 10) / 10}h
                                <span style={{ display: 'flex', gap: 2, marginTop: 2 }}>
                                  <button onClick={() => adjustMachine(m.wc, d, +8)}
                                    style={{ fontSize: 8, padding: '0 3px', borderRadius: 3, lineHeight: 1.5,
                                      border: `1px solid ${T.border2}`, background: T.surface3, color: T.ok, cursor: 'pointer' }}>+8</button>
                                  <button onClick={() => adjustMachine(m.wc, d, -8)}
                                    style={{ fontSize: 8, padding: '0 3px', borderRadius: 3, lineHeight: 1.5,
                                      border: `1px solid ${T.border2}`, background: T.surface3, color: T.bn, cursor: 'pointer' }}>-8</button>
                                </span>
                              </>}
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ padding: 3, textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          minWidth: 52, height: 34, borderRadius: 4, background: T.surface3,
                          color: T.text2, fontSize: 10, fontWeight: 600, fontFamily: 'monospace' }}>
                          {Math.round(dates.reduce((s, d) => s + getWcH(m.wc, d), 0))}h
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
        <div style={{ fontSize: 11, color: T.text3, marginTop: 8 }}>
          Cap/d = rbh/dzień pełna obsada. +8h/-8h zmienia wcSchedule maszyn → ⟳ Przelicz.
        </div>
      </div>

    </div>
  );
}