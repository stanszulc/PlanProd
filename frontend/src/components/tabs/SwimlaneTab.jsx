import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { T, PALETTE, s, tocColor, uStatus } from '../../constants/theme.js';
import { localDateStr, fmtDt, computeLoads, getAvail } from '../../utils/scheduler.js';
import { Dot } from '../common/Dot.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
import { DatePicker } from '../common/DatePicker.jsx';
export function SwimlaneTab({ routing, zp, globalLookups, wcSchedule }) {
  const dates = useMemo(() => [...new Set(zp.map(z => z.due_date))].sort(), [zp]);
  const [date, setDate] = useState(dates[0] || "");
  const allWC = useMemo(() => [...new Set(routing.map(r => r.workcenter))].sort(), [routing]);
  
  const zpForDate = useMemo(() => zp.filter(z => z.due_date === date), [zp, date]);
  const loads = useMemo(() => date ? computeLoads(globalLookups.routingByProduct, zpForDate, wcSchedule, date) : {}, [globalLookups.routingByProduct, zpForDate, wcSchedule, date]);
  const maxUtil = Object.values(loads).length ? Math.max(...Object.values(loads).map(v => v.util)) : 0;
  
  if (!dates.length) return <EmptyState icon="🏊" title="Brak danych" sub="Wgraj pliki CSV" />;

  const LANE_H = 80, LABEL_W = 120, CAP_W = 500;
  const svgW = LABEL_W + CAP_W + 80;
  const svgH = allWC.length * LANE_H;

  return (
    <div>
      <DatePicker dates={dates} selected={date} onChange={setDate} />
      <div style={{ ...s.card, padding: 0, overflowX: "auto" }}>
        <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block" }}>
          {allWC.map((w, wi) => {
            const y = wi * LANE_H;
            const wcData = loads[w] || { util: 0, cap: 8, load: 0, contrib: {} };
            const isBn = Math.abs(wcData.util - maxUtil) < 0.001 && wcData.util > 0.85;
            const scale = wcData.load > 0 ? Math.min(CAP_W / (wcData.cap * 1.4), CAP_W / (wcData.load * 1.05)) : CAP_W / wcData.cap;
            let curX = LABEL_W + 10;
            return (
              <g key={w}>
                <rect x="0" y={y} width={svgW} height={LANE_H} fill={wi % 2 === 0 ? T.surface : T.surface2} />
                <text x="20" y={y + LANE_H / 2 + 4} fontSize="13" fontWeight="700" fill={isBn ? T.bn : T.text}>{w} ({wcData.cap}h)</text>
                <line x1={LABEL_W + 10 + wcData.cap * scale} y1={y + 5} x2={LABEL_W + 10 + wcData.cap * scale} y2={y + LANE_H - 5} stroke="#555c6b" strokeDasharray="4 3" />
                {Object.entries(wcData.contrib).map(([zpid, v]) => {
                  const col = globalLookups.zpColorMap[zpid] || T.text3;
                  const w_px = v.h * scale;
                  const block = (
                    <g key={zpid}>
                      <rect x={curX} y={y + 15} width={w_px} height={LANE_H - 30} rx="4" fill={col} opacity="0.85" />
                      {w_px > 35 && <text x={curX + w_px / 2} y={y + LANE_H / 2 + 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="white">{zpid}</text>}
                    </g>
                  );
                  curX += w_px + 2;
                  return block;
                })}
                <text x={curX + 10} y={y + LANE_H / 2 + 4} fontSize="11" fontWeight="700" fill={T.text2}>{Math.round(wcData.util * 100)}%</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ─── ZAKŁADKA: GANTT ─────────────────────────────────────────────────────────