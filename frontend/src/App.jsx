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
import { ScheduleDebugTab } from './components/tabs/ScheduleDebugTab.jsx';
import './App.css';

const MENU = [
  { id: 'dashboard', label: '🏠 Dashboard' },
  { label: '📋 Planowanie', items: [
    { id: 'plan',       label: 'Harmonogram' },
    { id: 'bottleneck', label: 'Wąskie gardła' },
    { id: 'heatmap',    label: 'Heatmapa obciążeń' },
    { id: 'swimlane',   label: 'Swimlane' },
    { id: 'sankey',     label: 'Przepływ (Sankey)' },
    { id: 'routing',    label: 'Routing' },
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
  ]},
];

// ─── NAWIGACJA Z DROPDOWNAMI ─────────────────────────────────────────────────

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
  const [erpZp, setErpZp]           = useState([]);   // [NOWE] surowe ZP z ERP (parseZPFromERP)
  const [isScheduling, setIsScheduling] = useState(false); // Worker liczy w tle
  const workerRef = useRef(null);
  const [routing, setRouting]       = useState([]);
  const [zp, setZP]                 = useState([]);
  const [wcSchedule, setWcSchedule] = useState({});
  const [subZP, setSubZP]           = useState([]);
  const [fwdZP, setFwdZP]           = useState([]);
  const [zpStatus, setZpStatus]     = useState([]);
  const [ganttDirty, setGanttDirty] = useState(true);
  const [planStart, setPlanStart]   = useState(() => new Date().toISOString().slice(0,10));
  const [hybridMode, setHybridMode] = useState(false);

  const [historyData, setHistoryData]         = useState([]);
  const [zpStatusData, setZpStatusData]       = useState([]);
  const [zpStatusHeaders, setZpStatusHeaders] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');

  // ZP przefiltrowane wg zakresu dat — używane w Heatmap, Bottleneck, Swimlane, Sankey
  const filteredZP = useMemo(() => {
    if (!dateFrom && !dateTo) return zp;
    return zp.filter(z =>
      (!dateFrom || z.due_date >= dateFrom) &&
      (!dateTo   || z.due_date <= dateTo)
    );
  }, [zp, dateFrom, dateTo]);

  // unikalne due_dates z ZP — do quick buttons
  const allDueDates = useMemo(() => [...new Set(zp.map(z => z.due_date))].sort(), [zp]);

  function updateSchedule(s) {
    setWcSchedule(s);
    setGanttDirty(true);
  }

  useEffect(() => {
    if (routing.length > 0) {
      const wcs = [...new Set(routing.map(r => r.workcenter))].sort();
      setWcSchedule(prev => {
        const missing = wcs.filter(w => !prev[w]);
        if (missing.length === 0) return prev;
        const next = { ...prev };
        missing.forEach(w => { next[w] = [16, 16, 16, 16, 16, 0, 0]; });
        return next;
      });
      setGanttDirty(true);
    }
  }, [routing.length]);

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
      recalcGantt();
    }
  }, [zp.length, routing.length, JSON.stringify(wcSchedule), planStart]);

  function recalcGantt() {
    const rl = globalLookups.routingByProduct;
    if (!Object.keys(rl).length) return;

    if (workerRef.current) workerRef.current.terminate();
    setIsScheduling(true);

    const worker = new Worker(
      new URL('./utils/scheduler.worker.js', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'PROGRESS') {
        // opcjonalnie: setSchedulingProgress(payload.pct)
      } else if (type === 'DONE') {
        const { fwdZP, zpStatus } = payload;
        // Daty serialized przez Worker → przywróć Date objects
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
      payload: { zpList: zp, routingByProduct: rl, wcSchedule, planStart }
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
      // Demo: parsuj przez ten sam parser co produkcja
      const parsed = parseZPFromERP(DEMO_ERP_ZP);
      const { zpList, routingByProduct } = erpZpToSchedulerInput(parsed);
      const routingFlat = _erpRoutingToFlat(routingByProduct);
      setErpZp(parsed);
      setRouting(routingFlat);
      setZP(zpList);
      setGanttDirty(true);
      setPlanStart('2026-06-22'); // Demo: ustaw planStart na datę demo
      setTab('dashboard');
      return;
    }
    if (type === 'erp_zp') {
      const parsed = parseZPFromERP(text);
      const { zpList, routingByProduct } = erpZpToSchedulerInput(parsed);
      const routingFlat = _erpRoutingToFlat(routingByProduct);
      setErpZp(parsed);
      setRouting(routingFlat);
      setZP(zpList);
      setGanttDirty(true);
      if (parsed.length) setTab('dashboard');
      return { zpList: parsed };
    }
    if (type === 'zp_status') {
      const { records, rejected } = parseZpStatus(text);
      setZpStatusData(records);
      setZpStatusHeaders(calcZpHeaderStatus(records));
      return { rejected };
    }
  }, [wcLoadMap]);

  // Spłaszcz routingByProduct → routing[] (format zgodny z resztą aplikacji)
  function _erpRoutingToFlat(routingByProduct) {
    const flat = [];
    for (const [product, ops] of Object.entries(routingByProduct)) {
      for (const op of ops) {
        flat.push({
          product,
          operation:    op.machine_name || op.op_label,
          workcenter:   op.machine_id,
          wc_group:     op.wc_group,
          machine_id:   op.machine_id,
          machine_name: op.machine_name,
          ct_min:       0,
          sequence:     op.sequence,
          predecessors: op.predecessors || [],
          capacity_h:   16,
          _durH:        op._durH,
          _status:      op._status,
        });
      }
    }
    return flat;
  }

  function handleExportZpStatus() {
    exportZpStatusCsv(zp, fwdZP, routing);
  }

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
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '3px 10px', borderRadius: 8,
            background: 'rgba(77,148,255,0.12)', border: '1px solid rgba(77,148,255,0.3)',
            fontSize: 11, color: '#4d94ff', fontWeight: 600,
          }}>
            🔬 <span>BETA: Tryb realizacja</span>
          </div>
        )}

        {hasData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            {/* Date range picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 8, border: `1px solid ${T.border2}`, background: T.surface2 }}>
              <span style={{ fontSize: 11, color: T.text3 }}>od</span>
              <input
                type="date" value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                style={{ fontSize: 11, background: 'transparent', border: 'none', color: T.text2, outline: 'none', width: 110, cursor: 'pointer' }}
              />
              <span style={{ fontSize: 11, color: T.text3 }}>do</span>
              <input
                type="date" value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                style={{ fontSize: 11, background: 'transparent', border: 'none', color: T.text2, outline: 'none', width: 110, cursor: 'pointer' }}
              />
              {/* Quick buttons — +1d/+3d/+7d = pierwsze N terminów z danych */}
              {[
                { label: '+1d', n: 1 },
                { label: '+3d', n: 3 },
                { label: '+7d', n: 7 },
              ].map(({ label, n }) => {
                const from = allDueDates[0] || '';
                const to   = allDueDates[Math.min(n - 1, allDueDates.length - 1)] || from;
                const active = dateFrom === from && dateTo === to;
                return (
                  <button key={label} type="button"
                    onClick={() => { setDateFrom(from); setDateTo(to); }}
                    style={{ ...s.btnSm(active), fontSize: 10, padding: '2px 7px' }}>
                    {label}
                  </button>
                );
              })}
              <button type="button"
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                style={{ ...s.btnSm(!dateFrom && !dateTo), fontSize: 10, padding: '2px 7px' }}>
                wszystkie
              </button>

            </div>
            {(dateFrom || dateTo) && (
              <span style={{ fontSize: 10, color: T.accent }}>
                ● {filteredZP.length}/{zp.length} ZP
              </span>
            )}
            <button type="button" className="flowops-export-btn"
              style={{ ...s.btn(false), fontSize: 11 }} onClick={exportLoad}>
              ↓ Eksportuj raport
            </button>
          </div>
        )}
      </nav>

      <main className="flowops-main">
        {tab === 'dashboard'  && <DashboardTab routing={routing} zp={zp} zpStatus={activeZpStatus} wcSchedule={wcSchedule} historyData={historyData} zpStatusHeaders={zpStatusHeaders} globalLookups={globalLookups} onTabChange={setTab} hybridMode={hybridMode} />}
        {/* Spinner gdy Worker liczy */}
        {isScheduling && (
          <div style={{
            position:'fixed', inset:0, background:'rgba(0,0,0,0.45)',
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
            zIndex:9999,
          }}>
            <div style={{
              width:48, height:48, border:'4px solid rgba(255,255,255,0.2)',
              borderTop:'4px solid #4d94ff', borderRadius:'50%',
              animation:'spin 0.8s linear infinite',
            }}/>
            <div style={{color:'#fff', marginTop:16, fontSize:14, fontWeight:500}}>
              Harmonogramowanie {zp.length} ZP...
            </div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}
        {tab === 'import'     && <ImportTab erpZp={erpZp} zpStatusData={zpStatusData} onLoad={handleLoad} onExportZpStatus={handleExportZpStatus} hybridMode={hybridMode} onHybridModeChange={setHybridMode} />}
        {tab === 'plan'       && <PlanTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} subZP={subZP} fwdZP={fwdZP} zpStatus={activeZpStatus} ganttDirty={ganttDirty} onRecalc={() => recalcGantt()} onScheduleChange={updateSchedule} planStart={planStart} onPlanStartChange={setPlanStart} />}
        {tab === 'bottleneck' && <BottleneckTab routing={routing} zp={filteredZP} globalLookups={globalLookups} wcSchedule={wcSchedule} subZP={subZP} />}
        {tab === 'routing'    && <RoutingTab routing={routing} zp={zp} globalLookups={globalLookups} />}
        {tab === 'heatmap'    && <HeatmapTab routing={routing} zp={filteredZP} globalLookups={globalLookups} wcSchedule={wcSchedule} />}
        {tab === 'swimlane'   && <SwimlaneTab routing={routing} zp={filteredZP} globalLookups={globalLookups} wcSchedule={wcSchedule} />}
        {tab === 'sankey'     && <SankeyTab routing={routing} zp={filteredZP} globalLookups={globalLookups} wcSchedule={wcSchedule} />}
        {tab === 'realizacja' && <RealizacjaTab zpStatusData={zpStatusData} />}
        {tab === 'buffer'     && <BufferTab zpStatusData={zpStatusData} />}
        {tab === 'buffer_zs'  && <BufferZSTab zpStatusData={zpStatusData} />}
        {tab === 'late_zs'    && <LateZSTab zpStatus={activeZpStatus} />}
        {tab === 'schedule_debug' && <ScheduleDebugTab fwdZP={fwdZP} zpStatus={zpStatus} planStart={planStart} />}
        {tab === 'analysis'   && <AnalysisTab historyData={historyData} routing={routing} wcSchedule={wcSchedule} zpStatusData={zpStatusData} zpStatusHeaders={zpStatusHeaders} />}
      </main>
    </div>
  );
}