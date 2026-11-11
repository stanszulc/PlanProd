import { useState, useMemo } from 'react';
import { T, s, uStatus, heatBand, U_OK } from '../../constants/theme.js';
import { localDateStr, computeLoads } from '../../utils/scheduler.js';
import { calcBottlenecks } from '../../utils/bottleneck.js';
import { Dot } from '../common/Dot.jsx';
import { Bar } from '../common/Bar.jsx';
import { KpiCard } from '../common/KpiCard.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
const TH = { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.text3, padding: '0 10px 10px', textAlign: 'left', borderBottom: `1px solid ${T.border}` };
const TD = { padding: '9px 10px', borderBottom: `1px solid ${T.border}` };
const pct = (u) => `${Math.round(u * 100)}%`;

function ModeSwitch({ mode, onChange, hasPlan }) {
  const btn = (id, label) => {
    const off = id === 'plan' && !hasPlan;
    return (
      <button key={id} onClick={() => onChange(id)} disabled={off}
        style={{ padding: '5px 14px', fontSize: 12, fontWeight: mode === id ? 700 : 400, borderRadius: 6,
          border: `1px solid ${mode === id ? T.accent : T.border}`,
          background: mode === id ? T.accentBg : 'transparent',
          color: mode === id ? T.accent : T.text2, cursor: off ? 'not-allowed' : 'pointer',
          opacity: off ? 0.5 : 1 }}>{label}</button>
    );
  };
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      {btn('plan', 'Wg planu')}
      {btn('terminy', 'Wg terminów (popyt)')}
      {!hasPlan && <span style={{ fontSize: 11, color: T.text3 }}>Brak planu – przelicz harmonogram</span>}
    </div>
  );
}

