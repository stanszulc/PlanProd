import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { s, PALETTE } from './constants/theme.js';
import { DEMO_ROUTING, DEMO_ZS } from './constants/demoData.js';
import {
  parseRouting, parseZP, parseZS, zsToZP,
  backSchedule, forwardSchedule, tocBuffer, computeLoads, dlCSV,
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
    { id: 'realizacja', label: 'Lista ZP'     },
    { id: 'buffer',     label: 'Bufor TOC'    },
    { id: 'buffer_zs',  label: 'Bufor ZS'     },
    { id: 'late_zs',    label: 'Spóźnione ZS' },
  ]},
  { label: '📊 Analityka', items: [
    { id: 'analysis', label: 'Analiza Procesu' },
  ]},
  { label: '⚙️', items: [
    { id: 'import', label: 'Import / Eksport' },
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
  const [routing, setRouting]       = useState([]);
  const [zp, setZP]                 = useState([]);
  const [wcSchedule, setWcSchedule] = useState({});
  const [subZP, setSubZP]           = useState([]);
  const [fwdZP, setFwdZP]           = useState([]);
  const [zpStatus, setZpStatus]     = useState([]);
  const [ganttDirty, setGanttDirty] = useState(true);
  const [planStart, setPlanStart]   = useState('2026-05-22');
  const [hybridMode, setHybridMode] = useState(false);

  const [historyData, setHistoryData]         = useState([]);
  const [zpStatusData, setZpStatusData]       = useState([]);
  const [zpStatusHeaders, setZpStatusHeaders] = useState([]);

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
    if (zp.length > 0 && Object.keys(rl).length > 0 && Object.keys(wcSchedule).length > 0) {
      recalcGantt();
    }
  }, [zp.length, routing.length, JSON.stringify(wcSchedule), planStart]);

  function recalcGantt() {
    const rl     = globalLookups.routingByProduct;
    const sorted = [...zp].sort((a, b) => a.priority - b.priority || a.due_date.localeCompare(b.due_date));

    const backResult = backSchedule(sorted, rl, wcSchedule);
    setSubZP(backResult);

    const planStartDt = new Date(planStart + 'T00:00:00');
    const fwdResult   = forwardSchedule(sorted, rl, wcSchedule, planStartDt);
    setFwdZP(fwdResult);

    const statuses = sorted.map(zpItem => {
      const backOps   = backResult.filter(s => s.parent_zp === zpItem.zp_id || s.zp_id === zpItem.zp_id);
      const backStart = backOps.length
        ? new Date(Math.min(...backOps.map(s => s.start_dt ? new Date(s.start_dt).getTime() : Infinity)))
        : planStartDt;
      const dueDate   = new Date(zpItem.due_date + 'T23:59:59');
      const fwdOps    = fwdResult.filter(s => s.parent_zp === zpItem.zp_id || s.zp_id === zpItem.zp_id);
      const lastFwdOp = fwdOps.length
        ? fwdOps.reduce((best, op) => op.sequence > best.sequence ? op : best, fwdOps[0])
        : null;
      const realEnd   = lastFwdOp ? lastFwdOp.end_dt : planStartDt;
      const delayH    = Math.max(0, (new Date(realEnd) - dueDate) / 3600000);
      const delayDays = +(delayH / 16).toFixed(1);
      const toc       = tocBuffer(backStart, planStartDt, dueDate, new Date(realEnd));
      const fwdForZP  = fwdResult.filter(s => s.parent_zp === zpItem.zp_id || s.zp_id === zpItem.zp_id);
      const bottleneck = fwdForZP.length
        ? fwdForZP.reduce((b, op) => op.durH > b.durH ? op : b, fwdForZP[0])
        : null;
      return {
        zp_id:      zpItem.zp_id,
        zs_id:      zpItem.zs_id || '',
        pozycja:    zpItem.pozycja || '',
        product:    zpItem.product,
        due_date:   zpItem.due_date,
        priority:   zpItem.priority,
        klient:     zpItem.klient || '',
        bottleneck: bottleneck ? bottleneck.workcenter : null,
        backStart, realEnd, delayH, delayDays, toc,
      };
    });
    setZpStatus(statuses);
    setGanttDirty(false);
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
      const r  = parseRouting(DEMO_ROUTING);
      const zs = parseZS(DEMO_ZS);
      const z  = zsToZP(zs);
      setRouting(r);
      setZP(z);
      setGanttDirty(true);
      setTab('dashboard');
      return;
    }
    if (type === 'routing') {
      const r = parseRouting(text);
      setRouting(r);
      if (r.length && zp.length) setTab('plan');
    } else if (type === 'zs') {
      const zsList   = parseZS(text);
      const zpFromZS = zsToZP(zsList);
      setZP(zpFromZS);
      if (routing.length && zpFromZS.length) setTab('plan');
    } else if (type === 'zp_status') {
      const { records, rejected } = parseZpStatus(text);
      setZpStatusData(records);
      setZpStatusHeaders(calcZpHeaderStatus(records));
      return { rejected };
    } else {
      const z = parseZP(text).map((zpItem, i) => {
        if (!zpItem.zs_id) {
          const num = zpItem.zp_id.replace(/[^0-9]/g, '').padStart(3, '0') || String(i + 1).padStart(3, '0');
          return { ...zpItem, zs_id: `ZS-${num}`, pozycja: 1, zp_id: `ZP-${num}/01/01` };
        }
        return zpItem;
      });
      setZP(z);
      if (routing.length && z.length) setTab('plan');
    }
  }, [routing, zp, wcLoadMap]);

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
          <button type="button" className="flowops-export-btn"
            style={{ ...s.btn(false), fontSize: 11 }} onClick={exportLoad}>
            ↓ Eksportuj raport
          </button>
        )}
      </nav>

      <main className="flowops-main">
        {tab === 'dashboard'  && <DashboardTab routing={routing} zp={zp} zpStatus={activeZpStatus} wcSchedule={wcSchedule} historyData={historyData} zpStatusHeaders={zpStatusHeaders} globalLookups={globalLookups} onTabChange={setTab} hybridMode={hybridMode} />}
        {tab === 'import'     && <ImportTab routing={routing} zp={zp} historyData={historyData} zpStatusData={zpStatusData} onLoad={handleLoad} onExportZpStatus={handleExportZpStatus} hybridMode={hybridMode} onHybridModeChange={setHybridMode} />}
        {tab === 'plan'       && <PlanTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} subZP={subZP} fwdZP={fwdZP} zpStatus={activeZpStatus} ganttDirty={ganttDirty} onRecalc={() => recalcGantt()} onScheduleChange={updateSchedule} planStart={planStart} onPlanStartChange={setPlanStart} />}
        {tab === 'bottleneck' && <BottleneckTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} subZP={subZP} />}
        {tab === 'routing'    && <RoutingTab routing={routing} zp={zp} globalLookups={globalLookups} />}
        {tab === 'heatmap'    && <HeatmapTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} />}
        {tab === 'swimlane'   && <SwimlaneTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} />}
        {tab === 'sankey'     && <SankeyTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} />}
        {tab === 'realizacja' && <RealizacjaTab zpStatusData={zpStatusData} />}
        {tab === 'buffer'     && <BufferTab zpStatusData={zpStatusData} />}
        {tab === 'buffer_zs'  && <BufferZSTab zpStatusData={zpStatusData} />}
        {tab === 'late_zs'    && <LateZSTab zpStatus={activeZpStatus} />}
        {tab === 'analysis'   && <AnalysisTab historyData={historyData} routing={routing} wcSchedule={wcSchedule} zpStatusData={zpStatusData} zpStatusHeaders={zpStatusHeaders} />}
      </main>
    </div>
  );
}