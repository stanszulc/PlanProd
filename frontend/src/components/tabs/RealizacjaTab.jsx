import { useState, useMemo } from 'react';
import { T, s, tocColor } from '../../constants/theme.js';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function parseDt(str) {
  if (!str) return null;
  if (str instanceof Date) return isNaN(str) ? null : str;
  if (typeof str !== 'string') return new Date(str) || null;
  return new Date(str.includes('T') ? str : str.replace(' ', 'T'));
}

function fmtDt(dt) {
  if (!dt) return '—';
  const d = parseDt(dt);
  if (!d) return '—';
  return String(d.getMonth()+1).padStart(2,'0') + '.' +
    String(d.getDate()).padStart(2,'0') + ' ' +
    String(d.getHours()).padStart(2,'0') + ':' +
    String(d.getMinutes()).padStart(2,'0');
}

function fmtH(h) {
  if (h == null || isNaN(h)) return '—';
  return `${h.toFixed(1)}h`;
}

/**
 * Dla pozycji ZP (grupowane po parent_zp):
 * - On Time: actual_end(ostatnia CNF op) <= need_date
 * - In Full: suma volume_actual >= suma volume_plan (tylko nie-CNC)
 * - LT: actual_end(last) - actual_start(first)
 * - Touch time: suma (actual_end - actual_start) dla CNF
 * - Queue time: LT - touch time
 * - Efektywność: touch / LT
 */
function calcPozycja(ops) {
  ops = ops.slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

  const nonCnc   = ops.filter(o => o.status !== 'CNC');
  const cnfOps   = ops.filter(o => o.status === 'CNF');
  const allCnc   = nonCnc.length === 0;
  const need_date = parseDt(ops[ops.length - 1]?.need_date || ops[0]?.need_date);

  // OTIF
  let onTime = null, inFull = null, otif = null;

  if (allCnc) {
    onTime = false; inFull = false; otif = false;
  } else {
    const volPlan   = nonCnc.reduce((s, o) => s + (o.volume_plan   || 0), 0);
    const volActual = nonCnc.reduce((s, o) => s + (o.volume_actual || 0), 0);
    inFull = volActual >= volPlan && volPlan > 0;

    const lastCnf = cnfOps.length ? cnfOps[cnfOps.length - 1] : null;
    const actualEnd = lastCnf ? parseDt(lastCnf.actual_end) : null;
    if (actualEnd && need_date) {
      onTime = actualEnd <= need_date;
    } else if (cnfOps.length < nonCnc.length) {
      onTime = null; // jeszcze w toku
    }

    otif = onTime === true && inFull === true ? true
         : onTime === false || inFull === false ? false
         : null;
  }

  // LT technologiczny
  const firstOp = nonCnc.find(o => o.actual_start);
  const lastOp  = [...nonCnc].reverse().find(o => o.actual_end);
  const firstStart = firstOp ? parseDt(firstOp.actual_start) : null;
  const lastEnd    = lastOp  ? parseDt(lastOp.actual_end)    : null;

  const ltH = firstStart && lastEnd ? (lastEnd - firstStart) / 3600000 : null;

  let touchH = 0;
  cnfOps.forEach(o => {
    const s = parseDt(o.actual_start), e = parseDt(o.actual_end);
    if (s && e) touchH += (e - s) / 3600000;
  });

  const queueH  = ltH != null ? Math.max(0, ltH - touchH) : null;
  const effPct  = ltH && ltH > 0 ? Math.round((touchH / ltH) * 100) : null;

  // bottleneck — najdłuższa operacja CNF
  const bottleneck = cnfOps.length
    ? cnfOps.reduce((b, o) => {
        const s = parseDt(o.actual_start), e = parseDt(o.actual_end);
        const dur = s && e ? (e - s) / 3600000 : 0;
        return dur > (b.dur || 0) ? { wc: o.workcenter, dur } : b;
      }, {}).wc || null
    : null;

  const first = ops[0];
  return {
    parent_zp: first.parent_zp || first.zp_id,
    zs_id:     first.zs_id    || '',
    pozycja:   first.pozycja  || '',
    klient:    first.klient   || '',
    product:   first.product  || '',
    need_date,
    status:    allCnc ? 'CNC' : cnfOps.length === nonCnc.length ? 'CNF' : cnfOps.length > 0 ? 'WIP' : 'PLAN',
    onTime, inFull, otif,
    ltH, touchH, queueH, effPct,
    bottleneck,
    volPlan:   nonCnc.reduce((s, o) => s + (o.volume_plan   || 0), 0),
    volActual: nonCnc.reduce((s, o) => s + (o.volume_actual || 0), 0),
    lastEnd,
    allCnc,
  };
}

