import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { T, PALETTE, s, tocColor, uStatus } from '../../constants/theme.js';
import { localDateStr, fmtDt, computeLoads, getAvail } from '../../utils/scheduler.js';
import { Dot } from '../common/Dot.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
export function HeatmapTab({ routing, zp, globalLookups, wcSchedule }) {
  const dates = useMemo(() => [...new Set(zp.map(z => z.due_date))].sort(), [zp.length]);
  const allWC = useMemo(() => [...new Set(routing.map(r => r.workcenter))].sort(), [routing.length]);
  
  const loadsCache = useMemo(() => {
    const c = {};
    dates.forEach(d => { 
      const zpForDate = zp.filter(z => z.due_date === d);
      c[d] = computeLoads(globalLookups.routingByProduct, zpForDate, wcSchedule, d); 
    });
    return c;
  }, [zp.length, dates.join(','), JSON.stringify(wcSchedule)]);

  if (!dates.length) return <EmptyState icon="🌡️" title="Brak danych" sub="Wgraj pliki CSV" />;

  function hmStyle(u) {
    if (u <= 0)   return { bg: T.surface2, color: T.text3 };
    if (u <= .85) return { bg: "rgba(34,197,94,0.12)",  color: "#22c55e" };
    if (u <= 1.0) return { bg: "rgba(245,158,11,0.15)", color: "#f59e0b" };
    if (u <= 1.1) return { bg: "rgba(249,115,22,0.15)", color: "#f97316" };
    if (u <= 1.3) return { bg: "rgba(239,68,68,0.15)",  color: "#ef4444" };
    return               { bg: "rgba(220,38,38,0.25)",  color: "#fca5a5" };
  }


  return (
    <div style={s.card}>
      <div style={s.cardTitle}>Obłożenie gniazd w czasie (Gniazdo x Termin)</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ padding: "0 16px 12px 0", textAlign: "left", fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: T.text3 }}>Gniazdo</th>
              {dates.map(d => (
                <th key={d} style={{ padding: "0 6px 12px", textTransform: "uppercase", color: T.text3, fontSize: 10 }}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allWC.map(w => (
              <tr key={w}>
                <td style={{ padding: "6px 16px 6px 0", fontWeight: 700, color: T.text, fontSize: 13 }}>{w}</td>
                {dates.map(d => {
                  const u = loadsCache[d]?.[w]?.util || 0;
                  const hs = hmStyle(u);
                  return (
                    <td key={d} style={{ padding: "4px" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 68, height: 28, borderRadius: 6, background: hs.bg, color: hs.color, fontSize: 11, fontWeight: 600, fontFamily: "monospace" }}>
                        {u > 0 ? `${Math.round(u * 100)}%` : "–"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── ZAKŁADKA: ROUTING (GRAF) ────────────────────────────────────────────────