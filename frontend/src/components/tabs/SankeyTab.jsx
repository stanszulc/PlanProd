import { useState, useMemo, useEffect, useRef } from 'react';
import { T, PALETTE, s } from '../../constants/theme.js';
import { Dot } from '../common/Dot.jsx';
import { EmptyState } from '../common/EmptyState.jsx';

// ── helpers dat ──────────────────────────────────────────────────────────────
function isoWeekStr(dt) {
  const d = new Date(dt);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  return d.getFullYear() + '-W' + String(wn).padStart(2, '0');
}
function segDay(seg) {
  if (!seg?.segStart) return null;
  const d = new Date(seg.segStart);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function segWeek(seg) {
  if (!seg?.segStart) return null;
  return isoWeekStr(seg.segStart);
}

export function SankeyTab({ routing, zp, globalLookups, wcSchedule,
  fwdZP = [], wcToBrygada = {},
  heatmapFilter = null, onHeatmapFilterChange,
  selectedWC = null, onWCSelect,
  selectedDate = null, onDateSelect }) {

  const [granularity, setGranularity] = useState('week');
  const [selectedKey, setSelectedKey] = useState(null);
  const [hoveredWC,   setHoveredWC]   = useState(null);
  const [nodePos,     setNodePos]      = useState({});
  const [view,        setView]         = useState({ scale: 1, tx: 0, ty: 0 });
  const dragging = useRef(null);
  const svgRef   = useRef(null);

  // ── Filtr zewnętrzny (heatmapFilter / selectedWC / selectedDate z Gantta) ────
  const externalZpIds = useMemo(() => {
    const anyFilter = heatmapFilter || selectedWC || selectedDate;
    if (!anyFilter || !fwdZP.length) return null;
    const hmBase = heatmapFilter
      ? fwdZP.filter(s2 => {
          const targetWcSet = heatmapFilter.wc
            ? new Set([String(heatmapFilter.wc)])
            : new Set(Object.entries(wcToBrygada).filter(([, v]) => v === heatmapFilter.wc2).map(([k]) => k));
          if (!targetWcSet.has(String(s2.workcenter))) return false;
          if (!heatmapFilter.date) return true;
          return (s2.segments || []).some(seg => seg.segStart && new Date(seg.segStart).toISOString().slice(0, 10) === heatmapFilter.date);
        })
      : fwdZP;
    const wcBase = selectedWC
      ? hmBase.filter(s2 => String(s2.workcenter) === String(selectedWC))
      : hmBase;
    const dateBase = selectedDate
      ? wcBase.filter(s2 => (s2.segments || []).some(seg => seg.segStart && new Date(seg.segStart).toISOString().slice(0, 10) === selectedDate))
      : wcBase;
    const ids = new Set(dateBase.map(s2 => s2.parent_zp || s2.zp_id.split('/')[0]));
    return ids.size > 0 ? ids : null;
  }, [fwdZP, heatmapFilter, selectedWC, selectedDate, wcToBrygada]);

  // ── Przefiltrowany fwdZP wg filtra zewnętrznego ──────────────────────────────
  const activeFwdZP = useMemo(() =>
    externalZpIds ? fwdZP.filter(s2 => externalZpIds.has(s2.parent_zp || s2.zp_id.split('/')[0])) : fwdZP,
  [fwdZP, externalZpIds]);

  // ── Klucze okresu (dzień lub tydzień) z segmentów planu ──────────────────────
  const periodKeys = useMemo(() => {
    const keys = new Set();
    activeFwdZP.forEach(s2 => {
      (s2.segments || []).forEach(seg => {
        const k = granularity === 'week' ? segWeek(seg) : segDay(seg);
        if (k) keys.add(k);
      });
    });
    return [...keys].sort();
  }, [activeFwdZP, granularity]);

  // Domyślnie pierwszy dostępny klucz (lub aktualny jeśli nadal istnieje)
  const effectiveKey = selectedKey && periodKeys.includes(selectedKey)
    ? selectedKey
    : (periodKeys[0] ?? null);

  // Reset selectedKey gdy granularity się zmienia
  useEffect(() => { setSelectedKey(null); }, [granularity]);

  // ── ZP IDs aktywne w wybranym okresie ────────────────────────────────────────
  const periodZpIds = useMemo(() => {
    if (!effectiveKey) return new Set();
    const ids = new Set();
    activeFwdZP.forEach(s2 => {
      const matches = (s2.segments || []).some(seg => {
        const k = granularity === 'week' ? segWeek(seg) : segDay(seg);
        return k === effectiveKey;
      });
      if (matches) ids.add(s2.parent_zp || s2.zp_id.split('/')[0]);
    });
    return ids;
  }, [activeFwdZP, effectiveKey, granularity]);

  // ── ZP dla okresu (wolumeny) ──────────────────────────────────────────────────
  const periodZP = useMemo(() =>
    zp.filter(z => periodZpIds.has(z.zp_id)),
  [zp, periodZpIds]);

  const products = useMemo(() => [...new Set(routing.map(r => r.product))], [routing]);

  // ── FLOW DATA z planu ─────────────────────────────────────────────────────────
  const flowData = useMemo(() => {
    if (!periodZP.length || !routing.length)
      return { connections: [], edgeTotals: {}, nodeVolumes: {}, planCt: {} };

    const activeProducts = [...new Set(periodZP.map(z => z.product))];
    const nodeVolumes = {}, productConns = {}, planCt = {};

    // Zbierz zaplanowane czasy operacji z fwdZP (dla węzłów)
    activeFwdZP.forEach(s2 => {
      if (!periodZpIds.has(s2.parent_zp || s2.zp_id.split('/')[0])) return;
      const wc = String(s2.workcenter);
      if (!planCt[wc]) planCt[wc] = { totalMin: 0, count: 0 };
      (s2.segments || []).forEach(seg => {
        if (!seg.segStart || !seg.segEnd) return;
        const min = (new Date(seg.segEnd) - new Date(seg.segStart)) / 60000;
        planCt[wc].totalMin += min;
        planCt[wc].count += 1;
      });
    });

    periodZP.forEach(order => {
      const ops = globalLookups.routingByProduct[order.product] || [];
      ops.forEach((op, idx) => {
        nodeVolumes[op.workcenter] = (nodeVolumes[op.workcenter] || 0) + order.volume;
        if (idx < ops.length - 1) {
          const next = ops[idx + 1];
          const key  = `${order.product}||${op.workcenter}->${next.workcenter}`;
          if (!productConns[key])
            productConns[key] = { product: order.product, from: op.workcenter, to: next.workcenter, volume: 0 };
          productConns[key].volume += order.volume;
        }
      });
    });

    const edgeTotals = {};
    Object.values(productConns).forEach(c => {
      const k = `${c.from}->${c.to}`;
      edgeTotals[k] = (edgeTotals[k] || 0) + c.volume;
    });

    return { connections: Object.values(productConns), edgeTotals, nodeVolumes, planCt };
  }, [periodZP, activeFwdZP, periodZpIds, routing, globalLookups]);

  // ── LAYOUT węzłów ─────────────────────────────────────────────────────────────
  const activeProducts = useMemo(() =>
    [...new Set(periodZP.map(z => z.product))].filter(p => routing.some(r => r.product === p)),
  [periodZP, routing]);

  const baseLayout = useMemo(() => {
    if (!routing.length) return { positions: {}, SVG_W: 800, SVG_H: 400 };
    const activeProd = activeProducts.length ? activeProducts : products;
    const activeWCs  = [...new Set(routing.filter(r => activeProd.includes(r.product)).map(r => r.workcenter))];
    const numProds   = activeProd.length;
    const PAD_X = 90, PAD_Y = 50, COL_W = 200;
    const MAX_H = 600;
    const LANE_H = numProds > 1 ? Math.min(55, (MAX_H - PAD_Y * 2) / (numProds - 1)) : 55;
    const SVG_H = PAD_Y * 2 + Math.max(numProds - 1, 0) * LANE_H;
    const prodLaneY = {};
    activeProd.forEach((p, i) => {
      prodLaneY[p] = numProds === 1 ? SVG_H / 2 : PAD_Y + i * LANE_H;
    });
    const wcMinSeq = {};
    activeWCs.forEach(wc => {
      const seqs = routing.filter(r => r.workcenter === wc && activeProd.includes(r.product)).map(r => r.sequence);
      wcMinSeq[wc] = seqs.length ? Math.min(...seqs) : 99;
    });
    const colKeys = [...new Set(Object.values(wcMinSeq))].sort((a, b) => a - b);
    const SVG_W   = PAD_X * 2 + Math.max(colKeys.length - 1, 0) * COL_W;
    const positions = {};
    activeWCs.forEach(wc => {
      const users  = activeProd.filter(p => routing.some(r => r.product === p && r.workcenter === wc));
      const avgY   = users.reduce((sum, p) => sum + prodLaneY[p], 0) / (users.length || 1);
      const colIdx = colKeys.indexOf(wcMinSeq[wc]);
      const op     = routing.find(r => r.workcenter === wc);
      positions[wc] = { x: PAD_X + colIdx * COL_W, y: avgY, label: op ? op.operation.substring(0, 16) : wc };
    });
    return { positions, SVG_W, SVG_H };
  }, [routing, activeProducts, products]);

  useEffect(() => {
    if (!routing.length) return;
    const key = 'flowops_nodepos_' + [...new Set(routing.map(r => r.workcenter))].sort().join(',');
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      if (Object.keys(saved).length) setNodePos(saved);
    } catch(e) {}
  }, [routing]);

  const allPositions = useMemo(() => {
    const merged = {};
    Object.entries(baseLayout.positions).forEach(([wc, base]) => {
      merged[wc] = nodePos[wc] ? { ...base, x: nodePos[wc].x, y: nodePos[wc].y } : { ...base };
    });
    return merged;
  }, [baseLayout, nodePos]);

  const SVG_W = baseLayout.SVG_W;
  const SVG_H = baseLayout.SVG_H;
  const maxVolume  = Math.max(...Object.values(flowData.edgeTotals), 1);
  const maxNodeVol = Math.max(...Object.values(flowData.nodeVolumes), 1);

  // ── EDGE PATH ─────────────────────────────────────────────────────────────────
  function edgePath(fromPos, toPos, prodIdx, totalOnEdge) {
    const R   = 34;
    const dx  = toPos.x - fromPos.x, dy = toPos.y - fromPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux  = dx / dist, uy = dy / dist;
    const x1  = fromPos.x + ux * R, y1 = fromPos.y + uy * R;
    const x2  = toPos.x  - ux * R, y2 = toPos.y  - uy * R;
    const off = totalOnEdge > 1 ? (prodIdx - (totalOnEdge - 1) / 2) * 14 : 0;
    const arcLift = Math.abs(toPos.x - fromPos.x) > 250 ? -Math.abs(toPos.x - fromPos.x) * 0.25 : 0;
    const mx = (x1 + x2) / 2 + (-uy * off), my = (y1 + y2) / 2 + (ux * off) + arcLift;
    return {
      d: `M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1+(mx-x1)*0.5).toFixed(1)} ${(y1+(my-y1)*0.5).toFixed(1)},${(x2+(mx-x2)*0.5).toFixed(1)} ${(y2+(my-y2)*0.5).toFixed(1)},${x2.toFixed(1)} ${y2.toFixed(1)}`,
      mx, my,
    };
  }

  const edgeProdCount = {};
  flowData.connections.forEach(c => {
    const k = `${c.from}->${c.to}`;
    if (!edgeProdCount[k]) edgeProdCount[k] = [];
    if (!edgeProdCount[k].includes(c.product)) edgeProdCount[k].push(c.product);
  });

  // ── DRAG / PAN / ZOOM ─────────────────────────────────────────────────────────
  function svgPoint(e) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function onNodeMouseDown(e, wc) {
    e.stopPropagation();
    const { x, y } = svgPoint(e);
    const cur = allPositions[wc];
    // offset w graph coords między kursorem a środkiem węzła
    const gx = (x - view.tx) / view.scale;
    const gy = (y - view.ty) / view.scale;
    dragging.current = { kind: 'node', wc, ox: gx - cur.x, oy: gy - cur.y };
  }
  function onSvgBgMouseDown(e) {
    if (e.target.tagName === 'rect' && e.target.getAttribute('fill') === 'transparent')
      dragging.current = { kind: 'pan', ox: e.clientX - view.tx, oy: e.clientY - view.ty };
  }
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    function onWheel(e) {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setView(v => {
        const ns = Math.min(3, Math.max(0.2, v.scale * delta));
        return { scale: +ns.toFixed(3), tx: mx - (mx - v.tx) * (ns / v.scale), ty: my - (my - v.ty) * (ns / v.scale) };
      });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function onSvgMouseMove(e) {
    const d = dragging.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView(v => ({ ...v, tx: e.clientX - d.ox, ty: e.clientY - d.oy }));
    } else {
      const { x, y } = svgPoint(e);
      const gx = (x - view.tx) / view.scale - d.ox;
      const gy = (y - view.ty) / view.scale - d.oy;
      setNodePos(prev => ({ ...prev, [d.wc]: { x: gx, y: gy } }));
    }
  }
  function onSvgMouseUp() {
    if (!dragging.current) return;
    if (dragging.current.kind === 'node') {
      const key = 'flowops_nodepos_' + [...new Set(routing.map(r => r.workcenter))].sort().join(',');
      setNodePos(prev => { try { localStorage.setItem(key, JSON.stringify(prev)); } catch(e) {} return prev; });
    }
    dragging.current = null;
  }
  function resetLayout() {
    const key = 'flowops_nodepos_' + [...new Set(routing.map(r => r.workcenter))].sort().join(',');
    try { localStorage.removeItem(key); } catch(e) {}
    setNodePos({});
  }

  // ── Fit view do bounding box aktywnych węzłów ─────────────────────────────────
  function fitView() {
    const el = svgRef.current;
    if (!el) return;
    const visiblePositions = Object.entries(allPositions)
      .filter(([wc]) => (flowData.nodeVolumes[wc] || 0) > 0)
      .map(([, pos]) => pos);
    if (!visiblePositions.length) return;
    const { width, height } = el.getBoundingClientRect();
    if (!width || !height) return;
    const NODE_R = 50; // margines na promień węzła + etykietę
    const xs = visiblePositions.map(p => p.x);
    const ys = visiblePositions.map(p => p.y);
    const minX = Math.min(...xs) - NODE_R;
    const maxX = Math.max(...xs) + NODE_R;
    const minY = Math.min(...ys) - NODE_R;
    const maxY = Math.max(...ys) + NODE_R;
    const contentW = maxX - minX || 1;
    const contentH = maxY - minY || 1;
    const PAD = 32;
    const scale = Math.min((width - PAD * 2) / contentW, (height - PAD * 2) / contentH, 1.2);
    const tx = (width  - contentW * scale) / 2 - minX * scale;
    const ty = (height - contentH * scale) / 2 - minY * scale;
    setView({ scale: +scale.toFixed(3), tx: +tx.toFixed(1), ty: +ty.toFixed(1) });
  }

  // Auto-fit przy zmianie okresu lub pierwszym załadowaniu danych
  useEffect(() => {
    const timer = setTimeout(fitView, 50); // poczekaj na render SVG
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveKey, baseLayout]);

  if (!fwdZP.length || !routing.length)
    return <EmptyState icon="🌊" title="Brak planu produkcji" sub="Przelicz harmonogram aby zobaczyć przepływy" />;

  return (
    <div>
      {/* ── Controls row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>

        {/* Granularity */}
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
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {periodKeys.map(k => (
            <button key={k} type="button"
              style={{ ...s.btn(k === effectiveKey), fontSize: 10, padding: '3px 8px' }}
              onClick={() => setSelectedKey(k)}>
              {k}
            </button>
          ))}
          {!periodKeys.length && (
            <span style={{ fontSize: 11, color: T.text3 }}>Brak zaplanowanych operacji</span>
          )}
        </div>

        {/* Filtry zewnętrzne */}
        {heatmapFilter && (
          <button style={{ ...s.btn(true), fontSize: 11, padding: '4px 10px' }}
            onClick={() => onHeatmapFilterChange && onHeatmapFilterChange(null)}>
            📊 {heatmapFilter.wc2}{heatmapFilter.wc ? ` › ${heatmapFilter.wc}` : ''}{heatmapFilter.date ? ` × ${heatmapFilter.date}` : ''} — wyczyść
          </button>
        )}
        {selectedDate && !heatmapFilter && (
          <button style={{ ...s.btn(true), fontSize: 11, padding: '4px 10px' }}
            onClick={() => { onDateSelect && onDateSelect(null); onWCSelect && onWCSelect(null); }}>
            📅 {selectedDate}{selectedWC ? ` · ${selectedWC}` : ''} — wyczyść
          </button>
        )}
        {selectedWC && !selectedDate && !heatmapFilter && (
          <button style={{ ...s.btn(true), fontSize: 11, padding: '4px 10px' }}
            onClick={() => onWCSelect && onWCSelect(null)}>
            🔧 {selectedWC} — wyczyść
          </button>
        )}

        {/* Zoom */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button style={{ ...s.btn(false), fontSize: 13, padding: '4px 11px', fontWeight: 600 }}
            onClick={() => setView(v => ({ ...v, scale: Math.max(0.25, +(v.scale - 0.15).toFixed(2)) }))}>−</button>
          <span style={{ fontSize: 12, color: T.text2, minWidth: 38, textAlign: 'center' }}>{Math.round(view.scale * 100)}%</span>
          <button style={{ ...s.btn(false), fontSize: 13, padding: '4px 11px', fontWeight: 600 }}
            onClick={() => setView(v => ({ ...v, scale: Math.min(3, +(v.scale + 0.15).toFixed(2)) }))}>+</button>
          <button style={{ ...s.btn(false), fontSize: 11, padding: '4px 10px' }}
            onClick={fitView}>⊡ Fit</button>
          <button style={{ ...s.btn(false), fontSize: 11, padding: '4px 10px' }} onClick={resetLayout}>↺ Reset</button>
        </div>
      </div>

      {/* ── Legenda inline (kompaktowa) ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: T.text3 }}>
        <span>📦 wolumen</span>
        <span>🕐 śr. czas op.</span>
        <span style={{ color: T.border2 }}>|</span>
        {activeProducts.map((p, i) => (
          <span key={p} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span style={{ width: 16, height: 3, borderRadius: 2, background: PALETTE[i % PALETTE.length], display: 'inline-block' }} />
            <span style={{ color: T.text2 }}>{p}</span>
          </span>
        ))}
        {effectiveKey && periodZpIds.size === 0 && (
          <span style={{ color: T.warn, marginLeft: 8 }}>Brak ZP w wybranym okresie</span>
        )}
      </div>

      {/* ── SVG canvas ── */}
      <div style={{ background: '#090b0e', borderRadius: 10, overflow: 'hidden',
        height: 'calc(100vh - 220px)', minHeight: 400,
        border: `1px solid ${T.border}`, position: 'relative' }}>
        <svg ref={svgRef} width="100%" height="100%"
          style={{ display: 'block', cursor: dragging.current?.kind === 'pan' ? 'grabbing' : 'default', userSelect: 'none' }}
          onMouseMove={onSvgMouseMove} onMouseUp={onSvgMouseUp} onMouseLeave={onSvgMouseUp}
          onMouseDown={onSvgBgMouseDown}>
          <rect x="0" y="0" width="100%" height="100%" fill="transparent"/>
          <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
            <defs>
              {products.map((p, i) => (
                <marker key={p} id={`sarr-${i}`}
                  viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M1 1.5L8 5L1 8.5" fill="none"
                    stroke={PALETTE[i % PALETTE.length]} strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </marker>
              ))}
            </defs>

            {/* ── Edges ── */}
            {flowData.connections.map(conn => {
              const fromPos = allPositions[conn.from], toPos = allPositions[conn.to];
              if (!fromPos || !toPos) return null;
              if (!flowData.nodeVolumes[conn.from] || !flowData.nodeVolumes[conn.to]) return null;
              const prodIdx     = products.indexOf(conn.product);
              const col         = PALETTE[prodIdx % PALETTE.length];
              const edgeKey     = `${conn.from}->${conn.to}`;
              const prodsOnEdge = edgeProdCount[edgeKey] || [conn.product];
              const myIdx       = prodsOnEdge.indexOf(conn.product);
              const { d, mx, my } = edgePath(fromPos, toPos, myIdx, prodsOnEdge.length);
              const isHov  = hoveredWC === conn.from || hoveredWC === conn.to;
              const thick  = 1.5 + (flowData.edgeTotals[edgeKey] / maxVolume) * 12;
              return (
                <g key={`${conn.product}-${conn.from}-${conn.to}`}>
                  {isHov && <path d={d} fill="none" stroke={col} strokeWidth={thick + 6} opacity="0.12" strokeLinecap="round"/>}
                  <path d={d} fill="none" stroke={col} strokeWidth={thick} strokeLinecap="round"
                    opacity={hoveredWC && !isHov ? 0.1 : 0.55}
                    markerEnd={`url(#sarr-${prodIdx % PALETTE.length})`}/>
                </g>
              );
            })}

            {/* ── Edge labels ── */}
            {Object.entries(flowData.edgeTotals).map(([key, vol]) => {
              const [from, to] = key.split('->');
              const fp = allPositions[from], tp = allPositions[to];
              if (!fp || !tp) return null;
              if (!flowData.nodeVolumes[from] || !flowData.nodeVolumes[to]) return null;
              const isHov = hoveredWC === from || hoveredWC === to;
              if (hoveredWC && !isHov) return null;
              const arcLift = Math.abs(tp.x - fp.x) > 250 ? -Math.abs(tp.x - fp.x) * 0.25 : 0;
              return (
                <g key={`lbl-${key}`}>
                  <rect x={(fp.x+tp.x)/2-24} y={(fp.y+tp.y)/2+arcLift-10} width="48" height="18" rx="5"
                    fill="#090b0e" stroke={T.border2} strokeWidth="0.5"/>
                  <text x={(fp.x+tp.x)/2} y={(fp.y+tp.y)/2+arcLift+4} textAnchor="middle"
                    fontSize="10" fontWeight="600" fill={T.text2} fontFamily="monospace">
                    {vol} szt.
                  </text>
                </g>
              );
            })}

            {/* ── Nodes ── */}
            {Object.entries(allPositions).map(([wc, pos]) => {
              const volume = flowData.nodeVolumes[wc] || 0;
              if (volume === 0) return null;
              const isHov  = hoveredWC === wc;
              const r      = 38 + (volume / maxNodeVol) * 12;
              const dimmed = hoveredWC && !isHov ? 0.2 : 1;
              const ct     = flowData.planCt[wc];
              const avgCtMin = ct?.count ? (ct.totalMin / ct.count).toFixed(0) : null;
              const op = routing.find(ro => String(ro.workcenter) === String(wc));
              const opLabel = op ? op.operation : wc;
              const short = opLabel.length > 18 ? opLabel.substring(0, 17) + '…' : opLabel;
              return (
                <g key={wc}
                  style={{ cursor: 'grab', opacity: dimmed, transition: dragging.current ? 'none' : 'opacity 0.15s' }}
                  onMouseDown={e => onNodeMouseDown(e, wc)}
                  onMouseEnter={() => { if (!dragging.current) setHoveredWC(wc); }}
                  onMouseLeave={() => { if (!dragging.current) setHoveredWC(null); }}>
                  {isHov && <circle cx={pos.x} cy={pos.y} r={r + 7} fill="none" stroke={T.accent} strokeWidth="1.5" opacity="0.4"/>}
                  <circle cx={pos.x} cy={pos.y} r={r} fill="#13161b" stroke={isHov ? T.accent : T.border2} strokeWidth={isHov ? 2 : 1.5}/>
                  <text x={pos.x} y={pos.y - 12} textAnchor="middle"
                    fontSize="14" fontWeight="800" fill={T.text} style={{ pointerEvents: 'none' }}>{wc}</text>
                  <text x={pos.x} y={pos.y + 4} textAnchor="middle"
                    fontSize="10" fill={T.text3} style={{ pointerEvents: 'none' }}>{short}</text>
                  {avgCtMin && (
                    <text x={pos.x} y={pos.y + 18} textAnchor="middle"
                      fontSize="11" fontWeight="600" fill={T.accent} fontFamily="monospace"
                      style={{ pointerEvents: 'none' }}>{avgCtMin} min</text>
                  )}
                  <rect x={pos.x - 34} y={pos.y + r + 5} width="68" height="17"
                    rx="4" fill="#0d0f12" stroke={T.border} strokeWidth="0.5"/>
                  <text x={pos.x} y={pos.y + r + 16} textAnchor="middle"
                    fontSize="11" fontWeight="600" fill={T.text3} fontFamily="monospace"
                    style={{ pointerEvents: 'none' }}>{volume} szt.</text>
                </g>
              );
            })}
          </g>
        </svg>
        {hoveredWC && flowData.nodeVolumes[hoveredWC] && (() => {
          const wc  = hoveredWC;
          const vol = flowData.nodeVolumes[wc];
          const ct  = flowData.planCt[wc];
          const avgCt  = ct?.count ? (ct.totalMin / ct.count).toFixed(1) : '—';
          const totalH = ct?.totalMin ? (ct.totalMin / 60).toFixed(1) : '—';
          const op = routing.find(ro => String(ro.workcenter) === String(wc));
          const zpList = periodZP.filter(z =>
            (globalLookups.routingByProduct[z.product] || []).some(ro => String(ro.workcenter) === String(wc))
          );
          return (
            <div style={{ position: 'absolute', bottom: 16, right: 16,
              background: 'rgba(10,12,15,0.96)', border: `1px solid ${T.border2}`,
              borderRadius: 10, padding: '10px 14px', fontSize: 11,
              pointerEvents: 'none', zIndex: 10, minWidth: 200, maxWidth: 300,
              boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}>
              {/* Nagłówek: nr gniazda + opis */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 800, fontSize: 15, color: T.accent }}>{wc}</span>
                {op && <span style={{ color: T.text2, fontSize: 11 }}>{op.operation}</span>}
              </div>
              {/* Statystyki */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', marginBottom: 8, color: T.text3 }}>
                <span>wolumen</span><span style={{ color: T.text, fontWeight: 600, fontFamily: 'monospace' }}>{vol} szt.</span>
                <span>śr. ct</span><span style={{ color: T.accent, fontWeight: 600, fontFamily: 'monospace' }}>{avgCt} min</span>
                <span>łącznie</span><span style={{ color: T.text2, fontFamily: 'monospace' }}>{totalH} h</span>
              </div>
              {/* Lista ZP */}
              {zpList.length > 0 && (<>
                <div style={{ color: T.text3, fontSize: 10, marginBottom: 4, borderTop: `1px solid ${T.border}`, paddingTop: 6 }}>
                  ZP ({zpList.length}):
                </div>
                <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {zpList.map(z => (
                    <div key={z.zp_id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ color: T.accent, fontFamily: 'monospace', fontSize: 10, flexShrink: 0 }}>{z.zp_id}</span>
                      <span style={{ color: T.text2, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{z.product}</span>
                      <span style={{ color: T.text3, fontFamily: 'monospace', fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>{z.volume} szt.</span>
                    </div>
                  ))}
                </div>
              </>)}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