// Wąskie gardło wg planu: ranking brygad z calcBottlenecks (pula godzin brygady).
function PlanView({ fwdZP, wcSchedule, wcToBrygada }) {
  const res = useMemo(() => calcBottlenecks({ fwdZP, wcSchedule, wcToBrygada: wcToBrygada || {} }),
    [fwdZP, wcSchedule, wcToBrygada]);
  const { groups, primary, dates } = res;
  const [open, setOpen] = useState(null);
  const [selGrp, setSelGrp] = useState(null);
  const selName = groups.some(g => g.name === selGrp) ? selGrp : (primary?.name ?? groups[0]?.name);
  const sel = groups.find(g => g.name === selName);

  const zpCount = useMemo(() => new Set(fwdZP.map(o => o.zp_id ?? o.zpId).filter(Boolean)).size, [fwdZP]);

  // godziny planu per gniazdo w oknie dni (lokalnie z fwdZP)
  const wcHours = useMemo(() => {
    const win = new Set(dates);
    const m = {};
    fwdZP.forEach(op => (op.segments || []).forEach(sg => {
      if (!sg.segStart) return;
      if (!win.has(localDateStr(new Date(sg.segStart)))) return;
      const wc = String(op.workcenter);
      m[wc] = (m[wc] || 0) + (sg.durH || 0);
    }));
    return m;
  }, [fwdZP, dates]);

  if (!groups.length) return <EmptyState icon="📊" title="Brak danych" sub="Plan nie zawiera zaplanowanych segmentów" />;
  const pst = primary ? uStatus(primary.peakUtil) : null;

  return (
    <div>
      <div style={{ fontSize: 11, color: T.text3, marginBottom: 12 }}>
        Obciążenie z zaplanowanych segmentów, per brygada (pula godzin maszyn i gniazd) · "Gdzie plan się nie mieści?"
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Główne wąskie gardło" value={primary ? primary.name : 'brak'}
          sub={primary ? `nadwyżka ${primary.excessH.toFixed(1)} h w ${primary.overloadDays} dniach` : 'plan mieści się w dostępności'}
          color={primary ? pst.text : T.text3} />
        <KpiCard label="Brygad" value={groups.length} sub="w planie" />
        <KpiCard label="ZP w planie" value={zpCount} sub="zaplanowane" />
        <KpiCard label="Okno" value={dates.length} sub={`${dates[0]?.slice(5)} – ${dates[dates.length - 1]?.slice(5)} (dni)`} />
      </div>

      <div style={{ ...s.card, marginBottom: 16 }}>
        <div style={s.cardTitle}>Ranking brygad wg nadwyżki godzin</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>{['Brygada', 'Obciążenie (h)', 'Pojemność (h)', 'Śr. obciążenie %', 'Szczyt % (data)', 'Dni >100%', 'Nadwyżka (h)', 'Status'].map(h => <th key={h} style={TH}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {groups.map(g => {
              const st = uStatus(g.peakUtil);
              const isOpen = open === g.name;
              return [
                <tr key={g.name} data-testid={`grp-${g.name}`} onClick={() => { setOpen(isOpen ? null : g.name); setSelGrp(g.name); }}
                  style={{ cursor: 'pointer', background: g.excessH > 0 ? 'rgba(239,68,68,0.03)' : 'transparent' }}>
                  <td style={{ ...TD, fontWeight: 700, color: T.text }}>{isOpen ? '▾' : '▸'} {g.name}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: T.text2 }}>{g.totalLoad.toFixed(1)}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: T.text3 }}>{g.totalCap.toFixed(1)}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: T.text2 }}>{pct(g.avgUtil)}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: st.text }}>{pct(g.peakUtil)} <span style={{ color: T.text3 }}>({g.peakDate.slice(5)})</span></td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: T.text2 }}>{g.overloadDays}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: g.excessH > 0 ? T.bn : T.text3 }}>{g.excessH.toFixed(1)}</td>
                  <td style={TD}><span style={s.badge(st)}><Dot color={st.dot} size={6} />{g.status}</span></td>
                </tr>,
                ...(isOpen ? g.members.map(wc => {
                  const h = wcHours[wc] || 0;
                  return (
                    <tr key={`${g.name}-${wc}`} data-testid={`wc-${wc}`} style={{ background: T.surface2 }}>
                      <td style={{ ...TD, paddingLeft: 30, color: T.text2 }}>{wc}</td>
                      <td style={{ ...TD, fontFamily: 'monospace', color: T.text2 }}>{h.toFixed(1)}</td>
                      <td style={TD} colSpan={2}>
                        <span style={{ fontSize: 11, color: T.text3 }}>udział w brygadzie: {g.totalLoad > 0 ? pct(h / g.totalLoad) : '–'}</span>
                      </td>
                      <td style={TD} colSpan={4} />
                    </tr>
                  );
                }) : []),
              ];
            })}
          </tbody>
        </table>
      </div>

      {sel && (
        <div style={s.card}>
          <div style={s.cardTitle}>Dni brygady {sel.name} — obciążenie / dostępność</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {sel.days.map(d => {
              const noCap = d.cap <= 0 && d.load > 0;
              const band = noCap ? heatBand(Infinity) : (d.load > 0 || d.cap > 0) ? heatBand(d.util || 0) : null;
              return (
                <div key={d.date} title={`${d.date}: ${d.load.toFixed(1)} h / ${d.cap.toFixed(1)} h`}
                  style={{ minWidth: 62, padding: '6px 6px', borderRadius: 6, textAlign: 'center',
                    background: band ? band.bg : 'transparent', border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 10, color: T.text3 }}>{d.date.slice(5)}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: band ? band.color : T.text3 }}>
                    {noCap ? '!' : d.cap > 0 ? pct(d.util) : '–'}
                  </div>
                  <div style={{ fontSize: 10, color: T.text3, fontFamily: 'monospace' }}>{d.load.toFixed(1)}/{d.cap.toFixed(1)} h</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function BottleneckTab({ zp, globalLookups, wcSchedule, subZP, fwdZP, wcToBrygada }) {
  const hasPlan = Array.isArray(fwdZP) && fwdZP.length > 0;
  const [modeSel, setMode] = useState('plan');
  const mode = hasPlan ? modeSel : 'terminy';
  const dates    = useMemo(() => [...new Set(zp.map(z => z.due_date))].sort(), [zp]);
  const allDates = useMemo(() => {
    const set = new Set(dates);
    if (subZP) subZP.forEach(sz => {
      if (sz.start_dt) set.add(localDateStr(new Date(sz.start_dt)));
    });
    return [...set].sort();
  }, [dates, subZP]);

  // Wybrana data wyprowadzana: gdy dane dojdą później, bierzemy pierwszy termin.
  const [selDate, setDate] = useState(dates[0] || '');
  const date = selDate && allDates.includes(selDate) ? selDate : (dates[0] || '');

  const zpForDate = useMemo(() => zp.filter(z => z.due_date === date), [zp, date]);
  const routingByProduct = globalLookups.routingByProduct;
  const loads     = useMemo(() => {
    if (!date) return {};
    return computeLoads(routingByProduct, zpForDate, wcSchedule, date);
  }, [zpForDate, date, wcSchedule, routingByProduct]);
  const entries   = useMemo(() => Object.entries(loads).sort((a,b) => b[1].util-a[1].util), [loads]);
  const maxU      = entries.length ? Math.max(...entries.map(([,v]) => v.util)) : 0;
  // Wąskie gardło tylko gdy najwyższe obciążenie przekracza próg OK (85%).
  const bn        = entries.length && maxU > U_OK ? entries[0][0] : '–';

  // Kolor przycisku daty wg statusu (jedno przeliczenie dla wszystkich terminów ZP)
  const dateColors = useMemo(() => {
    const m = {};
    dates.forEach(d => {
      const zpD = zp.filter(z => z.due_date === d);
      const lds = Object.values(computeLoads(routingByProduct, zpD, wcSchedule, d));
      const u   = lds.length ? Math.max(...lds.map(v => v.util)) : 0;
      if (u <= 0) { m[d] = { border: T.border, text: T.text3, bg: 'transparent' }; return; }
      const st = uStatus(u);
      m[d] = { border: st.dot, text: st.text, bg: st.bg };
    });
    return m;
  }, [dates, zp, routingByProduct, wcSchedule]);

  if (!dates.length && !hasPlan) return <EmptyState icon="📊" title="Brak danych" sub="Wgraj pliki w zakładce Import" />;

  const st = uStatus(maxU);

  if (mode === 'plan') {
    return (
      <div>
        <ModeSwitch mode={mode} onChange={setMode} hasPlan={hasPlan} />
        <PlanView fwdZP={fwdZP} wcSchedule={wcSchedule} wcToBrygada={wcToBrygada} />
      </div>
    );
  }

  return (
    <div>
      <ModeSwitch mode={mode} onChange={setMode} hasPlan={hasPlan} />
      {/* Nagłówek */}
      <div style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:10,
        padding:'10px 16px', marginBottom:16, display:'flex', gap:16, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ flex:1 }}>
          <span style={{ fontSize:12, fontWeight:600, color:T.text }}>📊 Obciążenie per termin ZP</span>
          <span style={{ fontSize:11, color:T.text3, marginLeft:10 }}>
            Prognoza popytu per termin ZP (nie plan): zapotrzebowanie h per gniazdo dla wybranego due_date · "Czy mam pojemność na ZP z tym terminem?"
          </span>
        </div>
        <span style={{ fontSize:11, color:T.text3, borderLeft:`1px solid ${T.border}`, paddingLeft:12 }}>
          Rozkład dzienny → <strong style={{color:T.accent}}>Grafik zasobów</strong>
        </span>
      </div>

      {/* KPI */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:12, marginBottom:20 }}>
        <KpiCard label="Bottleneck" value={bn}
          sub={bn === '–' ? `brak wąskiego gardła (max ${Math.round(maxU*100)}%)` : `${Math.round(maxU*100)}% obciążenia`}
          color={bn === '–' ? T.text3 : st.text}/>
        <KpiCard label="Gniazda" value={entries.length} sub="aktywne"/>
        <KpiCard label="ZP na termin" value={zpForDate.length} sub={date}/>
        <KpiCard label="Terminów" value={dates.length} sub={`${dates[0]?.slice(5)} – ${dates[dates.length-1]?.slice(5)}`}/>
      </div>

      {/* Przyciski dat z kolorami */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:16, flexWrap:'wrap' }}>
        <span style={{ fontSize:12, color:T.text3 }}>Termin:</span>
        {allDates.map(d => {
          const isDue = dates.includes(d);
          const dc    = isDue ? dateColors[d] : { border:T.border, text:T.text3, bg:'transparent' };
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