function buildZsTree(zpStatusData) {
  const byParent = {};
  zpStatusData.forEach(row => {
    const key = row.parent_zp || row.zp_id;
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(row);
  });

  const positions = Object.values(byParent).map(calcPozycja);

  const byZs = {};
  positions.forEach(pos => {
    const key = pos.zs_id || pos.parent_zp;
    if (!byZs[key]) byZs[key] = { zs_id: pos.zs_id, klient: pos.klient, positions: [] };
    byZs[key].positions.push(pos);
  });

  return Object.values(byZs).map(zs => {
    zs.positions.sort((a, b) => String(a.pozycja).localeCompare(String(b.pozycja)));
    const nonCncPos = zs.positions.filter(p => !p.allCnc);
    const otifFail  = zs.positions.some(p => p.otif === false);
    const otifOk    = nonCncPos.length > 0 && nonCncPos.every(p => p.otif === true);
    const otif      = otifFail ? false : otifOk ? true : null;
    const lastDue   = zs.positions.reduce((d, p) => (!d || (p.need_date && p.need_date > d)) ? p.need_date : d, null);
    const avgLt     = (() => {
      const lts = zs.positions.filter(p => p.ltH != null).map(p => p.ltH);
      return lts.length ? lts.reduce((s, v) => s + v, 0) / lts.length : null;
    })();
    const totalTouch = zs.positions.reduce((s, p) => s + (p.touchH || 0), 0);
    const totalQueue = zs.positions.reduce((s, p) => s + (p.queueH || 0), 0);
    const totalLt    = totalTouch + totalQueue;
    return { ...zs, otif, lastDue, avgLt, totalTouch, totalQueue, totalLt };
  });
}

// ─── BADGE HELPERS ────────────────────────────────────────────────────────────

function OtifBadge({ onTime, inFull, otif, size = 11 }) {
  if (otif === null) return <span style={{ fontSize: size, color: T.text3 }}>⏳ W toku</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <span style={{ fontSize: size, color: onTime === true ? T.ok : onTime === false ? T.bn : T.text3 }}>
        {onTime === true ? '✅ OT' : onTime === false ? '❌ OT' : '⏳ OT'}
      </span>
      <span style={{ fontSize: size, color: inFull === true ? T.ok : inFull === false ? T.bn : T.text3 }}>
        {inFull === true ? '✅ IF' : inFull === false ? '❌ IF' : '⏳ IF'}
      </span>
    </span>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    CNF:  { label: 'Wykonane',    color: T.ok    },
    WIP:  { label: 'W trakcie',   color: T.warn  },
    PLAN: { label: 'Planowane',   color: T.accent },
    CNC:  { label: 'Anulowane',   color: T.text3 },
  }[status] || { label: status, color: T.text3 };
  return (
    <span style={{ ...s.tag(cfg.color), fontSize: 10 }}>{cfg.label}</span>
  );
}

// ─── WIERSZ POZYCJI ───────────────────────────────────────────────────────────

