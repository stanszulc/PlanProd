import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { T, PALETTE, s, tocColor, uStatus } from '../../constants/theme.js';
import { localDateStr, fmtDt, computeLoads, getAvail } from '../../utils/scheduler.js';
import { Dot } from '../common/Dot.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
export function RoutingTab({ routing, zp, globalLookups }) {
  const products = useMemo(() => [...new Set(routing.map(r => r.product))], [routing]);
  const dates = useMemo(() => [...new Set(zp.map(z => z.due_date))].sort(), [zp]);
  
  const firstDateZP = useMemo(() => dates.length ? zp.filter(z => z.due_date === dates[0]) : [], [zp, dates]);
  const wcLoads = useMemo(() => dates.length ? computeLoads(globalLookups.routingByProduct, firstDateZP) : {}, [dates.join(','), firstDateZP.length]);
  const maxUtil = Object.values(wcLoads).length ? Math.max(...Object.values(wcLoads).map(v => v.util)) : 0;
  
  if (!routing.length) return <EmptyState icon="🔀" title="Brak danych" sub="Wgraj routing.csv" />;

  const BW = 140, BH = 72, GAP = 48, ROW_H = 130, LEFT = 120;
  const maxOps = Math.max(...products.map(p => (globalLookups.routingByProduct[p] || []).length));
  const svgW = LEFT + maxOps * (BW + GAP) + 40;
  const svgH = products.length * ROW_H + 60;

  return (
    <div style={{ ...s.card, overflowX: "auto" }}>
      <div style={s.cardTitle}>Wizualizacja procesów technologicznych (Routingu)</div>
      <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block" }}>
        <defs>
          <marker id="ra" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1L9 5L1 9" fill="none" stroke="#555c6b" strokeWidth="1.5" />
          </marker>
        </defs>
        {products.map((p, pi) => {
          const rowY = 30 + pi * ROW_H;
          const boxY = rowY + (ROW_H - 30 - BH) / 2;
          const ops = globalLookups.routingByProduct[p] || [];
          const col = PALETTE[globalLookups.productIndexMap[p] % PALETTE.length];
          return (
            <g key={p}>
              {pi > 0 && <line x1="0" y1={rowY - 10} x2={svgW} y2={rowY - 10} stroke={T.border} />}
              <text x={LEFT - 25} y={boxY + BH / 2} fontSize="13" fontWeight="700" fill={col} textAnchor="middle" dominantBaseline="central">{p}</text>
              {ops.map((op, oi) => {
                const boxX = LEFT + oi * (BW + GAP);
                const wcData = wcLoads[op.workcenter] || { util: 0 };
                const u = wcData.util;
                const isBn = Math.abs(u - maxUtil) < 0.001 && u > 0.85;
                return (
                  <g key={oi}>
                    <rect x={boxX} y={boxY} width={BW} height={BH} rx="8" fill={T.surface2} stroke={isBn ? T.bn : T.border2} strokeWidth={isBn ? 2 : 1} />
                    <rect x={boxX} y={boxY} width={BW} height={4} fill={col} rx="2" />
                    <text x={boxX + BW / 2} y={boxY + 22} textAnchor="middle" fontSize="13" fontWeight="700" fill={T.text}>{op.workcenter}</text>
                    <text x={boxX + BW / 2} y={boxY + 40} textAnchor="middle" fontSize="10" fill={T.text2}>{op.operation}</text>
                    <text x={boxX + BW / 2} y={boxY + 58} textAnchor="middle" fontSize="10" fill={T.text3}>{op.ct_min} min</text>
                    {oi < ops.length - 1 && (
                      <line x1={boxX + BW + 2} y1={boxY + BH / 2} x2={boxX + BW + GAP - 4} y2={boxY + BH / 2} stroke="#555c6b" strokeWidth="1.5" markerEnd="url(#ra)" />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── ZAKŁADKA: SWIMLANE ──────────────────────────────────────────────────────