import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { T, PALETTE, s, tocColor, uStatus } from '../../constants/theme.js';
import { localDateStr, fmtDt, computeLoads, getAvail } from '../../utils/scheduler.js';
import { Dot } from '../common/Dot.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
import { DatePicker } from '../common/DatePicker.jsx';
export function SankeyTab({ routing, zp, globalLookups, wcSchedule }) {
  
  const dates    = useMemo(() => [...new Set(zp.map(z => z.due_date))].sort(), [zp]);
  const products = useMemo(() => [...new Set(routing.map(r => r.product))], [routing]);
  const [date,       setDate]       = useState(dates[0] || "");
  const [hoveredWC,  setHoveredWC]  = useState(null);
  const [nodePos,    setNodePos]     = useState({});
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const dragging  = useRef(null);   // { kind:'node'|'pan', wc?, ox, oy }
  const svgRef    = useRef(null);

  useEffect(() => { if (!date && dates.length) setDate(dates[0]); }, [dates]);

  // ── BASE LAYOUT (auto, product-lane Y) ──────────────────────────────
  const baseLayout = useMemo(() => {
    if (!routing.length) return { positions: {}, SVG_W: 800, SVG_H: 400 };
    const allWCs   = [...new Set(routing.map(r => r.workcenter))];
    const numProds = products.length;
    const PAD_X    = 90, PAD_Y = 80, COL_W = 190, LANE_H = 130;
    const SVG_H    = PAD_Y * 2 + Math.max(numProds - 1, 0) * LANE_H;
    const prodLaneY = {};
    products.forEach((p, i) => {
      prodLaneY[p] = numProds === 1 ? SVG_H / 2 : PAD_Y + i * LANE_H;
    });
    const wcMinSeq = {};
    allWCs.forEach(wc => {
      const seqs = routing.filter(r => r.workcenter === wc).map(r => r.sequence);
      wcMinSeq[wc] = Math.min(...seqs);
    });
    const colKeys = [...new Set(Object.values(wcMinSeq))].sort((a, b) => a - b);
    const SVG_W   = PAD_X * 2 + Math.max(colKeys.length - 1, 0) * COL_W;
    const positions = {};
    allWCs.forEach(wc => {
      const users  = products.filter(p => routing.some(r => r.product === p && r.workcenter === wc));
      const avgY   = users.reduce((s, p) => s + prodLaneY[p], 0) / (users.length || 1);
      const colIdx = colKeys.indexOf(wcMinSeq[wc]);
      const x      = PAD_X + colIdx * COL_W;
      const op     = routing.find(r => r.workcenter === wc);
      positions[wc] = { x, y: avgY, label: op ? op.operation.substring(0, 16) : wc };
    });
    return { positions, SVG_W, SVG_H };
  }, [routing, products]);

  // ── LOAD SAVED POSITIONS from localStorage ──────────────────────────
  useEffect(() => {
    if (!routing.length) return;
    const key = "flowops_nodepos_" + [...new Set(routing.map(r => r.workcenter))].sort().join(",");
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "{}");
      if (Object.keys(saved).length) setNodePos(saved);
    } catch(e) {}
  }, [routing]);

  // Merge base layout with drag overrides
  const allPositions = useMemo(() => {
    const merged = {};
    Object.entries(baseLayout.positions).forEach(([wc, base]) => {
      merged[wc] = nodePos[wc]
        ? { ...base, x: nodePos[wc].x, y: nodePos[wc].y }
        : { ...base };
    });
    return merged;
  }, [baseLayout, nodePos]);

  const SVG_W = baseLayout.SVG_W;
  const SVG_H = baseLayout.SVG_H;

  // ── FLOW DATA ────────────────────────────────────────────────────────
  const flowData = useMemo(() => {
    if (!date) return { connections: [], edgeTotals: {}, nodeVolumes: {}, loads: {} };
    const zpForDate = zp.filter(z => z.due_date === date);
    const loads     = computeLoads(globalLookups.routingByProduct, zpForDate, wcSchedule, date);
    const nodeVolumes = {}, productConns = {};
    zpForDate.forEach(order => {
      const ops = globalLookups.routingByProduct[order.product] || [];
      ops.forEach((op, idx) => {
        nodeVolumes[op.workcenter] = (nodeVolumes[op.workcenter] || 0) + order.volume;
        if (idx < ops.length - 1) {
          const next = ops[idx + 1];
          const key  = `${order.product}||${op.workcenter}->${next.workcenter}`;
          if (!productConns[key]) productConns[key] = { product: order.product, from: op.workcenter, to: next.workcenter, volume: 0 };
          productConns[key].volume += order.volume;
        }
      });
    });
    const edgeTotals = {};
    Object.values(productConns).forEach(c => {
      const k = `${c.from}->${c.to}`;
      edgeTotals[k] = (edgeTotals[k] || 0) + c.volume;
    });
    return { connections: Object.values(productConns), edgeTotals, nodeVolumes, loads };
  }, [zp.length, date]);

  const maxVolume  = Math.max(...Object.values(flowData.edgeTotals), 1);
  const maxNodeVol = Math.max(...Object.values(flowData.nodeVolumes), 1);
  const maxUtil    = Object.values(flowData.loads).length
    ? Math.max(...Object.values(flowData.loads).map(v => v.util)) : 0;

  // ── EDGE PATH (cubic bezier, arc for skip edges) ─────────────────────
  function edgePath(fromPos, toPos, prodIdx, totalOnEdge) {
    const R   = 34;
    const dx  = toPos.x - fromPos.x, dy = toPos.y - fromPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux  = dx / dist, uy = dy / dist;
    const x1  = fromPos.x + ux * R, y1 = fromPos.y + uy * R;
    const x2  = toPos.x  - ux * R, y2 = toPos.y  - uy * R;
    const spread = totalOnEdge > 1 ? 14 : 0;
    const off    = totalOnEdge > 1 ? (prodIdx - (totalOnEdge - 1) / 2) * spread : 0;
    const px = -uy * off, py = ux * off;
    const arcLift = Math.abs(toPos.x - fromPos.x) > 250 ? -Math.abs(toPos.x - fromPos.x) * 0.25 : 0;
    const mx = (x1 + x2) / 2 + px, my = (y1 + y2) / 2 + py + arcLift;
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

  function nodeStroke(u) {
    return u <= 0.85 ? T.ok : u <= 1.0 ? T.warn : T.bn;
  }

  // ── DRAG HANDLERS ────────────────────────────────────────────────────
  function svgPoint(e) {
    // Returns cursor position in SVG viewport pixels (before our g transform)
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ── NODE DRAG ────────────────────────────────────────────────────
  function onNodeMouseDown(e, wc) {
    e.stopPropagation();
    const { x, y } = svgPoint(e);
    const cur = allPositions[wc];
    dragging.current = { kind: "node", wc, ox: x - cur.x, oy: y - cur.y };
  }

  // ── PAN (drag on background) ──────────────────────────────────────
  function onSvgBgMouseDown(e) {
    if (e.target.tagName === "rect" && e.target.getAttribute("fill") === "transparent") {
      dragging.current = { kind: "pan", ox: e.clientX - view.tx, oy: e.clientY - view.ty };
    }
  }

  // ── WHEEL ZOOM (zoom toward cursor) ───────────────────────────────
  function onWheel(e) {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect  = svg.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView(v => {
      const ns = Math.min(3, Math.max(0.2, v.scale * delta));
      // zoom toward cursor: adjust tx/ty so point under cursor stays fixed
      return {
        scale: +ns.toFixed(3),
        tx: mx - (mx - v.tx) * (ns / v.scale),
        ty: my - (my - v.ty) * (ns / v.scale),
      };
    });
  }

  // ── UNIFIED MOUSE MOVE ────────────────────────────────────────────
  function onSvgMouseMove(e) {
    if (!dragging.current) return;
    if (dragging.current.kind === "pan") {
      const nx = e.clientX - dragging.current.ox;
      const ny = e.clientY - dragging.current.oy;
      setView(v => ({ ...v, tx: nx, ty: ny }));
    } else {
      // node drag — coordinates must be in SVG space (before transform)
      const { x, y } = svgPoint(e);
      // convert screen point to graph coords (undo view transform)
      const gx = (x - view.tx) / view.scale;
      const gy = (y - view.ty) / view.scale;
      const { wc, ox, oy } = dragging.current;
      setNodePos(prev => ({ ...prev, [wc]: { x: gx - ox, y: gy - oy } }));
    }
  }

  function onSvgMouseUp() {
    if (!dragging.current) return;
    if (dragging.current.kind === "node") {
      const key = "flowops_nodepos_" + [...new Set(routing.map(r => r.workcenter))].sort().join(",");
      setNodePos(prev => {
        try { localStorage.setItem(key, JSON.stringify(prev)); } catch(e) {}
        return prev;
      });
    }
    dragging.current = null;
  }

  function resetLayout() {
    const key = "flowops_nodepos_" + [...new Set(routing.map(r => r.workcenter))].sort().join(",");
    try { localStorage.removeItem(key); } catch(e) {}
    setNodePos({});
  }

  if (!dates.length) return <EmptyState icon="🌊" title="Brak danych" sub="Wgraj pliki CSV" />;

  return (
    <div>
      {/* Controls row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        {/* Przyciski dat — kolory wg statusu bottleneck */}
      <DatePicker dates={dates} selected={date} onChange={setDate} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <button style={{ ...s.btn(false), fontSize: 13, padding: "4px 11px", fontWeight: 600 }}
            onClick={() => setView(v => ({ ...v, scale: Math.max(0.25, +(v.scale - 0.15).toFixed(2)) }))}>−</button>
          <span style={{ fontSize: 12, color: T.text2, minWidth: 38, textAlign: "center" }}>{Math.round(view.scale * 100)}%</span>
          <button style={{ ...s.btn(false), fontSize: 13, padding: "4px 11px", fontWeight: 600 }}
            onClick={() => setView(v => ({ ...v, scale: Math.min(3, +(v.scale + 0.15).toFixed(2)) }))}>+</button>
          <button style={{ ...s.btn(false), fontSize: 11, padding: "4px 10px" }}
            onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}>⊡ Fit</button>
          <button style={{ ...s.btn(false), fontSize: 11, padding: "4px 10px" }} onClick={resetLayout}>↺ Reset</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 14, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 14, fontSize: 12, color: T.text2, background: T.surface, padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, flexWrap: "wrap" }}>
          <span style={{ display:"flex", alignItems:"center", gap:5 }}><Dot color={T.ok}   size={7}/> OK ≤85%</span>
          <span style={{ display:"flex", alignItems:"center", gap:5 }}><Dot color={T.warn} size={7}/> Uwaga 86–100%</span>
          <span style={{ display:"flex", alignItems:"center", gap:5 }}><Dot color={T.bn}   size={7}/> BN &gt;100%</span>
          <span style={{ color: T.text3 }}>· Grubość = wolumen · Kolor = produkt · Przeciągnij węzeł</span>
        </div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {products.map((p, i) => (
            <span key={p} style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:T.text2 }}>
              <span style={{ width:22, height:3, borderRadius:2, background:PALETTE[i%PALETTE.length], display:"inline-block" }}/>
              {p}
            </span>
          ))}
        </div>
      </div>

      <div style={{ ...s.card, padding: 0, overflow: "hidden" }}>
        <div style={{ background: "#090b0e", borderRadius: 12, overflow: "hidden", height: Math.max(SVG_H + 40, 420) }}>
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            style={{ display: "block", cursor: dragging.current?.kind === "pan" ? "grabbing" : "default", userSelect: "none" }}
            onMouseMove={onSvgMouseMove}
            onMouseUp={onSvgMouseUp}
            onMouseLeave={onSvgMouseUp}
            onMouseDown={onSvgBgMouseDown}
            onWheel={onWheel}
          >
            {/* invisible bg for pan */}
            <rect x="0" y="0" width="100%" height="100%" fill="transparent"/>
            <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
            <defs>
              {products.map((p, i) => (
                <marker key={p} id={`arr-${i}`}
                  viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M1 1.5L8 5L1 8.5" fill="none"
                    stroke={PALETTE[i % PALETTE.length]}
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </marker>
              ))}
            </defs>

            {/* ── EDGES ── */}
            {flowData.connections.map(conn => {
              const fromPos = allPositions[conn.from];
              const toPos   = allPositions[conn.to];
              if (!fromPos || !toPos) return null;
              const prodIdx     = products.indexOf(conn.product);
              const col         = PALETTE[prodIdx % PALETTE.length];
              const edgeKey     = `${conn.from}->${conn.to}`;
              const prodsOnEdge = edgeProdCount[edgeKey] || [conn.product];
              const myIdx       = prodsOnEdge.indexOf(conn.product);
              const { d, mx, my } = edgePath(fromPos, toPos, myIdx, prodsOnEdge.length);
              const isHov = hoveredWC === conn.from || hoveredWC === conn.to;
              const thick = 1.5 + (flowData.edgeTotals[edgeKey] / maxVolume) * 12;
              return (
                <g key={`${conn.product}-${conn.from}-${conn.to}`}>
                  {isHov && <path d={d} fill="none" stroke={col} strokeWidth={thick+6} opacity="0.12" strokeLinecap="round"/>}
                  <path d={d} fill="none" stroke={col} strokeWidth={thick} strokeLinecap="round"
                    opacity={hoveredWC && !isHov ? 0.1 : 0.55}
                    markerEnd={`url(#arr-${prodIdx % PALETTE.length})`}/>
                </g>
              );
            })}

            {/* ── EDGE LABELS ── */}
            {Object.entries(flowData.edgeTotals).map(([key, vol]) => {
              const [from, to] = key.split("->").map(s => s.trim());
              const fp = allPositions[from], tp = allPositions[to];
              if (!fp || !tp) return null;
              const isHov = hoveredWC === from || hoveredWC === to;
              if (hoveredWC && !isHov) return null;
              const mx = (fp.x + tp.x) / 2, my = (fp.y + tp.y) / 2;
              const arcLift = Math.abs(tp.x - fp.x) > 250 ? -Math.abs(tp.x - fp.x) * 0.25 : 0;
              return (
                <g key={`lbl-${key}`}>
                  <rect x={mx-24} y={my+arcLift-10} width="48" height="18" rx="5"
                    fill="#090b0e" stroke={T.border2} strokeWidth="0.5"/>
                  <text x={mx} y={my+arcLift+4} textAnchor="middle"
                    fontSize="10" fontWeight="600" fill={T.text2} fontFamily="monospace">
                    {vol} szt.
                  </text>
                </g>
              );
            })}

            {/* ── NODES ── */}
            {Object.entries(allPositions).map(([wc, pos]) => {
              const volume = flowData.nodeVolumes[wc] || 0;
              if (volume === 0) return null;
              const wcData = flowData.loads[wc] || { util: 0 };
              const u      = wcData.util;
              const stroke = nodeStroke(u);
              const isBn   = Math.abs(u - maxUtil) < 0.001 && u > 0.85;
              const isHov  = hoveredWC === wc;
              const r      = 28 + (volume / maxNodeVol) * 10;
              const uPct   = Math.round(u * 100);
              const dimmed = hoveredWC && !isHov ? 0.25 : 1;
              return (
                <g key={wc}
                  style={{ cursor: "grab", opacity: dimmed, transition: dragging.current ? "none" : "opacity 0.15s" }}
                  onMouseDown={e => onNodeMouseDown(e, wc)}
                  onMouseEnter={() => { if (!dragging.current) setHoveredWC(wc); }}
                  onMouseLeave={() => { if (!dragging.current) setHoveredWC(null); }}
                >
                  {isBn && <circle cx={pos.x} cy={pos.y} r={r+9}
                    fill="none" stroke={T.crit} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.7"/>}
                  {isHov && <circle cx={pos.x} cy={pos.y} r={r+5}
                    fill="none" stroke={stroke} strokeWidth="1" opacity="0.35"/>}
                  <circle cx={pos.x} cy={pos.y} r={r}
                    fill={isBn ? "rgba(127,29,29,0.4)" : "#13161b"}
                    stroke={stroke} strokeWidth={isBn ? 2.5 : 1.5}/>
                  <text x={pos.x} y={pos.y-10} textAnchor="middle"
                    fontSize="13" fontWeight="700" fill={T.text} style={{pointerEvents:"none"}}>{wc}</text>
                  <text x={pos.x} y={pos.y+4} textAnchor="middle"
                    fontSize="9" fill={T.text3} style={{pointerEvents:"none"}}>
                    {pos.label.length > 14 ? pos.label.substring(0,13)+"…" : pos.label}
                  </text>
                  <text x={pos.x} y={pos.y+17} textAnchor="middle"
                    fontSize="10" fontWeight="700" fill={stroke}
                    fontFamily="monospace" style={{pointerEvents:"none"}}>{uPct}%</text>
                  <rect x={pos.x-32} y={pos.y+r+6} width="64" height="16"
                    rx="4" fill="#0d0f12" stroke={T.border} strokeWidth="0.5"/>
                  <text x={pos.x} y={pos.y+r+17} textAnchor="middle"
                    fontSize="10" fontWeight="600" fill={T.text3}
                    fontFamily="monospace" style={{pointerEvents:"none"}}>{volume} szt.</text>
                </g>
              );
            })}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}


// ─── GŁÓWNY KOMPONENT APKI ───────────────────────────────────────────────────
// ─── ZAKŁADKA: GRAFIK ZASOBÓW ────────────────────────────────────────────────
// sched (wcSchedule) mieszka w App — GrafikTab tylko go wyświetla i edytuje
// Format sched: { "G-01": [pon,wt,sr,czw,pt,sob,nd] } — 7 elementów, idx 0=pon