function PozycjaRow({ pos }) {
  const delayH = pos.lastEnd && pos.need_date
    ? Math.max(0, (pos.lastEnd - pos.need_date) / 3600000)
    : null;
  const delayD = delayH != null ? (delayH / 16).toFixed(1) : null;

  return (
    <tr style={{ background: pos.allCnc ? 'rgba(100,100,100,0.05)' : 'transparent' }}>
      <td style={tdStyle}>
        <span style={{ fontSize: 11, color: T.text3 }}>poz.{pos.pozycja}</span>
      </td>
      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: T.accent }}>
        {pos.parent_zp}
      </td>
      <td style={{ ...tdStyle, fontSize: 11, color: T.text2 }}>{pos.product}</td>
      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: T.text2 }}>
        {pos.need_date?.toISOString().slice(0, 10)}
      </td>
      <td style={{ ...tdStyle, fontSize: 11 }}>
        <StatusBadge status={pos.status} />
      </td>
      <td style={{ ...tdStyle, fontSize: 11, fontFamily: 'monospace', color: T.text2 }}>
        {pos.volActual}/{pos.volPlan} szt.
      </td>
      <td style={{ ...tdStyle }}>
        {pos.allCnc
          ? <span style={{ fontSize: 10, color: T.text3 }}>anulowane</span>
          : <OtifBadge onTime={pos.onTime} inFull={pos.inFull} otif={pos.otif} />
        }
      </td>
      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>
        {pos.ltH != null ? (
          <span style={{ color: T.text2 }}>{fmtH(pos.ltH)}</span>
        ) : '—'}
      </td>
      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: T.text3 }}>
        {pos.touchH > 0 ? fmtH(pos.touchH) : '—'}
      </td>
      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: T.text3 }}>
        {pos.queueH != null ? fmtH(pos.queueH) : '—'}
      </td>
      <td style={{ ...tdStyle, fontSize: 11 }}>
        {pos.effPct != null ? (
          <span style={{ color: pos.effPct >= 70 ? T.ok : pos.effPct >= 40 ? T.warn : T.bn, fontWeight: 600 }}>
            {pos.effPct}%
          </span>
        ) : '—'}
      </td>
      <td style={{ ...tdStyle, fontSize: 11, color: T.text3 }}>
        {delayD && parseFloat(delayD) > 0
          ? <span style={{ color: T.bn }}>+{delayD}d</span>
          : pos.lastEnd ? <span style={{ color: T.ok }}>✓ OK</span> : '—'
        }
      </td>
      <td style={{ ...tdStyle, fontSize: 11, color: T.text3 }}>{pos.bottleneck || '—'}</td>
    </tr>
  );
}

// ─── WIERSZ ZS ────────────────────────────────────────────────────────────────

