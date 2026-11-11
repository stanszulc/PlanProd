import { useState, useMemo, useEffect, useRef } from 'react';
import { T, s } from '../../constants/theme.js';
import { fmtDt } from '../../utils/scheduler.js';
import { planBottleneckView } from './bottleneckView.js';
import { DAY_NAMES } from '../../constants/theme.js';
import { Dot } from '../common/Dot.jsx';
import { EmptyState } from '../common/EmptyState.jsx';

export function GanttTab({ routing, zp, globalLookups, wcSchedule, subZP, fwdZP, zpStatus, onRecalc, ganttDirty, onViewChange, slaveMode, planStart, onPlanStartChange, embedded, selectedWC: selectedWCProp, onWCSelect, selectedDate, onDateSelect, heatmapFilter, onHeatmapFilterChange, wcToBrygada }) {

  const wcNameMap = useMemo(() => { const m = {}; routing.forEach(r => { if (!m[r.workcenter]) m[r.workcenter] = r.operation; }); return m; }, [routing]);
  const allWCFull = useMemo(() => { const wcSeq = {}; routing.forEach(r => { const seq = parseInt(r.sequence)||999; if (wcSeq[r.workcenter]===undefined||seq<wcSeq[r.workcenter]) wcSeq[r.workcenter]=seq; }); return [...new Set(routing.map(r=>r.workcenter))].sort((a,b)=>(wcSeq[a]||999)-(wcSeq[b]||999)); }, [routing]);
  const wcToBrygadaGM = useMemo(() => { const m = {}; routing.forEach(r => { if (r.workcenter && r.wc_group) m[r.workcenter] = r.wc_group; }); return m; }, [routing]);
  const dates  = useMemo(() => [...new Set(zp.map(z => z.due_date))].sort(), [zp]);
  const [filterZS,   setFilterZS]  = useState('');
  const [filterProd, setFilterProd] = useState('');
  const allZPraw = useMemo(() => [...zp].sort((a,b) => a.priority-b.priority || a.due_date.localeCompare(b.due_date)), [zp]);
  const allZP = useMemo(() => allZPraw.filter(z => {
    const zsOk = !filterZS.trim() || (z.zs_id||z.zp_id||'').toLowerCase().includes(filterZS.toLowerCase());
    const prOk = !filterProd.trim() || (z.product||'').toLowerCase().includes(filterProd.toLowerCase());
    return zsOk && prOk;
  }), [allZPraw, filterZS, filterProd]);
  const filteredZpIds = useMemo(() => new Set(allZP.map(z => z.zp_id)), [allZP]);

  const SCALES = [
    { key:'4h',  hourW:96,  tick:1,  label:'1h'  },
    { key:'8h',  hourW:56,  tick:2,  label:'2h'  },
    { key:'1d',  hourW:28,  tick:4,  label:'4h'  },
    { key:'3d',  hourW:14,  tick:8,  label:'8h'  },
    { key:'1w',  hourW:6,   tick:24, label:'1d'  },
    { key:'2w',  hourW:3,   tick:48, label:'2d'  },
  ];

  const [scaleIdx,   setScaleIdx]  = useState(2);
  const [panX,       setPanX]      = useState(0);
  const [isPan,      setIsPan]     = useState(false);
  const [tableOpen,  setTableOpen] = useState(false);
  // Debounced planStart: input wyświetla localPlanStart (natychmiastowo),
  // ciężkie memo używają committedPlanStart (aktualizuje się 300ms po ostatnim keystroku)
  const [localPlanStart,     setLocalPlanStart]     = useState(planStart || '2026-05-22');
  const [committedPlanStart, setCommittedPlanStart] = useState(planStart || '2026-05-22');
  const debPlanRef = useRef(null);
  useEffect(() => {
    if (planStart && planStart !== localPlanStart) {
      setLocalPlanStart(planStart);
      setCommittedPlanStart(planStart);
    }
  }, [planStart]);
  const tooltipRef  = useRef(null);
  function showTooltip(e, op, isGhost) {
    const el = tooltipRef.current; if (!el) return;
    el.style.left = (e.clientX + 14) + 'px';
    el.style.top  = (e.clientY - 8)  + 'px';
    el.style.display = 'block';
    const titleEl = el.querySelector('[data-tt="title"]');
    titleEl.textContent = (isGhost ? '🔒 Blokuje maszynę: ' : '') + (op.zs_id || op.parent_zp || op.zp_id || '');
    titleEl.style.color = isGhost ? T.text2 : T.accent;
    el.querySelector('[data-tt="client"]').textContent = op.klient || '—';
    el.querySelector('[data-tt="op"]').textContent     = op.operation || '';
    el.querySelector('[data-tt="wc"]').textContent     = op.workcenter || '';
    el.querySelector('[data-tt="dur"]').textContent    = (op.durH != null ? op.durH.toFixed(1) : '') + 'h';
    el.querySelector('[data-tt="start"]').textContent  = fmtDt(op.start_dt);
    el.querySelector('[data-tt="end"]').textContent    = fmtDt(op.end_dt);
    el.querySelector('[data-tt="due"]').textContent    = op.due_date || '';
  }
  function hideTooltip() { if (tooltipRef.current) tooltipRef.current.style.display = 'none'; }
  const [selectedZp,  setSelectedZp]  = useState(null); // kliknięty zp_id → filtr
  const [selectedWCLocal, setSelectedWCLocal] = useState(null); // lokalny fallback gdy brak propa
  // jeśli GanttTab jest używany standalone (bez PlanTab), używa lokalnego stanu
  const selectedWC = selectedWCProp !== undefined ? selectedWCProp : selectedWCLocal;
  const setSelectedWC = onWCSelect || setSelectedWCLocal;
  const svgRef       = useRef(null);
  const panRef       = useRef(null);
  const containerRef = useRef(null);

  // Synchronizacja widoku z PlanTab
  useEffect(() => {
    if (onViewChange) onViewChange({ panX, scaleIdx, hourW: SCALES[scaleIdx].hourW });
  }, [panX, scaleIdx]);

  const scale  = SCALES[scaleIdx];
  const HOUR_W = scale.hourW;

  const displayZP = useMemo(() => {
    const base = (fwdZP && fwdZP.length) ? fwdZP : subZP;
    // L0: heatmapFilter — filtr z zakładki Heatmapa Planu (brygada lub komórka × data)
    const hmBase = heatmapFilter
      ? (() => {
          const targetWcSet = heatmapFilter.wc
            ? new Set([heatmapFilter.wc])
            : new Set(Object.entries(wcToBrygadaGM).filter(([, v]) => v === heatmapFilter.wc2).map(([k]) => k));
          const zpIds = new Set(
            base.filter(op => {
              if (!targetWcSet.has(op.workcenter)) return false;
              if (!heatmapFilter.date) return true;
              return (op.segments||[]).some(seg => seg.segStart && new Date(seg.segStart).toISOString().slice(0,10) === heatmapFilter.date);
            }).map(op => op.parent_zp || op.zp_id.split('/')[0])
          );
          return base.filter(s => zpIds.has(s.parent_zp || s.zp_id.split('/')[0]));
        })()
      : base;
    // L2: pojedyncze ZP — pełna ścieżka operacji
    if (selectedZp) return hmBase.filter(s => (s.parent_zp || s.zp_id.split('/')[0]) === selectedZp);
    // L1: filtr po gnieździe — znajdź ZP mające op na tym WC, pokaż ich pełne ścieżki
    const wcBase = selectedWC
      ? (() => {
          const zpIds = new Set(
            hmBase.filter(s => s.workcenter === selectedWC)
                  .map(s => s.parent_zp || s.zp_id.split('/')[0])
          );
          return hmBase.filter(s => zpIds.has(s.parent_zp || s.zp_id.split('/')[0]));
        })()
      : hmBase;
    // L1.5: filtr po dacie — znajdź ZP mające segment w danym dniu, pokaż ich pełne ścieżki
    const dateBase = selectedDate
      ? (() => {
          const zpIds = new Set(
            wcBase.filter(s => (s.segments||[]).some(seg => seg.segStart && new Date(seg.segStart).toISOString().slice(0,10) === selectedDate))
                  .map(s => s.parent_zp || s.zp_id.split('/')[0])
          );
          return wcBase.filter(s => zpIds.has(s.parent_zp || s.zp_id.split('/')[0]));
        })()
      : wcBase;
    if (!filterZS.trim() && !filterProd.trim()) return dateBase;
    return dateBase.filter(s => filteredZpIds.has(s.parent_zp || s.zp_id));
  }, [fwdZP, subZP, filteredZpIds, filterZS, filterProd, selectedZp, selectedWC, selectedDate, heatmapFilter, wcToBrygadaGM]);

  const allWC = useMemo(() => {
    // Jeśli jakikolwiek filtr jest aktywny → pokaż tylko WC które mają bary w displayZP
    const anyFilter = filterZS.trim() || filterProd.trim() || selectedZp || selectedWC || selectedDate || heatmapFilter;
    if (!anyFilter) return allWCFull;
    // L1 (WC selected, no date/ZP filter): pokaż wszystkie gniazda — widać pełną ścieżkę ZP
    if (selectedWC && !selectedZp && !selectedDate && !heatmapFilter) return allWCFull;
    const usedWC = new Set(displayZP.map(s => s.workcenter));
    const firstStart = new Map();
    displayZP.forEach(s => {
      const t = s.segments?.[0]?.segStart;
      if (!t) return;
      const ms = new Date(t).getTime();
      if (!firstStart.has(s.workcenter) || ms < firstStart.get(s.workcenter))
        firstStart.set(s.workcenter, ms);
    });
    return allWCFull
      .filter(w => usedWC.has(w))
      .sort((a, b) => (firstStart.get(a) ?? Infinity) - (firstStart.get(b) ?? Infinity));
  }, [allWCFull, displayZP, filterZS, filterProd, selectedZp, selectedWC, selectedDate, heatmapFilter]);

  const planStartDt = useMemo(
    () => new Date((committedPlanStart || '2026-05-22') + 'T00:00:00'),
    [committedPlanStart]
  );

  const LABEL_W = 110, LANE_H = 54, TOP = 56;

  // Warstwa 1 — pełny plan (nigdy nie filtrowany): oś, ticks
  const planBase = useMemo(
    () => (fwdZP && fwdZP.length) ? fwdZP : subZP,
    [fwdZP, subZP]
  );

  const layout = useMemo(() => {
    if (!dates.length) {
      return { contentW: 800, axisStart: planStartDt, axisEnd: planStartDt, allDues: [], svgH: TOP + 16 };
    }
    // Oś liczona z PEŁNEGO planu — filtrowanie widoku nie zmienia osi
    // Bez spread Math.min/max (crash stack dla 100k elementów) — reduce po planBase bezpośrednio
    const allDues = dates.map(d => new Date(d + 'T23:59:59'));
    const maxDue  = allDues.reduce((m, d) => Math.max(m, d.getTime()), planStartDt.getTime() + 7 * 24 * 3600000);
    let minSegStart = Infinity, maxSegEnd = -Infinity;
    planBase.forEach(s => {
      (s.segments || []).forEach(seg => {
        if (seg.segStart) { const t = new Date(seg.segStart).getTime(); if (t < minSegStart) minSegStart = t; }
        if (seg.segEnd)   { const t = new Date(seg.segEnd).getTime();   if (t > maxSegEnd)   maxSegEnd   = t; }
      });
    });
    const maxDueDt  = new Date(Math.max(maxDue, maxSegEnd === -Infinity ? 0 : maxSegEnd));
    const axisStart = new Date(Math.min(planStartDt.getTime(), minSegStart === Infinity ? planStartDt.getTime() : minSegStart));
    axisStart.setHours(0, 0, 0, 0);
    const axisEnd  = new Date(maxDueDt); axisEnd.setHours(24, 0, 0, 0);
    const totalH   = Math.max((axisEnd - axisStart) / 3600000, 16);
    const contentW = Math.ceil(totalH) * HOUR_W;
    const svgH     = TOP + allWC.length * LANE_H + 16;  // wiersze z filtrowanego allWC
    return { contentW, axisStart, axisEnd, allDues, svgH };
  }, [dates, planBase, planStartDt, HOUR_W, allWC.length]);

  const { contentW, axisStart, axisEnd, allDues, svgH } = layout;

  // ── WHEEL ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) setScaleIdx(v => Math.max(0, v - 1));
        else              setScaleIdx(v => Math.min(SCALES.length - 1, v + 1));
      } else {
        e.preventDefault();
        const newPanX = Math.min(0, Math.max(-(contentW - 200), panXRef.current - e.deltaY * 1.5));
        panXRef.current = newPanX;
        if (svgGroupRef.current) svgGroupRef.current.setAttribute('transform', `translate(${newPanX},0)`);
        clearTimeout(debouncePanRef.current);
        debouncePanRef.current = setTimeout(() => setPanX(newPanX), 80);
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [contentW, svgH, embedded]);

  // tooltip rendered via DOM ref — no React state re-render on hover

  const wcIndexMap = useMemo(() => {
    const m = new Map();
    allWC.forEach((w, i) => m.set(w, i));
    return m;
  }, [allWC]);

  // [VIRT] Widoczne wiersze — ResizeObserver wykrywa też przejście display:none→visible
  const [visRows, setVisRows] = useState([0, 25]);
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const update = () => {
      if (!el.clientHeight) return; // ukryty (display:none) — pomiń
      const scrollTop = el.scrollTop;
      const viewH     = el.clientHeight;
      const BUFFER    = 3;
      const start = Math.max(0, Math.floor((scrollTop - TOP) / LANE_H) - BUFFER);
      const end   = Math.min(allWC.length, Math.ceil((scrollTop + viewH - TOP) / LANE_H) + BUFFER);
      setVisRows(prev => (prev[0] === start && prev[1] === end) ? prev : [start, end]);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [allWC.length]);

  // [VIRT] Segmenty pogrupowane per wiersz WC — O(1) dostęp per row zamiast O(20k) scan
  const wcSegments = useMemo(() => {
    const map = new Map();
    displayZP.forEach(s2 => {
      const wi = wcIndexMap.get(s2.workcenter);
      if (wi === undefined) return;
      if (!map.has(wi)) map.set(wi, []);
      map.get(wi).push(s2);
    });
    return map;
  }, [displayZP, wcIndexMap]);

  // Warstwa "duch" — inne ZP zajmujące te same gniazda w tym samym okresie.
  // Widoczna tylko gdy filtr zawężony do jednego ZP (selectedZp) — inaczej przerwy
  // między jego operacjami są nieme (maszyna zajęta czymś, co filtr wycina z danych).
  const ghostSegments = useMemo(() => {
    const map = new Map();
    if (!selectedZp) return map;
    planBase.forEach(s2 => {
      const zpKey = s2.parent_zp || s2.zp_id.split('/')[0];
      if (zpKey === selectedZp) return;
      const wi = wcIndexMap.get(s2.workcenter);
      if (wi === undefined) return;
      if (!map.has(wi)) map.set(wi, []);
      map.get(wi).push(s2);
    });
    return map;
  }, [planBase, selectedZp, wcIndexMap]);

  const zpStatusMap = useMemo(() => {
    const m = new Map();
    if (zpStatus) zpStatus.forEach(st => m.set(st.zp_id, st));
    return m;
  }, [zpStatus]);

  const dueDateMap = useMemo(() => {
    const m = new Map();
    if (allDues) dates.forEach((d, i) => m.set(d, allDues[i]));
    return m;
  }, [dates, allDues]);

  // [PERF #3] Ticki memoizowane — nie tworzyć 180 Date objects przy każdym renderze
  const ticks = useMemo(() => {
    if (!axisStart || !axisEnd) return [];
    const result = [];
    for (let t = new Date(axisStart); t <= axisEnd; t.setHours(t.getHours() + scale.tick)) {
      result.push(new Date(t));
    }
    return result;
  }, [axisStart?.getTime(), axisEnd?.getTime(), scale.tick]);

  // Etykieta "wąskie gardło": jedna definicja z utils/bottleneck.js — brygada primary
  // liczona z całego planu (planBase), nie z widoku po filtrach. Źródło mapowania gniazdo→brygada:
  // prop wcToBrygada (z App), fallback na mapowanie z routingu.
  const bnMembers = useMemo(() => {
    const map = wcToBrygada && Object.keys(wcToBrygada).length ? wcToBrygada : wcToBrygadaGM;
    return planBottleneckView({ fwdZP: planBase, wcSchedule, wcToBrygada: map }).primaryMembers;
  }, [planBase, wcSchedule, wcToBrygada, wcToBrygadaGM]);

  // [PERF #4] Pre-compute segment pixel X positions — oblicza się raz z planBase, NIE z displayZP
  // Zmiana filtra nie wywołuje przeliczenia; wcSegments (lekkie) decyduje co pokazać
  const segmentPx = useMemo(() => {
    if (!axisStart) return new Map();
    const axisMs = axisStart.getTime();
    const map = new Map();
    planBase.forEach(s2 => {
      (s2.segments || []).forEach((seg, si) => {
        const x  = LABEL_W + Math.max(0, (new Date(seg.segStart).getTime() - axisMs) / 3600000) * HOUR_W;
        const x2 = LABEL_W + Math.max(0, (new Date(seg.segEnd).getTime()   - axisMs) / 3600000) * HOUR_W;
        map.set(s2.zp_id + '-' + si, { x, x2 });
      });
    });
    return map;
  }, [planBase, axisStart?.getTime(), HOUR_W]);

  // [PERF #5] Pre-compute tick pixel X — eliminuje xOf(t) per 180 ticków
  const ticksPx = useMemo(() => {
    if (!axisStart) return [];
    const axisMs = axisStart.getTime();
    return ticks.map(t => ({
      t,
      x: LABEL_W + (t.getTime() - axisMs) / 3600000 * HOUR_W,
      isDay: t.getHours() === 0,
      dn: DAY_NAMES[t.getDay()],
    }));
  }, [ticks, axisStart?.getTime(), HOUR_W]);

  // [PERF #6] Pre-compute due date and planStart pixel X
  const planStartPx = useMemo(
    () => axisStart ? LABEL_W + Math.max(0, (planStartDt.getTime() - axisStart.getTime()) / 3600000) * HOUR_W : 0,
    [planStartDt, axisStart?.getTime(), HOUR_W]
  );
  // Linie terminów: bez filtra — terminy WSZYSTKICH ZP w widoku (jak dotychczas).
  // Gdy wybrany jeden ZP (selectedZp) — tylko JEGO termin, żeby nie mylić go z terminami
  // zupełnie innych zleceń, które akurat wypadają w tym samym oknie czasu (to była
  // przyczyna dwóch "losowych" czerwonych linii przy zawężeniu widoku).
  const dueLines = useMemo(() => {
    if (!selectedZp) return dates.map((d, i) => ({ date: d, dt: allDues[i] }));
    const zpIds = new Set(displayZP.map(s => s.parent_zp || s.zp_id.split('/')[0]));
    const relevantDates = [...new Set(zp.filter(z => zpIds.has(z.zp_id)).map(z => z.due_date))];
    return relevantDates.map(d => ({ date: d, dt: new Date(d + 'T23:59:59') }));
  }, [selectedZp, dates, allDues, displayZP, zp]);

  const duesPx = useMemo(
    () => axisStart ? dueLines.map(({dt}) => LABEL_W + Math.max(0, (dt.getTime() - axisStart.getTime()) / 3600000) * HOUR_W) : [],
    [dueLines, axisStart?.getTime(), HOUR_W]
  );
  // Żółta linia "dzień przed terminem" — tylko przy zawężeniu do jednego ZP (inaczej przy
  // tysiącach zleceń podwoiłaby liczbę linii bez potrzeby).
  const dueWarnPx = useMemo(
    () => (axisStart && selectedZp)
      ? dueLines.map(({dt}) => LABEL_W + Math.max(0, (dt.getTime() - 24*3600000 - axisStart.getTime()) / 3600000) * HOUR_W)
      : [],
    [dueLines, axisStart?.getTime(), HOUR_W, selectedZp]
  );

  const panXRef = useRef(0); // aktualny panX podczas drag — bez re-renderu
  const svgGroupRef = useRef(null); // ref na scrollowaną grupę SVG
  const debouncePanRef = useRef(null); // debounce dla setPanX po scrollu kółkiem

  if (!dates.length) return <EmptyState icon="📅" title="Brak danych" sub="Wgraj pliki CSV" />;

  function xOf(dt) {
    return LABEL_W + Math.max(0, (new Date(dt) - axisStart) / 3600000) * HOUR_W;
  }

  function onBgMouseDown(e) {
    const tag = e.target.tagName;
    const isBg = (tag === 'rect' && (e.target.getAttribute('fill') === 'transparent' || e.target.getAttribute('data-bg') === '1')) || tag === 'svg';
    if (isBg) { panRef.current = { startX: e.clientX, startPanX: panXRef.current }; setIsPan(true); }
  }
  function onMouseMove(e) {
    if (!panRef.current) return;
    const dx = e.clientX - panRef.current.startX;
    const newPanX = Math.min(0, Math.max(-(contentW - 200), panRef.current.startPanX + dx));
    panXRef.current = newPanX;
    // Przesuń SVG przez ref — bez re-renderu React
    if (svgGroupRef.current) {
      svgGroupRef.current.setAttribute('transform', `translate(${newPanX},0)`);
    }
  }
  function onMouseUp() {
    if (panRef.current) {
      // Dopiero po puszczeniu myszy aktualizuj stan — jeden re-render
      setPanX(panXRef.current);
    }
    panRef.current = null;
    setIsPan(false);
  }

  // Scrollbar poziomy
  const visibleW = (containerRef.current?.offsetWidth || 900) - LABEL_W;
  const thumbPct = Math.min(1, visibleW / contentW);
  const thumbPos = contentW > 0 ? (-panX / contentW) * 100 : 0;


  return (
    <>
      <div ref={tooltipRef} style={{display:'none',position:'fixed',zIndex:9999,pointerEvents:'none',
        background:'#1a2030',border:`1px solid ${T.border2}`,borderRadius:8,padding:'10px 14px',
        minWidth:220,boxShadow:'0 8px 24px rgba(0,0,0,0.5)',fontSize:11}}>
        <div data-tt="title" style={{fontWeight:700,color:T.accent,marginBottom:4,fontSize:12}}/>
        <div data-tt="client" style={{color:T.text2,marginBottom:2}}/>
        <div data-tt="op" style={{color:T.text3,marginBottom:6,fontSize:10}}/>
        <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'2px 8px',fontSize:10}}>
          <span style={{color:T.text3}}>Gniazdo</span><span data-tt="wc" style={{color:T.text,fontFamily:'monospace'}}/>
          <span style={{color:T.text3}}>Czas</span><span data-tt="dur" style={{color:T.accent,fontWeight:600}}/>
          <span style={{color:T.text3}}>Start</span><span data-tt="start" style={{color:T.text,fontFamily:'monospace'}}/>
          <span style={{color:T.text3}}>Koniec</span><span data-tt="end" style={{color:T.text,fontFamily:'monospace'}}/>
          <span style={{color:T.text3}}>Termin</span><span data-tt="due" style={{color:T.bn,fontFamily:'monospace'}}/>
        </div>
      </div>
      <div className={embedded ? 'gantt-tab gantt-tab--embedded' : undefined} style={embedded ? {display:'flex', flexDirection:'column', height:'100%'} : undefined}>
      {/* Controls */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        <span style={{ fontSize:13, color:T.text2 }}>
          <strong style={{color:T.text}}>{dates[0]?.slice(5)} – {dates[dates.length-1]?.slice(5)}</strong>
          &nbsp;·&nbsp; {allZP.length} ZP &nbsp;·&nbsp; {allWC.length} gniazd
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:6, background:T.surface2, padding:'4px 10px', borderRadius:8, border:`1px solid ${T.border}` }}>
          <span style={{ fontSize:11, color:T.text3 }}>Planuj od:</span>
          <input type="date" value={localPlanStart}
            onChange={e => {
              const v = e.target.value;
              setLocalPlanStart(v);
              clearTimeout(debPlanRef.current);
              debPlanRef.current = setTimeout(() => {
                setCommittedPlanStart(v);
                onPlanStartChange && onPlanStartChange(v);
              }, 300);
            }}
            style={{ fontSize:11, background:'transparent', border:'none', color:T.text, cursor:'pointer', outline:'none' }}/>
        </div>
        <div style={{ display:'flex', gap:2, background:T.surface2, borderRadius:8, padding:2, marginLeft:8 }}>
          {SCALES.map((sc,i) => (
            <button key={sc.key} onClick={() => setScaleIdx(i)}
              style={{ padding:'4px 10px', fontSize:11, fontWeight:600, borderRadius:6, border:'none',
                background: i===scaleIdx ? T.accent : 'transparent',
                color: i===scaleIdx ? '#fff' : T.text3, cursor:'pointer' }}>
              {sc.key}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', gap:4, marginLeft:'auto', alignItems:'center' }}>
          <span style={{ fontSize:10, color:T.text3 }}>
            Ctrl+scroll=zoom · scroll=pan · scroll⬆⬇=gniazda
          </span>
          <button onClick={() => { setPanX(0); setScaleIdx(2); if (containerRef.current) containerRef.current.scrollTop = 0; }}
            style={{ ...s.btn(false), fontSize:11, padding:'4px 10px' }}>⊡ Reset</button>
          <button onClick={onRecalc}
            style={{ padding:'6px 14px', fontSize:12, fontWeight:600, borderRadius:8, border:'none',
              background: ganttDirty ? T.accent : T.surface3,
              color: ganttDirty ? '#fff' : T.text3, cursor:'pointer' }}>
            {ganttDirty ? '⟳ Przelicz' : '✓ OK'}
          </button>
        </div>
      </div>

      {/* Filtry */}
      <div style={{ display:'flex', gap:8, marginBottom:8, flexWrap:'wrap' }}>
        <input type="text" placeholder="Nr ZS..." value={filterZS} onChange={e => setFilterZS(e.target.value)}
          style={{ padding:'5px 10px', fontSize:12, borderRadius:6, border:`1px solid ${T.border2}`,
            background:T.surface2, color:T.text, outline:'none', width:160 }}/>
        <input type="text" placeholder="Kod produktu..." value={filterProd} onChange={e => setFilterProd(e.target.value)}
          style={{ padding:'5px 10px', fontSize:12, borderRadius:6, border:`1px solid ${T.border2}`,
            background:T.surface2, color:T.text, outline:'none', width:200 }}/>
        {heatmapFilter && !selectedZp && (
          <button onClick={() => onHeatmapFilterChange && onHeatmapFilterChange(null)}
            style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 10px',
              background:'rgba(59,130,246,0.12)', color:'#60a5fa', border:'1px solid rgba(59,130,246,0.3)', borderRadius:6,
              fontSize:12, fontWeight:600, cursor:'pointer' }}>
            📊 {heatmapFilter.wc2}{heatmapFilter.wc ? ` › ${heatmapFilter.wc}` : ''}{heatmapFilter.date ? ` × ${heatmapFilter.date}` : ''} — wyczyść
          </button>
        )}
        {selectedDate && !selectedZp && (
          <button onClick={() => onDateSelect && onDateSelect(null)}
            style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 10px',
              background:T.accentBg, color:T.accent, border:`1px solid ${T.accent}`, borderRadius:6,
              fontSize:12, fontWeight:600, cursor:'pointer' }}>
            📅 {selectedDate}{selectedWC ? ` · ${selectedWC}` : ''} — pokaż wszystkie
          </button>
        )}
        {selectedWC && !selectedZp && !selectedDate && (
          <button onClick={() => setSelectedWC(null)}
            style={{ padding:'5px 10px', fontSize:12, borderRadius:6, border:`1px solid ${T.accent}`,
              background:T.accentBg, color:T.accent, cursor:'pointer', fontWeight:600 }}>
            🔧 {selectedWC} — pokaż wszystkie
          </button>
        )}
        {selectedZp && (
          <button onClick={() => setSelectedZp(null)}
            style={{ padding:'5px 10px', fontSize:12, borderRadius:6, border:`1px solid ${T.accent}`,
              background:T.accentBg, color:T.accent, cursor:'pointer', fontWeight:600 }}>
            {selectedWC ? `🔧 ${selectedWC} › ` : ''}✕ {selectedZp} — wróć
          </button>
        )}
        {(filterZS||filterProd) && <button onClick={() => { setFilterZS(''); setFilterProd(''); }}
          style={{ padding:'5px 10px', fontSize:12, borderRadius:6, border:`1px solid ${T.border2}`,
            background:'transparent', color:T.text3, cursor:'pointer' }}>✕ Wyczyść</button>}
        {(filterZS||filterProd) && <span style={{fontSize:12, color:T.text3, alignSelf:'center'}}>
          {allZP.length} / {allZPraw.length} ZP
        </span>}
      </div>

      {/* Legenda ZP */}
      <div style={{ marginBottom:8 }}>
        <div style={{ display:'flex', gap:12, fontSize:11, color:T.text3, flexWrap:'wrap', alignItems:'center',
          maxHeight:64, overflowY:'auto', paddingBottom:2 }}>
          {allZP.length <= 80
            ? allZP.map(zp2 => {
                const col = globalLookups.zpColorMap[zp2.zp_id] || T.text3;
                return <span key={zp2.zp_id} style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
                  <Dot color={col} size={7}/>{zp2.zs_id || zp2.zp_id}
                </span>;
              })
            : <span style={{color:T.text3,fontStyle:'italic'}}>Legenda ukryta — {allZP.length} ZP (użyj filtrów)</span>
          }
        </div>
        <div style={{ display:'flex', gap:12, fontSize:11, color:T.text3, marginTop:4 }}>
          <span style={{display:'flex',alignItems:'center',gap:5}}>
            <span style={{width:14,height:3,background:T.bn,display:'inline-block',borderRadius:2}}/>due_date
          </span>
          {selectedZp && (
            <span style={{display:'flex',alignItems:'center',gap:5}}>
              <span style={{width:14,height:3,background:T.warn,display:'inline-block',borderRadius:2}}/>dzień przed terminem
            </span>
          )}
          <span style={{display:'flex',alignItems:'center',gap:5}}>
            <span style={{width:14,height:12,background:'rgba(0,0,0,0.25)',display:'inline-block',borderRadius:2}}/>niedostępne
          </span>
          {selectedZp && (
            <span style={{display:'flex',alignItems:'center',gap:5}}>
              <span style={{width:14,height:12,background:T.text3,opacity:0.4,border:`1px dashed ${T.text3}`,display:'inline-block',borderRadius:2}}/>
              🔒 inne ZP (blokują maszynę)
            </span>
          )}
          <span style={{color:T.text3}}>{allZP.length} ZP</span>
        </div>
      </div>

      {/* SVG Gantt */}
      <div style={embedded ? { flex:1, minHeight:0 } : { ...s.card, padding:0, overflow:'hidden' }}>
        <div ref={containerRef}
          style={{
            background: T.ganttBg,
            borderRadius: embedded ? 0 : 12,
            overflowY: 'auto',
            overflowX: 'hidden',
            height: embedded ? '100%' : 'calc(100vh - 160px)',
            minHeight: embedded ? 0 : 500,
            cursor: isPan ? 'grabbing' : 'default',
            userSelect: 'none',
            position: 'relative',
          }}
          onMouseDown={onBgMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {displayZP.length === 0
            ? <div style={{padding:'48px',textAlign:'center',color:T.text3,fontSize:13}}>
                Kliknij <strong style={{color:T.accent}}>⟳ Przelicz</strong> aby zaplanować
              </div>
            : <svg ref={svgRef} width="100%" height={svgH} style={{display:'block'}}>
                <defs>
                  <clipPath id="ganttClip">
                    <rect x={LABEL_W} y="0" width="10000" height={svgH}/>
                  </clipPath>
                </defs>

                <rect x="0" y="0" width="100%" height="100%" fill={T.ganttBg} data-bg="1"/>

                {/* SCROLLOWANA zawartość — przesuwa się X i Y */}
                <g clipPath="url(#ganttClip)">
                  <g ref={svgGroupRef} transform={`translate(${panX},0)`}>

                    {allWC.slice(visRows[0], visRows[1]).map((w, li) => { const wi = visRows[0]+li; return (
                      <g key={`bg-${w}`}>
                        <rect x={LABEL_W} y={TOP+wi*LANE_H} width={contentW+40} height={LANE_H}
                          fill={wi%2===0?T.surface:T.surface2}/>
                        <line x1={LABEL_W} y1={TOP+(wi+1)*LANE_H} x2={LABEL_W+contentW+40} y2={TOP+(wi+1)*LANE_H}
                          stroke={T.border} strokeWidth="0.5"/>
                      </g>
                    );})}
                    {ticksPx.map(({t,x,isDay,dn},ti) => (
                      <g key={ti}>
                        <line x1={x} y1={TOP-8} x2={x} y2={TOP+allWC.length*LANE_H}
                          stroke={isDay?T.border2:T.border} strokeWidth={isDay?1.5:0.5}/>
                        {isDay && <text x={x+4} y={TOP-30} fontSize="11" fontWeight="600" fill={T.text2}>
                          {dn} {String(t.getDate()).padStart(2,'0')}.{String(t.getMonth()+1).padStart(2,'0')}
                        </text>}
                        {!isDay && <text x={x+3} y={TOP-14} fontSize="9" fill={T.text3}>
                          {String(t.getHours()).padStart(2,'0')}:00
                        </text>}
                      </g>
                    ))}
                    <g>
                      <line x1={planStartPx} y1={TOP-8} x2={planStartPx} y2={TOP+allWC.length*LANE_H}
                        stroke={T.accent} strokeWidth="2" opacity="0.9"/>
                      <rect x={planStartPx+3} y={TOP-22} width="30" height="14" rx="3" fill={T.accentBg}/>
                      <text x={planStartPx+6} y={TOP-12} fontSize="9" fontWeight="700" fill={T.accent}>dziś</text>
                    </g>
                    {dueWarnPx.map((wx,i) => (
                      <g key={'duewarn'+i}>
                        <line x1={wx} y1={TOP-8} x2={wx} y2={TOP+allWC.length*LANE_H}
                          stroke={T.warn} strokeWidth="2" strokeDasharray="5 3" opacity="0.8"/>
                        <rect x={wx+3} y={TOP-22} width="46" height="14" rx="3" fill={T.warn} opacity="0.2"/>
                        <text x={wx+6} y={TOP-12} fontSize="9" fontWeight="700" fill={T.warn}>-1d {dueLines[i]?.date?.slice(5)}</text>
                      </g>
                    ))}
                    {duesPx.map((dx,i) => (
                      <g key={'due'+i}>
                        <line x1={dx} y1={TOP-8} x2={dx} y2={TOP+allWC.length*LANE_H}
                          stroke={T.bn} strokeWidth="2" strokeDasharray="5 3" opacity="0.9"/>
                        <rect x={dx+3} y={TOP-22} width="38" height="14" rx="3" fill={T.bnBg}/>
                        <text x={dx+6} y={TOP-12} fontSize="9" fontWeight="700" fill={T.bn}>{dueLines[i]?.date?.slice(5)}</text>
                      </g>
                    ))}
                    {selectedZp && Array.from({length: visRows[1]-visRows[0]}, (_, li) => {
                      const wi = visRows[0]+li;
                      const rows = ghostSegments.get(wi); if (!rows) return null;
                      return rows.map(s2 => {
                        const y = TOP+wi*LANE_H+5, bH = LANE_H-10;
                        return (s2.segments||[]).map((seg,si) => {
                          const px = segmentPx.get(s2.zp_id + '-' + si); if (!px) return null;
                          const { x, x2 } = px;
                          const wpx = Math.max(x2-x, 2);
                          return <rect key={'ghost-'+s2.zp_id+'-'+si} x={x} y={y} width={wpx} height={bH} rx="4"
                            fill={T.text3} opacity="0.16"
                            stroke={T.text3} strokeWidth="1" strokeDasharray="3 3"
                            style={{cursor:'pointer'}}
                            onMouseEnter={e => showTooltip(e, s2, true)}
                            onMouseLeave={hideTooltip}
                          />;
                        });
                      });
                    })}
                    {Array.from({length: visRows[1]-visRows[0]}, (_, li) => {
                      const wi = visRows[0]+li;
                      const rows = wcSegments.get(wi); if (!rows) return null;
                      return rows.map(s2 => {
                        const col = globalLookups.zpColorMap[s2.parent_zp] || globalLookups.zpColorMap[s2.zp_id] || T.text3;
                        const y = TOP+wi*LANE_H+5, bH = LANE_H-10;
                        const dueDtLocal = dueDateMap.get(s2.due_date);
                        const zpSt  = zpStatusMap.get(s2.parent_zp || s2.zp_id);
                        const zpKey = s2.parent_zp || s2.zp_id.split('/')[0];
                        return (s2.segments||[]).map((seg,si) => {
                          const px  = segmentPx.get(s2.zp_id + '-' + si); if (!px) return null;
                          const { x, x2 } = px;
                          const wpx = Math.max(x2-x, 2);
                          const isOver = dueDtLocal && seg.segEnd && new Date(seg.segEnd) > dueDtLocal;
                          const isLast = si===s2.segments.length-1;
                          const tocZone = zpSt ? (zpSt.toc && zpSt.toc.zone) : (isOver ? 'black' : 'green');
                          const isLateZone = tocZone==='black' || tocZone==='red';
                          const borderCol = isLateZone?T.bn:tocZone==='yellow'?T.warn:'transparent';
                          const borderW   = tocZone==='green'||!tocZone ? 0 : 2.5;
                          const isSel = selectedZp === zpKey;
                          return <g key={s2.zp_id + '-' + si}>
                            <rect x={x} y={y} width={wpx} height={bH} rx="4"
                              fill={col}
                              opacity={selectedZp && !isSel ? 0.25 : 0.9}
                              stroke={isSel ? (isLateZone ? T.bn : '#fff') : borderCol}
                              strokeWidth={isSel ? (isLateZone ? 3 : 2) : borderW}
                              style={{cursor:'pointer'}}
                              onClick={() => setSelectedZp(prev => prev === zpKey ? null : zpKey)}
                              onMouseEnter={e => showTooltip(e, s2)}
                              onMouseLeave={hideTooltip}
                            />
                            {isLast && wpx>30 && <text x={x+Math.min(wpx/2,38)} y={y+bH/2-4}
                              fontSize={wpx>52?10:9} fontWeight="600" fill="white"
                              textAnchor="middle" style={{pointerEvents:'none'}}>{s2.zs_id || s2.zp_id}</text>}
                            {isLast && wpx>56 && <text x={x+Math.min(wpx/2,38)} y={y+bH/2+9}
                              fontSize="9" fill="rgba(255,255,255,0.75)"
                              textAnchor="middle" style={{pointerEvents:'none'}}>{s2.durH.toFixed(1)}h</text>}
                            {!isLast && (() => {
                              const nxPx = segmentPx.get(s2.zp_id + '-' + (si+1)); if (!nxPx) return null;
                              return <line x1={x+wpx} y1={y+bH/2} x2={nxPx.x} y2={y+bH/2}
                                stroke={col} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5"/>;
                            })()}
                          </g>;
                        });
                      });
                    })}
                  </g>
                </g>



                {/* STAŁA lewa kolumna — przesuwa się tylko w Y razem z panY */}
                <rect x="0" y="0" width={LABEL_W} height="10000" fill={T.ganttBg}/>
                <g>
                  {allWC.slice(visRows[0], visRows[1]).map((w, li) => {
                    const wi = visRows[0]+li;
                    const isBn = bnMembers.has(String(w));
                    const isSel = selectedWC === w;
                    return <g key={`lbl-${w}`} style={{cursor:'pointer'}}
                      onClick={() => { setSelectedWC(prev => prev === w ? null : w); setSelectedZp(null); }}>
                      <rect x="0" y={TOP+wi*LANE_H} width={LABEL_W} height={LANE_H}
                        fill={isSel ? T.accentBg : isBn ? 'rgba(248,113,113,0.10)' : T.surface2}/>
                      {isSel && <rect x="0" y={TOP+wi*LANE_H} width={3} height={LANE_H} fill={T.accent}/>}
                      <text x="12" y={TOP+wi*LANE_H+LANE_H/2-7} fontSize="12" fontWeight="700"
                        fill={isSel ? T.accent : isBn ? T.bn : T.text}>{w}</text>
                      <text x="12" y={TOP+wi*LANE_H+LANE_H/2+9} fontSize="10"
                        fill={isSel ? T.accent : isBn ? T.bn : T.text3}>{wcNameMap[w] || ""}</text>
                    </g>;
                  })}
                </g>
                {/* Przykrycie nagłówka osi — stały */}
                <rect x="0" y="0" width={LABEL_W} height={TOP} fill={T.ganttBg}/>
                <line x1={LABEL_W} y1="0" x2={LABEL_W} y2="10000"
                  stroke={T.border2} strokeWidth="1.5"/>

              </svg>
          }

          {/* Scrollbar poziomy */}
          {contentW > 200 && (
            <div style={{ position:'absolute', bottom:4, left:LABEL_W, right:8, height:6,
              background:'rgba(255,255,255,0.05)', borderRadius:3 }}>
              <div style={{
                position:'absolute', top:0, height:'100%', borderRadius:3,
                background:'rgba(255,255,255,0.18)',
                width: `${thumbPct*100}%`,
                left: `${thumbPos}%`,
                transition:'left 0.05s',
              }}/>
            </div>
          )}
        </div>
      </div>

      {/* Tabela pod-ZP */}
      {!embedded && subZP && subZP.length > 0 && (
        <div style={{...s.card, marginTop:12}}>
          <div onClick={()=>setTableOpen(v=>!v)}
            style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',userSelect:'none'}}>
            <div style={s.cardTitle}>Plan operacji ({subZP.length})</div>
            <span style={{fontSize:12,color:T.text3,marginBottom:14}}>{tableOpen?'▲ Zwiń':'▶ Rozwiń'}</span>
          </div>
          {tableOpen && (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr>
                  {['Pod-ZP','ZP','Gniazdo','Operacja','Start','Koniec','Czas','Status'].map(h=>
                    <th key={h} style={{fontSize:10,fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',
                      color:T.text3,padding:'0 8px 8px',textAlign:'left',borderBottom:`1px solid ${T.border}`}}>{h}</th>
                  )}
                </tr></thead>
                <tbody>
                  {[...subZP].sort((a,b)=>a.sequence-b.sequence||a.zp_id.localeCompare(b.zp_id)).map((s2,i)=>{
                    const col=globalLookups.zpColorMap[s2.zp_id]||T.text3;
                    const dueDtForZP=allDues[dates.indexOf(s2.due_date)];
                    const isOver=s2.end_dt&&dueDtForZP&&new Date(s2.end_dt)>dueDtForZP;
                    const st=isOver?{bg:T.bnBg,color:T.bn,label:'OPÓŹNIONE'}:{bg:T.okBg,color:T.ok,label:'OK'};
                    return <tr key={i} style={{background:isOver?'rgba(248,113,113,0.05)':'transparent'}}>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`}}>
                        <code style={{fontSize:11,color:T.accent,background:T.accentBg,padding:'1px 5px',borderRadius:4}}>{s2.sub_id}</code>
                      </td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`}}>
                        <span style={{display:'flex',alignItems:'center',gap:5}}><Dot color={col} size={7}/>{s2.zp_id}</span>
                      </td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`,fontWeight:700,color:T.text}}>{s2.workcenter}</td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`,color:T.text2,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s2.operation}</td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`,fontFamily:'monospace',color:T.text2,whiteSpace:'nowrap'}}>{fmtDt(s2.start_dt)}</td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`,fontFamily:'monospace',color:isOver?T.bn:T.text2,fontWeight:isOver?600:400,whiteSpace:'nowrap'}}>{fmtDt(s2.end_dt)}</td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`,fontFamily:'monospace',color:T.text3}}>{s2.durH.toFixed(1)}h</td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`}}>
                        <span style={{display:'inline-flex',padding:'2px 7px',borderRadius:5,fontSize:10,fontWeight:600,background:st.bg,color:st.color}}>{st.label}</span>
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}