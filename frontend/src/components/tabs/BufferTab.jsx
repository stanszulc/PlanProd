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

  // GUARD: patologia planu
  if (need_date <= plan_start) {
    return { ratio: null, zone: 'black', remainingAvailH: 0, remainingNeededH: 0,
             planError: true, overdue: false, allDone: false };
  }

  const remainingAvailMs = need_date - now;
  const remainingAvailH  = remainingAvailMs / 3600000;

  // Wszystkie CNF — zakończone
  const unfinished = nonCnc.filter(o => o.status !== 'CNF');
  if (!unfinished.length) {
    return { ratio: 0, zone: 'green', remainingAvailH, remainingNeededH: 0,
             planError: false, overdue: false, allDone: true };
  }

  const lastUnfinished = unfinished[unfinished.length - 1];
  const lastPlannedEnd = parseDt(lastUnfinished.planned_end);
  if (!lastPlannedEnd) return null;

  const remainingNeededMs = lastPlannedEnd - now;
  const remainingNeededH  = remainingNeededMs / 3600000;

  // Po terminie
  if (remainingAvailMs <= 0) {
    const overdueH = Math.abs(remainingAvailH); // ile godzin po terminie
    return { ratio: null, zone: 'black', remainingAvailH, remainingNeededH,
             planError: false, overdue: true, overdueH, allDone: false };
  }

  const ratio = Math.max(0, remainingNeededH / remainingAvailH);

  let zone;
  if (ratio >= 1.0) zone = 'black';
  else if (ratio >= 0.8) zone = 'red';
  else if (ratio >= 0.5) zone = 'yellow';
  else zone = 'green';

  return { ratio, zone, remainingAvailH, remainingNeededH,
           planError: false, overdue: false, allDone: false };
}

function zoneOrder(zone) {
  return { black: 0, red: 1, yellow: 2, green: 3 }[zone] ?? 9;
}

function calcAll(zpStatusData, now) {
  if (!zpStatusData.length) return [];

  const byParent = {};
  zpStatusData.forEach(row => {
    const key = row.parent_zp || row.zp_id;
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(row);
  });

  return Object.entries(byParent).map(([parent_zp, ops]) => {
    ops.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    if (ops.every(o => o.status === 'CNC')) return null;

    const first = ops[0];
    const buf   = calcBufferRatio(ops, now);
    if (!buf) return null;

    const cnfOps   = ops.filter(o => o.status === 'CNF').length;
    const totalOps = ops.filter(o => o.status !== 'CNC').length;

    const opsEnriched = ops
      .filter(o => o.status !== 'CNC')
      .map(o => ({
        ...o,
        computedStatus: opStatus(o, now),
        plannedStartDt: parseDt(o.planned_start),
        plannedEndDt:   parseDt(o.planned_end),
        actualStartDt:  parseDt(o.actual_start),
        actualEndDt:    parseDt(o.actual_end),
      }));

    return {
      parent_zp,
      zs_id:    first.zs_id   || '',
      pozycja:  first.pozycja || '',
      klient:   first.klient  || '',
      product:  first.product || '',
      need_date: parseDt(ops[ops.length - 1].need_date || first.need_date),
      cnfOps, totalOps,
      ops: opsEnriched,
      ...buf,
    };
  }).filter(Boolean);
}

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = {
    cnf:  { label: 'CNF',    bg: 'rgba(52,211,153,0.15)',  color: '#34d399' },
    wip:  { label: 'WIP',    bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24' },
    late: { label: 'SPÓŹN.', bg: 'rgba(248,113,113,0.15)', color: '#f87171' },
    plan: { label: 'PLAN',   bg: 'rgba(98,109,128,0.15)',  color: '#626d80' },
  }[status] || { label: status, bg: T.surface3, color: T.text3 };
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px',
      borderRadius: 5, background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
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
  const actualH = op.actualStartDt && op.actualEndDt
    ? fmtH(op.actualStartDt, op.actualEndDt)
    : op.actualStartDt ? 'w toku' : '—';
  const rowBg = op.computedStatus === 'late' ? 'rgba(248,113,113,0.06)'
    : op.computedStatus === 'wip' ? 'rgba(251,191,36,0.06)' : 'transparent';

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '20px 110px 1fr 55px 55px 60px 70px',
      gap: 8, padding: '6px 14px 6px 40px',
      background: rowBg,
      borderBottom: isLast ? 'none' : `1px solid ${T.border}`,
      alignItems: 'center',
    }}>
      <span style={{ fontSize: 11, color: T.text3, fontFamily: 'monospace' }}>{op.sequence}</span>
      <span style={{ fontSize: 10, color: T.text3, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {op.zp_id || ''}
      </span>
      <div>
        <span style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{op.workcenter}</span>
        <span style={{ fontSize: 10, color: T.text3 }}> — {op.operation}</span>
      </div>
      <span style={{ fontSize: 11, color: T.text2, fontFamily: 'monospace', textAlign: 'right' }}>{planH}</span>
      <span style={{ fontSize: 11, color: T.text2, fontFamily: 'monospace', textAlign: 'right' }}>{actualH}</span>
      <span style={{ fontSize: 10, color: T.text3, textAlign: 'right' }}>
        {op.volume_actual != null ? `${op.volume_actual}/${op.volume_plan}` : '—'}
      </span>
      <span style={{ textAlign: 'right' }}><StatusBadge status={op.computedStatus} /></span>
    </div>
  );
}