function ZsRow({ zs, expanded, onToggle }) {
  const otifColor = zs.otif === true ? T.ok : zs.otif === false ? T.bn : T.text3;
  const otifLabel = zs.otif === true ? '✅ OTIF' : zs.otif === false ? '❌ OTIF' : '⏳ W toku';

  return (
    <div style={{
      borderRadius: 10,
      border: `1px solid ${zs.otif === false ? T.bn + '44' : T.border}`,
      background: T.surface2,
      overflow: 'hidden',
      transition: 'border-color 0.15s',
    }}>
      {/* nagłówek ZS */}
      <div onClick={onToggle} style={{
        display: 'grid', gridTemplateColumns: '120px 1fr 1fr 110px 70px 70px 70px 40px',
        gap: 10, padding: '10px 14px', alignItems: 'center', cursor: 'pointer',
      }}>
        {/* OT + IF osobno, najgorszy z pozycji */}
        <div style={{ display: 'flex', gap: 6 }}>
          {(() => {
            const otFail = zs.positions.some(p => p.onTime === false);
            const otOk   = zs.positions.filter(p => !p.allCnc).every(p => p.onTime === true);
            const ifFail = zs.positions.some(p => p.inFull === false);
            const ifOk   = zs.positions.filter(p => !p.allCnc).every(p => p.inFull === true);
            return (
              <>
                <span style={{ fontSize: 11, fontWeight: 600, color: otFail ? T.bn : otOk ? T.ok : T.text3 }}>
                  {otFail ? '❌' : otOk ? '✅' : '⏳'} OT
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: ifFail ? T.bn : ifOk ? T.ok : T.text3 }}>
                  {ifFail ? '❌' : ifOk ? '✅' : '⏳'} IF
                </span>
              </>
            );
          })()}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{zs.zs_id}</div>
          <div style={{ fontSize: 11, color: T.text3 }}>{zs.positions.length} poz.</div>
        </div>
        <div style={{ fontSize: 12, color: T.text2 }}>{zs.klient}</div>
        <span style={{ fontSize: 11, color: T.text2, fontFamily: 'monospace' }}>
          {zs.lastDue?.toISOString().slice(0, 10)}
        </span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text2, fontFamily: 'monospace' }}>{fmtH(zs.totalTouch)}</div>
          <div style={{ fontSize: 9, color: T.text3 }}>Touch</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text2, fontFamily: 'monospace' }}>{fmtH(zs.totalQueue)}</div>
          <div style={{ fontSize: 9, color: T.text3 }}>Queue</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.accent, fontFamily: 'monospace' }}>{fmtH(zs.totalLt)}</div>
          <div style={{ fontSize: 9, color: T.text3 }}>LT</div>
        </div>
        <span style={{
          fontSize: 14, color: T.text3, textAlign: 'center',
          transform: expanded ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.2s',
        }}>▶</span>
      </div>

      {/* tabela pozycji */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${T.border}`, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                {['Poz.', 'ZP', 'Produkt', 'Termin', 'Status', 'Wolumen', 'OTIF', 'LT', 'Touch', 'Queue', 'Efekt.', 'Opóźn.', 'BN'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zs.positions.map(pos => (
                <PozycjaRow key={pos.parent_zp} pos={pos} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── GŁÓWNY KOMPONENT ─────────────────────────────────────────────────────────

export function RealizacjaTab({ zpStatusData }) {
  const [expanded,    setExpanded]    = useState(null);
  const [showOnlyFail, setShowOnlyFail] = useState(false);

  const zsTree = useMemo(() => buildZsTree(zpStatusData || []), [zpStatusData]);

  const stats = useMemo(() => {
    const total    = zsTree.length;
    const fail     = zsTree.filter(z => z.otif === false).length;
    const ok       = zsTree.filter(z => z.otif === true).length;
    const worstDel = zsTree.reduce((best, z) => {
      const maxDel = z.positions.reduce((m, p) => {
        if (!p.lastEnd || !p.need_date) return m;
        const d = (p.lastEnd - p.need_date) / 3600000 / 16;
        return d > m ? d : m;
      }, 0);
      return maxDel > (best.del || 0) ? { del: maxDel, zs: z.zs_id } : best;
    }, {});
    return { total, fail, ok, worstDel };
  }, [zsTree]);

  const filtered = showOnlyFail ? zsTree.filter(z => z.otif === false) : zsTree;

  if (!zpStatusData?.length) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: T.text3 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🏭</div>
        <div style={{ fontSize: 14 }}>Brak danych realizacji. Wgraj ZP Status w zakładce Import.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── NAGŁÓWEK ────────────────────────────────────────────────────── */}
      <div style={{ ...s.card, padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>
              Realizacja zamówień
            </div>
            <div style={{ fontSize: 12, color: T.text3 }}>
              OTIF — On Time In Full · LT — Lead Time (TOC) per pozycja ZS
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button"
              style={{ ...s.btnSm(showOnlyFail), fontSize: 11 }}
              onClick={() => setShowOnlyFail(v => !v)}>
              ⚠️ Tylko spóźnione
            </button>
            <button type="button"
              style={{ ...s.btnSm(!showOnlyFail), fontSize: 11 }}
              onClick={() => setShowOnlyFail(false)}>
              📋 Wszystkie ZS
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {[
          { label: 'Zamówienia sprzedaży', value: stats.total, sub: 'łącznie w systemie',  color: T.accent, icon: '🧾' },
          { label: 'Spóźnione ZS',         value: stats.fail,  sub: `${zsTree.filter(z=>z.positions.some(p=>p.otif===false)).reduce((s,z)=>s+z.positions.filter(p=>p.otif===false).length,0)} ZP po terminie`, color: stats.fail > 0 ? T.bn : T.ok, icon: '⚠️' },
          { label: 'ZS na czas',            value: stats.ok,    sub: `${zsTree.filter(z=>z.otif===true).reduce((s,z)=>s+z.positions.filter(p=>p.otif===true).length,0)} ZP OK`, color: T.ok, icon: '✅' },
          { label: 'Najgorsze opóźnienie',  value: stats.worstDel?.del ? `+${stats.worstDel.del.toFixed(1)}d` : '—', sub: stats.worstDel?.zs || 'brak opóźnień', color: stats.worstDel?.del ? T.bn : T.ok, icon: '🔥' },
        ].map(({ label, value, sub, color, icon }) => (
          <div key={label} style={{ ...s.card, borderLeft: `3px solid ${color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.text3 }}>{label}</div>
              <span style={{ fontSize: 18 }}>{icon}</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color, fontFamily: 'monospace', marginBottom: 4 }}>{value}</div>
            <div style={{ fontSize: 11, color: T.text3 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* ── LISTA ZS ────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 110px 70px 70px 70px 40px', gap: 10, padding: '0 14px' }}>
        {['OT / IF', 'ZS', 'Klient', 'Ostatni termin', 'Touch', 'Queue', 'LT', ''].map(h => (
          <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.text3 }}>{h}</span>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(zs => (
          <ZsRow
            key={zs.zs_id}
            zs={zs}
            expanded={expanded === zs.zs_id}
            onToggle={() => setExpanded(p => p === zs.zs_id ? null : zs.zs_id)}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ ...s.card, color: T.text3, fontSize: 13, textAlign: 'center', padding: 32 }}>
            Brak spóźnionych zamówień
          </div>
        )}
      </div>

      {/* ── LEGENDA LT ──────────────────────────────────────────────────── */}
      <div style={{ ...s.card, padding: '12px 18px', borderLeft: `3px solid ${T.accent}` }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.text3, marginBottom: 8 }}>
          Jak czytać Lead Time (TOC)?
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 11, color: T.text2, lineHeight: 1.7 }}>
          <div><span style={{ color: T.text, fontWeight: 600 }}>LT</span> = czas od pierwszej do ostatniej operacji (actual)</div>
          <div><span style={{ color: T.text, fontWeight: 600 }}>Touch time</span> = suma czasu aktywnej obróbki (op CNF)</div>
          <div><span style={{ color: T.text, fontWeight: 600 }}>Queue time</span> = LT − Touch = czas oczekiwania między operacjami</div>
          <div><span style={{ color: T.ok, fontWeight: 600 }}>Efektywność ≥ 70%</span> · <span style={{ color: T.warn, fontWeight: 600 }}>40–70%</span> · <span style={{ color: T.bn, fontWeight: 600 }}>&lt; 40% — dużo czekania</span></div>
        </div>
        <div style={{ fontSize: 10, color: T.text3, marginTop: 6 }}>
          W TOC Queue time = czas w którym materiał czeka zamiast być obrabiany. Im wyższy — tym większe straty przepustowości.
          LT handlowy (od złożenia zamówienia) = nieobsługiwany — brak daty złożenia ZS w obecnej strukturze danych.
        </div>
      </div>

    </div>
  );
}

const thStyle = {
  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: T.text3, padding: '6px 10px', borderBottom: `1px solid ${T.border}`,
  textAlign: 'left', whiteSpace: 'nowrap', background: T.surface3,
};
const tdStyle = {
  padding: '7px 10px', borderBottom: `1px solid ${T.border}`,
  color: T.text, whiteSpace: 'nowrap',
};