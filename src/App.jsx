import { useState, useCallback, useMemo, useEffect } from 'react';
import { s, PALETTE } from './constants/theme.js';
import { DEMO_ROUTING, DEMO_ZS } from './constants/demoData.js';
import {
  parseRouting, parseZP, parseZS, zsToZP,
  backSchedule, forwardSchedule, tocBuffer, computeLoads, dlCSV,
} from './utils/scheduler.js';
import {
  parseHistory, sanitizeHistoryData, enrichWithStandards,
  calcWaitTimes, calcCapacityLoss,
} from './utils/analysisUtils.js';
import { ImportTab }    from './components/tabs/ImportTab.jsx';
import { PlanTab }      from './components/tabs/PlanTab.jsx';
import { BottleneckTab } from './components/tabs/BottleneckTab.jsx';
import { RoutingTab }   from './components/tabs/RoutingTab.jsx';
import { HeatmapTab }   from './components/tabs/HeatmapTab.jsx';
import { SwimlaneTab }  from './components/tabs/SwimlaneTab.jsx';
import { SankeyTab }    from './components/tabs/SankeyTab.jsx';
import { AnalysisTab }  from './components/tabs/AnalysisTab.jsx';
import './App.css';

const TABS = [
  { id: 'import',     label: 'Import CSV' },
  { id: 'plan',       label: '📋 Plan' },
  { id: 'bottleneck', label: 'Bottleneck' },
  { id: 'routing',    label: 'Routing' },
  { id: 'heatmap',    label: 'Heatmapa' },
  { id: 'swimlane',   label: 'Swimlane' },
  { id: 'sankey',     label: 'Przepływ (Sankey)' },
  { id: 'analysis',   label: '📊 Analiza Procesu' },
];

