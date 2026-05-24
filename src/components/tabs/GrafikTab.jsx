import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { T, PALETTE, s, tocColor, uStatus } from '../../constants/theme.js';
import { localDateStr, fmtDt, computeLoads, getAvail } from '../../utils/scheduler.js';
import { EmptyState } from '../common/EmptyState.jsx';
import { DAY_NAMES } from '../../constants/theme.js';
export function GrafikTab({ routing, zp, wcSchedule, onScheduleChange, subZP, slavePanX, slaveScaleIdx, slaveHourW, planStart, embedded }) {
  
  const WCS = useMemo(() => [...new Set(routing.map(r => r.workcenter))].sort(), [routing]);
  const DAYS_LABEL = ['Pon','Wt','Śr','Czw','Pt','Sob','Nd'];
  const DAYS_FULL  = ['Poniedziałek','Wtorek','Środa','Czwartek','Piątek','Sobota','Niedziela'];

  // Skale (identyczne jak Gantt)
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
  const [isPan,    setIsPan]    = useState(false);
  const containerRef = useRef(null);
  const panRef       = useRef(null);

  // Slave mode: używaj wartości z zewnątrz
  const scaleIdx = slaveScaleIdx !== undefined ? slaveScaleIdx : _scaleIdx;
  const panX     = slavePanX     !== undefined ? slavePanX     : _panX;
  const setScaleIdx = slaveScaleIdx !== undefined ? () => {} : _setScaleIdx;
  const setPanX     = slavePanX     !== undefined ? () => {} : _setPanX;

  // W slave mode: DAY_W = HOUR_W * 24 (zsynchronizowany z Gantt)
  const DAY_W = slaveHourW !== undefined ? slaveHourW * 24 : SCALES[scaleIdx].dayW;
  const CYCLE = [0,4,8,12,16,20,24];

  // Model godzin: { wc: { "2026-05-22": 16, ... } }
  // onScheduleChange teraz przyjmuje ten format
  // Backwards compat: stary format [pon..nd] → konwertujemy

  // Zakres dat z subZP lub ZP (w slave mode zaczyna od axisStart Ganttu)
  const dateRange = useMemo(() => {
    let minDt = null, maxDt = null;
    // minDt = planStart — zawsze zacznij od tej samej daty co Gantt
    const ps = planStart || localDateStr(new Date());
    minDt = new Date(ps + 'T00:00:00');
    if (subZP && subZP.length) {
      subZP.forEach(s => {
        (s.segments||[]).forEach(seg => {
          if (seg.segEnd) { const d = new Date(seg.segEnd); if (!maxDt||d>maxDt) maxDt=d; }
        });
        if (s.due_date) { const d = new Date(s.due_date+'T23:59:59'); if (!maxDt||d>maxDt) maxDt=d; }
      });
    } else if (zp.length) {
      zp.forEach(z => {
        const d = new Date(z.due_date);
        if (!minDt) minDt=d;
        if (!maxDt||d>maxDt) maxDt=d;
      });
    }
    if (!minDt||!maxDt) return [];
    minDt = new Date(minDt); minDt.setHours(0,0,0,0);
    maxDt = new Date(maxDt); maxDt.setHours(23,59,59,0);
    const dates = [];
    const cur = new Date(minDt);
    while (cur <= maxDt) { dates.push(localDateStr(cur)); cur.setDate(cur.getDate()+1); }
    return dates;
  }, [subZP ? subZP.length : 0, zp.length, planStart, subZP && subZP[0] ? (subZP[0].segments && subZP[0].segments[0] ? subZP[0].segments[0].segStart : null) : null]);

  // Domyślna dostępność dla daty
  function defaultAvail(dateStr) {
    const jsDay = new Date(dateStr+'T12:00:00').getDay();
    return (jsDay===0||jsDay===6) ? 0 : 16;
  }

  // Pobierz godziny dla wc+date z nowego lub starego formatu
  function getH(wc, dateStr) {
    const s = wcSchedule[wc];
    if (!s) return defaultAvail(dateStr);
    // Nowy format: obiekt z datami
    if (typeof s === 'object' && !Array.isArray(s)) {
      return s[dateStr] !== undefined ? s[dateStr] : defaultAvail(dateStr);
    }
    // Stary format: tablica [pon..nd]
    if (Array.isArray(s)) {
      const jsDay = new Date(dateStr+'T12:00:00').getDay();
      const idx = jsDay===0?6:jsDay-1;
      return s[idx] ?? defaultAvail(dateStr);
    }
    return defaultAvail(dateStr);
  }

  function setH(wc, dateStr, h) {
    const prev = wcSchedule[wc];
    // Konwertuj stary format na nowy jeśli potrzeba
    let newWC = {};
    if (prev && !Array.isArray(prev) && typeof prev === 'object') {
      newWC = { ...prev };
    }
    newWC[dateStr] = h;
    onScheduleChange({ ...wcSchedule, [wc]: newWC });
  }

  function cycleH(wc, dateStr) {
    const cur = getH(wc, dateStr);
    const idx = CYCLE.indexOf(cur);
    const next = CYCLE[(idx+1)%CYCLE.length];
    setH(wc, dateStr, next);
  }

  // Rzeczywiste godziny pracy na gnieździe w danym dniu — z segmentów back-schedule
  function needForDate(wc, dateStr) {
    if (!subZP || !subZP.length) {
      // Fallback: szacunek z ZP.due_date gdy brak back-schedule
      return zp.filter(z => z.due_date===dateStr).reduce((sum,z) => {
        const op = routing.find(r => r.product===z.product && r.workcenter===wc);
        return sum + (op ? z.volume*op.ct_min/60 : 0);
      }, 0);
    }
    // Sumuj godziny segmentów które przypadają na ten dzień i gniazdo
    let total = 0;
    subZP.forEach(s => {
      if (s.workcenter !== wc) return;
      (s.segments || []).forEach(seg => {
        if (!seg.segStart) return;
        const segDate = localDateStr(new Date(seg.segStart));
        if (segDate === dateStr) total += seg.durH;
      });
    });
    return total;
  }

  // Layout
  const LABEL_W = 110;
  const TOP_H   = 42;   // nagłówek dat
  const ROW_H   = 50;   // panel: h/dzień per gniazdo (większy bo utilization)
  const topH    = TOP_H + WCS.length * ROW_H;  // całkowita wysokość panelu
  const GAP     = 0;   // brak separatora (jeden panel)
  const LANE_H  = ROW_H;  // alias dla kompatybilności
  const contentW = dateRange.length * DAY_W;

  const isSlave = slavePanX !== undefined;

  // Wheel handler
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    function onWheel(e) {
      if (e.ctrlKey||e.metaKey) {
        if (isSlave) return;
        e.preventDefault();
        if (e.deltaY<0) setScaleIdx(v=>Math.max(0,v-1));
        else            setScaleIdx(v=>Math.min(SCALES.length-1,v+1));
      } else if (embedded && !e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        return;
      } else if (isSlave) {
        return;
      } else {
        e.preventDefault();
        setPanX(v => Math.min(0, Math.max(-(contentW-200), v-e.deltaY*1.5)));
      }
    }
    el.addEventListener('wheel', onWheel, {passive:false});
    return () => el.removeEventListener('wheel', onWheel);
  }, [contentW, embedded, isSlave]);

  function onBgMouseDown(e) {
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

  if (!WCS.length) return <EmptyState icon="📅" title="Brak danych" sub="Wgraj routing.csv" />;
  if (!dateRange.length) return <EmptyState icon="📅" title="Brak zakresu dat" sub="Przelicz Gantt aby ustalić zakres" />;

  const dueDates  = new Set(zp.map(z=>z.due_date));

  // Kolor dostępności
  function availColor(h) {
    if (h===0)  return {bg:'rgba(0,0,0,0)',   text:T.text3};
    if (h<=8)   return {bg:'rgba(52,211,153,0.15)',  text:T.ok};
    if (h<=16)  return {bg:'rgba(77,148,255,0.15)',  text:T.accent};
    return             {bg:'rgba(168,85,247,0.15)',  text:'#c084fc'};
  }
  // Kolor zapotrzebowania
  function needColor(need, avail) {
    if (need===0) return {bg:'rgba(255,255,255,0.02)', text:T.text3};
    const r = avail>0 ? need/avail : 999;
    if (r>1.3) return {bg:T.critBg, text:T.crit};
    if (r>1.0) return {bg:T.bnBg,   text:T.bn};
    if (r>0.85)return {bg:T.warnBg, text:T.warn};
    return            {bg:T.okBg,   text:T.ok};
  }

  return (
    <div className={embedded ? 'grafik-tab grafik-tab--embedded' : undefined}>
      {/* Controls — ukryte w slave mode */}
      {slavePanX === undefined && <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,flexWrap:'wrap'}}>
        <span style={{fontSize:13,color:T.text2}}>
          <strong style={{color:T.text}}>
            {dateRange[0]?.slice(5)} – {dateRange[dateRange.length-1]?.slice(5)}
          </strong>
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
          <span style={{fontSize:10,color:T.text3}}>Ctrl+scroll=zoom · scroll=pan · klik=zmień h</span>
          <button onClick={()=>{setPanX(0);setScaleIdx(2);}}
            style={{...s.btn(false),fontSize:11,padding:'4px 10px'}}>⊡ Reset</button>
        </div>
      </div>}

      {/* Legenda */}
      <div className={embedded ? 'grafik-tab-legend' : undefined} style={{display:'flex',gap:12,fontSize:11,color:T.text3,marginBottom:8,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{color:T.text3}}>
          {embedded ? 'Scroll=przewijanie gniazd · klik=zmień h (0→4→8→…→24h)' : 'Kliknij komórkę aby zmienić godziny (cykl 0→4→8→…→24h)'}
        </span>
        <span style={{marginLeft:8,display:'flex',gap:8,alignItems:'center'}}>
          <span style={{color:T.ok,fontWeight:500}}>■ OK ≤85%</span>
          <span style={{color:T.warn,fontWeight:500}}>■ Uwaga 85-100%</span>
          <span style={{color:T.crit,fontWeight:500}}>■ Wąskie gardło &gt;100%</span>
          <span style={{color:T.text3}}>■ Brak pracy</span>
        </span>
      </div>

      <div style={embedded ? undefined : {...s.card,padding:0,overflow:'hidden'}}>
        <div ref={containerRef}
          className={embedded ? 'grafik-chart-wrap' : undefined}
          style={{
            background: T.ganttBg,
            borderRadius: embedded ? 0 : 12,
            overflow: embedded ? 'auto' : 'hidden',
            ...(embedded ? {} : { height: 'calc(100vh - 280px)', minHeight: 320 }),
            cursor: isPan ? 'grabbing' : 'default',
            userSelect: 'none',
            position: 'relative',
          }}
          onMouseDown={onBgMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <svg width="100%" height={embedded ? topH : '100%'} style={{display:'block', minHeight: embedded ? topH : undefined}}>
            <defs>
              <clipPath id="gfClip">
                <rect x={LABEL_W} y="0" width="10000" height="10000"/>
              </clipPath>
            </defs>

            {/* Tło */}
            <rect x="0" y="0" width="100%" height={embedded ? topH : '100%'} fill={T.ganttBg} data-bg="1"/>

            {/* separator usunięty — jeden panel */}

            {/* ── SCROLLOWANA ZAWARTOŚĆ ── */}
            <g clipPath="url(#gfClip)">
              <g transform={`translate(${panX},0)`}>

                {/* Tła pasków */}
                {WCS.map((_,wi) => (
                  <rect key={`tbg${wi}`} x={LABEL_W} y={TOP_H+wi*ROW_H} width={contentW+40} height={ROW_H}
                    fill={wi%2===0?T.surface:T.surface2}/>
                ))}

                {/* Nagłówki dat (JEDEN — wspólny dla obu paneli) */}
                {dateRange.map((d,di) => {
                  const x = LABEL_W + di*DAY_W;
                  const dt = new Date(d+'T12:00:00');
                  const jsDay = dt.getDay();
                  const isWe = jsDay===0||jsDay===6;
                  const isDue = dueDates.has(d);
                  return (
                    <g key={`hdr${d}`}>
                      {/* Weekend overlay — oba panele */}
                      {isWe && <rect x={x} y={TOP_H} width={DAY_W}
                        height={WCS.length*ROW_H}
                        fill="rgba(0,0,0,0.18)"/>}
                      <line x1={x} y1={0} x2={x}
                        y2={topH}
                        stroke={T.border} strokeWidth="0.5"/>
                      {/* Data */}
                      <text x={x+DAY_W/2} y={TOP_H-18} textAnchor="middle"
                        fontSize="10" fontWeight={isDue?700:400}
                        fill={isDue?T.bn:isWe?T.text3:T.text2}>
                        {String(dt.getDate()).padStart(2,'0')}.{String(dt.getMonth()+1).padStart(2,'0')}
                      </text>
                      {/* Dzień tygodnia */}
                      <text x={x+DAY_W/2} y={TOP_H-6} textAnchor="middle"
                        fontSize="9" fill={isWe?T.text3:T.text3}>
                        {DAY_NAMES[jsDay]}
                      </text>
                      {/* Due marker */}
                      {isDue && <rect x={x} y={0} width={DAY_W} height={4} rx="1"
                        fill={T.bn} opacity="0.7"/>}
                    </g>
                  );
                })}

                {/* ── PANEL: dostępne h + utilization — klikalne ── */}
                {WCS.map((wc,wi) => (
                  <g key={`top${wc}`}>
                    {dateRange.map((d,di) => {
                      const x     = LABEL_W + di*DAY_W;
                      const h     = getH(wc, d);
                      const need  = needForDate(wc, d);
                      const ratio = h > 0 ? need / h : (need > 0 ? 999 : 0);
                      const pad   = 3;
                      // Kolor wg utilization (nie wg dostępnych h)
                      let bg, textCol, borderCol;
                      if (h === 0 && need === 0) {
                        bg='rgba(0,0,0,0)'; textCol=T.text3; borderCol='transparent';
                      } else if (need === 0) {
                        bg='rgba(255,255,255,0.04)'; textCol=T.text3; borderCol='transparent';
                      } else if (ratio > 1.0) {
                        bg=T.critBg; textCol=T.crit; borderCol=T.crit;
                      } else if (ratio > 0.85) {
                        bg=T.warnBg; textCol=T.warn; borderCol=T.warn;
                      } else if (ratio > 0) {
                        bg=T.okBg; textCol=T.ok; borderCol=T.ok;
                      } else {
                        bg='rgba(255,255,255,0.04)'; textCol=T.text3; borderCol='transparent';
                      }
                      return (
                        <g key={d} style={{cursor:'pointer'}} onClick={() => cycleH(wc, d)}>
                          <rect x={x+pad} y={TOP_H+wi*ROW_H+pad}
                            width={DAY_W-pad*2} height={ROW_H-pad*2}
                            rx="4" fill={bg}
                            stroke={borderCol} strokeWidth={ratio>0.85?1.5:0}/>
                          {/* Godziny */}
                          <text x={x+DAY_W/2} y={TOP_H+wi*ROW_H+ROW_H/2-4}
                            textAnchor="middle" fontSize={DAY_W>40?11:9}
                            fontWeight="600" fill={textCol} fontFamily="monospace"
                            style={{pointerEvents:'none'}}>
                            {h>0 ? h+'h' : '—'}
                          </text>
                          {/* Utilization % — tylko gdy jest praca */}
                          {need > 0 && DAY_W > 30 && (
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

                {/* dolny panel usunięty — utilization w górnym */}

                {/* Linie poziome */}
                {WCS.map((_,wi) => (
                  <line key={`ln${wi}`} x1={LABEL_W} y1={TOP_H+(wi+1)*ROW_H}
                    x2={LABEL_W+contentW+40} y2={TOP_H+(wi+1)*ROW_H}
                    stroke={T.border} strokeWidth="0.5"/>
                ))}

              </g>
            </g>

            {/* ── STAŁA LEWA KOLUMNA ── */}
            {/* Tło */}
            <rect x="0" y="0" width={LABEL_W} height="10000" fill={T.ganttBg}/>
            {/* Nagłówek górny panel */}
            <rect x="0" y="0" width={LABEL_W} height={TOP_H} fill={T.surface2}/>
            <text x="12" y={TOP_H-12} fontSize="9" fontWeight="600"
              fill={T.text3} textTransform="uppercase">DOSTĘPNE H</text>
            {/* Górny panel labels */}
            {WCS.map((wc,wi) => {
              const totalAvail = dateRange.reduce((s,d)=>s+getH(wc,d),0);
              return (
                <g key={`ltop${wc}`}>
                  <rect x="0" y={TOP_H+wi*ROW_H} width={LABEL_W} height={ROW_H}
                    fill={T.surface2}/>
                  <text x="12" y={TOP_H+wi*ROW_H+ROW_H/2-4} fontSize="12"
                    fontWeight="700" fill={T.text}>{wc}</text>
                  <text x="12" y={TOP_H+wi*ROW_H+ROW_H/2+10} fontSize="10"
                    fill={T.text3}>{totalAvail}h</text>
                </g>
              );
            })}
            {/* Lewa kolumna */}
            {WCS.map((wc,wi) => {
              const totalNeed  = dateRange.reduce((s,d)=>s+needForDate(wc,d),0);
              const totalAvail = dateRange.reduce((s,d)=>s+getH(wc,d),0);
              const ratio = totalAvail>0 ? totalNeed/totalAvail : 0;
              const col = ratio>1?T.crit:ratio>0.85?T.warn:totalNeed>0?T.ok:T.text3;
              return (
                <g key={`lbl${wc}`}>
                  <rect x="0" y={TOP_H+wi*ROW_H} width={LABEL_W} height={ROW_H}
                    fill={T.surface2}/>
                  <text x="12" y={TOP_H+wi*ROW_H+ROW_H/2-5} fontSize="12"
                    fontWeight="700" fill={T.text}>{wc}</text>
                  <text x="12" y={TOP_H+wi*ROW_H+ROW_H/2+10} fontSize="10"
                    fill={col}>{Math.round(ratio*100)}%</text>
                </g>
              );
            })}
            {/* Separator pionowy */}
            <line x1={LABEL_W} y1="0" x2={LABEL_W} y2="10000"
              stroke={T.border2} strokeWidth="1.5"/>
          </svg>

          {/* Scrollbar */}
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



// ─── ZAKŁADKA: PLAN (Gantt + Grafik zasobów) ──────────────────────────────