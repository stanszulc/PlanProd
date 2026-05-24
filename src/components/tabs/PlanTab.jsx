import { useState } from 'react';
import { T, tocColor } from '../../constants/theme.js';
import { fmtDt } from '../../utils/scheduler.js';
import { Dot } from '../common/Dot.jsx';
import { GanttTab } from './GanttTab.jsx';
import { GrafikTab } from './GrafikTab.jsx';

export function PlanTab({ routing, zp, globalLookups, wcSchedule, subZP, fwdZP, zpStatus,
                     onRecalc, ganttDirty, onScheduleChange, planStart, onPlanStartChange }) {
  const [sharedView, setSharedView] = useState({ panX:0, scaleIdx:2, hourW:28 });

  const panelStyle = {
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };

  const headerStyle = {
    fontSize: 12, fontWeight: 700, color: T.text2,
    padding: '7px 14px',
    background: T.surface2,
    borderBottom: `1px solid ${T.border}`,
    flexShrink: 0,
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, padding:'0 0 8px' }}>

      {/* ── GANTT ── */}
      <div style={{ ...panelStyle, height: '45vh', minHeight: 220 }}>
        <div style={headerStyle}>📊 Harmonogram (Gantt)</div>
        <div style={{ flex:1, overflow:'hidden', position:'relative', minHeight:0 }}>
          <GanttTab
            embedded
            routing={routing} zp={zp} globalLookups={globalLookups}
            wcSchedule={wcSchedule} subZP={subZP} fwdZP={fwdZP} zpStatus={zpStatus}
            onRecalc={onRecalc} ganttDirty={ganttDirty}
            planStart={planStart} onPlanStartChange={onPlanStartChange}
            onViewChange={v => setSharedView(v)}
          />
        </div>
      </div>

      {/* ── GRAFIK ZASOBÓW ── */}
      <div style={{ ...panelStyle, height: '28vh', minHeight: 160 }}>
        <div style={headerStyle}>📅 Grafik zasobów — dostępność vs zapotrzebowanie</div>
        <div style={{ flex:1, overflow:'hidden', position:'relative', minHeight:0 }}>
          <GrafikTab
            embedded
            routing={routing} zp={zp}
            wcSchedule={wcSchedule} onScheduleChange={onScheduleChange}
            subZP={fwdZP && fwdZP.length ? fwdZP : subZP}
            slavePanX={sharedView.panX}
            slaveScaleIdx={sharedView.scaleIdx}
            slaveHourW={sharedView.hourW}
            planStart={planStart}
          />
        </div>
      </div>

      {/* ── STATUS ZP ── */}
      {zpStatus && zpStatus.length > 0 && (
        <div style={{ ...panelStyle, maxHeight: '35vh', minHeight: 120 }}>
          <div style={headerStyle}>📋 Status ZP — TOC Buffer Management</div>
          <div style={{ overflowY:'auto', overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead><tr>
                {['ZS / Pozycja / Klient','ZP','Produkt','Due date','Koniec','Opóźnienie','Bottleneck','Bufor','Status'].map(h => (
                  <th key={h} style={{ fontSize:10, fontWeight:600, letterSpacing:'.06em',
                    textTransform:'uppercase', color:T.text3, padding:'6px 8px',
                    textAlign:'left', borderBottom:`1px solid ${T.border}`,
                    background: T.surface2, position:'sticky', top:0, zIndex:1 }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(() => {
                  const byZS = {};
                  zpStatus.forEach(st => {
                    const key = st.zs_id || 'bez-ZS';
                    if (!byZS[key]) byZS[key] = [];
                    byZS[key].push(st);
                  });
                  const ord = {black:0,red:1,yellow:2,green:3};
                  const rows = [];
                  Object.entries(byZS)
                    .sort(([,a],[,b]) => {
                      const wa = Math.min(...a.map(s=>ord[s.toc?.zone]??4));
                      const wb = Math.min(...b.map(s=>ord[s.toc?.zone]??4));
                      return wa-wb;
                    })
                    .forEach(([zsKey, stList]) => {
                      const first = stList[0];
                      const maxOrd = Math.min(...stList.map(s=>ord[s.toc?.zone]??4));
                      const zsColor = maxOrd===0?T.bn:maxOrd===1?T.bn:maxOrd===2?T.warn:T.ok;
                      rows.push(
                        <tr key={`zs-${zsKey}`} style={{ background:T.surface2 }}>
                          <td colSpan={9} style={{ padding:'6px 8px',
                            borderBottom:`1px solid ${T.border2}`, borderTop:`2px solid ${T.border2}` }}>
                            <span style={{ fontWeight:700, color:zsColor, fontSize:12 }}>{first.zs_id || '—'}</span>
                            {first.klient && <span style={{ fontSize:11, color:T.text3, marginLeft:8 }}>{first.klient}</span>}
                            <span style={{ fontSize:10, color:T.text3, marginLeft:8 }}>({stList.length} ZP)</span>
                          </td>
                        </tr>
                      );
                      [...stList].sort((a,b) => (ord[a.toc?.zone]??4)-(ord[b.toc?.zone]??4))
                        .forEach((st) => {
                          const col = globalLookups.zpColorMap[st.zp_id]||T.text3;
                          const tc  = tocColor(st.toc?.zone||'green');
                          rows.push(
                            <tr key={`zp-${st.zp_id}`} style={{
                              background:['black','red'].includes(st.toc?.zone)?'rgba(248,113,113,0.03)':'transparent'
                            }}>
                              <td style={{ padding:'6px 8px 6px 20px', borderBottom:`1px solid ${T.border}`, color:T.text3, fontSize:10 }}>poz.{st.pozycja}</td>
                              <td style={{ padding:'6px 8px', borderBottom:`1px solid ${T.border}` }}>
                                <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                                  <Dot color={col} size={7}/>
                                  <code style={{ fontSize:11, color:T.accent, background:T.accentBg, padding:'1px 5px', borderRadius:4 }}>{st.zp_id}</code>
                                </span>
                              </td>
                              <td style={{ padding:'6px 8px', borderBottom:`1px solid ${T.border}`, color:T.text2, fontSize:11 }}>{st.product}</td>
                              <td style={{ padding:'6px 8px', borderBottom:`1px solid ${T.border}`, fontFamily:'monospace', fontSize:11, color:T.text2 }}>{st.due_date}</td>
                              <td style={{ padding:'6px 8px', borderBottom:`1px solid ${T.border}`, fontFamily:'monospace', fontSize:11,
                                color:st.delayH>0?T.bn:T.ok, fontWeight:st.delayH>0?600:400 }}>
                                {st.realEnd?fmtDt(st.realEnd):'—'}
                              </td>
                              <td style={{ padding:'6px 8px', borderBottom:`1px solid ${T.border}`, fontFamily:'monospace', fontSize:11,
                                color:st.delayH>0?T.bn:T.ok, fontWeight:600 }}>
                                {st.delayDays>0?`+${st.delayDays}d`:'✓ OK'}
                              </td>
                              <td style={{ padding:'6px 8px', borderBottom:`1px solid ${T.border}` }}>
                                {st.bottleneck && <span style={{ display:'inline-flex', alignItems:'center',
                                  gap:4, padding:'2px 7px', borderRadius:4, fontSize:11, fontWeight:600,
                                  background:T.bnBg, color:T.bn }}>🔴 {st.bottleneck}</span>}
                              </td>
                              <td style={{ padding:'6px 8px', borderBottom:`1px solid ${T.border}` }}>
                                <div style={{ height:5, background:T.surface3, borderRadius:3, width:70, marginBottom:2 }}>
                                  <div style={{ height:'100%', borderRadius:3, background:tc.border,
                                    width:`${Math.min(100,Math.max(0,Math.round((st.toc?.consumed||0)*100)))}%` }}/>
                                </div>
                                <span style={{ fontSize:10, color:T.text3 }}>{Math.round((st.toc?.consumed||0)*100)}%</span>
                              </td>
                              <td style={{ padding:'6px 8px', borderBottom:`1px solid ${T.border}` }}>
                                <span style={{ display:'inline-flex', padding:'2px 8px', borderRadius:5,
                                  fontSize:10, fontWeight:600, background:tc.bg, color:tc.text }}>
                                  {st.toc?.label||'—'}
                                </span>
                              </td>
                            </tr>
                          );
                        });
                    });
                  return rows;
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}