import { useState, useMemo, useRef } from 'react';
import { T, s, PALETTE } from '../../constants/theme.js';
import {
  calcWcStats, calcHeatmapData, calcReasonPareto, hasReasonCodes,
} from '../../utils/analysisUtils.js';

const SUB_TABS = [
  { id: 'times',     label: 'Czasy operacji' },
  { id: 'heatmap',   label: 'Heatmapa strat' },
  { id: 'sankey',    label: 'Przepływ materiału' },
  { id: 'stability', label: 'Stabilność gniazd' },
  { id: 'pareto',    label: 'Pareto przyczyn' },
];

const REASON_COLORS = [
  T.bn, T.warn, '#a855f7', T.accent, T.ok, T.text2,
];

export function AnalysisTab({ historyData, routing, wcSchedule }) {
  const [subTab, setSubTab] = useState('times');
  const [filterWc, setFilterWc] = useState('ALL');
  const [filterProduct, setFilterProduct] = useState('ALL');
  const [paretoWc, setParetoWc] = useState('ALL');

  const hasReasons = useMemo(() => hasReasonCodes(historyData), [historyData]);

  const workcenter = useMemo(() =>
    [...new Set(historyData.map(r => r.workcenter))].sort(), [historyData]);
  const products = useMemo(() =>
    [...new Set(historyData.map(r => r.product))].sort(), [historyData]);

  const filtered = useMemo(() => {
    let d = historyData;
    if (filterWc !== 'ALL')      d = d.filter(r => r.workcenter === filterWc);
    if (filterProduct !== 'ALL') d = d.filter(r => r.product === filterProduct);
    return d;
  }, [historyData, filterWc, filterProduct]);

  const wcStats    = useMemo(() => calcWcStats(filtered),        [filtered]);
  const heatmap    = useMemo(() => calcHeatmapData(historyData), [historyData]);
  const paretoData = useMemo(() =>
    calcReasonPareto(historyData, paretoWc === 'ALL' ? null : paretoWc),
    [historyData, paretoWc]);

  // KPI summary
  const worstDev = wcStats.reduce((b, w) =>
    (w.avg_dev_pct ?? -Infinity) > (b.avg_dev_pct ?? -Infinity) ? w : b,
    { avg_dev_pct: -Infinity, workcenter: '—' });
  const mostUnstable = [...wcStats].sort((a, b) => b.cv_pct - a.cv_pct)[0];
  const avgDevAll = wcStats.filter(w => w.avg_dev_pct != null).length
    ? (wcStats.filter(w => w.avg_dev_pct != null)
        .reduce((s, w) => s + w.avg_dev_pct, 0) /
       wcStats.filter(w => w.avg_dev_pct != null).length).toFixed(1)
    : '—';

  if (!historyData.length) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: T.text3 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
        <div style={{ fontSize: 14 }}>Brak danych historycznych. Wczytaj history.csv w zakładce Import.</div>
      </div>
    );
  }

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Rekordów historycznych', value: historyData.length },
          { label: 'Śr. odchylenie od std', value: avgDevAll !== '—' ? `+${avgDevAll}%` : '—' },
          { label: 'Najgorsze gniazdo', value: worstDev.workcenter !== '—' ? `${worstDev.workcenter} (+${worstDev.avg_dev_pct?.toFixed(1)}%)` : '—' },
          { label: 'Najbardziej niestabilne', value: mostUnstable ? `${mostUnstable.workcenter} (CV ${mostUnstable.cv_pct}%)` : '—' },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.text3, marginBottom: 6 }}>{kpi.label}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Sub-nav */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {SUB_TABS
          .filter(t => t.id !== 'pareto' || hasReasons)
          .map(t => (
            <button key={t.id} type="button"
              style={{ ...s.btn(subTab === t.id), fontSize: 12 }}
              onClick={() => setSubTab(t.id)}>
              {t.label}
              {t.id === 'pareto' && <span style={{ marginLeft: 5, fontSize: 10, color: T.warn }}>●</span>}
            </button>
          ))}
      </div>

      {/* Filtry (nie na heatmapie i pareto) */}
      {(subTab === 'times' || subTab === 'stability') && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          <select value={filterWc} onChange={e => setFilterWc(e.target.value)} style={selectStyle}>
            <option value="ALL">Wszystkie gniazda</option>
            {workcenter.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)} style={selectStyle}>
            <option value="ALL">Wszystkie produkty</option>
            {products.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      )}

      {/* ── A: Czasy operacji ─────────────────────────────────────────────── */}
      {subTab === 'times' && <TimesSection wcStats={wcStats} />}

      {/* ── B: Heatmapa strat ────────────────────────────────────────────── */}
      {subTab === 'heatmap' && <HeatmapSection heatmap={heatmap} />}

      {/* ── C: Przepływ materiału (Sankey historyczny) ──────────────────── */}
      {subTab === 'sankey' && <HistorySankeySection historyData={historyData} routing={routing} />}

      {/* ── D: Stabilność gniazd ─────────────────────────────────────────── */}
      {subTab === 'stability' && <StabilitySection wcStats={wcStats} rawData={filtered} />}

      {/* ── D: Pareto przyczyn ───────────────────────────────────────────── */}
      {subTab === 'pareto' && hasReasons && (
        <ParetoSection
          paretoData={paretoData}
          workcenter={workcenter}
          paretoWc={paretoWc}
          onWcChange={setParetoWc}
        />
      )}
    </div>
  );
}


// ─── SEKCJA: PRZEPŁYW MATERIAŁU (SANKEY HISTORYCZNY) ─────────────────────────

function isoWeekStr(dt) {
  const d = new Date(dt);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  return d.getFullYear() + '-W' + String(wn).padStart(2,'0');
}

