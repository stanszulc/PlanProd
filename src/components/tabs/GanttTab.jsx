import { useState, useMemo, useEffect, useRef } from 'react';
import { T, s, tocColor } from '../../constants/theme.js';
import { fmtDt, computeLoads, getAvail } from '../../utils/scheduler.js';
import { DAY_NAMES } from '../../constants/theme.js';
import { Dot } from '../common/Dot.jsx';
import { EmptyState } from '../common/EmptyState.jsx';

export function GanttTab({ routing, zp, globalLookups, wcSchedule, subZP, fwdZP, zpStatus, onRecalc, ganttDirty, onViewChange, slaveMode, planStart, onPlanStartChange, embedded }) {

  const allWC  = useMemo(() => [...new Set(routing.map(r => r.workcenter))].sort(), [routing]);
  const dates  = useMemo(() => [...new Set(zp.map(z => z.due_date))].sort(), [zp]);
  const allZP  = useMemo(() => [...zp].sort((a,b) => a.priority-b.priority || a.due_date.localeCompare(b.due_date)), [zp]);

  const SCALES = [
    { key:'4h',  hourW:96,  tick:1,  label:'1h'  },
    { key:'8h',  hourW:56,  tick:2,  label:'2h'  },
    { key:'1d',  hourW:28,  tick:4,  label:'4h'  },
    { key:'3d',  hourW:14,  tick:8,  label:'8h'  },
    { key:'1w',  hourW:6,   tick:24, label:'1d'  },
    { key:'2w',  hourW:3,   tick:48, label:'2d'  },
  ];

  const [scaleIdx,   setScaleIdx]  = useState(2);
  const [panX,       setPanX]      = useState(0);
  const [isPan,      setIsPan]     = useState(false);
  const [tableOpen,  setTableOpen] = useState(false);
  const [tooltip,    setTooltip]   = useState(null);
  const svgRef       = useRef(null);
  const panRef       = useRef(null);
  const containerRef = useRef(null);

  // Synchronizacja widoku z PlanTab
  useEffect(() => {
    if (onViewChange) onViewChange({ panX, scaleIdx, hourW: SCALES[scaleIdx].hourW });
  }, [panX, scaleIdx]);

  const scale  = SCALES[scaleIdx];
  const HOUR_W = scale.hourW;

  const displayZP = useMemo(
    () => (fwdZP && fwdZP.length) ? fwdZP : subZP,
    [fwdZP, subZP]
  );

  const planStartDt = useMemo(
    () => new Date((planStart || '2026-05-22') + 'T00:00:00'),
    [planStart]
  );

  const LABEL_W = 110, LANE_H = 54, TOP = 56;

  const layout = useMemo(() => {
    if (!dates.length) {
      return { contentW: 800, axisStart: planStartDt, axisEnd: planStartDt, allDues: [], svgH: TOP + 16 };
    }
    const allSegs = displayZP.flatMap(s => s.segments || []);
    const allEnds = allSegs.map(s => s.segEnd).filter(Boolean);
    const allDues = dates.map(d => new Date(d + 'T23:59:59'));
    const maxDueDt = new Date(Math.max(
      ...allDues.map(d => d.getTime()),
      ...(allEnds.length ? allEnds.map(d => new Date(d).getTime()) : [0]),
      planStartDt.getTime() + 7 * 24 * 3600000
    ));
    const axisStart = new Date(planStartDt); axisStart.setHours(0, 0, 0, 0);
    const axisEnd   = new Date(maxDueDt);   axisEnd.setHours(24, 0, 0, 0);
    const totalH    = Math.max((axisEnd - axisStart) / 3600000, 16);
    const contentW  = Math.ceil(totalH) * HOUR_W;
    const svgH      = TOP + allWC.length * LANE_H + 16;
    return { contentW, axisStart, axisEnd, allDues, svgH };
  }, [dates, displayZP, planStartDt, HOUR_W, allWC.length]);

  const { contentW, axisStart, axisEnd, allDues, svgH } = layout;

  // ── WHEEL ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) setScaleIdx(v => Math.max(0, v - 1));
        else              setScaleIdx(v => Math.min(SCALES.length - 1, v + 1));
      } else {
        // scroll → pan poziomy (zawsze)
        e.preventDefault();
        setPanX(v => Math.min(0, Math.max(-(contentW - 200), v - e.deltaY * 1.5)));
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [contentW, svgH, embedded]);

  if (!dates.length) return <EmptyState icon="📅" title="Brak danych" sub="Wgraj pliki CSV" />;

  function xOf(dt) {
    return LABEL_W + Math.max(0, (new Date(dt) - axisStart) / 3600000) * HOUR_W;
  }

  // Ticki
  const ticks = [];
  for (let t = new Date(axisStart); t <= axisEnd; t.setHours(t.getHours() + scale.tick)) {
    ticks.push(new Date(t));
  }

  // Niedostępne strefy
  const unavailZones = [];
  const dayIter = new Date(axisStart);
  while (dayIter <= axisEnd) {
    allWC.forEach((wc, wi) => {
      const avail = getAvail(wc, dayIter, wcSchedule);
      const ds = new Date(dayIter); ds.setHours(0,0,0,0);
      const de = new Date(dayIter); de.setHours(24,0,0,0);
      if (avail === 0) unavailZones.push({ wi, x1: xOf(ds), x2: xOf(de) });
      else if (avail < 24) {
        const we = new Date(dayIter); we.setHours(avail, 0, 0, 0);
        unavailZones.push({ wi, x1: xOf(we), x2: xOf(de) });
      }
    });
    dayIter.setDate(dayIter.getDate() + 1);
  }

  const loads   = computeLoads(globalLookups.routingByProduct, allZP, wcSchedule, dates[0]);
  const maxUtil = Object.values(loads).length ? Math.max(...Object.values(loads).map(v => v.util)) : 0;

  function onBgMouseDown(e) {
    const tag = e.target.tagName;
    const isBg = (tag === 'rect' && (e.target.getAttribute('fill') === 'transparent' || e.target.getAttribute('data-bg') === '1')) || tag === 'svg';
    if (isBg) { panRef.current = { startX: e.clientX, startPanX: panX }; setIsPan(true); }
  }
  function onMouseMove(e) {
    if (!panRef.current) return;
    const dx = e.clientX - panRef.current.startX;
    setPanX(Math.min(0, Math.max(-(contentW - 200), panRef.current.startPanX + dx)));
  }
  function onMouseUp() { panRef.current = null; setIsPan(false); }

  // Scrollbar poziomy
  const visibleW = (containerRef.current?.offsetWidth || 900) - LABEL_W;
  const thumbPct = Math.min(1, visibleW / contentW);
  const thumbPos = contentW > 0 ? (-panX / contentW) * 100 : 0;


  return (
    <div className={embedded ? 'gantt-tab gantt-tab--embedded' : undefined} style={embedded ? {display:'flex', flexDirection:'column', height:'100%'} : undefined}>
      {/* Controls */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        <span style={{ fontSize:13, color:T.text2 }}>
          <strong style={{color:T.text}}>{dates[0]?.slice(5)} – {dates[dates.length-1]?.slice(5)}</strong>
          &nbsp;·&nbsp; {allZP.length} ZP &nbsp;·&nbsp; {allWC.length} gniazd
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:6, background:T.surface2, padding:'4px 10px', borderRadius:8, border:`1px solid ${T.border}` }}>
          <span style={{ fontSize:11, color:T.text3 }}>Planuj od:</span>
          <input type="date" value={planStart || '2026-05-22'}
            onChange={e => onPlanStartChange && onPlanStartChange(e.target.value)}
            style={{ fontSize:11, background:'transparent', border:'none', color:T.text, cursor:'pointer', outline:'none' }}/>
        </div>
        <div style={{ display:'flex', gap:2, background:T.surface2, borderRadius:8, padding:2, marginLeft:8 }}>
          {SCALES.map((sc,i) => (
            <button key={sc.key} onClick={() => setScaleIdx(i)}
              style={{ padding:'4px 10px', fontSize:11, fontWeight:600, borderRadius:6, border:'none',
                background: i===scaleIdx ? T.accent : 'transparent',
                color: i===scaleIdx ? '#fff' : T.text3, cursor:'pointer' }}>
              {sc.key}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', gap:4, marginLeft:'auto', alignItems:'center' }}>
          <span style={{ fontSize:10, color:T.text3 }}>
            Ctrl+scroll=zoom · scroll=pan · scroll⬆⬇=gniazda
          </span>
          <button onClick={() => { setPanX(0); setPanY(0); setScaleIdx(2); }}
            style={{ ...s.btn(false), fontSize:11, padding:'4px 10px' }}>⊡ Reset</button>
          <button onClick={onRecalc}
            style={{ padding:'6px 14px', fontSize:12, fontWeight:600, borderRadius:8, border:'none',
              background: ganttDirty ? T.accent : T.surface3,
              color: ganttDirty ? '#fff' : T.text3, cursor:'pointer' }}>
            {ganttDirty ? '⟳ Przelicz' : '✓ OK'}
          </button>
        </div>
      </div>

      {/* Legenda ZP */}
      <div style={{ display:'flex', gap:12, fontSize:11, color:T.text3, marginBottom:8, flexWrap:'wrap', alignItems:'center' }}>
        {allZP.map(zp2 => {
          const col = globalLookups.zpColorMap[zp2.zp_id] || T.text3;
          return <span key={zp2.zp_id} style={{display:'flex',alignItems:'center',gap:4}}>
            <Dot color={col} size={7}/>{zp2.zp_id}
          </span>;
        })}
        <span style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:5}}>
          <span style={{width:14,height:3,background:T.bn,display:'inline-block',borderRadius:2}}/>due_date
        </span>
        <span style={{display:'flex',alignItems:'center',gap:5}}>
          <span style={{width:14,height:12,background:'rgba(0,0,0,0.25)',display:'inline-block',borderRadius:2}}/>niedostępne
        </span>
      </div>

      {/* SVG Gantt */}
      <div style={embedded ? { flex:1, minHeight:0 } : { ...s.card, padding:0, overflow:'hidden' }}>
        <div ref={containerRef}
          style={{
            background: T.ganttBg,
            borderRadius: embedded ? 0 : 12,
            overflowY: 'auto',
            overflowX: 'hidden',
            height: embedded ? '100%' : 'calc(100vh - 240px)',
            minHeight: embedded ? 0 : 380,
            cursor: isPan ? 'grabbing' : 'default',
            userSelect: 'none',
            position: 'relative',
          }}
          onMouseDown={onBgMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {displayZP.length === 0
            ? <div style={{padding:'48px',textAlign:'center',color:T.text3,fontSize:13}}>
                Kliknij <strong style={{color:T.accent}}>⟳ Przelicz</strong> aby zaplanować
              </div>
            : <svg ref={svgRef} width="100%" height={svgH} style={{display:'block'}}>
                <defs>
                  <clipPath id="ganttClip">
                    <rect x={LABEL_W} y="0" width="10000" height={svgH}/>
                  </clipPath>
                </defs>

                <rect x="0" y="0" width="100%" height="100%" fill={T.ganttBg} data-bg="1"/>

                {/* SCROLLOWANA zawartość — przesuwa się X i Y */}
                <g clipPath="url(#ganttClip)">
                  <g transform={`translate(${panX},0)`}>

                    {allWC.map((w,wi) => (
                      <rect key={`bg-${w}`} x={LABEL_W} y={TOP+wi*LANE_H}
                        width={contentW+40} height={LANE_H}
                        fill={wi%2===0?T.surface:T.surface2}/>
                    ))}
                    {allWC.map((_,wi) => (
                      <line key={`hl-${wi}`} x1={LABEL_W} y1={TOP+(wi+1)*LANE_H}
                        x2={LABEL_W+contentW+40} y2={TOP+(wi+1)*LANE_H}
                        stroke={T.border} strokeWidth="0.5"/>
                    ))}
                    {unavailZones.map((z,zi) => (
                      <rect key={`uz${zi}`} x={z.x1} y={TOP+z.wi*LANE_H+1}
                        width={Math.max(z.x2-z.x1,0)} height={LANE_H-2}
                        fill="rgba(0,0,0,0.22)"/>
                    ))}
                    {ticks.map((t,ti) => {
                      const x = xOf(t);
                      const isDay = t.getHours()===0;
                      const dn = DAY_NAMES[t.getDay()];
                      return <g key={ti}>
                        <line x1={x} y1={TOP-8} x2={x} y2={TOP+allWC.length*LANE_H}
                          stroke={isDay?T.border2:T.border} strokeWidth={isDay?1.5:0.5}/>
                        {isDay && <text x={x+4} y={TOP-30} fontSize="11" fontWeight="600" fill={T.text2}>
                          {dn} {String(t.getDate()).padStart(2,'0')}.{String(t.getMonth()+1).padStart(2,'0')}
                        </text>}
                        {!isDay && <text x={x+3} y={TOP-14} fontSize="9" fill={T.text3}>
                          {String(t.getHours()).padStart(2,'0')}:00
                        </text>}
                      </g>;
                    })}
                    {(() => {
                      const px = xOf(planStartDt);
                      return <g>
                        <line x1={px} y1={TOP-8} x2={px} y2={TOP+allWC.length*LANE_H}
                          stroke={T.accent} strokeWidth="2" opacity="0.9"/>
                        <rect x={px+3} y={TOP-22} width="30" height="14" rx="3" fill={T.accentBg}/>
                        <text x={px+6} y={TOP-12} fontSize="9" fontWeight="700" fill={T.accent}>dziś</text>
                      </g>;
                    })()}
                    {allDues.map((dt,i) => {
                      const dx = xOf(dt);
                      return <g key={`due${i}`}>
                        <line x1={dx} y1={TOP-8} x2={dx} y2={TOP+allWC.length*LANE_H}
                          stroke={T.bn} strokeWidth="2" strokeDasharray="5 3" opacity="0.9"/>
                        <rect x={dx+3} y={TOP-22} width="38" height="14" rx="3" fill={T.bnBg}/>
                        <text x={dx+6} y={TOP-12} fontSize="9" fontWeight="700" fill={T.bn}>{dates[i]?.slice(5)}</text>
                      </g>;
                    })}
                    {displayZP.map(s2 => {
                      const wi = allWC.indexOf(s2.workcenter);
                      if (wi<0) return null;
                      const col = globalLookups.zpColorMap[s2.parent_zp] || globalLookups.zpColorMap[s2.zp_id] || T.text3;
                      const y = TOP+wi*LANE_H+5, bH = LANE_H-10;
                      return (s2.segments||[]).map((seg,si) => {
                        const x   = xOf(seg.segStart);
                        const x2  = xOf(seg.segEnd);
                        const wpx = Math.max(x2-x, 2);
                        const dueDtLocal = allDues[dates.indexOf(s2.due_date)];
                        const isOver = dueDtLocal && new Date(seg.segEnd) > dueDtLocal;
                        const isLast = si===s2.segments.length-1;
                        const zpSt = zpStatus && zpStatus.find(st => st.zp_id === (s2.parent_zp || s2.zp_id));
                        const tocZone = zpSt ? (zpSt.toc && zpSt.toc.zone) : (isOver ? 'black' : 'green');
                        const borderCol = tocZone==='black'?T.bn:tocZone==='red'?T.bn:tocZone==='yellow'?T.warn:'transparent';
                        const borderW   = tocZone==='green'||!tocZone ? 0 : 2.5;
                        return <g key={`${s2.sub_id}-${si}`}>
                          <rect x={x} y={y} width={wpx} height={bH} rx="4"
                            fill={col} opacity={0.9} stroke={borderCol} strokeWidth={borderW}/>
                          {isLast && wpx>30 && <text x={x+Math.min(wpx/2,38)} y={y+bH/2-4}
                            fontSize={wpx>52?10:9} fontWeight="600" fill="white"
                            textAnchor="middle" style={{pointerEvents:'none'}}>{s2.zp_id}</text>}
                          {isLast && wpx>56 && <text x={x+Math.min(wpx/2,38)} y={y+bH/2+9}
                            fontSize="9" fill="rgba(255,255,255,0.75)"
                            textAnchor="middle" style={{pointerEvents:'none'}}>{s2.durH.toFixed(1)}h</text>}
                          {!isLast && (()=>{
                            const ns=s2.segments[si+1]; if(!ns) return null;
                            const nx=xOf(ns.segStart), cy=y+bH/2;
                            return <line x1={x+wpx} y1={cy} x2={nx} y2={cy}
                              stroke={col} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5"/>;
                          })()}
                        </g>;
                      });
                    })}
                  </g>
                </g>

                {/* Tooltip */}
                {tooltip && (
                  <g style={{pointerEvents:'none'}}>
                    <rect x={tooltip.x} y={tooltip.y} width="220" height="80" rx="6"
                      fill={T.surface3} stroke={T.border2} strokeWidth="1"
                      style={{filter:'drop-shadow(0 2px 8px rgba(0,0,0,0.4))'}}/>
                    <text x={tooltip.x+10} y={tooltip.y+14} fontSize="11" fontWeight="700" fill={T.text}>
                      {tooltip.s2.zp_id} · {tooltip.s2.workcenter}
                    </text>
                    <text x={tooltip.x+10} y={tooltip.y+40} fontSize="10" fill={T.text2}>
                      {tooltip.s2.product} · {tooltip.s2.volume} szt
                    </text>
                    <text x={tooltip.x+10} y={tooltip.y+53} fontSize="10" fill={T.text3}>
                      {tooltip.s2.operation}
                    </text>
                    <text x={tooltip.x+10} y={tooltip.y+66} fontSize="10" fill={T.text3} fontFamily="monospace">
                      {fmtDt(tooltip.s2.start_dt)} → {fmtDt(tooltip.s2.end_dt)} ({tooltip.s2.durH.toFixed(1)}h)
                    </text>
                  </g>
                )}

                {/* STAŁA lewa kolumna — przesuwa się tylko w Y razem z panY */}
                <rect x="0" y="0" width={LABEL_W} height="10000" fill={T.ganttBg}/>
                <g>
                  {allWC.map((w,wi) => {
                    const ld = loads[w]||{util:0};
                    const isBn = Math.abs(ld.util-maxUtil)<0.001 && ld.util>0.85;
                    return <g key={`lbl-${w}`}>
                      <rect x="0" y={TOP+wi*LANE_H} width={LABEL_W} height={LANE_H}
                        fill={isBn?'rgba(248,113,113,0.10)':T.surface2}/>
                      <text x="12" y={TOP+wi*LANE_H+LANE_H/2-7} fontSize="12" fontWeight="700"
                        fill={isBn?T.bn:T.text}>{w}</text>
                      <text x="12" y={TOP+wi*LANE_H+LANE_H/2+9} fontSize="10"
                        fill={isBn?T.bn:T.text3}>{Math.round(ld.util*100)}%</text>
                    </g>;
                  })}
                </g>
                {/* Przykrycie nagłówka osi — stały */}
                <rect x="0" y="0" width={LABEL_W} height={TOP} fill={T.ganttBg}/>
                <line x1={LABEL_W} y1="0" x2={LABEL_W} y2="10000"
                  stroke={T.border2} strokeWidth="1.5"/>

              </svg>
          }

          {/* Scrollbar poziomy */}
          {contentW > 200 && (
            <div style={{ position:'absolute', bottom:4, left:LABEL_W, right:8, height:6,
              background:'rgba(255,255,255,0.05)', borderRadius:3 }}>
              <div style={{
                position:'absolute', top:0, height:'100%', borderRadius:3,
                background:'rgba(255,255,255,0.18)',
                width: `${thumbPct*100}%`,
                left: `${thumbPos}%`,
                transition:'left 0.05s',
              }}/>
            </div>
          )}
        </div>
      </div>

      {/* TOC Status — tylko poza PlanTab */}
      {!embedded && zpStatus && zpStatus.length > 0 && (
        <div style={{ ...s.card, marginTop:12 }}>
          <div style={s.cardTitle}>Status ZP — TOC Buffer Management</div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead><tr>
                {['ZP / ZS','Produkt','Due date','Planowany koniec','Opóźnienie','Bufor %','Status'].map(h => (
                  <th key={h} style={{ fontSize:10, fontWeight:600, letterSpacing:'.07em',
                    textTransform:'uppercase', color:T.text3, padding:'0 8px 8px',
                    textAlign:'left', borderBottom:`1px solid ${T.border}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {[...zpStatus].sort((a,b) => {
                  const ord = {black:0,red:1,yellow:2,green:3};
                  return (ord[a.toc.zone]??4) - (ord[b.toc.zone]??4);
                }).map((st, i) => {
                  const col = globalLookups.zpColorMap[st.zp_id] || T.text3;
                  const tc  = tocColor(st.toc.zone);
                  return (
                    <tr key={i} style={{ background: ['black','red'].includes(st.toc.zone) ? 'rgba(248,113,113,0.04)' : 'transparent' }}>
                      <td style={{ padding:'7px 8px', borderBottom:`1px solid ${T.border}` }}>
                        <span style={{ display:'flex', flexDirection:'column', gap:2 }}>
                          <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                            <Dot color={col} size={7}/><strong>{st.zp_id}</strong>
                          </span>
                          {st.zs_id && <span style={{ fontSize:10, color:T.text3, marginLeft:12 }}>
                            {st.zs_id}{st.pozycja ? `/poz.${st.pozycja}` : ''}
                          </span>}
                        </span>
                      </td>
                      <td style={{ padding:'7px 8px', borderBottom:`1px solid ${T.border}`, color:T.text2 }}>{st.product}</td>
                      <td style={{ padding:'7px 8px', borderBottom:`1px solid ${T.border}`, fontFamily:'monospace', color:T.text2 }}>{st.due_date}</td>
                      <td style={{ padding:'7px 8px', borderBottom:`1px solid ${T.border}`, fontFamily:'monospace',
                        color: st.delayH > 0 ? T.bn : T.ok, fontWeight: st.delayH>0?600:400 }}>
                        {st.realEnd ? fmtDt(st.realEnd) : '—'}
                      </td>
                      <td style={{ padding:'7px 8px', borderBottom:`1px solid ${T.border}`, fontFamily:'monospace',
                        color: st.delayH>0 ? T.bn : T.ok, fontWeight:600 }}>
                        {st.delayDays > 0 ? `+${st.delayDays}d` : '✓ OK'}
                      </td>
                      <td style={{ padding:'7px 8px', borderBottom:`1px solid ${T.border}` }}>
                        <div style={{ height:6, background:T.surface3, borderRadius:3, width:80, overflow:'hidden' }}>
                          <div style={{ height:'100%', width:`${Math.min(100,Math.round(st.toc.consumed*100))}%`,
                            background: tc.border, borderRadius:3, transition:'width .3s' }}/>
                        </div>
                        <span style={{ fontSize:10, color:T.text3 }}>{Math.round(st.toc.consumed*100)}%</span>
                      </td>
                      <td style={{ padding:'7px 8px', borderBottom:`1px solid ${T.border}` }}>
                        <span style={{ display:'inline-flex', padding:'2px 8px', borderRadius:5,
                          fontSize:10, fontWeight:600, background:tc.bg, color:tc.text }}>
                          {st.toc.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tabela pod-ZP */}
      {!embedded && subZP && subZP.length > 0 && (
        <div style={{...s.card, marginTop:12}}>
          <div onClick={()=>setTableOpen(v=>!v)}
            style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',userSelect:'none'}}>
            <div style={s.cardTitle}>Plan operacji ({subZP.length})</div>
            <span style={{fontSize:12,color:T.text3,marginBottom:14}}>{tableOpen?'▲ Zwiń':'▶ Rozwiń'}</span>
          </div>
          {tableOpen && (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr>
                  {['Pod-ZP','ZP','Gniazdo','Operacja','Start','Koniec','Czas','Status'].map(h=>
                    <th key={h} style={{fontSize:10,fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',
                      color:T.text3,padding:'0 8px 8px',textAlign:'left',borderBottom:`1px solid ${T.border}`}}>{h}</th>
                  )}
                </tr></thead>
                <tbody>
                  {[...subZP].sort((a,b)=>a.sequence-b.sequence||a.zp_id.localeCompare(b.zp_id)).map((s2,i)=>{
                    const col=globalLookups.zpColorMap[s2.zp_id]||T.text3;
                    const dueDtForZP=allDues[dates.indexOf(s2.due_date)];
                    const isOver=s2.end_dt&&dueDtForZP&&new Date(s2.end_dt)>dueDtForZP;
                    const st=isOver?{bg:T.bnBg,color:T.bn,label:'OPÓŹNIONE'}:{bg:T.okBg,color:T.ok,label:'OK'};
                    return <tr key={i} style={{background:isOver?'rgba(248,113,113,0.05)':'transparent'}}>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`}}>
                        <code style={{fontSize:11,color:T.accent,background:T.accentBg,padding:'1px 5px',borderRadius:4}}>{s2.sub_id}</code>
                      </td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`}}>
                        <span style={{display:'flex',alignItems:'center',gap:5}}><Dot color={col} size={7}/>{s2.zp_id}</span>
                      </td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`,fontWeight:700,color:T.text}}>{s2.workcenter}</td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`,color:T.text2,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s2.operation}</td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`,fontFamily:'monospace',color:T.text2,whiteSpace:'nowrap'}}>{fmtDt(s2.start_dt)}</td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`,fontFamily:'monospace',color:isOver?T.bn:T.text2,fontWeight:isOver?600:400,whiteSpace:'nowrap'}}>{fmtDt(s2.end_dt)}</td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`,fontFamily:'monospace',color:T.text3}}>{s2.durH.toFixed(1)}h</td>
                      <td style={{padding:'7px 8px',borderBottom:`1px solid ${T.border}`}}>
                        <span style={{display:'inline-flex',padding:'2px 7px',borderRadius:5,fontSize:10,fontWeight:600,background:st.bg,color:st.color}}>{st.label}</span>
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}