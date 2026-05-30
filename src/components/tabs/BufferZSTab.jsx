import { useMemo, useState } from 'react';
import { T, s, tocColor } from '../../constants/theme.js';
import { EmptyState } from '../common/EmptyState.jsx';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function parseDt(str) {
  if (!str) return null;
  if (str instanceof Date) return isNaN(str) ? null : str;
  if (typeof str !== 'string') return new Date(str) || null;
  return new Date(str.includes('T') ? str : str.replace(' ', 'T'));
}

function opStatus(op, now) {
  if (op.status === 'CNF') return 'cnf';
  if (op.status === 'WIP') return 'wip';
  if (op.status === 'CNC') return 'cnc';
  const ps = parseDt(op.planned_start);
  if (ps && ps < now) return 'late';
  return 'plan';
}

function calcBufferRatio(ops, now) {
  const nonCnc = ops.filter(o => o.status !== 'CNC');
  if (!nonCnc.length) return null;

  const last       = nonCnc[nonCnc.length - 1];
  const need_date  = parseDt(last.need_date || nonCnc[0].need_date);
  const plan_start = parseDt(nonCnc[0].planned_start);
  if (!need_date || !plan_start) return null;

  if (need_date <= plan_start) {
    return { ratio: 99, zone: 'black', remainingAvailH: 0, remainingNeededH: 0, planError: true, allDone: false };
  }

  const remainingAvailMs = need_date - now;
  const remainingAvailH  = remainingAvailMs / 3600000;

  const unfinished = nonCnc.filter(o => o.status !== 'CNF');
  if (!unfinished.length) {
    return { ratio: 0, zone: 'green', remainingAvailH, remainingNeededH: 0, planError: false, allDone: true };
  }

  const lastUnfinished = unfinished[unfinished.length - 1];
  const lastPlannedEnd = parseDt(lastUnfinished.planned_end);
  if (!lastPlannedEnd) return null;

  const remainingNeededMs = lastPlannedEnd - now;
  const remainingNeededH  = remainingNeededMs / 3600000;

  if (remainingAvailMs <= 0) {
    return { ratio: 99, zone: 'black', remainingAvailH, remainingNeededH, planError: false, allDone: false };
  }

  const ratio = Math.max(0, remainingNeededH / remainingAvailH);

  let zone;
  if (ratio >= 1.0) zone = 'black';
  else if (ratio >= 0.8) zone = 'red';
  else if (ratio >= 0.5) zone = 'yellow';
  else zone = 'green';

  return { ratio, zone, remainingAvailH, remainingNeededH, planError: false, allDone: false };
}

function zoneOrder(zone) {
  return { black: 0, red: 1, yellow: 2, green: 3 }[zone] ?? 9;
}

// ─── BUDUJ STRUKTURĘ ZS → pozycje → operacje ─────────────────────────────────

function buildZsTree(zpStatusData, now) {
  if (!zpStatusData.length) return [];

  // grupuj po parent_zp
  const byParent = {};
  zpStatusData.forEach(row => {
    const key = row.parent_zp || row.zp_id;
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(row);
  });

  // buduj pozycje ZP
  const positions = Object.entries(byParent).map(([parent_zp, ops]) => {
    ops.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    if (ops.every(o => o.status === 'CNC')) return null;

    const first = ops[0];
    const buf   = calcBufferRatio(ops, now);
    if (!buf) return null;

    const cnfOps   = ops.filter(o => o.status === 'CNF').length;
    const totalOps = ops.filter(o => o.status !== 'CNC').length;

    return {
      parent_zp,
      zs_id:   first.zs_id   || '',
      pozycja: first.pozycja || '',
      klient:  first.klient  || '',
      product: first.product || '',
      need_date: parseDt(ops[ops.length - 1].need_date || first.need_date),
      cnfOps, totalOps,
      ops: ops.filter(o => o.status !== 'CNC').map(o => ({
        ...o,
        computedStatus: opStatus(o, now),
        plannedStartDt: parseDt(o.planned_start),
        plannedEndDt:   parseDt(o.planned_end),
        actualStartDt:  parseDt(o.actual_start),
        actualEndDt:    parseDt(o.actual_end),
      })),
      ...buf,
    };
  }).filter(Boolean);

  // grupuj po zs_id
  const byZs = {};
  positions.forEach(pos => {
    const key = pos.zs_id || pos.parent_zp;
    if (!byZs[key]) byZs[key] = { zs_id: pos.zs_id, klient: pos.klient, positions: [] };
    byZs[key].positions.push(pos);
  });

  // dla każdego ZS: posortuj pozycje po pozycja, wyciągnij najgorszy status
  return Object.values(byZs).map(zs => {
    zs.positions.sort((a, b) => String(a.pozycja || '').localeCompare(String(b.pozycja || '')));
    const worst = zs.positions.reduce((w, p) => zoneOrder(p.zone) < zoneOrder(w.zone) ? p : w, zs.positions[0]);
    const lastDue = zs.positions.reduce((d, p) => (!d || (p.need_date && p.need_date > d)) ? p.need_date : d, null);
    return {
      ...zs,
      zone:      worst.zone,
      ratio:     worst.ratio,
      worstZp:   worst.parent_zp,
      lastDue,
    };
  });
}