// ─── PASEK BUFORA ─────────────────────────────────────────────────────────────

function RatioBar({ ratio, zone, overdue }) {
  const tc  = tocColor(zone);
  // po terminie → pasek 100% wypełniony kolorem strefy
  const pct = overdue ? 100 : ratio != null ? Math.min(ratio * 100, 100) : 100;
  return (
    <div style={{ position: 'relative', height: 8, borderRadius: 4, background: T.surface3, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
        <div style={{ width: '50%', background: 'rgba(52,211,153,0.07)' }} />
        <div style={{ width: '30%', background: 'rgba(251,191,36,0.07)' }} />
        <div style={{ width: '20%', background: 'rgba(248,113,113,0.07)' }} />
      </div>
      {[50, 80].map(x => (
        <div key={x} style={{ position: 'absolute', top: 0, bottom: 0, left: `${x}%`, width: 1, background: 'rgba(255,255,255,0.12)' }} />
      ))}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 0,
        width: `${pct}%`, background: tc.border, opacity: 0.7,
        borderRadius: 4, transition: 'width 0.4s',
      }} />
    </div>
  );
}

// ─── WIERSZ ZP ────────────────────────────────────────────────────────────────

function ZpRow({ item, expanded, onToggle }) {
  const tc = tocColor(item.zone);

  const zoneLabel = {
    green:  '🟢 ZIELONY',
    yellow: '🟡 ŻÓŁTY',
    red:    '🔴 CZERWONY',
    black:  '⚫ CZARNY',
  }[item.zone] || '🟢 ZIELONY';

  // Ratio display — czytelne etykiety zamiast 99.00
  let ratioDisplay, ratioColor;
  if (item.planError) {
    ratioDisplay = '⚠ błąd planu'; ratioColor = T.bn;
  } else if (item.allDone) {
    ratioDisplay = '✅ done'; ratioColor = T.ok;
  } else if (item.overdue) {
    ratioDisplay = 'PO TERM.'; ratioColor = T.bn;
  } else if (item.ratio != null) {
    ratioDisplay = item.ratio.toFixed(2);
    ratioColor = item.ratio >= 1.0 ? T.bn : tc.text;
  } else {
    ratioDisplay = '—'; ratioColor = T.text3;
  }

  // Bufor display
  let bufDisplay, bufColor;
  if (item.allDone) {
    bufDisplay = '—'; bufColor = T.text3;
  } else if (item.overdue) {
    bufDisplay = `−${item.overdueH?.toFixed(1)}h`; bufColor = T.bn;
  } else if (item.planError) {
    bufDisplay = '⚠'; bufColor = T.bn;
  } else {
    const bufH = item.remainingAvailH - item.remainingNeededH;
    bufDisplay = bufH >= 0 ? `+${bufH.toFixed(1)}h` : `${bufH.toFixed(1)}h`;
    bufColor   = bufH >= 0 ? T.ok : T.bn;
  }

  return (
    <div style={{
      borderRadius: 10,
      border: `1px solid ${expanded ? tc.border : T.border}`,
      background: expanded ? tc.bg : T.surface2,
      overflow: 'hidden',
      transition: 'border-color 0.15s, background 0.15s',
    }}>
      <div onClick={onToggle} style={{
        display: 'grid', gridTemplateColumns: '100px 1fr 1fr 80px 80px 80px 40px',
        gap: 8, padding: '10px 14px', alignItems: 'center', cursor: 'pointer',
      }}>
        <span style={{ ...s.badge(tc), fontSize: 10, justifyContent: 'center', whiteSpace: 'nowrap' }}>
          {zoneLabel}
        </span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
            {item.zs_id || item.parent_zp}{item.pozycja ? ` poz.${item.pozycja}` : ''}
          </div>
          <div style={{ fontSize: 11, color: T.text3, fontFamily: 'monospace' }}>{item.parent_zp}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: T.text2 }}>{item.klient || '—'}</div>
          <div style={{ fontSize: 10, color: T.text3 }}>{item.product}</div>
        </div>
        <span style={{ fontSize: 11, color: T.text2, fontFamily: 'monospace' }}>
          {item.need_date?.toISOString().slice(0, 10)}
        </span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: ratioColor, fontFamily: 'monospace' }}>
            {ratioDisplay}
          </div>
          <div style={{ fontSize: 9, color: T.text3 }}>ratio</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'monospace', color: bufColor }}>
            {bufDisplay}
          </div>
          <div style={{ fontSize: 9, color: T.text3 }}>bufor</div>
        </div>
        <span style={{
          fontSize: 14, color: T.text3, textAlign: 'center',
          transform: expanded ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.2s',
        }}>▶</span>
      </div>

      {/* pasek ratio */}
      <div style={{ padding: '0 14px 10px' }}>
        <RatioBar ratio={item.ratio} zone={item.zone} overdue={item.overdue} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
          <span style={{ fontSize: 10, color: T.text3 }}>
            {item.overdue ? (
              <span style={{ color: T.bn }}>⚠ Po terminie o {item.overdueH?.toFixed(1)}h</span>
            ) : item.allDone ? (
              <span style={{ color: T.ok }}>Zakończone</span>
            ) : item.planError ? (
              <span style={{ color: T.bn }}>Patologia planu — start &gt; termin</span>
            ) : (
              <>
                Potrzeba: <span style={{ fontFamily: 'monospace', color: T.text2 }}>
                  {item.remainingNeededH > 0 ? `${item.remainingNeededH.toFixed(1)}h` : '—'}
                </span>
                &nbsp;·&nbsp; Dostępne: <span style={{ fontFamily: 'monospace', color: T.text2 }}>
                  {item.remainingAvailH > 0 ? `${item.remainingAvailH.toFixed(1)}h` : '—'}
                </span>
              </>
            )}
          </span>
          <span style={{ fontSize: 10, color: T.text3 }}>{item.cnfOps}/{item.totalOps} op. CNF</span>
        </div>
      </div>

      {/* rozwinięcie — operacje */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${T.border}` }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '20px 110px 1fr 55px 55px 60px 70px',
            gap: 8, padding: '6px 14px 4px 40px',
            borderBottom: `1px solid ${T.border}`,
          }}>
            {['#', 'Nr ZP', 'Operacja', 'Plan h', 'Rzecz. h', 'Wol./Plan', 'Status'].map((h, i) => (
              <span key={h} style={{
                fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.06em', color: T.text3,
                textAlign: i >= 2 ? 'right' : 'left',
              }}>{h}</span>
            ))}
          </div>
          {item.ops.map((op, i) => (
            <OpRow key={`${op.workcenter}-${op.sequence}`} op={op} isLast={i === item.ops.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── GŁÓWNY KOMPONENT ─────────────────────────────────────────────────────────

export function BufferTab({ zpStatusData }) {
  const [expanded, setExpanded] = useState(null);
  const [filter, setFilter]     = useState('all');

  const now = useMemo(() => new Date(), []);

  const items = useMemo(() => calcAll(zpStatusData || [], now), [zpStatusData, now]);

  const filtered = useMemo(() => {
    const base = filter === 'all' ? items : items.filter(i => i.zone === filter);
    return [...base].sort((a, b) => {
      const zo = zoneOrder(a.zone) - zoneOrder(b.zone);
      if (zo !== 0) return zo;
      if (a.zone === 'black' || a.zone === 'red') {
        // po terminie na górze, potem po overdueH malejąco, potem ratio
        if (a.overdue && !b.overdue) return -1;
        if (!a.overdue && b.overdue) return 1;
        if (a.overdue && b.overdue) return (b.overdueH || 0) - (a.overdueH || 0);
        return (b.ratio || 0) - (a.ratio || 0);
      }
      return (a.need_date || 0) - (b.need_date || 0);
    });
  }, [items, filter]);

  const stats = useMemo(() => {
    const cnt = { black: 0, red: 0, yellow: 0, green: 0 };
    items.forEach(i => { cnt[i.zone] = (cnt[i.zone] || 0) + 1; });
    return cnt;
  }, [items]);

  if (!zpStatusData?.length) {
    return <EmptyState icon="🟡" title="Brak danych realizacji" sub="Wgraj plik ZP Status w zakładce Import / Eksport" />;
  }

  const FILTERS = [
    { id: 'all',    label: `Wszystkie (${items.length})` },
    { id: 'black',  label: `⚫ Czarny (${stats.black})` },
    { id: 'red',    label: `🔴 Czerwony (${stats.red})` },
    { id: 'yellow', label: `🟡 Żółty (${stats.yellow})` },
    { id: 'green',  label: `🟢 Zielony (${stats.green})` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {[
          { zone: 'black',  count: stats.black,  label: 'Po terminie / kryt.', color: T.text3 },
          { zone: 'red',    count: stats.red,    label: 'Strefa czerwona',     color: T.bn   },
          { zone: 'yellow', count: stats.yellow, label: 'Strefa żółta',        color: T.warn },
          { zone: 'green',  count: stats.green,  label: 'Strefa zielona',      color: T.ok   },
        ].map(({ zone, count, label, color }) => (
          <div key={zone} onClick={() => setFilter(f => f === zone ? 'all' : zone)}
            style={{ ...s.card, cursor: 'pointer',
              borderLeft: `3px solid ${color}`,
              borderColor: filter === zone ? color : T.border,
              background: filter === zone ? tocColor(zone).bg : T.surface,
              transition: 'all 0.15s',
            }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.text3 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: 'monospace', margin: '4px 0' }}>{count}</div>
            <div style={{ fontSize: 11, color: T.text3 }}>zleceń prod.</div>
          </div>
        ))}
      </div>

      <div style={{ ...s.card, padding: '10px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.text3 }}>
            Ratio = czas potrzebny / czas dostępny
          </span>
          {[
            { color: T.ok,    label: '< 0.5 zielony'  },
            { color: T.warn,  label: '< 0.8 żółty'    },
            { color: T.bn,    label: '< 1.0 czerwony'  },
            { color: T.text3, label: '≥ 1.0 czarny'   },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 6, background: color, opacity: 0.6, borderRadius: 3 }} />
              <span style={{ fontSize: 10, color: T.text3 }}>{label}</span>
            </div>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 10, color: T.text3 }}>
            Po terminie: bufor = czas przekroczenia (ujemny) · Sortowanie: po terminie↑ → ratio↓
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f.id} type="button" style={s.btnSm(filter === f.id)} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ ...s.card, color: T.text3, fontSize: 13, textAlign: 'center', padding: 32 }}>
          Brak zleceń dla wybranego filtra
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr 80px 80px 80px 40px', gap: 8, padding: '0 14px' }}>
            {['Strefa', 'Zlecenie', 'Klient / Produkt', 'Termin', 'Ratio', 'Bufor', ''].map(h => (
              <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.text3 }}>{h}</span>
            ))}
          </div>
          {filtered.map(item => (
            <ZpRow key={item.parent_zp} item={item}
              expanded={expanded === item.parent_zp}
              onToggle={() => setExpanded(p => p === item.parent_zp ? null : item.parent_zp)} />
          ))}
        </div>
      )}
    </div>
  );
}