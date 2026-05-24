import { useState, useMemo, useEffect, useRef } from 'react';
import { T, s } from '../../constants/theme.js';
import { localDateStr, computeLoads } from '../../utils/scheduler.js';
import { EmptyState } from '../common/EmptyState.jsx';
import { DAY_NAMES } from '../../constants/theme.js';

export function GrafikTab({ routing, zp, wcSchedule, onScheduleChange, subZP, slavePanX, slaveScaleIdx, slaveHourW, planStart, embedded }) {

  const WCS = useMemo(() => [...new Set(routing.map(r => r.workcenter))].sort(), [routing]);

  const SCALES = [
    { key:'4h',  dayW:160 },
    { key:'8h',  dayW:112 },
    { key:'1d',  dayW:64  },
    { key:'3d',  dayW:32  },
    { key:'1w',  dayW:18  },
    { key:'2w',  dayW:9   },
  ];

  const [_scaleIdx, _setScaleIdx] = useState(2);
  const [_panX,     _setPanX]     = useState(0);
  const [isPan,     setIsPan]     = useState(false);
  const containerRef = useRef(null);
  const panRef       = useRef(null);

  // Slave mode — przejmuje wartości z GanttTab przez PlanTab
  const isSlave   = slavePanX !== undefined;
  const scaleIdx  = slaveScaleIdx !== undefined ? slaveScaleIdx : _scaleIdx;
  const panX      = slavePanX     !== undefined ? slavePanX     : _panX;
  const setScaleIdx = isSlave ? () => {} : _setScaleIdx;
  const setPanX     = isSlave ? () => {} : _setPanX;

  // DAY_W zsynchronizowany z Gantt gdy slave
  const DAY_W = slaveHourW !== undefined ? slaveHourW * 24 : SCALES[scaleIdx].dayW;
  const CYCLE = [0,4,8,12,16,20,24];

  // Zakres dat
  const dateRange = useMemo(() => {
    const ps = planStart || localDateStr(new Date());
    let minDt = new Date(ps + 'T00:00:00');
    let maxDt = null;
    if (subZP && subZP.length) {
      subZP.forEach(s => {
        (s.segments||[]).forEach(seg => {
          if (seg.segEnd) { const d = new Date(seg.segEnd); if (!maxDt||d>maxDt) maxDt=d; }
        });
        if (s.due_date) { const d = new Date(s.due_date+'T23:59:59'); if (!maxDt||d>maxDt) maxDt=d; }
      });
    } else if (zp.length) {
      zp.forEach(z => { const d = new Date(z.due_date); if (!maxDt||d>maxDt) maxDt=d; });
    }
    if (!maxDt) return [];
    minDt.setHours(0,0,0,0);
    maxDt.setHours(23,59,59,0);
    const dates = [];
    const cur = new Date(minDt);
    while (cur <= maxDt) { dates.push(localDateStr(cur)); cur.setDate(cur.getDate()+1); }
    return dates;
  }, [subZP, zp, planStart]);

  function defaultAvail(dateStr) {
    const jsDay = new Date(dateStr+'T12:00:00').getDay();
    return (jsDay===0||jsDay===6) ? 0 : 16;
  }
  function getH(wc, dateStr) {
    const sc = wcSchedule[wc];
    if (!sc) return defaultAvail(dateStr);
    if (typeof sc === 'object' && !Array.isArray(sc)) return sc[dateStr] !== undefined ? sc[dateStr] : defaultAvail(dateStr);
    if (Array.isArray(sc)) {
      const jsDay = new Date(dateStr+'T12:00:00').getDay();
      return sc[jsDay===0?6:jsDay-1] ?? defaultAvail(dateStr);
    }
    return defaultAvail(dateStr);
  }
  function cycleH(wc, dateStr) {
    const cur = getH(wc, dateStr);
    const idx = CYCLE.indexOf(cur);
    const next = CYCLE[(idx+1)%CYCLE.length];
    const prev = wcSchedule[wc];
    let newWC = (!prev || Array.isArray(prev)) ? {} : { ...prev };
    newWC[dateStr] = next;
    onScheduleChange({ ...wcSchedule, [wc]: newWC });
  }
  function needForDate(wc, dateStr) {
    if (!subZP || !subZP.length) return 0;
    let total = 0;
    subZP.forEach(s => {
      if (s.workcenter !== wc) return;
      (s.segments||[]).forEach(seg => {
        if (!seg.segStart) return;
        if (localDateStr(new Date(seg.segStart)) === dateStr) total += seg.durH;
      });
    });
    return total;
  }

  // Layout
  const LABEL_W = 110;
  const TOP_H   = 42;
  const ROW_H   = 50;
  const LANE_H  = ROW_H;
  const topH    = TOP_H + WCS.length * ROW_H;
  const contentW = dateRange.length * DAY_W;

  // ── WHEEL ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    function onWheel(e) {
      if (e.ctrlKey || e.metaKey) {
        if (isSlave) return;   // zoom kontroluje Gantt
        e.preventDefault();
        if (e.deltaY<0) setScaleIdx(v=>Math.max(0,v-1));
        else            setScaleIdx(v=>Math.min(SCALES.length-1,v+1));
      } else if (isSlave) {
        return; // slave: scroll obsługuje Gantt
      } else {
        e.preventDefault();
        setPanX(v => Math.min(0, Math.max(-(contentW-200), v-e.deltaY*1.5)));
      }
    }
    el.addEventListener('wheel', onWheel, {passive:false});
    return () => el.removeEventListener('wheel', onWheel);
  }, [contentW, topH, isSlave, embedded]);

  function onBgMouseDown(e) {
    if (isSlave) return;
    if (e.target.getAttribute('data-bg')==='1') {
      panRef.current = {startX:e.clientX, startPanX:panX};
      setIsPan(true);
    }
  }
  function onMouseMove(e) {
    if (!panRef.current) return;
    const dx = e.clientX - panRef.current.startX;
    setPanX(Math.min(0, Math.max(-(contentW-200), panRef.current.startPanX+dx)));
  }
  function onMouseUp() { panRef.current=null; setIsPan(false); }

  if (!WCS.length)       return <EmptyState icon="📅" title="Brak danych" sub="Wgraj routing.csv" />;
  if (!dateRange.length) return <EmptyState icon="📅" title="Brak zakresu dat" sub="Przelicz Gantt aby ustalić zakres" />;

  const dueDates = new Set(zp.map(z=>z.due_date));


  return (
    <div className={embedded ? 'grafik-tab grafik-tab--embedded' : undefined} style={embedded ? {display:'flex', flexDirection:'column', height:'100%'} : undefined}>
      {/* Controls — ukryte gdy embedded (slave) */}
      {!isSlave && (
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,flexWrap:'wrap'}}>
          <span style={{fontSize:13,color:T.text2}}>
            <strong style={{color:T.text}}>{dateRange[0]?.slice(5)} – {dateRange[dateRange.length-1]?.slice(5)}</strong>
            &nbsp;·&nbsp; {dateRange.length} dni &nbsp;·&nbsp; {WCS.length} gniazd
          </span>
          <div style={{display:'flex',gap:2,background:T.surface2,borderRadius:8,padding:2,marginLeft:8}}>
            {SCALES.map((sc,i) => (
              <button key={sc.key} onClick={()=>setScaleIdx(i)}
                style={{padding:'4px 10px',fontSize:11,fontWeight:600,borderRadius:6,border:'none',
                  background:i===scaleIdx?T.accent:'transparent',
                  color:i===scaleIdx?'#fff':T.text3,cursor:'pointer'}}>
                {sc.key}
              </button>
            ))}
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center',marginLeft:'auto'}}>
            <span style={{fontSize:10,color:T.text3}}>Ctrl+scroll=zoom · scroll=pan · scroll⬆⬇=gniazda · klik=zmień h</span>
            <button onClick={()=>{setPanX(0);setScaleIdx(2);}}
              style={{...s.btn(false),fontSize:11,padding:'4px 10px'}}>⊡ Reset</button>
          </div>
        </div>
      )}

      {/* Legenda */}
      <div style={{display:'flex',gap:12,fontSize:11,color:T.text3,marginBottom:8,flexWrap:'wrap',alignItems:'center'}}>
        {isSlave && <span style={{color:T.text3,fontSize:11}}>Kliknij komórkę aby zmienić godziny (cykl 0→4→8→…→24h)</span>}
        <span style={{marginLeft:isSlave?8:0,display:'flex',gap:8,alignItems:'center'}}>
          <span style={{color:T.ok,fontWeight:500}}>■ OK ≤85%</span>
          <span style={{color:T.warn,fontWeight:500}}>■ Uwaga 85-100%</span>
          <span style={{color:T.crit,fontWeight:500}}>■ Wąskie gardło &gt;100%</span>
          <span style={{color:T.text3}}>■ Brak pracy</span>
        </span>
        
      </div>

      <div style={embedded ? { flex:1, minHeight:0 } : { ...s.card, padding:0, overflow:'hidden' }}>
        <div ref={containerRef}
          style={{
            background: T.ganttBg,
            borderRadius: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            height: '100%',
            minHeight: 0,
            cursor: isPan ? 'grabbing' : 'default',
            userSelect: 'none',
            position: 'relative',
          }}
          onMouseDown={onBgMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <svg width="100%" height={topH} style={{display:'block'}}>
            <defs>
              <clipPath id="gfClip">
                <rect x={LABEL_W} y="0" width="10000" height={topH}/>
              </clipPath>
            </defs>

            <rect x="0" y="0" width="100%" height={embedded ? topH : '100%'} fill={T.ganttBg} data-bg="1"/>

            {/* SCROLLOWANA zawartość — obie osie */}
            <g clipPath="url(#gfClip)">
              <g transform={`translate(${panX},0)`}>
                {/* Tła pasków */}
                {WCS.map((_,wi) => (
                  <rect key={`tbg${wi}`} x={LABEL_W} y={TOP_H+wi*ROW_H} width={contentW+40} height={ROW_H}
                    fill={wi%2===0?T.surface:T.surface2}/>
                ))}
                {/* Nagłówki dat */}
                {dateRange.map((d,di) => {
                  const x = LABEL_W + di*DAY_W;
                  const dt = new Date(d+'T12:00:00');
                  const jsDay = dt.getDay();
                  const isWe = jsDay===0||jsDay===6;
                  const isDue = dueDates.has(d);
                  return (
                    <g key={`hdr${d}`}>
                      {isWe && <rect x={x} y={TOP_H} width={DAY_W} height={WCS.length*ROW_H} fill="rgba(0,0,0,0.18)"/>}
                      <line x1={x} y1={0} x2={x} y2={topH} stroke={T.border} strokeWidth="0.5"/>
                      <text x={x+DAY_W/2} y={TOP_H-18} textAnchor="middle"
                        fontSize="10" fontWeight={isDue?700:400} fill={isDue?T.bn:isWe?T.text3:T.text2}>
                        {String(dt.getDate()).padStart(2,'0')}.{String(dt.getMonth()+1).padStart(2,'0')}
                      </text>
                      <text x={x+DAY_W/2} y={TOP_H-6} textAnchor="middle" fontSize="9" fill={T.text3}>
                        {DAY_NAMES[jsDay]}
                      </text>
                      {isDue && <rect x={x} y={0} width={DAY_W} height={4} rx="1" fill={T.bn} opacity="0.7"/>}
                    </g>
                  );
                })}
                {/* Komórki utilization */}
                {WCS.map((wc,wi) => (
                  <g key={`top${wc}`}>
                    {dateRange.map((d,di) => {
                      const x    = LABEL_W + di*DAY_W;
                      const h    = getH(wc, d);
                      const need = needForDate(wc, d);
                      const ratio = h > 0 ? need / h : (need > 0 ? 999 : 0);
                      const pad  = 3;
                      let bg, textCol, borderCol;
                      if (h===0&&need===0)      { bg='rgba(0,0,0,0)'; textCol=T.text3; borderCol='transparent'; }
                      else if (need===0)         { bg='rgba(255,255,255,0.04)'; textCol=T.text3; borderCol='transparent'; }
                      else if (ratio>1.0)        { bg=T.critBg; textCol=T.crit; borderCol=T.crit; }
                      else if (ratio>0.85)       { bg=T.warnBg; textCol=T.warn; borderCol=T.warn; }
                      else if (ratio>0)          { bg=T.okBg;   textCol=T.ok;   borderCol=T.ok; }
                      else                       { bg='rgba(255,255,255,0.04)'; textCol=T.text3; borderCol='transparent'; }
                      return (
                        <g key={d} style={{cursor:'pointer'}} onClick={() => cycleH(wc, d)}>
                          <rect x={x+pad} y={TOP_H+wi*ROW_H+pad}
                            width={DAY_W-pad*2} height={ROW_H-pad*2}
                            rx="4" fill={bg} stroke={borderCol} strokeWidth={ratio>0.85?1.5:0}/>
                          <text x={x+DAY_W/2} y={TOP_H+wi*ROW_H+ROW_H/2-4}
                            textAnchor="middle" fontSize={DAY_W>40?11:9}
                            fontWeight="600" fill={textCol} fontFamily="monospace"
                            style={{pointerEvents:'none'}}>
                            {h>0 ? h+'h' : '—'}
                          </text>
                          {need>0 && DAY_W>30 && (
                            <text x={x+DAY_W/2} y={TOP_H+wi*ROW_H+ROW_H/2+10}
                              textAnchor="middle" fontSize="9"
                              fill={textCol} fontFamily="monospace" opacity="0.8"
                              style={{pointerEvents:'none'}}>
                              {Math.round(ratio*100)}%
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                ))}
                {/* Linie poziome */}
                {WCS.map((_,wi) => (
                  <line key={`ln${wi}`} x1={LABEL_W} y1={TOP_H+(wi+1)*ROW_H}
                    x2={LABEL_W+contentW+40} y2={TOP_H+(wi+1)*ROW_H}
                    stroke={T.border} strokeWidth="0.5"/>
                ))}
              </g>
            </g>

            {/* STAŁA lewa kolumna — przesuwa się tylko pionowo */}
            <rect x="0" y="0" width={LABEL_W} height="10000" fill={T.ganttBg}/>
            <g>
              {WCS.map((wc,wi) => {
                const totalNeed  = dateRange.reduce((sum,d)=>sum+needForDate(wc,d),0);
                const totalAvail = dateRange.reduce((sum,d)=>sum+getH(wc,d),0);
                const ratio = totalAvail>0 ? totalNeed/totalAvail : 0;
                const col = ratio>1?T.crit:ratio>0.85?T.warn:totalNeed>0?T.ok:T.text3;
                return (
                  <g key={`lbl${wc}`}>
                    <rect x="0" y={TOP_H+wi*ROW_H} width={LABEL_W} height={ROW_H} fill={T.surface2}/>
                    <text x="12" y={TOP_H+wi*ROW_H+ROW_H/2-5} fontSize="12" fontWeight="700" fill={T.text}>{wc}</text>
                    <text x="12" y={TOP_H+wi*ROW_H+ROW_H/2+10} fontSize="10" fill={col}>{Math.round(ratio*100)}%</text>
                  </g>
                );
              })}
            </g>
            {/* Przykrycie nagłówka — stały */}
            <rect x="0" y="0" width={LABEL_W} height={TOP_H} fill={T.surface2}/>
            <text x="12" y={TOP_H-12} fontSize="9" fontWeight="600" fill={T.text3} textTransform="uppercase">DOSTĘPNE H</text>
            <line x1={LABEL_W} y1="0" x2={LABEL_W} y2="10000" stroke={T.border2} strokeWidth="1.5"/>

          </svg>

          {/* Scrollbar poziomy */}
          {contentW > 200 && (
            <div style={{position:'absolute',bottom:4,left:LABEL_W,right:8,height:5,
              background:'rgba(255,255,255,0.05)',borderRadius:3}}>
              <div style={{position:'absolute',top:0,height:'100%',borderRadius:3,
                background:'rgba(255,255,255,0.2)',
                width:`${Math.min(100,((containerRef.current?.offsetWidth||900)-LABEL_W)/(contentW||1)*100)}%`,
                left:`${contentW>0?(-panX/contentW)*100:0}%`,
                transition:'left 0.05s'}}/>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}