// ─── KOMPONENTY ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = {
    cnf:  { label: 'CNF',    bg: 'rgba(52,211,153,0.15)',  color: '#34d399' },
    wip:  { label: 'WIP',    bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24' },
    late: { label: 'SPÓŹN.', bg: 'rgba(248,113,113,0.15)', color: '#f87171' },
    plan: { label: 'PLAN',   bg: 'rgba(98,109,128,0.15)',  color: '#626d80' },
  }[status] || { label: status, bg: T.surface3, color: T.text3 };
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  );
}

function ZoneBadge({ zone }) {
  const tc = tocColor(zone);
  const label = { green: '🟢 ZIELONY', yellow: '🟡 ŻÓŁTY', red: '🔴 CZERWONY', black: '⚫ CZARNY' }[zone] || '🟢';
  return (
    <span style={{ ...s.badge(tc), fontSize: 10, justifyContent: 'center', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function RatioBar({ ratio, zone }) {
  const tc  = tocColor(zone);
  const pct = Math.min(ratio * 100, 100);
  return (
    <div style={{ position: 'relative', height: 6, borderRadius: 3, background: T.surface3, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
        <div style={{ width: '50%', background: 'rgba(52,211,153,0.07)' }} />
        <div style={{ width: '30%', background: 'rgba(251,191,36,0.07)' }} />
        <div style={{ width: '20%', background: 'rgba(248,113,113,0.07)' }} />
      </div>
      {[50, 80].map(x => (
        <div key={x} style={{ position: 'absolute', top: 0, bottom: 0, left: `${x}%`, width: 1, background: 'rgba(255,255,255,0.12)' }} />
      ))}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pct}%`, background: tc.border, opacity: 0.7, borderRadius: 3, transition: 'width 0.4s' }} />
    </div>
  );
}

// ─── WIERSZ OPERACJI ─────────────────────────────────────────────────────────

function OpRow({ op, isLast }) {
  const fmtH = (dt1, dt2) => {
    if (!dt1 || !dt2) return '—';
    const h = (dt2 - dt1) / 3600000;
    return h > 0 ? `${h.toFixed(1)}h` : '—';
  };
  const planH   = fmtH(op.plannedStartDt, op.plannedEndDt);
  const actualH = op.actualStartDt && op.actualEndDt ? fmtH(op.actualStartDt, op.actualEndDt) : op.actualStartDt ? 'w toku' : '—';
  const rowBg   = op.computedStatus === 'late' ? 'rgba(248,113,113,0.06)' : op.computedStatus === 'wip' ? 'rgba(251,191,36,0.06)' : 'transparent';

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '20px 110px 1fr 55px 55px 60px 70px',
      gap: 8, padding: '5px 14px 5px 56px',
      background: rowBg,
      borderBottom: isLast ? 'none' : `1px solid ${T.border}`,
      alignItems: 'center',
    }}>
      <span style={{ fontSize: 10, color: T.text3, fontFamily: 'monospace' }}>{op.sequence}</span>
      <span style={{ fontSize: 10, color: T.text3, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.zp_id || ''}</span>
      <div>
        <span style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{op.workcenter}</span>
        <span style={{ fontSize: 10, color: T.text3 }}> — {op.operation}</span>
      </div>
      <span style={{ fontSize: 11, color: T.text2, fontFamily: 'monospace', textAlign: 'right' }}>{planH}</span>
      <span style={{ fontSize: 11, color: T.text2, fontFamily: 'monospace', textAlign: 'right' }}>{actualH}</span>
      <span style={{ fontSize: 10, color: T.text3, textAlign: 'right' }}>{op.volume_actual != null ? `${op.volume_actual}/${op.volume_plan}` : '—'}</span>
      <span style={{ textAlign: 'right' }}><StatusBadge status={op.computedStatus} /></span>
    </div>
  );
}

// ─── WIERSZ POZYCJI ZP ───────────────────────────────────────────────────────

function PozycjaRow({ pos, expanded, onToggle }) {
  const tc   = tocColor(pos.zone);
  const over = pos.ratio >= 1.0;
  const bufH = pos.remainingAvailH - pos.remainingNeededH;

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${expanded ? tc.border : T.border}`, background: expanded ? tc.bg : T.surface3, overflow: 'hidden', transition: 'all 0.15s' }}>
      {/* nagłówek pozycji */}
      <div onClick={onToggle} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 80px 70px 70px 36px', gap: 8, padding: '8px 14px 8px 28px', alignItems: 'center', cursor: 'pointer' }}>
        <ZoneBadge zone={pos.zone} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
            {pos.zs_id} poz.{pos.pozycja}
          </div>
          <div style={{ fontSize: 11, color: T.text3, fontFamily: 'monospace' }}>{pos.parent_zp}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: T.text3 }}>{pos.product}</div>
        </div>
        <span style={{ fontSize: 11, color: T.text2, fontFamily: 'monospace' }}>{pos.need_date?.toISOString().slice(0, 10)}</span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: over ? T.bn : tc.text, fontFamily: 'monospace' }}>
            {pos.allDone ? '✅' : over ? `${pos.ratio.toFixed(2)}⚠` : pos.ratio.toFixed(2)}
          </div>
          <div style={{ fontSize: 9, color: T.text3 }}>ratio</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, fontWeight: 600, fontFamily: 'monospace', color: bufH >= 0 ? T.ok : T.bn }}>
            {pos.allDone ? '—' : bufH >= 0 ? `+${bufH.toFixed(1)}h` : `${bufH.toFixed(1)}h`}
          </div>
          <div style={{ fontSize: 9, color: T.text3 }}>bufor</div>
        </div>
        <span style={{ fontSize: 13, color: T.text3, textAlign: 'center', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
      </div>

      {/* pasek */}
      <div style={{ padding: '0 14px 8px 28px' }}>
        <RatioBar ratio={pos.ratio} zone={pos.zone} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
          <span style={{ fontSize: 10, color: T.text3 }}>
            {pos.cnfOps}/{pos.totalOps} op. CNF
          </span>
          <span style={{ fontSize: 10, color: T.text3 }}>
            {pos.remainingNeededH > 0 ? `potrzeba ${pos.remainingNeededH.toFixed(1)}h` : ''}
          </span>
        </div>
      </div>

      {/* operacje */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${T.border}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '20px 110px 1fr 55px 55px 60px 70px', gap: 8, padding: '5px 14px 4px 56px', borderBottom: `1px solid ${T.border}` }}>
            {['#', 'Nr ZP', 'Operacja', 'Plan h', 'Rzecz. h', 'Wol./Plan', 'Status'].map((h, i) => (
              <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.text3, textAlign: i >= 3 ? 'right' : 'left' }}>{h}</span>
            ))}
          </div>
          {pos.ops.map((op, i) => (
            <OpRow key={`${op.workcenter}-${op.sequence}`} op={op} isLast={i === pos.ops.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── WIERSZ ZS ───────────────────────────────────────────────────────────────

function ZsRow({ zs, expandedZs, expandedPos, onToggleZs, onTogglePos }) {
  const tc   = tocColor(zs.zone);
  const over = zs.ratio >= 1.0;

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${expandedZs ? tc.border : T.border}`, background: expandedZs ? tc.bg : T.surface2, overflow: 'hidden', transition: 'all 0.15s' }}>
      {/* nagłówek ZS */}
      <div onClick={onToggleZs} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 80px 80px 40px', gap: 8, padding: '12px 14px', alignItems: 'center', cursor: 'pointer' }}>
        <ZoneBadge zone={zs.zone} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{zs.zs_id}</div>
          <div style={{ fontSize: 11, color: T.text3 }}>{zs.positions.length} poz.</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: T.text2 }}>{zs.klient}</div>
          <div style={{ fontSize: 10, color: T.text3 }}>
            najgorsze: <span style={{ color: tc.text, fontFamily: 'monospace' }}>{zs.worstZp}</span>
          </div>
        </div>
        <span style={{ fontSize: 11, color: T.text2, fontFamily: 'monospace' }}>
          {zs.lastDue?.toISOString().slice(0, 10)}
        </span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: over ? T.bn : tc.text, fontFamily: 'monospace' }}>
            {zs.ratio >= 99 ? '⚠ kryt.' : zs.ratio.toFixed(2)}
          </div>
          <div style={{ fontSize: 9, color: T.text3 }}>worst ratio</div>
        </div>
        <span style={{ fontSize: 14, color: T.text3, textAlign: 'center', transform: expandedZs ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
      </div>

      {/* pozycje */}
      {expandedZs && (
        <div style={{ borderTop: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px' }}>
          {zs.positions.map(pos => (
            <PozycjaRow
              key={pos.parent_zp}
              pos={pos}
              expanded={expandedPos === pos.parent_zp}
              onToggle={() => onTogglePos(pos.parent_zp)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── GŁÓWNY KOMPONENT ─────────────────────────────────────────────────────────

export function BufferZSTab({ zpStatusData }) {
  const [expandedZs,  setExpandedZs]  = useState(null);
  const [expandedPos, setExpandedPos] = useState(null);
  const [filter, setFilter] = useState('all');

  const now = useMemo(() => new Date(), []);

  const zsTree = useMemo(
    () => buildZsTree(zpStatusData || [], now),
    [zpStatusData, now]
  );

  const sorted = useMemo(() => {
    const base = filter === 'all' ? zsTree : zsTree.filter(z => z.zone === filter);
    return [...base].sort((a, b) => {
      const zo = zoneOrder(a.zone) - zoneOrder(b.zone);
      if (zo !== 0) return zo;
      if (a.zone === 'black' || a.zone === 'red') return b.ratio - a.ratio;
      return (a.lastDue || 0) - (b.lastDue || 0);
    });
  }, [zsTree, filter]);

  const stats = useMemo(() => {
    const cnt = { black: 0, red: 0, yellow: 0, green: 0 };
    zsTree.forEach(z => { cnt[z.zone] = (cnt[z.zone] || 0) + 1; });
    return cnt;
  }, [zsTree]);

  if (!zpStatusData?.length) {
    return <EmptyState icon="🟡" title="Brak danych realizacji" sub="Wgraj plik ZP Status w zakładce Import / Eksport" />;
  }

  const FILTERS = [
    { id: 'all',    label: `Wszystkie ZS (${zsTree.length})` },
    { id: 'black',  label: `⚫ Czarny (${stats.black})`  },
    { id: 'red',    label: `🔴 Czerwony (${stats.red})`  },
    { id: 'yellow', label: `🟡 Żółty (${stats.yellow})`  },
    { id: 'green',  label: `🟢 Zielony (${stats.green})` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {[
          { zone: 'black',  count: stats.black,  label: 'ZS po terminie / kryt.', color: T.text3 },
          { zone: 'red',    count: stats.red,    label: 'ZS strefa czerwona',     color: T.bn   },
          { zone: 'yellow', count: stats.yellow, label: 'ZS strefa żółta',        color: T.warn },
          { zone: 'green',  count: stats.green,  label: 'ZS strefa zielona',      color: T.ok   },
        ].map(({ zone, count, label, color }) => (
          <div key={zone}
            onClick={() => setFilter(f => f === zone ? 'all' : zone)}
            style={{ ...s.card, cursor: 'pointer', borderLeft: `3px solid ${color}`, borderColor: filter === zone ? color : T.border, background: filter === zone ? tocColor(zone).bg : T.surface, transition: 'all 0.15s' }}
          >
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.text3 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: 'monospace', margin: '4px 0' }}>{count}</div>
            <div style={{ fontSize: 11, color: T.text3 }}>zamówień</div>
          </div>
        ))}
      </div>

      {/* info */}
      <div style={{ ...s.card, padding: '10px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 10, color: T.text3 }}>
          <span style={{ fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Widok handlowca — ZS</span>
          <span>Kolor ZS = najgorszy status pozycji w zamówieniu</span>
          <span>Ratio = czas potrzebny / czas dostępny · worst ratio decyduje o kolorze ZS</span>
          <span style={{ marginLeft: 'auto' }}>Sortowanie: czarny → czerwony → żółty → zielony</span>
        </div>
      </div>

      {/* filtry */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f.id} type="button" style={s.btnSm(filter === f.id)} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {/* nagłówki */}
      <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 80px 80px 40px', gap: 8, padding: '0 14px' }}>
        {['Strefa', 'ZS', 'Klient', 'Ostatni termin', 'Worst ratio', ''].map(h => (
          <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.text3 }}>{h}</span>
        ))}
      </div>

      {/* lista ZS */}
      {sorted.length === 0 ? (
        <div style={{ ...s.card, color: T.text3, fontSize: 13, textAlign: 'center', padding: 32 }}>
          Brak zamówień dla wybranego filtra
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sorted.map(zs => (
            <ZsRow
              key={zs.zs_id}
              zs={zs}
              expandedZs={expandedZs === zs.zs_id}
              expandedPos={expandedPos}
              onToggleZs={() => {
                setExpandedZs(p => p === zs.zs_id ? null : zs.zs_id);
                setExpandedPos(null);
              }}
              onTogglePos={pos => setExpandedPos(p => p === pos ? null : pos)}
            />
          ))}
        </div>
      )}
    </div>
  );
}