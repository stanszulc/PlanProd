import { useMemo } from 'react';
import { T, s, tocColor, uStatus } from '../../constants/theme.js';
import { computeLoads } from '../../utils/scheduler.js';
import { calcBottlenecks } from '../../utils/bottleneck.js';

// Wersja aplikacji — ręcznie podbijana (V1.1 -> V1.2 -> ...), bez powiązania z commitami.
const APP_VERSION = 'V1.2';

function tocZone(toc) {
  if (!toc) return 'green';
  if (typeof toc === 'string') return toc;
  return toc.zone || 'green';
}

export function DashboardTab({ routing, zp, zpStatus, wcSchedule, historyData, globalLookups, onTabChange, hybridMode, fwdZP, wcToBrygada }) {

  // ── KPI ────────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    if (!zpStatus.length) return null;
    const zsSet     = new Set(zpStatus.map(z => z.zs_id).filter(Boolean));
    const onTime    = zpStatus.filter(z => tocZone(z.toc) !== 'black').length;
    const otd       = zpStatus.length ? Math.round((onTime / zpStatus.length) * 100) : 0;
    const delayed   = zpStatus.filter(z => tocZone(z.toc) === 'black');
    const delayedZS = new Set(delayed.map(z => z.zs_id).filter(Boolean));
    return {
      zsCount:   zsSet.size,
      zpCount:   zpStatus.length,
      otd,
      onTime,
      delayedZP: delayed.length,
      delayedZS: delayedZS.size,
    };
  }, [zpStatus]);

  // ── Utilization per gniazdo ────────────────────────────────────────────────
  const wcLoads = useMemo(() => {
    if (!zp.length || !routing.length) return [];
    const dates    = [...new Set(zp.map(z => z.due_date))];
    const allLoads = {};
    dates.forEach(d => {
      const zpForDate = zp.filter(z => z.due_date === d);
      const loads     = computeLoads(globalLookups.routingByProduct, zpForDate, wcSchedule, d);
      Object.entries(loads).forEach(([wc, v]) => {
        if (!allLoads[wc]) allLoads[wc] = { load: 0, cap: 0, overDays: 0 };
        if (v.cap > 0) { allLoads[wc].load += v.load; allLoads[wc].cap += v.cap; }
        else if (v.load > 0) allLoads[wc].overDays += 1; // praca w dniu bez capa — osobno, bez 999
      });
    });
    // Utilizacja ważona godzinami (suma load / suma cap po dniach z cap>0).
    // util=null → gniazdo ma pracę tylko w dniach bez capa (przeciążenie bez wartości %).
    return Object.entries(allLoads)
      .map(([wc, a]) => ({
        wc,
        util: a.cap > 0 ? Math.round(a.load / a.cap * 100) : null,
        overDays: a.overDays,
      }))
      .filter(w => w.util !== null || w.overDays > 0)
      .sort((a, b) => (b.util ?? Infinity) - (a.util ?? Infinity));
  }, [zp, routing, globalLookups, wcSchedule]);

  // ── Wąskie gardła wg planu (jedna definicja: utils/bottleneck.js) ──────────
  const hasPlan = Array.isArray(fwdZP) && fwdZP.length > 0;
  const planBn = useMemo(
    () => (hasPlan ? calcBottlenecks({ fwdZP, wcSchedule, wcToBrygada: wcToBrygada || {} }) : null),
    [hasPlan, fwdZP, wcSchedule, wcToBrygada]
  );

  const measured = wcLoads.filter(w => w.util !== null);
  const demandAvg = measured.length
    ? Math.round(measured.reduce((s, w) => s + w.util, 0) / measured.length)
    : 0;
  // Wg planu: Σload / Σcap po wszystkich brygadach na dniach cap>0 (nie średnia z procentów).
  const planAvg = useMemo(() => {
    if (!planBn) return 0;
    let load = 0, cap = 0;
    planBn.groups.forEach(g => g.days.forEach(d => { if (d.cap > 0) { load += d.load; cap += d.cap; } }));
    return cap > 0 ? Math.round(load / cap * 100) : 0;
  }, [planBn]);
  const avgUtil = planBn ? planAvg : demandAvg;
  const basisLabel = planBn ? 'wg planu' : 'wg terminów';

  // ── Alerty TOC ─────────────────────────────────────────────────────────────
  const alerts = useMemo(() => {
    return [...zpStatus]
      .filter(z => ['black', 'red', 'yellow'].includes(tocZone(z.toc)))
      .sort((a, b) => {
        const order = { black: 0, red: 1, yellow: 2, green: 3 };
        return (order[tocZone(a.toc)] ?? 9) - (order[tocZone(b.toc)] ?? 9);
      });
  }, [zpStatus]);

  // ── Historia ostatnie 7 dni ────────────────────────────────────────────────
  const historyStats = useMemo(() => {
    if (!historyData.length) return null;
    const now    = new Date();
    const ago7   = new Date(now - 7 * 24 * 3600 * 1000);
    const recent = historyData.filter(r => new Date(r.start_ts) >= ago7);
    if (!recent.length) return null;

    const byDay = {};
    recent.forEach(r => {
      const d   = new Date(r.start_ts);
      const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      if (!byDay[key]) byDay[key] = { ops: 0, devSum: 0, devCount: 0 };
      byDay[key].ops++;
      if (r.deviation_pct != null) { byDay[key].devSum += r.deviation_pct; byDay[key].devCount++; }
    });

    const days = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([date, v]) => ({
        date,
        ops:    v.ops,
        avgDev: v.devCount ? +(v.devSum / v.devCount).toFixed(1) : null,
      }));

    const totalOps  = recent.length;
    const avgDevAll = recent.filter(r => r.deviation_pct != null).length
      ? +(recent.filter(r => r.deviation_pct != null)
            .reduce((s, r) => s + r.deviation_pct, 0) /
           recent.filter(r => r.deviation_pct != null).length).toFixed(1)
      : null;

    return { days, totalOps, avgDevAll };
  }, [historyData]);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!zp.length && !routing.length) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🏠</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 8 }}>Witaj w FlowOps</div>
        <div style={{ fontSize: 13, color: T.text3, marginBottom: 24 }}>Wczytaj dane aby zobaczyć dashboard</div>
        <button
          style={{ padding: '10px 28px', fontSize: 13, fontWeight: 600, borderRadius: 10, border: 'none', background: T.accent, color: '#fff', cursor: 'pointer' }}
          onClick={() => onTabChange('import')}>
          Przejdź do importu →
        </button>
        <div style={{ fontSize: 10, color: T.text3, marginTop: 28, fontFamily: 'monospace' }}>
          wersja {APP_VERSION}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── WIERSZ 1: KPI ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        <KpiCard
          label="ZS w realizacji"
          value={kpi?.zsCount ?? '—'}
          sub={`${kpi?.zpCount ?? 0} zleceń produkcyjnych`}
          color={T.accent}
          icon="🧾"
          onClick={() => onTabChange('plan')}
        />
        <KpiCard
          label={hybridMode ? 'OTD (actual) 🔬' : 'OTD (prognoza)'}
          value={kpi ? `${kpi.otd}%` : '—'}
          sub={`${kpi?.onTime ?? 0} z ${kpi?.zpCount ?? 0} ZP na czas`}
          color={kpi?.otd >= 80 ? T.ok : kpi?.otd >= 60 ? T.warn : T.bn}
          icon="🎯"
        />
        <KpiCard
          label="Avg utilization"
          value={`${avgUtil}%`}
          sub={planBn ? `${planBn.groups.length} brygad · ${basisLabel}` : `${wcLoads.length} gniazd · ${basisLabel}`}
          color={avgUtil <= 85 ? T.ok : avgUtil <= 100 ? T.warn : T.bn}
          icon="⚙️"
          onClick={() => onTabChange('heatmap')}
        />
        <KpiCard
          label="Spóźnione ZS"
          value={kpi?.delayedZS ?? '—'}
          sub={`${kpi?.delayedZP ?? 0} ZP po terminie`}
          color={kpi?.delayedZS > 0 ? T.bn : T.ok}
          icon="⚠️"
          onClick={() => onTabChange('late_zs')}
        />
      </div>

      {/* ── WIERSZ 2: ALERT CENTER ─────────────────────────────────────────── */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={s.cardTitle}>🚨 Alert Center — bufory TOC</div>
          {alerts.length > 0 && (
            <span style={{ ...s.tag(T.bn), fontSize: 11 }}>{alerts.length} aktywnych</span>
          )}
        </div>

        {alerts.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', color: T.ok }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <span style={{ fontSize: 13 }}>Wszystkie zlecenia w normie — brak alertów</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 100px 90px 120px', gap: 8, padding: '4px 8px' }}>
              {['Strefa', 'ZP', 'ZS / Klient', 'Termin', 'Opóźnienie', 'Najdłuższa operacja'].map(h => (
                <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.text3 }}>{h}</span>
              ))}
            </div>
            {alerts.map(z => {
              const tc       = tocColor(tocZone(z.toc));
              const delayTxt = z.delayDays > 0 ? `+${z.delayDays}d` : tocZone(z.toc) === 'black' ? 'po term.' : '—';
              return (
                <div key={z.zp_id}
                  style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 100px 90px 120px', gap: 8, padding: '8px', borderRadius: 8, background: tc.bg, border: `1px solid ${tc.border}`, alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => onTabChange('late_zs')}>
                  <span style={{ ...s.badge(tc), fontSize: 10, justifyContent: 'center' }}>
                    {tocZone(z.toc) === 'black' ? '⚫ CZARNY' : tocZone(z.toc) === 'red' ? '🔴 CZERWONY' : '🟡 ŻÓŁTY'}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{z.zp_id}</span>
                  <span style={{ fontSize: 11, color: T.text2 }}>
                    {z.zs_id && <span style={{ color: T.text3 }}>{z.zs_id} · </span>}
                    {z.klient || '—'}
                  </span>
                  <span style={{ fontSize: 11, color: T.text2, fontFamily: 'monospace' }}>{z.due_date}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: tc.text, fontFamily: 'monospace' }}>{delayTxt}</span>
                  <span style={{ fontSize: 11, color: T.text3 }}>{z.bottleneck || '—'}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── WIERSZ 3: CAPACITY WATCH + HISTORIA ────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: historyStats ? '1fr 1fr' : '1fr', gap: 16 }}>

        {/* Capacity Watch */}
        <div style={s.card}>
          <div style={s.cardTitle}>⚙️ Capacity Watch <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· {basisLabel}</span></div>
          {planBn ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {planBn.primary ? (
                <div style={{ fontSize: 12, fontWeight: 600, color: uStatus(planBn.primary.peakUtil).text }}>
                  Wąskie gardło: {planBn.primary.name} — nadwyżka {planBn.primary.excessH.toFixed(1)} h w {planBn.primary.overloadDays} dniach
                </div>
              ) : (
                <div style={{ fontSize: 12, fontWeight: 600, color: T.ok }}>brak przeciążeń</div>
              )}
              {planBn.groups.map(g => {
                const st = uStatus(g.peakUtil);
                const pct = Math.round(g.avgUtil * 100);
                return (
                  <div key={g.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{g.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ ...s.badge(st), fontSize: 10 }}>{g.status}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: st.text, fontFamily: 'monospace' }}
                          title={`Szczyt ${Math.round(g.peakUtil * 100)}% (${g.peakDate})`}>{pct}%</span>
                      </div>
                    </div>
                    <div style={{ background: T.surface3, borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(pct, 130)}%`, height: '100%', background: st.dot, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                <LegendDot color={T.ok}   label="≤ 85% OK" />
                <LegendDot color={T.warn} label="86–100% Uwaga" />
                <LegendDot color={T.bn}   label="> 100% BN" />
              </div>
            </div>
          ) : wcLoads.length === 0 ? (
            <div style={{ color: T.text3, fontSize: 12 }}>Brak danych obciążenia</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {wcLoads.map(({ wc, util: utilRaw, overDays }) => {
                const noCap = utilRaw === null;
                const util  = noCap ? 130 : utilRaw;
                const st = uStatus(noCap ? Infinity : util / 100);
                return (
                  <div key={wc}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{wc}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ ...s.badge(st), fontSize: 10 }}>{st.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: st.text, fontFamily: 'monospace' }}
                          title={overDays > 0 ? `Praca w ${overDays} dn. bez dostępnej pojemności` : undefined}>
                          {noCap ? '!' : `${util}%${overDays > 0 ? ' !' : ''}`}
                        </span>
                      </div>
                    </div>
                    <div style={{ background: T.surface3, borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(util, 130)}%`,
                        height: '100%',
                        background: st.dot,
                        borderRadius: 4,
                        transition: 'width 0.3s',
                      }} />
                    </div>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                <LegendDot color={T.ok}   label="≤ 85% OK" />
                <LegendDot color={T.warn} label="86–100% Uwaga" />
                <LegendDot color={T.bn}   label="> 100% BN" />
              </div>
            </div>
          )}
        </div>

        {/* Historia ostatnie 7 dni */}
        {historyStats && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div style={s.cardTitle}>📈 Historia — ostatnie 7 dni</div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: T.text }}>{historyStats.totalOps}</div>
                <div style={{ fontSize: 10, color: T.text3 }}>operacji</div>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: T.text3, marginBottom: 6 }}>Liczba operacji per dzień</div>
              <OpsBarChart days={historyStats.days} />
            </div>

            {historyStats.avgDevAll != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: T.surface2, borderRadius: 8 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: historyStats.avgDevAll > 20 ? T.bn : historyStats.avgDevAll > 10 ? T.warn : T.ok }}>
                  {historyStats.avgDevAll > 0 ? '+' : ''}{historyStats.avgDevAll}%
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Śr. odchylenie od standardu</div>
                  <div style={{ fontSize: 11, color: T.text3 }}>ostatnie 7 dni · wszystkie gniazda</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

