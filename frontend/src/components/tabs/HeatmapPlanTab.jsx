import { useState, useMemo, useRef } from 'react';
import { T, s, heatBand } from '../../constants/theme.js';
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

export function HeatmapPlanTab({ fwdZP = [], routing = [], wcSchedule = {}, onScheduleChange, onRecalc, onOptimize, isOptimizing, ganttDirty, isScheduling, planStart, onPlanStartChange, schedulingMode = 'asap', onSchedulingModeChange, heatmapFilter, onHeatmapFilterChange }) {

  const [showDetail, setShowDetail] = useState(false);
  const [expanded,   setExpanded]   = useState(new Set());
  const [mode,       setMode]       = useState('h');
  const [groupBy,       setGroupBy]       = useState('plan');
  const [expandedBr,    setExpandedBr]    = useState(new Set());
  // Filtr gniazda/komórki — kontrolowany z App.jsx (przeżywa zmianę zakładki)
  const filterWc2 = heatmapFilter && !heatmapFilter.date ? heatmapFilter.wc2 : null;
  const filterCell = heatmapFilter && heatmapFilter.date
    ? { wc2: heatmapFilter.wc2, wc: heatmapFilter.wc, date: heatmapFilter.date }
    : null;
  function setFilterWc2(valOrFn) {
    const v = typeof valOrFn === 'function' ? valOrFn(filterWc2) : valOrFn;
    onHeatmapFilterChange && onHeatmapFilterChange(v ? { wc2: v } : null);
  }
  function setFilterCell(valOrFn) {
    const prev = filterCell;
    const cell = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn;
    onHeatmapFilterChange && onHeatmapFilterChange(cell ? { wc2: cell.wc2, wc: cell.wc, date: cell.date } : null);
  }
  const tooltipRef = useRef(null);
  function showTooltipHM(e, titleText, zps) {
    const el = tooltipRef.current; if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.style.left    = (r.right + 12) + 'px';
    el.style.top     = (r.top - 8)   + 'px';
    el.style.display = 'block';
    const total = zps.reduce((s, z) => s + (z.durH || 0), 0);
    el.querySelector('[data-tt="title"]').textContent =
      titleText + (zps.length > 0 ? ` — ${total.toFixed(1)}h łącznie` : '');
    const listEl = el.querySelector('[data-tt="list"]');
    listEl.replaceChildren();
    if (!zps.length) {
      const empty = document.createElement('div');
      empty.style.color = '#94a3b8';
      empty.textContent = 'Brak operacji';
      listEl.appendChild(empty);
    } else {
      zps.forEach(z => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:2px 0;border-bottom:1px solid rgba(148,163,184,0.15)';

        const idEl = document.createElement('span');
        idEl.style.cssText = 'color:#cbd5e1;font-family:monospace;font-size:10px';
        idEl.textContent = z.id;

        const klientEl = document.createElement('span');
        klientEl.style.cssText = 'color:#94a3b8;white-space:nowrap';
        klientEl.textContent = z.klient || '';

        const dueEl = document.createElement('span');
        dueEl.style.cssText = 'color:#f87171;font-family:monospace;font-size:10px';
        dueEl.textContent = (z.due_date || '').slice(5);

        const durEl = document.createElement('span');
        durEl.style.cssText = 'color:#60a5fa;font-weight:600;white-space:nowrap';
        durEl.textContent = (z.durH != null ? z.durH.toFixed(1) : '') + 'h';

        row.append(idEl, klientEl, dueEl, durEl);
        listEl.appendChild(row);
      });
    }
  }
  function hideTooltipHM() { if (tooltipRef.current) tooltipRef.current.style.display = 'none'; }

  // wc → { group, name }
  const wcMeta = useMemo(() => {
    const map = {};
    // Najpierw statyczny WC_TO_WC2 — tylko jako fallback dla maszyn spoza
    // aktualnie wczytanego pliku (np. widoczne wcześniej w innym imporcie).
    Object.entries(WC_TO_WC2).forEach(([wc, wc2]) => {
      map[wc] = { group: wc2, name: wc };
    });
    // Routing z aktualnie wczytanego pliku ZAWSZE nadpisuje fallback —
    // wc_group pochodzi z op.workcenter (WC3, patrz scheduler.js), więc to
    // jest jedyne źródło zgodne z bieżącym podziałem na brygady.
    routing.forEach(r => {
      if (!r.workcenter) return;
      map[r.workcenter] = {
        group: r.wc_group || r.workcenter,
        name:  r.machine_name || r.workcenter,
      };
    });
    return map;
  }, [routing.length]);

  // [PERF] Pre-computed ZP list per cell (wc2|date and wc|date) — O(1) lookup at hover
  const zpsByCellMap = useMemo(() => {
    const map = {};
    fwdZP.forEach(op => {
      const wc  = op.workcenter;
      const wc2 = wcMeta[wc]?.group || wc;
      const id  = op.parent_zp || op.zp_id;
      const entry = { id, klient: op.klient || op.zp_id, durH: op.durH, due_date: op.due_date };
      (op.segments || []).forEach(seg => {
        if (!seg.segStart) return;
        const d    = localDateStr(seg.segStart);
        const bKey = wc2 + '|' + d;
        const mKey = wc  + '|' + d;
        if (!map[bKey]) map[bKey] = { zps: [], seen: new Set() };
        if (!map[bKey].seen.has(id)) { map[bKey].seen.add(id); map[bKey].zps.push(entry); }
        if (!map[mKey]) map[mKey] = { zps: [], seen: new Set() };
        if (!map[mKey].seen.has(id)) { map[mKey].seen.add(id); map[mKey].zps.push(entry); }
      });
    });
    return map;
  }, [fwdZP, wcMeta]);

  const { loadMap, dates, groups, lateKeys, weekendSet } = useMemo(() => {
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

    const dates_raw = [...dateSet].sort();
    // Wypełnij wszystkie dni w zakresie (włącznie z weekendami)
    if (dates_raw.length > 0) {
      const cur = new Date(dates_raw[0] + 'T12:00:00');
      const end = new Date(dates_raw[dates_raw.length - 1] + 'T12:00:00');
      while (cur <= end) {
        const dk = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
        dateSet.add(dk);
        cur.setDate(cur.getDate() + 1);
      }
    }
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
  }, [fwdZP, routing.length, wcMeta, groupBy]);

  // ZP powiązane z wybranym gniazdem (przez routing)
  const filteredGroups = useMemo(() => {
    if (!filterWc2 && !filterCell) return groups;

    let filteredZpIds;
    if (filterCell) {
      const cellWcs = filterCell.wc
        ? new Set([filterCell.wc])
        : new Set(Object.entries(wcMeta).filter(([, m]) => m.group === filterCell.wc2).map(([wc]) => wc));
      filteredZpIds = new Set(
        fwdZP.filter(op => {
          if (!cellWcs.has(op.workcenter)) return false;
          return (op.segments || []).some(seg => seg.segStart && localDateStr(seg.segStart) === filterCell.date);
        }).map(op => op.parent_zp || op.zp_id)
      );
    } else {
      // Filtr gniazda
      const filterWcs = new Set(
        Object.entries(wcMeta).filter(([, m]) => m.group === filterWc2).map(([wc]) => wc)
      );
      filteredZpIds = new Set(
        fwdZP.filter(op => filterWcs.has(op.workcenter)).map(op => op.parent_zp || op.zp_id)
      );
    }

    const relatedWc2s = new Set(
      fwdZP.filter(op => filteredZpIds.has(op.parent_zp || op.zp_id))
           .map(op => wcMeta[op.workcenter]?.group || op.workcenter)
    );
    return groups.filter(g => relatedWc2s.has(g.wc2));
  }, [groups, filterWc2, filterCell?.wc2, filterCell?.date, fwdZP, wcMeta]);

  // Mapa wc2 → Set(dat) gdzie wyfiltrowane ZP mają operacje w danym gnieździe
  const activeMap = useMemo(() => {
    if (!filterWc2 && !filterCell) return null;
    let filteredZpIds;
    if (filterCell) {
      const cellWcs = filterCell.wc
        ? new Set([filterCell.wc])  // konkretna maszyna
        : new Set(Object.entries(wcMeta).filter(([, m]) => m.group === filterCell.wc2).map(([wc]) => wc));
      filteredZpIds = new Set(
        fwdZP.filter(op => {
          if (!cellWcs.has(op.workcenter)) return false;
          return (op.segments || []).some(seg => seg.segStart && localDateStr(seg.segStart) === filterCell.date);
        }).map(op => op.parent_zp || op.zp_id)
      );
    } else {
      const filterWcs = new Set(
        Object.entries(wcMeta).filter(([, m]) => m.group === filterWc2).map(([wc]) => wc)
      );
      filteredZpIds = new Set(
        fwdZP.filter(op => filterWcs.has(op.workcenter)).map(op => op.parent_zp || op.zp_id)
      );
    }
    // Buduj mapę: wc2 → Set(dat) gdzie wyfiltrowane ZP mają segmenty
    const map = {};
    fwdZP.filter(op => filteredZpIds.has(op.parent_zp || op.zp_id))
         .forEach(op => {
           const wc2 = wcMeta[op.workcenter]?.group || op.workcenter;
           if (!map[wc2]) map[wc2] = new Set();
           (op.segments || []).forEach(seg => {
             if (seg.segStart) map[wc2].add(localDateStr(seg.segStart));
           });
         });
    return map;
  }, [filterWc2, filterCell?.wc2, filterCell?.date, fwdZP, wcMeta]);

  const brigades = useMemo(() => [...new Set(groups.map(g => g.wc2))].sort(), [groups]);

  const filteredBrigades = useMemo(() => {
    if (!filterWc2 && !filterCell) return brigades;
    const wc2s = new Set(filteredGroups.map(g => g.wc2));
    return brigades.filter(br => wc2s.has(br));
  }, [brigades, filteredGroups, filterWc2, filterCell?.wc2, filterCell?.date]);

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

  const [editingCapBr, setEditingCapBr] = useState(null);
  const [editingCapVal, setEditingCapVal] = useState('');

  // Capacity brygady = suma godzin jej maszyn z wcSchedule
  // Fallback do BRIGADE_CAPACITY tylko gdy brak maszyn w meta (nie gdy weekend = 0)
  function getBrigadeCapH(wc2, dateStr) {
    const wcs = Object.entries(wcMeta)
      .filter(([, meta]) => meta.group === wc2)
      .map(([wc]) => wc);
    if (!wcs.length) return weekendSet.has(dateStr) ? 0 : (BRIGADE_CAPACITY[wc2] ?? 0);
    const sum = wcs.reduce((s, wc) => s + getWcH(wc, dateStr), 0);
    return Math.round(sum * 10) / 10;
  }

  // +8h/-8h → zgłasza PATCH (tylko zmienione maszyny/daty), nie cały wcSchedule —
  // App.jsx scala patch do trwałego, rzadkiego wcExplicit; resztę dni (poza tym
  // patchem) dalej wypełnia szablon/domyślne capacity, przeliczane na bieżąco.
  function adjustBrigade(wc2, dateStr, delta) {
    if (!onScheduleChange) return;
    const grp = groups.find(g => g.wc2 === wc2);
    if (!grp) return;
    const nMachines = grp.machines.length || 1;
    const patch = {};
    grp.machines.forEach(m => {
      const cur = getWcH(m.wc, dateStr);
      patch[m.wc] = { [dateStr]: Math.max(0, cur + delta / nMachines) };
    });
    onScheduleChange(patch);
  }

  // Ustawia wprost (nie deltę) wszystkie dni robocze w widocznym zakresie —
  // patch obejmuje tylko dni robocze, weekendy zostają jak były (szablon/default).
  function applyCapH(br, newH) {
    if (!onScheduleChange) return;
    const grp = groups.find(g => g.wc2 === br);
    if (!grp || !grp.machines.length) return;
    const nMachines = grp.machines.length;
    const hPerMachine = newH / nMachines;
    const patch = {};
    grp.machines.forEach(m => {
      const dayPatch = {};
      dates.forEach(d => { if (!weekendSet.has(d)) dayPatch[d] = hPerMachine; });
      patch[m.wc] = dayPatch;
    });
    onScheduleChange(patch);
    setEditingCapBr(null);
  }

  function adjustMachine(wc, dateStr, delta) {
    if (!onScheduleChange) return;
    const cur = getWcH(wc, dateStr);
    onScheduleChange({ [wc]: { [dateStr]: Math.max(0, cur + delta) } });
  }

  function hmStyle(avail, load) {
    if (load === 0) return { bg: T.surface2, color: T.text3, text: '–' };
    if (avail === 0) return { bg: 'rgba(239,68,68,0.2)', color: '#ef4444', text: mode === 'h' ? load.toFixed(1) + 'h' : '!' };
    const u    = load / avail;
    const text = mode === 'h' ? load.toFixed(1) + 'h' : Math.round(u * 100) + '%';
    return { ...heatBand(u), text };
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

  // tooltip via DOM ref — zero React state re-renders on hover

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
      <div ref={tooltipRef} style={{display:'none',position:'fixed',zIndex:9999,pointerEvents:'none',
        background:'#1a2030',border:`1px solid ${T.border2}`,borderRadius:8,padding:'8px 12px',
        minWidth:200,maxWidth:360,boxShadow:'0 8px 24px rgba(0,0,0,0.5)',fontSize:11}}>
        <div data-tt="title" style={{fontWeight:700,color:T.accent,marginBottom:6,fontSize:12}}/>
        <div data-tt="list"/>
      </div>

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
        {onPlanStartChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px',
            borderRadius: 7, background: T.surface3, border: `1px solid ${T.border2}` }}>
            <span style={{ fontSize: 11, color: T.text3 }}>Planuj od</span>
            <input type="date" value={planStart || ''}
              onChange={e => onPlanStartChange(e.target.value)}
              style={{ fontSize: 11, background: 'transparent', border: 'none',
                color: T.text, outline: 'none', cursor: 'pointer' }} />
          </div>
        )}
        {onSchedulingModeChange && (
          <div style={{ display: 'flex', gap: 2, background: T.surface3, borderRadius: 7, padding: 2 }}>
            {[['asap', '⏩ ASAP'], ['alap', '⏪ ALAP']].map(([val, label]) => (
              <button key={val} onClick={() => onSchedulingModeChange(val)}
                style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                  border: 'none', background: schedulingMode === val ? T.accent : 'transparent',
                  color: schedulingMode === val ? '#fff' : T.text3, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>
        )}
        <select value={mode} onChange={e => setMode(e.target.value)}
          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6,
            border: `1px solid ${T.border2}`, background: T.surface2, color: T.text }}>
          <option value="pct">%</option>
          <option value="h">godz.</option>
        </select>
        {(() => {
          const lateCount = [...new Set(fwdZP.filter(op => {
            const due = op.due_date ? new Date(op.due_date + 'T23:59:59').getTime() : null;
            return due && op.realEnd && new Date(op.realEnd).getTime() > due;
          }).map(op => op.parent_zp || op.zp_id))].length;
          return lateCount > 0 ? (
            <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
              🔴 {lateCount} spóźnionych ZP
            </span>
          ) : (
            <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
              ✅ 0 spóźnionych
            </span>
          );
        })()}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {legend.map(l => (
            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.text3 }}>
              <span style={{ background: l.bg, color: l.color, padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600 }}>■</span>
              {l.label}
            </span>
          ))}
          <span style={{ fontSize: 11, color: '#ef4444' }}>🔴 spóźnione</span>
        </div>
        {filterCell && (
          <button onClick={() => setFilterCell(null)}
            style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 8,
              border: `1px solid ${T.border2}`, background: T.surface3, color: T.accent, cursor: 'pointer' }}>
            ✕ Pokaż wszystko ({filterCell.wc2} × {filterCell.date})
          </button>
        )}
        {filterWc2 && !filterCell && (
          <button onClick={() => setFilterWc2(null)}
            style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 8,
              border: `1px solid ${T.border2}`, background: T.surface3, color: T.accent, cursor: 'pointer' }}>
            ✕ Pokaż wszystko ({filterWc2})
          </button>
        )}
        {onRecalc && (
          <button onClick={onRecalc} disabled={isScheduling}
            style={{ marginLeft: 'auto', padding: '4px 14px', fontSize: 12, fontWeight: 600,
              borderRadius: 8, border: 'none', cursor: isScheduling ? 'wait' : 'pointer',
              background: ganttDirty ? T.accent : T.surface3,
              color: ganttDirty ? '#fff' : T.text3, opacity: isScheduling ? 0.6 : 1 }}>
            {isScheduling ? '⏳ Liczę...' : ganttDirty ? '⟳ Przelicz' : '✓ OK'}
          </button>
        )}
        {onOptimize && (
          <button onClick={onOptimize} disabled={isOptimizing || isScheduling || !fwdZP.length}
            title="Faza 2: Local Search — przesuwa spóźnione ZP wcześniej w kolejce"
            style={{ padding: '4px 14px', fontSize: 12, fontWeight: 600,
              borderRadius: 8, border: `1px solid #10b981`, cursor: isOptimizing ? 'wait' : 'pointer',
              background: isOptimizing ? T.surface3 : 'rgba(16,185,129,0.15)',
              color: isOptimizing ? T.text3 : '#34d399',
              opacity: (!fwdZP.length || isScheduling) ? 0.4 : 1 }}>
            {isOptimizing ? '⏳ Optymalizuję...' : '⚡ Optymalizuj'}
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
                <th style={{ ...thStyle, minWidth: 60 }}></th>
                {dates.map(d => <th key={d} style={thStyle}>{fmtDate(d)}</th>)}
                <th style={thStyle}>Suma</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map(({ wc2, machines }) => {
                const isOpen   = expanded.has(wc2) || showDetail;
                const aggLoad  = dates.map(d => machines.reduce((s, m) => s + (loadMap[m.wc]?.[d] || 0), 0));
                const aggAvail = dates.map(d => machines.reduce((s, m) => s + getAvailH(m.wc, d), 0));
                const totLoad  = aggLoad.reduce((s, v) => s + v, 0);
                const totAvail = aggAvail.reduce((s, v) => s + v, 0);
                const sumSt    = hmStyle(totAvail, totLoad);
                return [
                  <tr key={wc2} onClick={() => toggleExpand(wc2)} style={{ cursor: 'pointer', background: T.surface2 }}>
                    <td style={{ padding: '6px 8px 6px 0', fontWeight: 700, color: T.text, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span style={{ fontSize: 9, color: T.text3, marginRight: 4, display: 'inline-block',
                        transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                      {wc2}
                      <span style={{ fontSize: 10, color: T.text3, fontWeight: 400, marginLeft: 4 }}>({machines.length})</span>
                      <button onClick={e => { e.stopPropagation(); setFilterWc2(filterWc2 === wc2 ? null : wc2); }}
                        style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 4,
                          border: `1px solid ${T.border2}`, cursor: 'pointer',
                          background: filterWc2 === wc2 ? T.accent : T.surface3,
                          color: filterWc2 === wc2 ? '#fff' : T.text3 }}>
                        {filterWc2 === wc2 ? '✕' : '⊕'}
                      </button>
                    </td>
                    <td></td>
                    {aggLoad.map((load, i) => {
                      const hs     = hmStyle(aggAvail[i], load);
                      const isLate = machines.some(m => lateKeys.has(`${m.wc}|${dates[i]}`));
                      return (
                        <td key={i} style={{ padding: 3, textAlign: 'center' }}>
                          {(() => {
                            const isDimmed = activeMap && !(activeMap[wc2]?.has(dates[i]));
                            const isActive = filterCell?.wc2 === wc2 && filterCell?.date === dates[i] && !filterCell?.wc;
                            return (
                              <div
                                onClick={() => load > 0 && setFilterCell(fc => fc?.wc2 === wc2 && fc?.date === dates[i] ? null : { wc2, date: dates[i] })}
                                onMouseEnter={e => { if (load > 0) showTooltipHM(e, wc2 + ' × ' + dates[i], zpsByCellMap[wc2+'|'+dates[i]]?.zps||[]); }}
                                onMouseLeave={hideTooltipHM}
                                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                minWidth: 52, height: 24, borderRadius: 4,
                                background: isDimmed ? T.surface2 : hs.bg,
                                color: isDimmed ? T.text3 : hs.color,
                                fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
                                cursor: load > 0 && !isDimmed ? 'pointer' : 'default',
                                opacity: isDimmed ? 0.3 : 1,
                                boxShadow: isActive ? 'inset 0 0 0 2px #fff' : isLate && !isDimmed ? 'inset 0 0 0 2px #ef4444' : 'none' }}>
                                {isDimmed ? '–' : hs.text}
                              </div>
                            );
                          })()}
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
                        <td style={{ padding: '3px 8px 3px 16px', color: T.text2, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <span style={{ color: T.text3, marginRight: 4 }}>└</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 10 }}>{m.wc}</span>
                          <span style={{ color: T.text3, marginLeft: 6, fontSize: 10 }}>{m.name}</span>
                        </td>
                        <td></td>
                        {mLoads.map((load, i) => {
                          const hs       = hmStyle(mAvail[i], load);
                          const isLate   = lateKeys.has(`${m.wc}|${dates[i]}`);
                          const mWc2     = wcMeta[m.wc]?.group || m.wc;
                          const isDimmed = activeMap && !(activeMap[mWc2]?.has(dates[i]));
                          const isMActive = filterCell?.wc === m.wc && filterCell?.date === dates[i];
                          return (
                            <td key={i} style={{ padding: 3, textAlign: 'center' }}>
                              <div
                                onMouseEnter={e => { if (load > 0) showTooltipHM(e, m.wc + ' × ' + dates[i], zpsByCellMap[m.wc+'|'+dates[i]]?.zps||[]); }}
                                onMouseLeave={hideTooltipHM}
                                onClick={() => load > 0 && setFilterCell(fc => fc?.wc === m.wc && fc?.date === dates[i] ? null : { wc2: mWc2, wc: m.wc, date: dates[i] })}
                                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                minWidth: 52, height: 22, borderRadius: 4,
                                background: isDimmed ? T.surface2 : hs.bg,
                                color: isDimmed ? T.text3 : hs.color,
                                opacity: isDimmed ? 0.3 : 1,
                                fontSize: 10, fontWeight: 500, fontFamily: 'monospace',
                                cursor: load > 0 ? 'pointer' : 'default',
                                boxShadow: isMActive ? 'inset 0 0 0 2px #fff' : isLate && !isDimmed ? 'inset 0 0 0 2px #ef4444' : 'none' }}>
                                {isDimmed ? '–' : hs.text}
                              </div>
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
              {filteredBrigades.map((br, bi) => {
                // Cap/d = stała demo capacity (nie zmienia się po +8h)
                const capH    = BRIGADE_CAPACITY[br] ?? 0;
                // weekSum = suma aktualnych godzin z wcSchedule per dzień roboczy
                const weekSum = Math.round(dates.reduce((s, d) => s + getBrigadeCapH(br, d), 0) * 10) / 10;
                const grp = groups.find(g => g.wc2 === br);
                return [
                  <tr key={br} style={{ background: bi % 2 === 0 ? T.surface : T.surface2 }}>
                    <td style={{ padding: '5px 8px 5px 0', fontWeight: 700, color: T.text, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}
                      onClick={() => setExpandedBr(prev => { const n = new Set(prev); n.has(br) ? n.delete(br) : n.add(br); return n; })}>
                      <span style={{ fontSize: 9, color: T.text3, marginRight: 4, display: 'inline-block',
                        transform: expandedBr.has(br) ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                      {br}
                      {grp && <span style={{ fontSize: 10, color: T.text3, fontWeight: 400, marginLeft: 4 }}>({grp.machines.length})</span>}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: 11, fontFamily: 'monospace', color: T.accent, fontWeight: 600 }}>
                      {editingCapBr === br ? (
                        <input
                          autoFocus
                          type="number" min="0" step="0.5"
                          value={editingCapVal}
                          onChange={e => setEditingCapVal(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { const v = parseFloat(editingCapVal); if (!isNaN(v) && v >= 0) applyCapH(br, v); else setEditingCapBr(null); }
                            if (e.key === 'Escape') setEditingCapBr(null);
                          }}
                          onBlur={() => { const v = parseFloat(editingCapVal); if (!isNaN(v) && v >= 0) applyCapH(br, v); else setEditingCapBr(null); }}
                          style={{ width: 52, fontSize: 11, fontFamily: 'monospace', fontWeight: 600,
                            textAlign: 'center', borderRadius: 4, border: `1px solid ${T.accent}`,
                            background: T.surface3, color: T.accent, padding: '1px 4px', outline: 'none' }}
                        />
                      ) : (
                        <span
                          onClick={() => { if (onScheduleChange) { setEditingCapBr(br); setEditingCapVal(String(getBrigadeCapH(br, dates.find(d => !weekendSet.has(d)) || ''))); }}}
                          title="Kliknij aby edytować capacity wszystkich dni"
                          style={{ cursor: onScheduleChange ? 'pointer' : 'default',
                            borderBottom: onScheduleChange ? `1px dashed ${T.accent}` : 'none', paddingBottom: 1 }}>
                          {capH > 0 ? getBrigadeCapH(br, dates.find(d => !weekendSet.has(d)) || '') + 'h' : '—'}
                        </span>
                      )}
                    </td>
                    {dates.map(d => {
                      const cap  = getBrigadeCapH(br, d);
                      return (
                        <td key={d} style={{ padding: 3, textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            minWidth: 52, height: 34, borderRadius: 4,
                            background: cap > 0 ? 'rgba(34,197,94,0.08)' : T.surface2,
                            color: cap > 0 ? '#22c55e' : T.text3,
                            fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
                            <>{Math.round(cap * 10) / 10}h
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
                            </>
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
                      <td style={{ padding: '3px 8px 3px 20px', color: T.text2, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span style={{ color: T.text3, marginRight: 4 }}>└</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 10 }}>{m.wc}</span>
                        <span style={{ color: T.text3, marginLeft: 6, fontSize: 10 }}>{m.name}</span>
                      </td>
                      <td style={{ padding: '3px 8px', textAlign: 'center', fontSize: 10, color: T.text3, fontFamily: 'monospace' }}>
                        {Math.round(getWcH(m.wc, dates.find(d => !weekendSet.has(d)) || '') * 10) / 10}h
                      </td>
                      {dates.map(d => {
                        const h    = getWcH(m.wc, d);
                        return (
                          <td key={d} style={{ padding: 3, textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', flexDirection: 'column',
                              alignItems: 'center', justifyContent: 'center',
                              minWidth: 52, height: 34, borderRadius: 4,
                              background: h > 0 ? 'rgba(34,197,94,0.06)' : T.surface2,
                              color: h > 0 ? '#22c55e' : T.text3,
                              fontFamily: 'monospace', fontSize: 10, fontWeight: 500 }}>
                              <>{Math.round(h * 10) / 10}h
                                <span style={{ display: 'flex', gap: 2, marginTop: 2 }}>
                                  <button onClick={() => adjustMachine(m.wc, d, +8)}
                                    style={{ fontSize: 8, padding: '0 3px', borderRadius: 3, lineHeight: 1.5,
                                      border: `1px solid ${T.border2}`, background: T.surface3, color: T.ok, cursor: 'pointer' }}>+8</button>
                                  <button onClick={() => adjustMachine(m.wc, d, -8)}
                                    style={{ fontSize: 8, padding: '0 3px', borderRadius: 3, lineHeight: 1.5,
                                      border: `1px solid ${T.border2}`, background: T.surface3, color: T.bn, cursor: 'pointer' }}>-8</button>
                                </span>
                              </>
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