export default function App() {
  const [tab, setTab]           = useState('import');
  const [routing, setRouting]   = useState([]);
  const [zp, setZP]             = useState([]);
  const [wcSchedule, setWcSchedule] = useState({});
  const [subZP,     setSubZP]   = useState([]);
  const [fwdZP,     setFwdZP]   = useState([]);
  const [zpStatus,  setZpStatus] = useState([]);
  const [ganttDirty, setGanttDirty] = useState(true);
  const [planStart,  setPlanStart]  = useState('2026-05-22');

  // ── dane historyczne ──────────────────────────────────────────────────────
  const [historyData, setHistoryData] = useState([]);
  // rawHistory = po enrich+waits, bez capacity loss — przeliczamy reaktywnie
  const [rawHistory, setRawHistory] = useState([]);

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
        missing.forEach(w => { next[w] = [16,16,16,16,16,0,0]; });
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
    const sorted = [...zp].sort((a,b) => a.priority-b.priority || a.due_date.localeCompare(b.due_date));

    const backResult = backSchedule(sorted, rl, wcSchedule);
    setSubZP(backResult);

    const planStartDt = new Date(planStart + 'T00:00:00');
    const fwdResult   = forwardSchedule(sorted, rl, wcSchedule, planStartDt);
    setFwdZP(fwdResult);

    const statuses = sorted.map(zpItem => {
      const backOps = backResult.filter(s => s.parent_zp === zpItem.zp_id || s.zp_id === zpItem.zp_id);
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

  // ── Wylicz wcLoadMap z wcSchedule (avg utilization % per gniazdo) ─────────
  const wcLoadMap = useMemo(() => {
    const map = {};
    if (!zp.length || !routing.length) return map;
    const dates = [...new Set(zp.map(z => z.due_date))];
    const allLoads = {};
    dates.forEach(d => {
      const zpForDate = zp.filter(z => z.due_date === d);
      const loads = computeLoads(globalLookups.routingByProduct, zpForDate);
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

  // ── Przelicz capacity loss gdy zmieni się wcLoadMap ─────────────────────
  useEffect(() => {
    if (rawHistory.length) {
      setHistoryData(calcCapacityLoss(rawHistory, wcLoadMap));
    }
  }, [rawHistory, wcLoadMap]);

  // ── Przetwórz historię → historyData ─────────────────────────────────────
  function processHistory(text) {
    const { records, rejected } = parseHistory(text);
    const { sanitized, rejected: allRejected } = sanitizeHistoryData(records, rejected);
    const enriched  = enrichWithStandards(sanitized, routing);
    const withWaits = calcWaitTimes(enriched);
    setRawHistory(withWaits);          // zapisz bez cap loss
    setHistoryData(calcCapacityLoss(withWaits, wcLoadMap)); // i z cap loss od razu
    return { rejected: allRejected };
  }

  const handleLoad = useCallback((text, type) => {
    if (type === 'demo') {
      const r  = parseRouting(DEMO_ROUTING);
      const zs = parseZS(DEMO_ZS);
      const z  = zsToZP(zs);
      setRouting(r);
      setZP(z);
      setGanttDirty(true);
      setTab('plan');
      return;
    }
    if (type === 'routing') {
      const r = parseRouting(text);
      setRouting(r);
      if (r.length && zp.length) setTab('plan');
    } else if (type === 'zs') {
      const zsList = parseZS(text);
      const zpFromZS = zsToZP(zsList);
      setZP(zpFromZS);
      if (routing.length && zpFromZS.length) setTab('plan');
    } else if (type === 'history') {
      return processHistory(text);
    } else {
      const z = parseZP(text).map((zpItem, i) => {
        if (!zpItem.zs_id) {
          const num = zpItem.zp_id.replace(/[^0-9]/g,'').padStart(3,'0') || String(i+1).padStart(3,'0');
          return { ...zpItem, zs_id: `ZS-${num}`, pozycja: 1, zp_id: `ZP-${num}/01/01` };
        }
        return zpItem;
      });
      setZP(z);
      if (routing.length && z.length) setTab('plan');
    }
  }, [routing, zp, wcLoadMap]);

  function exportLoad() {
    const dates = [...new Set(zp.map(z => z.due_date))].sort();
    const rows = [['gniazdo','due_date','load_h','cap_h','utilization_pct']];
    dates.forEach(d => {
      const zpForDate = zp.filter(z => z.due_date === d);
      const loads = computeLoads(globalLookups.routingByProduct, zpForDate);
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

        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`flowops-nav-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'analysis' && historyData.length > 0 && (
              <span style={{ marginLeft: 5, fontSize: 10, color: '#34d399' }}>●</span>
            )}
          </button>
        ))}

        {hasData && (
          <button type="button" className="flowops-export-btn" style={{ ...s.btn(false), fontSize: 11 }} onClick={exportLoad}>
            ↓ Eksportuj raport
          </button>
        )}
      </nav>

      <main className="flowops-main">
        {tab === 'import'     && <ImportTab routing={routing} zp={zp} historyData={historyData} onLoad={handleLoad} />}
        {tab === 'plan'       && <PlanTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} subZP={subZP} fwdZP={fwdZP} zpStatus={zpStatus} ganttDirty={ganttDirty} onRecalc={() => recalcGantt()} onScheduleChange={updateSchedule} planStart={planStart} onPlanStartChange={setPlanStart} />}
        {tab === 'bottleneck' && <BottleneckTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} subZP={subZP} />}
        {tab === 'routing'    && <RoutingTab routing={routing} zp={zp} globalLookups={globalLookups} />}
        {tab === 'heatmap'    && <HeatmapTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} />}
        {tab === 'swimlane'   && <SwimlaneTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} />}
        {tab === 'sankey'     && <SankeyTab routing={routing} zp={zp} globalLookups={globalLookups} wcSchedule={wcSchedule} />}
        {tab === 'analysis'   && <AnalysisTab historyData={historyData} routing={routing} wcSchedule={wcSchedule} />}
      </main>
    </div>
  );
}