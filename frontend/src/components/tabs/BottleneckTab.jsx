import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { T, PALETTE, s, tocColor, uStatus } from '../../constants/theme.js';
import { localDateStr, fmtDt, computeLoads, getAvail } from '../../utils/scheduler.js';
import { Dot } from '../common/Dot.jsx';
import { Bar } from '../common/Bar.jsx';
import { KpiCard } from '../common/KpiCard.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
export function BottleneckTab({ routing, zp, globalLookups, wcSchedule, subZP }) {
  const dates    = useMemo(() => [...new Set(zp.map(z => z.due_date))].sort(), [zp]);
  const allDates = useMemo(() => {
    const set = new Set(dates);
    if (subZP) subZP.forEach(s => {
      if (s.start_dt) set.add(localDateStr(new Date(s.start_dt)));
    });
    return [...set].sort();
  }, [dates.join(','), subZP ? subZP.length : 0]);

  const [date, setDate]  = useState(dates[0] || '');
  useEffect(() => { if (!date && dates.length) setDate(dates[0]); }, [dates.join(',')]);

  const products  = useMemo(() => [...new Set(routing.map(r => r.product))], [routing]);
  const zpForDate = useMemo(() => zp.filter(z => z.due_date === date), [zp.length, date]);
  const loads     = useMemo(() => {
    if (!date) return {};
    return computeLoads(globalLookups.routingByProduct, zpForDate, wcSchedule, date);
  }, [zpForDate.length, date, wcSchedule]);
  const entries   = useMemo(() => Object.entries(loads).sort((a,b) => b[1].util-a[1].util), [loads]);
  const maxU      = entries.length ? Math.max(...entries.map(([,v]) => v.util)) : 0;
  const bn        = entries[0]?.[0] || '–';

  if (!dates.length) return <EmptyState icon="📊" title="Brak danych" sub="Wgraj pliki w zakładce Import" />;

  const st = uStatus(maxU);

  // Kolor przycisku daty wg statusu (obliczamy tylko dla due_dates, lekko)
  function dateColor(d) {
    if (!dates.includes(d)) return { border: T.border, text: T.text3, bg: 'transparent' };
    const zpD = zp.filter(z => z.due_date === d);
    const lds = computeLoads(globalLookups.routingByProduct, zpD, wcSchedule, d);
    const u   = Object.values(lds).length ? Math.max(...Object.values(lds).map(v=>v.util)) : 0;
    if (u > 1.3) return { border: T.crit, text: T.crit, bg: T.critBg };
    if (u > 1.0) return { border: T.bn,   text: T.bn,   bg: T.bnBg   };
    if (u > 0.85)return { border: T.warn, text: T.warn, bg: T.warnBg };
    if (u > 0)   return { border: T.ok,   text: T.ok,   bg: T.okBg   };
    return              { border: T.border,text: T.text3,bg:'transparent' };
  }

  return (
    <div>
      {/* Nagłówek */}
      <div style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:10,
        padding:'10px 16px', marginBottom:16, display:'flex', gap:16, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ flex:1 }}>
          <span style={{ fontSize:12, fontWeight:600, color:T.text }}>📊 Obciążenie per termin ZP</span>
          <span style={{ fontSize:11, color:T.text3, marginLeft:10 }}>
            Zapotrzebowanie h per gniazdo dla wybranego due_date · "Czy mam wystarczającą pojemność?"
          </span>
        </div>
        <span style={{ fontSize:11, color:T.text3, borderLeft:`1px solid ${T.border}`, paddingLeft:12 }}>
          Rozkład dzienny → <strong style={{color:T.accent}}>Grafik zasobów</strong>
        </span>
      </div>

      {/* KPI */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:12, marginBottom:20 }}>
        <KpiCard label="Bottleneck" value={bn} sub={`${Math.round(maxU*100)}% obciążenia`} color={st.text}/>
        <KpiCard label="Gniazda" value={entries.length} sub="aktywne"/>
        <KpiCard label="ZP na termin" value={zpForDate.length} sub={date}/>
        <KpiCard label="Terminów" value={dates.length} sub={`${dates[0]?.slice(5)} – ${dates[dates.length-1]?.slice(5)}`}/>
      </div>

      {/* Przyciski dat z kolorami */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:16, flexWrap:'wrap' }}>
        <span style={{ fontSize:12, color:T.text3 }}>Termin:</span>
        {allDates.map(d => {
          const isDue = dates.includes(d);
          const dc    = isDue ? dateColor(d) : { border:T.border, text:T.text3, bg:'transparent' };
          const isSel = d === date;
          return (
            <button key={d} onClick={() => setDate(d)}
              style={{ padding:'4px 10px', fontSize:11, fontWeight:isSel?700:400, borderRadius:6,
                border:`1px solid ${isSel ? dc.border : isDue ? dc.border+'88' : T.border}`,
                background: isSel ? dc.bg : 'transparent',
                color: isSel ? dc.text : isDue ? dc.text : T.text3,
                cursor:'pointer', opacity: isDue ? 1 : 0.55 }}>
              {d.slice(5)}
              {isDue && <span style={{ display:'inline-block', width:5, height:5,
                borderRadius:'50%', background:dc.border, marginLeft:4, verticalAlign:'middle' }}/>}
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={s.card}>
          <div style={s.cardTitle}>Obciążenie vs Pojemność — {date}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>{["Gniazdo","Load (h)","Cap (h)","Obciążenie","Status"].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.text3, padding: "0 10px 10px", textAlign: "left", borderBottom: `1px solid ${T.border}` }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {entries.map(([wc, v]) => {
                const st2 = uStatus(v.util);
                return (
                  <tr key={wc} style={{ background: v.util > 1 ? "rgba(239,68,68,0.03)" : "transparent" }}>
                    <td style={{ padding: "9px 10px", borderBottom: `1px solid ${T.border}`, fontWeight: 700, color: T.text }}>{wc}</td>
                    <td style={{ padding: "9px 10px", borderBottom: `1px solid ${T.border}`, color: T.text2, fontFamily: "monospace" }}>{v.load.toFixed(2)}</td>
                    <td style={{ padding: "9px 10px", borderBottom: `1px solid ${T.border}`, color: T.text3, fontFamily: "monospace" }}>{v.cap.toFixed(1)}</td>
                    <td style={{ padding: "9px 10px", borderBottom: `1px solid ${T.border}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Bar value={v.util} max={1} color={st2.dot} />
                        <span style={{ fontSize: 12, color: T.text2, minWidth: 36, fontFamily: "monospace" }}>{Math.round(v.util * 100)}%</span>
                      </div>
                    </td>
                    <td style={{ padding: "9px 10px", borderBottom: `1px solid ${T.border}` }}>
                      <span style={s.badge(st2)}><Dot color={st2.dot} size={6} />{st2.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={s.card}>
          <div style={s.cardTitle}>Zlecenia na dzień {date}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>{["ZP ID","Produkt","Ilość","Prio"].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.text3, padding: "0 8px 10px", textAlign: "left", borderBottom: `1px solid ${T.border}` }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {[...zpForDate].sort((a, b) => a.priority - b.priority).map(zp2 => {
                const col = globalLookups.zpColorMap[zp2.zp_id] || T.text2;
                return (
                  <tr key={zp2.zp_id}>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}` }}>
                      <code style={{ fontSize: 11, color: T.accent, background: T.accentBg, padding: "2px 6px", borderRadius: 4 }}>{zp2.zp_id}</code>
                    </td>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}` }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <Dot color={col} size={7} />
                        <span style={{ color: T.text }}>{zp2.product}</span>
                      </span>
                    </td>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}`, color: T.text2, fontFamily: "monospace" }}>{zp2.volume} szt.</td>
                    <td style={{ padding: "8px", borderBottom: `1px solid ${T.border}`, color: T.text3 }}>{zp2.priority}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {entries.length > 0 && loads[bn] && (() => {
        const bnData = loads[bn];
        const contribs = Object.entries(bnData.contrib);
        const totalLoad = bnData.load;
        return (
          <div style={s.card}>
            <div style={s.cardTitle}>Struktura obciążenia bottlenecku {bn} — {date}</div>
            <div style={{ fontSize: 12, color: T.text2, marginBottom: 12 }}>
              Łączny czas: <strong style={{ color: bnData.util > 1 ? T.bn : T.text }}>{bnData.load.toFixed(2)}h</strong> / {bnData.cap}h dostępu
            </div>
            <div style={{ display: "flex", height: 20, borderRadius: 6, overflow: "hidden", marginBottom: 16 }}>
              {contribs.map(([zpid, v]) => {
                const col = globalLookups.zpColorMap[zpid] || T.text3;
                return <div key={zpid} style={{ width: `${totalLoad > 0 ? v.h / totalLoad * 100 : 0}%`, background: col }} />;
              })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {contribs.map(([zpid, v]) => {
                const col = globalLookups.zpColorMap[zpid] || T.text3;
                const pct = totalLoad > 0 ? v.h / totalLoad : 0;
                return (
                  <div key={zpid} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <Dot color={col} size={7} />
                      <code>{zpid}</code> <span style={{ color: T.text3 }}>({v.product})</span>
                    </span>
                    <span style={{ fontFamily: "monospace", color: T.text2 }}>{v.h.toFixed(2)}h ({Math.round(pct * 100)}%)</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── ZAKŁADKA: HEATMAPA ──────────────────────────────────────────────────────