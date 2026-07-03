import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { s, T, PALETTE } from './constants/theme.js';
import { DEMO_ERP_ZP, DEMO_ZP_STATUS } from './constants/demoData.js';
import {
  parseZPFromERP, erpZpToSchedulerInput,
  tocBuffer, computeLoads, dlCSV,
  calcHybridZpStatus,
} from './utils/scheduler.js';
import {
  enrichWithStandards, calcWaitTimes, calcCapacityLoss,
  parseZpStatus, calcZpHeaderStatus, exportZpStatusCsv,
  zpStatusToHistoryFormat,
} from './utils/analysisUtils.js';
import { ImportTab }     from './components/tabs/ImportTab.jsx';
import { PlanTab }       from './components/tabs/PlanTab.jsx';
import { BottleneckTab } from './components/tabs/BottleneckTab.jsx';
import { RoutingTab }    from './components/tabs/RoutingTab.jsx';
import { HeatmapTab }    from './components/tabs/HeatmapTab.jsx';
import { SwimlaneTab }   from './components/tabs/SwimlaneTab.jsx';
import { SankeyTab }     from './components/tabs/SankeyTab.jsx';
import { AnalysisTab }   from './components/tabs/AnalysisTab.jsx';
import { DashboardTab }  from './components/tabs/DashboardTab.jsx';
import { RealizacjaTab } from './components/tabs/RealizacjaTab.jsx';
import { LateZSTab }     from './components/tabs/LateZSTab.jsx';
import { BufferTab }     from './components/tabs/BufferTab.jsx';
import { BufferZSTab }   from './components/tabs/BufferZSTab.jsx';
import { ScheduleDebugTab }  from './components/tabs/ScheduleDebugTab.jsx';
import { HeatmapPlanTab }   from './components/tabs/HeatmapPlanTab.jsx';
import { SettingsTab }      from './components/tabs/SettingsTab.jsx';
import { FlowMatrixTab }    from './components/tabs/FlowMatrixTab.jsx';
import './App.css';
import { WC_DAILY_CAPACITY } from './constants/demoData.js';
import { initBrigadeSchedule } from './components/tabs/SettingsTab.jsx';

// ─── buildWcSchedule ──────────────────────────────────────────────────────────
function buildWcSchedule(wcList, planStartStr, zpList, horizonDays = 14, prev = {}, wcCapacity = {}) {
  const planStart = new Date(planStartStr + 'T00:00:00');

  const horizonEnd = new Date(planStart);
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);

  let maxDue = new Date(horizonEnd);
  if (zpList && zpList.length) {
    zpList.forEach(z => {
      if (z.due_date) {
        const d = new Date(z.due_date + 'T00:00:00');
        if (d > maxDue) maxDue = d;
      }
    });
  }

  const endDate = new Date(maxDue);
  endDate.setDate(endDate.getDate() + 30);

  const next = {};
  for (const wc of wcList) {
    const capH   = wcCapacity[wc] ?? WC_DAILY_CAPACITY[wc] ?? 16;
    const obj    = {};
    const prevSc = prev[wc];

    const cur = new Date(planStart);
    while (cur <= endDate) {
      const dateStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
      const jsDay   = cur.getDay();
      const isWe    = jsDay === 0 || jsDay === 6;

      if (prevSc && typeof prevSc === 'object' && !Array.isArray(prevSc) && prevSc[dateStr] !== undefined) {
        obj[dateStr] = prevSc[dateStr];
      } else if (Array.isArray(prevSc)) {
        const idx = jsDay === 0 ? 6 : jsDay - 1;
        obj[dateStr] = prevSc[idx] ?? 0;
      } else {
        obj[dateStr] = isWe ? 0 : capH;
      }

      cur.setDate(cur.getDate() + 1);
    }
    next[wc] = obj;
  }
  return next;
}