function localDay(dt) {
  const d = new Date(dt);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function HistorySankeySection({ historyData, routing }) {
  const svgRef  = useRef(null);
  const dragging = useRef(null);
  const [granularity, setGranularity] = useState('week'); // 'day' | 'week'
  const [selectedKey, setSelectedKey] = useState(null);
  const [hoveredWC, setHoveredWC]     = useState(null);
  const [nodePos, setNodePos]         = useState({});
  const [view, setView]               = useState({ scale: 1, tx: 0, ty: 0 });

  // Unikalne klucze okresu z danych historycznych
  const periodKeys = useMemo(() => {
    const keys = new Set();
    historyData.forEach(r => {
      keys.add(granularity === 'week' ? isoWeekStr(r.start_ts) : localDay(r.start_ts));
    });
    return [...keys].sort();
  }, [historyData, granularity]);

  // Ustaw domyślny klucz gdy zmienia się granularity lub dane
  const effectiveKey = selectedKey && periodKeys.includes(selectedKey)
    ? selectedKey
    : (periodKeys[periodKeys.length - 1] ?? null);

  // Filtruj rekordy do wybranego okresu
  const periodRecords = useMemo(() => {
    if (!effectiveKey) return [];
    return historyData.filter(r => {
      const k = granularity === 'week' ? isoWeekStr(r.start_ts) : localDay(r.start_ts);
      return k === effectiveKey;
    });
  }, [historyData, effectiveKey, granularity]);

  // Oblicz przepływ: per produkt, połączenia gniazdo→gniazdo wg routing
  const flowData = useMemo(() => {
    if (!periodRecords.length || !routing.length) return { connections: [], edgeTotals: {}, nodeOps: {} };

    // Ile operacji zrealizowano na każdym gnieździe w tym okresie
    const nodeOps = {};
    periodRecords.forEach(r => {
      nodeOps[r.workcenter] = (nodeOps[r.workcenter] || 0) + 1;
    });

    // Produkty obecne w tym okresie
    const productsInPeriod = [...new Set(periodRecords.map(r => r.product))];

    // Dla każdego produktu buduj połączenia wg routing (sekwencja operacji)
    const productConns = {};
    productsInPeriod.forEach(product => {
      const ops = routing
        .filter(r => r.product === product)
        .sort((a, b) => a.sequence - b.sequence);

      // Suma wolumenów (szt.) per produkt w tym okresie — per zp_id żeby nie mnożyć przez liczbę operacji
      const zpVolumes = {};
      periodRecords
        .filter(r => r.product === product)
        .forEach(r => { zpVolumes[r.zp_id] = r.volume || 0; });
      const volume = Object.values(zpVolumes).reduce((s, v) => s + v, 0);

      ops.forEach((op, idx) => {
        if (idx < ops.length - 1) {
          const next = ops[idx + 1];
          const key  = `${product}||${op.workcenter}->${next.workcenter}`;
          if (!productConns[key]) {
            productConns[key] = { product, from: op.workcenter, to: next.workcenter, volume: 0 };
          }
          productConns[key].volume += volume;
        }
      });
    });

    const edgeTotals = {};
    Object.values(productConns).forEach(c => {
      const k = `${c.from}->${c.to}`;
      edgeTotals[k] = (edgeTotals[k] || 0) + c.volume;
    });

    return { connections: Object.values(productConns), edgeTotals, nodeOps };
  }, [periodRecords, routing]);

  // Auto-layout gniazd — wszystkie gniazda z routing dla produktów obecnych w okresie
  // (nie tylko te z rekordów historycznych, żeby krawędzie routing były widoczne)
  const activeWCs = useMemo(() => {
    const fromHistory = new Set(periodRecords.map(r => r.workcenter));
    const productsInPeriod = [...new Set(periodRecords.map(r => r.product))];
    const fromRouting = new Set(
      routing
        .filter(r => productsInPeriod.includes(r.product))
        .map(r => r.workcenter)
    );
    return [...new Set([...fromHistory, ...fromRouting])].sort();
  }, [periodRecords, routing]);

  const baseLayout = useMemo(() => {
    if (!activeWCs.length || !routing.length) return { positions: {}, SVG_W: 700, SVG_H: 360 };
    const products = [...new Set(routing.map(r => r.product))];
    const PAD_X = 90, PAD_Y = 80, COL_W = 180, LANE_H = 120;
    const SVG_H = PAD_Y * 2 + Math.max(products.length - 1, 0) * LANE_H;
    const prodLaneY = {};
    products.forEach((p, i) => {
      prodLaneY[p] = products.length === 1 ? SVG_H / 2 : PAD_Y + i * LANE_H;
    });
    const wcMinSeq = {};
    activeWCs.forEach(wc => {
      const seqs = routing.filter(r => r.workcenter === wc).map(r => r.sequence);
      wcMinSeq[wc] = seqs.length ? Math.min(...seqs) : 99;
    });
    const colKeys = [...new Set(Object.values(wcMinSeq))].sort((a, b) => a - b);
    const SVG_W = PAD_X * 2 + Math.max(colKeys.length - 1, 0) * COL_W;
    const positions = {};
    activeWCs.forEach(wc => {
      const users = products.filter(p => routing.some(r => r.product === p && r.workcenter === wc));
      const avgY  = users.length
        ? users.reduce((s, p) => s + (prodLaneY[p] ?? SVG_H/2), 0) / users.length
        : SVG_H / 2;
      const colIdx = colKeys.indexOf(wcMinSeq[wc]);
      positions[wc] = { x: PAD_X + colIdx * COL_W, y: avgY };
    });
    return { positions, SVG_W, SVG_H };
  }, [activeWCs, routing]);

  const allPositions = useMemo(() => {
    const merged = {};
    Object.entries(baseLayout.positions).forEach(([wc, base]) => {
      merged[wc] = nodePos[wc] ? { ...base, ...nodePos[wc] } : { ...base };
    });
    return merged;
  }, [baseLayout, nodePos]);

  const { SVG_W, SVG_H } = baseLayout;
  const maxEdge   = Math.max(...Object.values(flowData.edgeTotals), 1);
  const maxNodeOp = Math.max(...Object.values(flowData.nodeOps), 1);
  const products  = useMemo(() => [...new Set(routing.map(r => r.product))], [routing]);

  const edgeProdCount = {};
  flowData.connections.forEach(c => {
    const k = `${c.from}->${c.to}`;
    if (!edgeProdCount[k]) edgeProdCount[k] = [];
    if (!edgeProdCount[k].includes(c.product)) edgeProdCount[k].push(c.product);
  });

  function edgePath(fromPos, toPos, prodIdx, totalOnEdge) {
    const R = 32;
    const dx = toPos.x - fromPos.x, dy = toPos.y - fromPos.y;
    const dist = Math.sqrt(dx*dx + dy*dy) || 1;
    const ux = dx/dist, uy = dy/dist;
    const x1 = fromPos.x + ux*R, y1 = fromPos.y + uy*R;
    const x2 = toPos.x  - ux*R, y2 = toPos.y  - uy*R;
    const spread = totalOnEdge > 1 ? 14 : 0;
    const off = totalOnEdge > 1 ? (prodIdx - (totalOnEdge-1)/2) * spread : 0;
    const px = -uy*off, py = ux*off;
    const arcLift = Math.abs(toPos.x - fromPos.x) > 250 ? -Math.abs(toPos.x - fromPos.x)*0.22 : 0;
    const mx = (x1+x2)/2 + px, my = (y1+y2)/2 + py + arcLift;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1+(mx-x1)*0.5).toFixed(1)} ${(y1+(my-y1)*0.5).toFixed(1)},${(x2+(mx-x2)*0.5).toFixed(1)} ${(y2+(my-y2)*0.5).toFixed(1)},${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  // Drag handlers
  function svgPt(e) {
    const r = svgRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  }
  function onNodeMD(e, wc) {
    e.stopPropagation();
    const { x, y } = svgPt(e);
    dragging.current = { kind: 'node', wc, ox: x - allPositions[wc].x * view.scale - view.tx, oy: y - allPositions[wc].y * view.scale - view.ty };
  }
  function onBgMD(e) {
    if (e.target.tagName === 'rect' && e.target.getAttribute('fill') === 'transparent') {
      dragging.current = { kind: 'pan', ox: e.clientX - view.tx, oy: e.clientY - view.ty };
    }
  }
  function onMM(e) {
    const d = dragging.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const tx = e.clientX - d.ox, ty = e.clientY - d.oy;
      setView(v => ({ ...v, tx, ty }));
    } else {
      const { x, y } = svgPt(e);
      const gx = (x - view.tx) / view.scale - d.ox / view.scale;
      const gy = (y - view.ty) / view.scale - d.oy / view.scale;
      const wc = d.wc;
      setNodePos(p => ({ ...p, [wc]: { x: gx, y: gy } }));
    }
  }
  function onMU() { dragging.current = null; }
  function onWheel(e) {
    e.preventDefault();
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const d = e.deltaY < 0 ? 1.12 : 1/1.12;
    setView(v => {
      const ns = Math.min(3, Math.max(0.2, v.scale * d));
      return { scale: +ns.toFixed(3), tx: mx - (mx - v.tx) * (ns/v.scale), ty: my - (my - v.ty) * (ns/v.scale) };
    });
  }

  if (!historyData.length) return <Empty />;
  if (!periodKeys.length) return <Empty />;

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>Przepływ materiału — rzeczywisty (dane historyczne)</div>

      {/* Kontrolki */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Granularity toggle */}
        <div style={{ display: 'flex', gap: 4 }}>
          {['day', 'week'].map(g => (
            <button key={g} type="button"
              style={{ ...s.btn(granularity === g), fontSize: 11 }}
              onClick={() => { setGranularity(g); setSelectedKey(null); }}>
              {g === 'day' ? 'Dzień' : 'Tydzień'}
            </button>
          ))}
        </div>

        {/* Period selector */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {periodKeys.map(k => (
            <button key={k} type="button"
              style={{ ...s.btn(k === effectiveKey), fontSize: 10, padding: '3px 8px' }}
              onClick={() => setSelectedKey(k)}>
              {k}
            </button>
          ))}
        </div>

        {/* Zoom controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <button style={{ ...s.btn(false), fontSize: 12, padding: '3px 9px' }}
            onClick={() => setView(v => ({ ...v, scale: Math.max(0.25, +(v.scale-0.15).toFixed(2)) }))}>−</button>
          <span style={{ fontSize: 11, color: T.text2, minWidth: 34, textAlign: 'center' }}>{Math.round(view.scale*100)}%</span>
          <button style={{ ...s.btn(false), fontSize: 12, padding: '3px 9px' }}
            onClick={() => setView(v => ({ ...v, scale: Math.min(3, +(v.scale+0.15).toFixed(2)) }))}>+</button>
          <button style={{ ...s.btn(false), fontSize: 11, padding: '3px 8px' }}
            onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}>⊡ Fit</button>
          <button style={{ ...s.btn(false), fontSize: 11, padding: '3px 8px' }}
            onClick={() => setNodePos({})}>↺ Reset</button>
        </div>
      </div>

      {/* Legenda produktów */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {products.map((p, i) => (
          <span key={p} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.text2 }}>
            <span style={{ width: 20, height: 3, borderRadius: 2, background: PALETTE[i%PALETTE.length], display: 'inline-block' }}/>
            {p}
          </span>
        ))}
        <span style={{ fontSize: 11, color: T.text3, marginLeft: 8 }}>
          · Grubość = liczba ZP · Kolor = produkt · Węzeł = liczba operacji w okresie · Przeciągnij węzeł
        </span>
      </div>

      {/* SVG canvas */}
      <div style={{ background: '#090b0e', borderRadius: 10, overflow: 'hidden', height: Math.max(SVG_H + 40, 360) }}>
        <svg ref={svgRef} width="100%" height="100%"
          style={{ display: 'block', cursor: 'default', userSelect: 'none' }}
          onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}
          onMouseDown={onBgMD} onWheel={onWheel}>
          <rect x="0" y="0" width="100%" height="100%" fill="transparent"/>
          <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
            <defs>
              {products.map((p, i) => (
                <marker key={p} id={`harr-${i}`}
                  viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M1 1.5L8 5L1 8.5" fill="none"
                    stroke={PALETTE[i%PALETTE.length]} strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </marker>
              ))}
            </defs>

            {/* Edges */}
            {flowData.connections.map(conn => {
              const fp = allPositions[conn.from], tp = allPositions[conn.to];
              if (!fp || !tp) return null;
              const prodIdx     = products.indexOf(conn.product);
              const col         = PALETTE[prodIdx % PALETTE.length];
              const edgeKey     = `${conn.from}->${conn.to}`;
              const prodsOnEdge = edgeProdCount[edgeKey] || [conn.product];
              const myIdx       = prodsOnEdge.indexOf(conn.product);
              const d           = edgePath(fp, tp, myIdx, prodsOnEdge.length);
              const thick       = 1.5 + (flowData.edgeTotals[edgeKey] / maxEdge) * 10;
              const isHov       = hoveredWC === conn.from || hoveredWC === conn.to;
              return (
                <g key={`${conn.product}-${conn.from}-${conn.to}`}>
                  {isHov && <path d={d} fill="none" stroke={col} strokeWidth={thick+6} opacity="0.12" strokeLinecap="round"/>}
                  <path d={d} fill="none" stroke={col} strokeWidth={thick} strokeLinecap="round"
                    opacity={hoveredWC && !isHov ? 0.08 : 0.55}
                    markerEnd={`url(#harr-${prodIdx%PALETTE.length})`}/>
                </g>
              );
            })}

            {/* Edge labels */}
            {Object.entries(flowData.edgeTotals).map(([key, vol]) => {
              const [from, to] = key.split('->');
              const fp = allPositions[from], tp = allPositions[to];
              if (!fp || !tp) return null;
              const isHov = hoveredWC === from || hoveredWC === to;
              if (hoveredWC && !isHov) return null;
              const arcLift = Math.abs(tp.x - fp.x) > 250 ? -Math.abs(tp.x - fp.x)*0.22 : 0;
              const mx = (fp.x + tp.x)/2, my = (fp.y + tp.y)/2 + arcLift;
              return (
                <g key={`hl-${key}`}>
                  <rect x={mx-26} y={my-10} width="52" height="18" rx="5"
                    fill="#090b0e" stroke={T.border2} strokeWidth="0.5"/>
                  <text x={mx} y={my+4} textAnchor="middle"
                    fontSize="10" fontWeight="600" fill={T.text2} fontFamily="monospace">
                    {vol} szt.
                  </text>
                </g>
              );
            })}

            {/* Nodes */}
            {Object.entries(allPositions).map(([wc, pos]) => {
              const ops = flowData.nodeOps[wc] || 0;
              if (!ops) return null;
              const isHov = hoveredWC === wc;
              const r     = 26 + (ops / maxNodeOp) * 10;
              const dimmed = hoveredWC && !isHov ? 0.2 : 1;
              // Avg actual_ct_min dla tego gniazda w tym okresie
              const recs = periodRecords.filter(x => x.workcenter === wc);
              const avgCt = recs.length
                ? (recs.reduce((s, x) => s + x.actual_ct_min, 0) / recs.length).toFixed(1)
                : '—';
              return (
                <g key={wc}
                  style={{ cursor: 'grab', opacity: dimmed, transition: dragging.current ? 'none' : 'opacity 0.15s' }}
                  onMouseDown={e => onNodeMD(e, wc)}
                  onMouseEnter={() => { if (!dragging.current) setHoveredWC(wc); }}
                  onMouseLeave={() => { if (!dragging.current) setHoveredWC(null); }}>
                  {isHov && <circle cx={pos.x} cy={pos.y} r={r+5} fill="none" stroke={T.accent} strokeWidth="1" opacity="0.35"/>}
                  <circle cx={pos.x} cy={pos.y} r={r} fill="#13161b" stroke={T.accent} strokeWidth="1.5"/>
                  <text x={pos.x} y={pos.y-8} textAnchor="middle" fontSize="12" fontWeight="700" fill={T.text} style={{pointerEvents:'none'}}>{wc}</text>
                  <text x={pos.x} y={pos.y+5} textAnchor="middle" fontSize="9" fill={T.text3} style={{pointerEvents:'none'}}>avg {avgCt} min</text>
                  <text x={pos.x} y={pos.y+17} textAnchor="middle" fontSize="9" fontWeight="600" fill={T.accent} fontFamily="monospace" style={{pointerEvents:'none'}}>{ops} ops</text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {Object.entries(flowData.nodeOps).sort((a,b) => b[1]-a[1]).map(([wc, ops]) => {
          const recs  = periodRecords.filter(r => r.workcenter === wc);
          const avgCt = recs.length ? (recs.reduce((s,r) => s+r.actual_ct_min,0)/recs.length).toFixed(1) : '—';
          const avgWt = recs.length ? (recs.reduce((s,r) => s+(r.wait_min||0),0)/recs.length).toFixed(1) : '—';
          return (
            <div key={wc} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 11, minWidth: 100 }}>
              <div style={{ fontWeight: 600, color: T.text, marginBottom: 3 }}>{wc}</div>
              <div style={{ color: T.text3 }}>ops: <span style={{ color: T.text2 }}>{ops}</span></div>
              <div style={{ color: T.text3 }}>szt.: <span style={{ color: T.text2 }}>{(() => { const vols = {}; periodRecords.filter(r=>r.workcenter===wc).forEach(r=>{vols[r.zp_id]=(r.volume||0);}); return Object.values(vols).reduce((s,v)=>s+v,0); })()}</span></div>
              <div style={{ color: T.text3 }}>avg ct: <span style={{ color: T.text2 }}>{avgCt} min</span></div>
              <div style={{ color: T.text3 }}>avg wait: <span style={{ color: T.text2 }}>{avgWt} min</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SEKCJA A: CZASY OPERACJI ─────────────────────────────────────────────────

function TimesSection({ wcStats }) {
  if (!wcStats.length) return <Empty />;

  const maxVal = Math.max(...wcStats.flatMap(w => [w.avg_actual_ct ?? 0, w.avg_std_ct ?? 0]));

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>Średni czas operacji — actual vs standard (min)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {wcStats.map(w => (
          <div key={w.workcenter}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{w.workcenter}</span>
              <span style={{ fontSize: 11, color: devColor(w.avg_dev_pct) }}>
                {w.avg_dev_pct != null
                  ? `${w.avg_dev_pct > 0 ? '+' : ''}${w.avg_dev_pct.toFixed(1)}% vs std`
                  : 'brak std'}
              </span>
            </div>
            {/* Actual bar */}
            <div style={{ marginBottom: 3 }}>
              <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>
                Actual: {w.avg_actual_ct.toFixed(1)} min
              </div>
              <div style={{ background: T.surface3, borderRadius: 4, height: 10, overflow: 'hidden' }}>
                <div style={{
                  width: `${(w.avg_actual_ct / maxVal) * 100}%`,
                  height: '100%',
                  background: devBarColor(w.avg_dev_pct),
                  borderRadius: 4,
                  transition: 'width 0.3s',
                }} />
              </div>
            </div>
            {/* Std bar */}
            {w.avg_std_ct != null && (
              <div>
                <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>
                  Standard: {w.avg_std_ct.toFixed(1)} min
                </div>
                <div style={{ background: T.surface3, borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(w.avg_std_ct / maxVal) * 100}%`,
                    height: '100%',
                    background: T.text3,
                    borderRadius: 4,
                  }} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 20 }}>
        <LegendDot color={T.ok}   label="≤ +10% vs std" />
        <LegendDot color={T.warn} label="+10–30% vs std" />
        <LegendDot color={T.bn}   label="> +30% vs std" />
        <LegendDot color={T.text3} label="Standard" />
      </div>
    </div>
  );
}

// ─── SEKCJA B: HEATMAPA STRAT ─────────────────────────────────────────────────

function HeatmapSection({ heatmap }) {
  const { cells, weeks, workcenter } = heatmap;
  if (!cells.length) return <Empty />;

  const maxLoss = Math.max(...cells.map(c => c.cap_loss), 0.001);

  // lookup szybki
  const lookup = {};
  cells.forEach(c => { lookup[`${c.week}||${c.workcenter}`] = c; });

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>Capacity Loss (h) — czas oczekiwania × obciążenie gniazda</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 400 }}>
          <thead>
            <tr>
              <th style={thStyle}>Tydzień</th>
              {workcenter.map(wc => (
                <th key={wc} style={{ ...thStyle, textAlign: 'center' }}>{wc}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map(week => (
              <tr key={week}>
                <td style={{ ...tdStyle, color: T.text2, fontWeight: 500 }}>{week}</td>
                {workcenter.map(wc => {
                  const cell = lookup[`${week}||${wc}`];
                  const loss = cell?.cap_loss ?? 0;
                  const intensity = maxLoss > 0 ? loss / maxLoss : 0;
                  const bg = heatColor(intensity);
                  return (
                    <td key={wc} style={{ ...tdStyle, textAlign: 'center', background: bg, position: 'relative' }}
                      title={cell ? `Wait: ${cell.wait_h.toFixed(1)}h · CapLoss: ${cell.cap_loss.toFixed(2)}h · ops: ${cell.count}` : 'brak danych'}>
                      {loss > 0
                        ? <span style={{ color: intensity > 0.5 ? '#fff' : T.text, fontWeight: intensity > 0.3 ? 600 : 400 }}>
                            {loss.toFixed(2)}
                          </span>
                        : <span style={{ color: T.text3 }}>—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Legenda */}
      <div style={{ marginTop: 18, borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: T.text3, marginBottom: 10 }}>Legenda</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: T.text3, minWidth: 16 }}>0</span>
          {[0, 0.15, 0.35, 0.55, 0.75, 1].map(v => (
            <div key={v} style={{ width: 32, height: 16, background: heatColor(v), borderRadius: 2 }} />
          ))}
          <span style={{ fontSize: 11, color: T.text3 }}>max</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <LegendItem color={heatColor(0)}    label="Brak strat" desc="gniazdo nie stało" />
          <LegendItem color={heatColor(0.25)} label="Niskie straty" desc="< 25% max" />
          <LegendItem color={heatColor(0.55)} label="Umiarkowane" desc="25–70% max" />
          <LegendItem color={heatColor(1)}    label="Krytyczne" desc="> 70% max — priorytet do analizy" textDark />
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: T.text3, lineHeight: 1.6 }}>
          <strong style={{ color: T.text2 }}>Capacity Loss (h)</strong> = (czas oczekiwania między operacjami w min / 60) × (średnie obciążenie gniazda w %)
          <br />Im wyższe obciążenie gniazda, tym droższa każda godzina postoju — stąd ta metryka boli bardziej niż sam czas oczekiwania.
          <br /><span style={{ color: T.text3 }}>Najedź na komórkę aby zobaczyć: wait_h · capacity_loss_h · liczba operacji w tygodniu.</span>
        </div>
      </div>
    </div>
  );
}

// ─── SEKCJA C: STABILNOŚĆ GNIAZD ─────────────────────────────────────────────

function calcBoxStats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n    = sorted.length;
  const q1   = sorted[Math.floor(n * 0.25)];
  const med  = n % 2 === 0
    ? (sorted[n/2-1] + sorted[n/2]) / 2
    : sorted[Math.floor(n/2)];
  const q3   = sorted[Math.floor(n * 0.75)];
  const iqr  = q3 - q1;
  const lo   = q1 - 1.5 * iqr;
  const hi   = q3 + 1.5 * iqr;
  const wLo  = sorted.find(v => v >= lo) ?? sorted[0];
  const wHi  = [...sorted].reverse().find(v => v <= hi) ?? sorted[n-1];
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const outliers = sorted.filter(v => v < lo || v > hi);
  return { q1, med, q3, iqr, wLo, wHi, mean, min: sorted[0], max: sorted[n-1], outliers, n };
}

function BoxPlotChart({ rawData, wcStats }) {
  const PAD  = { l: 52, r: 20, t: 16, b: 28 };
  const ROW_H = 52;
  const wcs  = [...wcStats].sort((a, b) => b.cv_pct - a.cv_pct).map(w => w.workcenter);
  const H    = PAD.t + wcs.length * ROW_H + PAD.b;
  const W    = 620;
  const innerW = W - PAD.l - PAD.r;

  // Zbierz actual_ct_min per gniazdo
  const byWc = {};
  rawData.forEach(r => {
    if (!byWc[r.workcenter]) byWc[r.workcenter] = [];
    byWc[r.workcenter].push(r.actual_ct_min);
  });

  const allVals = rawData.map(r => r.actual_ct_min);
  const globalMax = Math.max(...allVals, 1);
  const globalMin = Math.min(...allVals, 0);
  const range = globalMax - globalMin || 1;

  function xScale(v) {
    return PAD.l + ((v - globalMin) / range) * innerW;
  }

  // Oś X: 5 ticków
  const ticks = Array.from({ length: 5 }, (_, i) =>
    globalMin + (range / 4) * i
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Siatka + ticki X */}
      {ticks.map(t => {
        const x = xScale(t);
        return (
          <g key={t}>
            <line x1={x} y1={PAD.t} x2={x} y2={H - PAD.b} stroke={T.border} strokeWidth={0.5} strokeDasharray="3 3" />
            <text x={x} y={H - PAD.b + 12} textAnchor="middle" fontSize={9} fill={T.text3}>
              {t.toFixed(1)}
            </text>
          </g>
        );
      })}
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize={9} fill={T.text3}>actual_ct_min</text>

      {wcs.map((wc, i) => {
        const vals  = byWc[wc] ?? [];
        const bs    = calcBoxStats(vals);
        const stat  = wcStats.find(w => w.workcenter === wc);
        const color = stabilityColor(stat?.stability ?? 'stable');
        const cy    = PAD.t + i * ROW_H + ROW_H / 2;
        const boxH  = 18;

        return (
          <g key={wc}>
            {/* Etykieta */}
            <text x={PAD.l - 6} y={cy + 4} textAnchor="end" fontSize={10} fontWeight="600" fill={T.text}>{wc}</text>
            {/* Badge CV */}
            <text x={PAD.l - 6} y={cy + 15} textAnchor="end" fontSize={8} fill={color}>CV {stat?.cv_pct.toFixed(1)}%</text>

            {bs && (
              <>
                {/* Linia tła (min→max) */}
                <line x1={xScale(bs.min)} y1={cy} x2={xScale(bs.max)} y2={cy}
                  stroke={T.border2} strokeWidth={1} />

                {/* Wąsy (whiskers) */}
                <line x1={xScale(bs.wLo)} y1={cy - boxH/2 + 4} x2={xScale(bs.wLo)} y2={cy + boxH/2 - 4}
                  stroke={color} strokeWidth={1.5} />
                <line x1={xScale(bs.wHi)} y1={cy - boxH/2 + 4} x2={xScale(bs.wHi)} y2={cy + boxH/2 - 4}
                  stroke={color} strokeWidth={1.5} />
                <line x1={xScale(bs.wLo)} y1={cy} x2={xScale(bs.q1)} y2={cy}
                  stroke={color} strokeWidth={1} strokeDasharray="3 2" />
                <line x1={xScale(bs.q3)} y1={cy} x2={xScale(bs.wHi)} y2={cy}
                  stroke={color} strokeWidth={1} strokeDasharray="3 2" />

                {/* Pudełko IQR */}
                <rect
                  x={xScale(bs.q1)} y={cy - boxH/2}
                  width={Math.max(2, xScale(bs.q3) - xScale(bs.q1))} height={boxH}
                  fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.5} rx={2}
                />

                {/* Mediana */}
                <line x1={xScale(bs.med)} y1={cy - boxH/2} x2={xScale(bs.med)} y2={cy + boxH/2}
                  stroke={color} strokeWidth={2.5} />

                {/* Średnia (krzyżyk) */}
                <line x1={xScale(bs.mean)-4} y1={cy} x2={xScale(bs.mean)+4} y2={cy}
                  stroke="#fff" strokeWidth={1.5} />
                <line x1={xScale(bs.mean)} y1={cy-4} x2={xScale(bs.mean)} y2={cy+4}
                  stroke="#fff" strokeWidth={1.5} />

                {/* Outliery */}
                {bs.outliers.map((v, oi) => (
                  <circle key={oi} cx={xScale(v)} cy={cy} r={3}
                    fill="none" stroke={T.bn} strokeWidth={1.2} />
                ))}

                {/* Etykiety wartości */}
                <text x={xScale(bs.med) + 4} y={cy - boxH/2 - 3} fontSize={8} fill={color}>
                  med {bs.med.toFixed(1)}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function StabilitySection({ wcStats, rawData }) {
  if (!wcStats.length) return <Empty />;

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>Stabilność gniazd — wykres pudełkowy actual_ct_min</div>

      <BoxPlotChart rawData={rawData} wcStats={wcStats} />

      {/* Tabela CV */}
      <div style={{ marginTop: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              {['Gniazdo', 'Stabilność', 'CV%', 'σ (min)', 'Średnia (min)', 'Mediana (min)', 'IQR (min)', 'Outliery', 'Obs.'].map(h => (
                <th key={h} style={{ ...thStyle, textAlign: h === 'Gniazdo' ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...wcStats].sort((a, b) => b.cv_pct - a.cv_pct).map(w => {
              const color = stabilityColor(w.stability);
              const vals  = rawData.filter(r => r.workcenter === w.workcenter).map(r => r.actual_ct_min);
              const bs    = calcBoxStats(vals);
              return (
                <tr key={w.workcenter}>
                  <td style={tdStyle}><span style={{ fontWeight: 600, color: T.text }}>{w.workcenter}</span></td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <span style={{ ...s.tag(color), fontSize: 10 }}>
                      {w.stability === 'stable' ? 'stabilne' : w.stability === 'moderate' ? 'umiarkowane' : 'niestabilne'}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color, fontWeight: 600 }}>{w.cv_pct.toFixed(1)}%</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: T.text2 }}>{w.std_dev.toFixed(2)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: T.text2 }}>{w.avg_actual_ct.toFixed(1)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: T.text2 }}>{bs ? bs.med.toFixed(1) : '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: T.text2 }}>{bs ? bs.iqr.toFixed(1) : '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: bs?.outliers.length ? T.bn : T.text3 }}>
                    {bs ? bs.outliers.length : '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: T.text3 }}>{w.count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legenda */}
      <div style={{ marginTop: 20, borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: T.text3, marginBottom: 12 }}>Legenda wykresu</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 12 }}>
          <LegendBoxItem type="box"      label="Pudełko (IQR)"    desc="środkowe 50% obserwacji — Q1 do Q3" />
          <LegendBoxItem type="median"   label="Linia mediany"    desc="wartość środkowa (50. percentyl)" />
          <LegendBoxItem type="mean"     label="Krzyżyk (+)"      desc="średnia arytmetyczna" />
          <LegendBoxItem type="whisker"  label="Wąsy"             desc="zakres bez outlierów (1.5 × IQR od pudełka)" />
          <LegendBoxItem type="outlier"  label="Kółka (outliery)" desc="wartości poza 1.5 × IQR — potencjalne awarie lub błędy" />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12 }}>
          <LegendItem color={T.ok}   label="CV < 10% — stabilne"    desc="czasy powtarzalne, proces pod kontrolą" />
          <LegendItem color={T.warn} label="CV 10–25% — umiarkowane" desc="zauważalna zmienność, warto monitorować" />
          <LegendItem color={T.bn}   label="CV > 25% — niestabilne"  desc="duża zmienność — kandydat na wąskie gardło" />
        </div>
        <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.6 }}>
          <strong style={{ color: T.text2 }}>CV%</strong> = σ / średnia × 100 — mierzy zmienność względną niezależnie od skali operacji.
          Jeśli mediana ≠ średnia → rozkład jest skośny (outliery zawyżają średnią).
          Wiele outlierów przy niskim IQR = sporadyczne awarie, nie systemowy problem.
        </div>
      </div>
    </div>
  );
}

// ─── SEKCJA D: PARETO PRZYCZYN ────────────────────────────────────────────────

function ParetoSection({ paretoData, workcenter, paretoWc, onWcChange }) {
  if (!paretoData.length) return (
    <div style={{ ...s.card, color: T.text3, fontSize: 13 }}>
      Brak danych z reason_code dla wybranego gniazda.
    </div>
  );

  const maxCount = paretoData[0]?.count ?? 1;
  const total    = paretoData.reduce((s, d) => s + d.count, 0);

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={s.cardTitle}>Pareto przyczyn przestojów</div>
        <select value={paretoWc} onChange={e => onWcChange(e.target.value)} style={selectStyle}>
          <option value="ALL">Wszystkie gniazda</option>
          {workcenter.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>

      {/* Wykres słupkowy + linia kumulatywna (SVG) */}
      <ParetoChart data={paretoData} />

      {/* Tabela */}
      <div style={{ marginTop: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Przyczyna', 'Liczba', 'Udział %', 'Kum. %', 'Wait (h)'].map(h => (
                <th key={h} style={{ ...thStyle, textAlign: h === 'Przyczyna' ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paretoData.map((d, i) => (
              <tr key={d.code}>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: REASON_COLORS[i % REASON_COLORS.length] }} />
                    {d.code}
                  </div>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{d.count}</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: REASON_COLORS[i % REASON_COLORS.length], fontWeight: 600 }}>{d.pct.toFixed(1)}%</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: T.text2 }}>{d.cum_pct.toFixed(1)}%</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: T.text2 }}>{d.wait_h.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ParetoChart({ data }) {
  const W = 560, H = 160, PAD = { l: 30, r: 40, t: 10, b: 30 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const n      = data.length;
  if (!n) return null;

  const maxCount = data[0].count;
  const barW     = innerW / n;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Y-axis left (count) */}
      {[0, 0.5, 1].map(t => {
        const y = PAD.t + innerH - t * innerH;
        return (
          <g key={t}>
            <line x1={PAD.l} y1={y} x2={PAD.l + innerW} y2={y} stroke={T.border} strokeWidth={0.5} />
            <text x={PAD.l - 4} y={y + 4} textAnchor="end" fontSize={9} fill={T.text3}>
              {Math.round(t * maxCount)}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const bH    = (d.count / maxCount) * innerH;
        const x     = PAD.l + i * barW + barW * 0.1;
        const y     = PAD.t + innerH - bH;
        const color = REASON_COLORS[i % REASON_COLORS.length];
        return (
          <g key={d.code}>
            <rect x={x} y={y} width={barW * 0.8} height={bH} fill={color} fillOpacity={0.8} rx={2} />
            <text x={x + barW * 0.4} y={H - PAD.b + 12} textAnchor="middle" fontSize={9} fill={T.text3}>
              {d.code.length > 8 ? d.code.slice(0, 8) + '…' : d.code}
            </text>
          </g>
        );
      })}

      {/* Cumulative % line (right axis) */}
      {data.length > 1 && (() => {
        const points = data.map((d, i) => {
          const x = PAD.l + i * barW + barW * 0.5;
          const y = PAD.t + innerH - (d.cum_pct / 100) * innerH;
          return `${x},${y}`;
        });
        return (
          <>
            <polyline points={points.join(' ')} fill="none" stroke={T.warn} strokeWidth={1.5} strokeDasharray="4 2" />
            {data.map((d, i) => {
              const x = PAD.l + i * barW + barW * 0.5;
              const y = PAD.t + innerH - (d.cum_pct / 100) * innerH;
              return <circle key={i} cx={x} cy={y} r={3} fill={T.warn} />;
            })}
            <text x={W - PAD.r + 4} y={PAD.t + 10} fontSize={9} fill={T.warn}>100%</text>
            <text x={W - PAD.r + 4} y={PAD.t + innerH / 2} fontSize={9} fill={T.warn}>50%</text>
          </>
        );
      })()}
    </svg>
  );
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function devColor(pct) {
  if (pct == null) return T.text3;
  if (pct <= 10)   return T.ok;
  if (pct <= 30)   return T.warn;
  return T.bn;
}

function devBarColor(pct) {
  if (pct == null) return T.accent;
  if (pct <= 10)   return T.ok;
  if (pct <= 30)   return T.warn;
  return T.bn;
}

function stabilityColor(stability) {
  if (stability === 'stable')   return T.ok;
  if (stability === 'moderate') return T.warn;
  return T.bn;
}

function heatColor(intensity) {
  // szary (brak) → żółty → czerwony
  if (intensity <= 0) return T.surface3;
  const r = Math.round(50  + intensity * 200);
  const g = Math.round(180 - intensity * 150);
  const b = Math.round(80  - intensity * 70);
  return `rgba(${r},${g},${b},${0.2 + intensity * 0.7})`;
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 11, color: T.text3 }}>{label}</span>
    </div>
  );
}

function LegendBoxItem({ type, label, desc }) {
  const W = 40, H = 20;
  const cy = H / 2;
  let icon;
  if (type === 'box') {
    icon = (
      <svg width={W} height={H}>
        <rect x={8} y={cy-6} width={24} height={12} fill={T.ok} fillOpacity={0.2} stroke={T.ok} strokeWidth={1.5} rx={1} />
      </svg>
    );
  } else if (type === 'median') {
    icon = (
      <svg width={W} height={H}>
        <rect x={8} y={cy-6} width={24} height={12} fill="none" stroke={T.border2} strokeWidth={1} rx={1} />
        <line x1={20} y1={cy-6} x2={20} y2={cy+6} stroke={T.ok} strokeWidth={2.5} />
      </svg>
    );
  } else if (type === 'mean') {
    icon = (
      <svg width={W} height={H}>
        <line x1={16} y1={cy} x2={24} y2={cy} stroke="#fff" strokeWidth={1.5} />
        <line x1={20} y1={cy-4} x2={20} y2={cy+4} stroke="#fff" strokeWidth={1.5} />
      </svg>
    );
  } else if (type === 'whisker') {
    icon = (
      <svg width={W} height={H}>
        <line x1={8} y1={cy-5} x2={8} y2={cy+5} stroke={T.ok} strokeWidth={1.5} />
        <line x1={8} y1={cy} x2={16} y2={cy} stroke={T.ok} strokeWidth={1} strokeDasharray="3 2" />
        <line x1={24} y1={cy} x2={32} y2={cy} stroke={T.ok} strokeWidth={1} strokeDasharray="3 2" />
        <line x1={32} y1={cy-5} x2={32} y2={cy+5} stroke={T.ok} strokeWidth={1.5} />
      </svg>
    );
  } else {
    icon = (
      <svg width={W} height={H}>
        <circle cx={20} cy={cy} r={4} fill="none" stroke={T.bn} strokeWidth={1.5} />
      </svg>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      <div style={{ flexShrink: 0, background: T.surface3, borderRadius: 4 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{label}</div>
        {desc && <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>{desc}</div>}
      </div>
    </div>
  );
}

function LegendItem({ color, label, desc, textDark }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 180 }}>
      <div style={{ width: 12, height: 12, borderRadius: 2, background: color, marginTop: 2, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: textDark ? '#fff' : T.text }}>{label}</div>
        {desc && <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>{desc}</div>}
      </div>
    </div>
  );
}

function Empty() {
  return <div style={{ color: T.text3, fontSize: 13, padding: 24 }}>Brak danych po zastosowanych filtrach.</div>;
}

const selectStyle = {
  background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 7,
  color: T.text, fontSize: 12, padding: '5px 10px', cursor: 'pointer',
};

const thStyle = {
  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em',
  color: T.text3, padding: '6px 10px', borderBottom: `1px solid ${T.border}`, textAlign: 'left',
};

const tdStyle = {
  padding: '7px 10px', borderBottom: `1px solid ${T.border}`, color: T.text, fontSize: 12,
};