// ─── KOMPONENTY POMOCNICZE ────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon, onClick }) {
  return (
    <div
      style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 12, padding: '16px 18px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
        borderLeft: `3px solid ${color}`,
      }}
      onClick={onClick}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = color; }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.borderColor = T.border; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.text3 }}>{label}</div>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, marginBottom: 4, fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 11, color: T.text3 }}>{sub}</div>
    </div>
  );
}

function OpsBarChart({ days }) {
  if (!days.length) return null;
  const maxOps = Math.max(...days.map(d => d.ops), 1);
  const W = 340, H = 60, PAD = { l: 8, r: 8, t: 4, b: 18 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const barW   = innerW / days.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {days.map((d, i) => {
        const bH    = (d.ops / maxOps) * innerH;
        const x     = PAD.l + i * barW + barW * 0.15;
        const y     = PAD.t + innerH - bH;
        const color = d.avgDev != null && d.avgDev > 20 ? T.bn : d.avgDev != null && d.avgDev > 10 ? T.warn : T.accent;
        const label = d.date.slice(5);
        return (
          <g key={d.date}>
            <rect x={x} y={y} width={barW * 0.7} height={Math.max(bH, 2)}
              fill={color} fillOpacity={0.8} rx={2} />
            <text x={x + barW * 0.35} y={H - 4} textAnchor="middle" fontSize={8} fill={T.text3}>{label}</text>
            {bH > 12 && (
              <text x={x + barW * 0.35} y={y + 10} textAnchor="middle" fontSize={8} fill="#fff" fontWeight="600">{d.ops}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 10, color: T.text3 }}>{label}</span>
    </div>
  );
}