const MENU = [
  { id: 'dashboard', label: '🏠 Dashboard' },
  { label: '📋 Planowanie', items: [
    { id: 'plan',         label: 'Harmonogram' },
    { id: 'bottleneck',   label: 'Wąskie gardła' },
    { id: 'heatmap',      label: 'Heatmapa obciążeń' },
    { id: 'heatmap_plan', label: 'Heatmapa planu' },
    { id: 'flow_matrix',  label: 'Przepływy (macierz)' },
    { id: 'swimlane',     label: 'Swimlane' },
    { id: 'sankey',       label: 'Przepływ (Sankey)' },
    { id: 'routing',      label: 'Routing' },
  ]},
  { label: '🏭 Realizacja', items: [
    { id: 'realizacja', label: 'Raport OTIF'  },
    { id: 'buffer',     label: 'Bufor TOC'    },
    { id: 'buffer_zs',  label: 'Bufor ZS'     },
    { id: 'late_zs',    label: 'Spóźnione ZS' },
  ]},
  { label: '📊 Analityka', items: [
    { id: 'analysis', label: 'Analiza Procesu' },
  ]},
  { label: '⚙️', items: [
    { id: 'import',         label: 'Import / Eksport' },
    { id: 'schedule_debug', label: 'Diagnostyka harmonogramu' },
    { id: 'settings',       label: 'Ustawienia planowania' },
  ]},
];

function NavMenu({ menu, active, onSelect, indicators = {} }) {
  const [open, setOpen] = React.useState(null);

  function groupActive(item) {
    if (item.id) return active === item.id;
    return item.items?.some(i => i.id === active);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {menu.map((item, idx) => {
        if (item.id) {
          return (
            <button key={item.id} type="button"
              className={`flowops-nav-tab${active === item.id ? ' active' : ''}`}
              onClick={() => { onSelect(item.id); setOpen(null); }}>
              {item.label}
            </button>
          );
        }
        const isOpen   = open === idx;
        const isActive = groupActive(item);
        return (
          <div key={idx} style={{ position: 'relative' }}
            onMouseLeave={() => setOpen(null)}>
            <button type="button"
              className={`flowops-nav-tab${isActive ? ' active' : ''}`}
              onMouseEnter={() => setOpen(idx)}
              onClick={() => setOpen(isOpen ? null : idx)}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {item.label}
              <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
              {item.items?.some(i => indicators[i.id]) && (
                <span style={{ fontSize: 8, color: '#34d399' }}>●</span>
              )}
            </button>
            {isOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 100,
                background: '#10141a', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '4px 0', minWidth: 160,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                {item.items.map(sub => (
                  <button key={sub.id} type="button"
                    onClick={() => { onSelect(sub.id); setOpen(null); }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '8px 14px', fontSize: 12,
                      background: active === sub.id ? 'rgba(77,148,255,0.15)' : 'transparent',
                      color: active === sub.id ? '#4d94ff' : '#a8b0c0',
                      border: 'none', cursor: 'pointer', textAlign: 'left',
                      borderLeft: active === sub.id ? '2px solid #4d94ff' : '2px solid transparent',
                    }}
                    onMouseEnter={e => { if (active !== sub.id) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    onMouseLeave={e => { if (active !== sub.id) e.currentTarget.style.background = 'transparent'; }}>
                    {sub.label}
                    {indicators[sub.id] && <span style={{ fontSize: 8, color: '#34d399' }}>●</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [tab, setTab]               = useState('dashboard');
  const [erpZp, setErpZp]           = useState([]);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const workerRef    = useRef(null);
  const workerSeqRef = useRef(0);
  const [routing, setRouting]       = useState([]);
  const [zp, setZP]                 = useState([]);
  const [wcSchedule, setWcSchedule] = useState({});
  const [wcScheduleVersion, setWcScheduleVersion] = useState(0);
  const [wcToWc2, setWcToWc2]       = useState({});
  const [wcCapacity, setWcCapacity] = useState(WC_DAILY_CAPACITY);
  const [subZP, setSubZP]           = useState([]);
  const [fwdZP, setFwdZP]           = useState([]);
  const [zpStatus, setZpStatus]     = useState([]);
  const [ganttDirty, setGanttDirty] = useState(true);
  const [planStart, setPlanStart]   = useState(() => new Date().toISOString().slice(0,10));
  const [selectedWC, setSelectedWC] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [heatmapFilter, setHeatmapFilter] = useState(null);
  const [hybridMode, setHybridMode] = useState(false);
  const [scheduleConfig, setScheduleConfig] = useState({
    vipBufferDays:   2,
    urgencyMethod:   'atc',
    autoPlanStart:   true,
    defaultSchedule: [16,16,16,16,16,0,0],
    horizonDays:     14,
    brigadeSchedule: initBrigadeSchedule(),
    schedulingMode:  'asap',
    safetyBufferDays: 1,
    shiftStart:      6,
  });

  const [historyData, setHistoryData]         = useState([]);
  const [zpStatusData, setZpStatusData]       = useState([]);
  const [zpStatusHeaders, setZpStatusHeaders] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');

  const filteredZP = useMemo(() => {
    if (!dateFrom && !dateTo) return zp;
    return zp.filter(z =>
      (!dateFrom || z.due_date >= dateFrom) &&
      (!dateTo   || z.due_date <= dateTo)
    );
  }, [zp, dateFrom, dateTo]);

  const allDueDates = useMemo(() => [...new Set(zp.map(z => z.due_date))].sort(), [zp]);

  function updateSchedule(s) {
    setWcSchedule(s);
    setWcScheduleVersion(v => v + 1);
    setGanttDirty(true);
  }

  useEffect(() => {
    if (routing.length > 0) {
      const wcs = [...new Set([
        ...routing.map(r => r.workcenter),
        ...Object.keys(wcToWc2)
      ])].sort();
      setWcSchedule(prev => buildWcSchedule(wcs, planStart, zp, scheduleConfig.horizonDays, prev, wcCapacity));
      setWcScheduleVersion(v => v + 1);
      setGanttDirty(true);
    }
  }, [routing.length, planStart, zp.length, Object.keys(wcToWc2).length]);

  const globalLookups = useMemo(() => {
    const routingByProduct = {};
    routing.forEach(r => {
      if (!routingByProduct[r.product]) routingByProduct[r.product] = [];
      routingByProduct[r.product].push(r);
    });
    Object.keys(routingByProduct).forEach(p => {
      routingByProduct[p].sort((a, b) => a.sequence - b.sequence);
    });

    const zpColorMap = {};
    zp.forEach((z, index) => {
      zpColorMap[z.zp_id] = PALETTE[index % PALETTE.length];
    });

    const productIndexMap = {};
    const uniqueProducts = [...new Set(routing.map(r => r.product))];
    uniqueProducts.forEach((p, index) => {
      productIndexMap[p] = index;
    });

    return { routingByProduct, zpColorMap, productIndexMap };
  }, [routing, zp]);

  useEffect(() => {
    const rl = globalLookups.routingByProduct;
    if (zp.length > 0 && Object.keys(rl).length > 0) {
      recalcGantt(wcSchedule);
    }
  }, [zp.length, routing.length, wcScheduleVersion, planStart, scheduleConfig.schedulingMode]);

  function recalcGantt(currentWcSchedule) {
    const rl  = globalLookups.routingByProduct;
    const wcs = currentWcSchedule ?? wcSchedule;
    if (!Object.keys(rl).length) return;

    if (workerRef.current) workerRef.current.terminate();
    setIsScheduling(true);
    const seq = ++workerSeqRef.current;

    const worker = new Worker(
      new URL('./utils/scheduler.worker.js', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (e) => {
      if (seq !== workerSeqRef.current) { worker.terminate(); return; }
      const { type, payload } = e.data;
      if (type === 'DONE') {
        const { fwdZP, zpStatus } = payload;
        const fwdFixed = fwdZP.map(op => ({
          ...op,
          start_dt: op.start_dt ? new Date(op.start_dt) : null,
          end_dt:   op.end_dt   ? new Date(op.end_dt)   : null,
          segments: (op.segments||[]).map(s => ({
            ...s,
            segStart: s.segStart ? new Date(s.segStart) : null,
            segEnd:   s.segEnd   ? new Date(s.segEnd)   : null,
          })),
          realEnd: op.realEnd ? new Date(op.realEnd) : null,
        }));
        const statusFixed = zpStatus.map(z => ({
          ...z,
          backStart: z.backStart ? new Date(z.backStart) : null,
          realEnd:   z.realEnd   ? new Date(z.realEnd)   : null,
        }));
        setFwdZP(fwdFixed);
        setSubZP(fwdFixed);
        setZpStatus(statusFixed);
        setGanttDirty(false);
        setIsScheduling(false);
        workerRef.current = null;
        window.__FLOWOPS_DEBUG__ = { zp, routing: rl, wcSchedule: wcs, planStart, scheduleConfig, wcToWc2 };
      } else if (type === 'ERROR') {
        console.error('Worker error:', payload.message);
        setIsScheduling(false);
        workerRef.current = null;
      }
    };

    worker.onerror = (err) => {
      console.error('Worker crashed:', err);
      setIsScheduling(false);
      workerRef.current = null;
    };

    worker.postMessage({
      type: 'SCHEDULE',
      payload: { zpList: zp, routingByProduct: rl, wcSchedule: wcs, planStart, config: scheduleConfig, wcToWc2 }
    });
  }

  useEffect(() => {
    return () => { if (workerRef.current) workerRef.current.terminate(); };
  }, []);

  function handleOptimize() {
    if (!fwdZP.length || !zp.length) return;
    setIsOptimizing(true);
    const worker = new Worker(new URL('./utils/scheduler.worker.js', import.meta.url), { type: 'module' });
    worker.onerror = (err) => {
      console.error('⚡ Worker onerror:', err.message, err);
      setIsOptimizing(false);
      worker.terminate();
    };
    worker.onmessage = ({ data: { type, payload } }) => {
      if (type === 'DONE') {
        setFwdZP(payload.fwdZP || []);
        setZpStatus(payload.zpStatus || []);
        setGanttDirty(false);
        setIsOptimizing(false);
        worker.terminate();
        const s = payload.optimizeStats;
        if (s) {
          if (s.skipped) {
            alert('✅ Brak spóźnionych ZP — plan jest już optymalny.');
          } else {
            alert(`⚡ Optymalizacja zakończona (${s.iterations} iter.):\nByło spóźnionych: ${s.lateStart}\nJest spóźnionych: ${s.lateEnd}\nPoprawiono: ${s.moved} ZP`);
          }
        }
      }
      if (type === 'ERROR') {
        console.error('⚡ INSERT LS error:', payload.message, payload.stack);
        setIsOptimizing(false);
        worker.terminate();
      }
    };
    worker.postMessage({
      type: 'OPTIMIZE_INSERT',
      payload: { wcSchedule, planStart, fwdZP, zpStatus, wcToWc2 },
    });
  }

  const activeZpStatus = useMemo(() => {
    if (!hybridMode || !zpStatusData.length) return zpStatus;
    try {
      return calcHybridZpStatus(zpStatus, zpStatusData, globalLookups.routingByProduct, wcSchedule, planStart);
    } catch (err) {
      console.warn('hybridMode fallback:', err);
      return zpStatus;
    }
  }, [hybridMode, zpStatus, zpStatusData, globalLookups, wcSchedule, planStart]);

  const wcLoadMap = useMemo(() => {
    const map = {};
    if (!zp.length || !routing.length) return map;
    const dates    = [...new Set(zp.map(z => z.due_date))];
    const allLoads = {};
    dates.forEach(d => {
      const zpForDate = zp.filter(z => z.due_date === d);
      const loads     = computeLoads(globalLookups.routingByProduct, zpForDate);
      Object.entries(loads).forEach(([wc, v]) => {
        if (!allLoads[wc]) allLoads[wc] = [];
        allLoads[wc].push(v.util * 100);
      });
    });
    Object.entries(allLoads).forEach(([wc, arr]) => {
      map[wc] = arr.reduce((s, v) => s + v, 0) / arr.length;
    });
    return map;
  }, [zp, routing, globalLookups]);

  useEffect(() => {
    if (zpStatusData.length) {
      const withWaits = zpStatusToHistoryFormat(zpStatusData, routing);
      setHistoryData(calcCapacityLoss(withWaits, wcLoadMap));
    } else {
      setHistoryData([]);
    }
  }, [zpStatusData, routing, wcLoadMap]);

  const handleLoad = useCallback((text, type) => {
    if (type === 'demo') {
      const parsed      = parseZPFromERP(DEMO_ERP_ZP);
      const newWcToWc2  = parsed.wcToWc2 || {};
      const { zpList, routingByProduct } = erpZpToSchedulerInput(parsed);
      const routingFlat = _erpRoutingToFlat(routingByProduct);
      const ps          = '2026-06-22';
      const wcs         = [...new Set(routingFlat.map(r => r.workcenter))].sort();
      const newSched    = buildWcSchedule(wcs, ps, zpList, scheduleConfig.horizonDays, {}, wcCapacity);
      setErpZp(parsed);
      setRouting(routingFlat);
      setZP(zpList);
      setWcToWc2(prev => ({ ...prev, ...newWcToWc2 }));
      setWcSchedule(newSched);
      setWcScheduleVersion(v => v + 1);
      setGanttDirty(true);
      setPlanStart(ps);
      setTab('dashboard');
      return;
    }
    if (type === 'erp_zp') {
      const parsed      = parseZPFromERP(text);
      const newWcToWc2  = parsed.wcToWc2 || {};
      const { zpList, routingByProduct } = erpZpToSchedulerInput(parsed);
      const routingFlat = _erpRoutingToFlat(routingByProduct);
      const horizonDate = new Date();
      horizonDate.setDate(horizonDate.getDate() + (scheduleConfig.horizonDays || 14));
      const horizonStr  = horizonDate.toISOString().slice(0, 10);
      const cutoffDate  = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      const cutoffStr   = cutoffDate.toISOString().slice(0, 10);
      const zpFiltered  = zpList.filter(z => z.due_date >= cutoffStr && z.due_date <= horizonStr);
      const ps          = new Date().toISOString().slice(0, 10);
      const wcs         = [...new Set(routingFlat.map(r => r.workcenter))].sort();
      const newSched    = buildWcSchedule(wcs, ps, zpFiltered, scheduleConfig.horizonDays, {}, wcCapacity);
      setRouting(routingFlat);
      setZP(zpFiltered);
      setWcToWc2(prev => ({ ...prev, ...newWcToWc2 }));
      setWcSchedule(newSched);
      setWcScheduleVersion(v => v + 1);
      setGanttDirty(true);
      if (parsed.length) setTab('heatmap_plan');
      return { zpList: parsed };
    }
    if (type === 'zp_status') {
      const { records, rejected } = parseZpStatus(text);
      setZpStatusData(records);
      setZpStatusHeaders(calcZpHeaderStatus(records));
      return { rejected };
    }
  }, [wcLoadMap, scheduleConfig, wcCapacity]);

  function _erpRoutingToFlat(routingByProduct) {
    const flat = [];
    for (const [product, ops] of Object.entries(routingByProduct)) {
      for (const op of ops) {
        flat.push({
          product,
          operation:    op.machine_name || op.op_label,
          workcenter:   op.machine_id,
          wc_group:     op.wc_group || op.workcenter,
          machine_id:   op.machine_id,
          machine_name: op.machine_name,
          ct_min:       0,
          sequence:     op.sequence,
          predecessors: op.predecessors || [],
          capacity_h:   wcCapacity[op.machine_id] ?? WC_DAILY_CAPACITY[op.machine_id] ?? 16,
          _durH:        op._durH,
          _status:      op._status,
        });
      }
    }
    return flat;
  }

  function handleExportZpStatus() { exportZpStatusCsv(zp, fwdZP, routing); }

  function exportLoad() {
    const dates = [...new Set(zp.map(z => z.due_date))].sort();
    const rows  = [['gniazdo', 'due_date', 'load_h', 'cap_h', 'utilization_pct']];
    dates.forEach(d => {
      const zpForDate = zp.filter(z => z.due_date === d);
      const loads     = computeLoads(globalLookups.routingByProduct, zpForDate);
      Object.entries(loads).forEach(([wc, v]) => {
        rows.push([wc, d, v.load.toFixed(2), v.cap.toFixed(1), Math.round(v.util * 100)]);
      });
    });
    dlCSV(rows, 'raport_obciazenia.csv');
  }

  const hasData = routing.length > 0 && zp.length > 0;

  return (
    <div className="flowops-app">
      <nav className="flowops-nav">
        <span className="flowops-nav-brand">FlowOps</span>
        <NavMenu menu={MENU} active={tab} onSelect={setTab}
          indicators={{
            analysis:   historyData.length > 0,
            realizacja: zpStatusData.length > 0,
            buffer:     zpStatusData.length > 0,
            buffer_zs:  zpStatusData.length > 0,
            late_zs:    zpStatus.some(z => (z.toc?.zone ?? z.toc) === 'black'),
          }} />
        {hybridMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 8,
            background: 'rgba(77,148,255,0.12)', border: '1px solid rgba(77,148,255,0.3)',
            fontSize: 11, color: '#4d94ff', fontWeight: 600 }}>
            🔬 <span>BETA: Tryb realizacja</span>
          </div>
        )}
        {hasData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 8, border: `1px solid ${T.border2}`, background: T.surface2 }}>
              <span style={{ fontSize: 11, color: T.text3 }}>od</span>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                style={{ fontSize: 11, background: 'transparent', border: 'none', color: T.text2, outline: 'none', width: 110, cursor: 'pointer' }} />
              <span style={{ fontSize: 11, color: T.text3 }}>do</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                style={{ fontSize: 11, background: 'transparent', border: 'none', color: T.text2, outline: 'none', width: 110, cursor: 'pointer' }} />
              {[{ label: '+1d', n: 1 }, { label: '+3d', n: 3 }, { label: '+7d', n: 7 }].map(({ label, n }) => {
                const from = allDueDates[0] || '';
                const to   = allDueDates[Math.min(n - 1, allDueDates.length - 1)] || from;
                const active = dateFrom === from && dateTo === to;
                return (
                  <button key={label} type="button" onClick={() => { setDateFrom(from); setDateTo(to); }}
                    style={{ ...s.btnSm(active), fontSize: 10, padding: '2px 7px' }}>{label}</button>
                );
              })}
              <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }}
                style={{ ...s.btnSm(!dateFrom && !dateTo), fontSize: 10, padding: '2px 7px' }}>wszystkie</button>
            </div>
            {(dateFrom || dateTo) && (
              <span style={{ fontSize: 10, color: T.accent }}>● {filteredZP.length}/{zp.length} ZP</span>
            )}
            <button type="button" className="flowops-export-btn"
              style={{ ...s.btn(false), fontSize: 11 }} onClick={exportLoad}>↓ Eksportuj raport</button>
          </div>
        )}
      </nav>

      <main className="flowops-main">
        {tab === 'dashboard'    && <DashboardTab routing={routing} zp={zp} zpStatus={activeZpStatus} wcSchedule={wcSchedule} historyData={historyData} zpStatusHeaders={zpStatusHeaders} globalLookups={globalLookups} onTabChange={setTab} hybridMode={hybridMode} />}
        {isScheduling && (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
            <div style={{ width:48, height:48, border:'4px solid rgba(255,255,255,0.2)', borderTop:'4px solid #4d94ff', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
            <div style={{ color:'#fff', marginTop:16, fontSize:14, fontWeight:500 }}>Harmonogramowanie {zp.length} ZP...</div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}
        {tab === 'import'       && <ImportTab erpZp={erpZp} zpStatusData={zpStatusData} onLoad={handleLoad} onExportZpStatus={handleExportZpStatus} hybridMode={hybridMode} onHybridModeChange={setHybridMode} />}
        <div style={{display: tab === 'plan' ? 'contents' : 'none'}}>
          <PlanTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} subZP={subZP} fwdZP={fwdZP} zpStatus={activeZpStatus} ganttDirty={ganttDirty} onRecalc={() => recalcGantt(wcSchedule)} onScheduleChange={updateSchedule} planStart={planStart} onPlanStartChange={setPlanStart} selectedWC={selectedWC} onWCSelect={setSelectedWC} selectedDate={selectedDate} onDateSelect={setSelectedDate} heatmapFilter={heatmapFilter} onHeatmapFilterChange={setHeatmapFilter} />
        </div>
        {tab === 'bottleneck'   && <BottleneckTab routing={routing} zp={filteredZP} globalLookups={globalLookups} wcSchedule={wcSchedule} subZP={subZP} />}
        {tab === 'routing'      && <RoutingTab routing={routing} zp={zp} globalLookups={globalLookups} />}
        {tab === 'heatmap'      && <HeatmapTab routing={routing} zp={filteredZP} globalLookups={globalLookups} wcSchedule={wcSchedule} />}
        {tab === 'heatmap_plan' && <HeatmapPlanTab fwdZP={fwdZP} routing={routing} wcSchedule={wcSchedule} wcToWc2={wcToWc2} wcCapacity={wcCapacity} onScheduleChange={updateSchedule} onRecalc={() => recalcGantt(wcSchedule)} onOptimize={handleOptimize} isOptimizing={isOptimizing} ganttDirty={ganttDirty} isScheduling={isScheduling} planStart={planStart} onPlanStartChange={setPlanStart} schedulingMode={scheduleConfig.schedulingMode} onSchedulingModeChange={mode => { setScheduleConfig(c => ({ ...c, schedulingMode: mode })); setGanttDirty(true); }} heatmapFilter={heatmapFilter} onHeatmapFilterChange={setHeatmapFilter} />}
        {tab === 'flow_matrix'  && <FlowMatrixTab fwdZP={fwdZP} routing={routing} wcToWc2={wcToWc2} wcSchedule={wcSchedule} />}
        {tab === 'swimlane'     && <SwimlaneTab routing={routing} zp={filteredZP} globalLookups={globalLookups} wcSchedule={wcSchedule} />}
        {tab === 'sankey'       && <SankeyTab routing={routing} zp={filteredZP} globalLookups={globalLookups} wcSchedule={wcSchedule} />}
        {tab === 'realizacja'   && <RealizacjaTab zpStatusData={zpStatusData} />}
        {tab === 'buffer'       && <BufferTab zpStatusData={zpStatusData} />}
        {tab === 'buffer_zs'    && <BufferZSTab zpStatusData={zpStatusData} />}
        {tab === 'late_zs'      && <LateZSTab zpStatus={activeZpStatus} />}
        {tab === 'schedule_debug' && <ScheduleDebugTab fwdZP={fwdZP} zpStatus={zpStatus} planStart={planStart} scheduleConfig={scheduleConfig} zpList={zp} routingByProduct={globalLookups.routingByProduct} wcSchedule={wcSchedule} />}
        {tab === 'settings'       && <SettingsTab config={scheduleConfig} onConfigChange={cfg => { setScheduleConfig(cfg); setGanttDirty(true); }} wcCapacity={wcCapacity} onWcCapacityChange={setWcCapacity} wcToWc2={wcToWc2} />}
        {tab === 'analysis'     && <AnalysisTab historyData={historyData} routing={routing} wcSchedule={wcSchedule} zpStatusData={zpStatusData} zpStatusHeaders={zpStatusHeaders} />}
      </main>
    </div>
  );
}