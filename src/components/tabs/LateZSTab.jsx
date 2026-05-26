import { useMemo, useState } from 'react';
import { T, s, tocColor } from '../../constants/theme.js';

function tocZone(toc) {
  if (!toc) return 'green';
  if (typeof toc === 'string') return toc;
  return toc.zone || 'green';
}

function fmtDate(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

export function LateZSTab({ zpStatus }) {
  const [onlyLate, setOnlyLate] = useState(true);
  const [search,   setSearch]   = useState('');

  // Grupuj zpStatus po zs_id
  const zsGroups = useMemo(() => {
    if (!zpStatus.length) return [];

    const byZS = {};
    zpStatus.forEach(z => {
      const key = z.zs_id || '—';
      if (!byZS[key]) byZS[key] = { zs_id: key, klient: z.klient || '—', items: [] };
      byZS[key].items.push(z);
    });

    return Object.values(byZS).map(group => {
      // Posortuj pozycje po due_date
      const items = [...group.items].sort((a, b) => a.due_date?.localeCompare(b.due_date));

      const totalDelay  = items.reduce((s, z) => s + (z.delayDays || 0), 0);
      const lateCount   = items.filter(z => tocZone(z.toc) === 'black').length;
      const isLate      = lateCount > 0;
      const firstDue    = items[0]?.due_date || '';
      const worstDelay  = Math.max(...items.map(z => z.delayDays || 0));

      return { ...group, items, totalDelay, lateCount, isLate, firstDue, worstDelay };
    });
  }, [zpStatus]);

  // Sortuj: spóźnione pierwsze → worstDelay malejąco → klient A→Z → firstDue
  const sorted = useMemo(() => {
    return [...zsGroups]
      .filter(g => {
        if (onlyLate && !g.isLate) return false;
        if (search) {
          const q = search.toLowerCase();
          return g.klient.toLowerCase().includes(q) || g.zs_id.toLowerCase().includes(q);
        }
        return true;
      })
      .sort((a, b) => {
        if (a.isLate !== b.isLate) return a.isLate ? -1 : 1;
        if (b.worstDelay !== a.worstDelay) return b.worstDelay - a.worstDelay;
        const kc = a.klient.localeCompare(b.klient);
        if (kc !== 0) return kc;
        return a.firstDue.localeCompare(b.firstDue);
      });
  }, [zsGroups, onlyLate, search]);

  // KPI
  const totalZS   = zsGroups.length;
  const lateZS    = zsGroups.filter(g => g.isLate).length;
  const totalZP   = zpStatus.length;
  const lateZP    = zpStatus.filter(z => tocZone(z.toc) === 'black').length;
  const worstZS   = zsGroups.filter(g => g.isLate).reduce((best, g) => g.worstDelay > (best?.worstDelay ?? 0) ? g : best, null);

  if (!zpStatus.length) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: T.text3 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🧾</div>
        <div style={{ fontSize: 14 }}>Brak danych. Wczytaj zp_status.csv w zakładce Import.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        <KpiCard icon="🧾" label="Zamówienia sprzedaży"  value={totalZS}  sub="łącznie w systemie"          color={T.accent} />
        <KpiCard icon="⚠️" label="Spóźnione ZS"         value={lateZS}   sub={`${lateZP} ZP po terminie`}  color={lateZS > 0 ? T.bn : T.ok} />
        <KpiCard icon="✅" label="ZS na czas"            value={totalZS - lateZS} sub={`${totalZP - lateZP} ZP OK`} color={T.ok} />
        <KpiCard icon="🔥" label="Najgorsze opóźnienie"
          value={worstZS ? `+${worstZS.worstDelay}d` : '—'}
          sub={worstZS ? `${worstZS.klient}` : 'brak opóźnień'}
          color={worstZS ? T.bn : T.ok} />
      </div>

      {/* Filtry */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button"
          style={{ ...s.btn(onlyLate), fontSize: 12 }}
          onClick={() => setOnlyLate(true)}>
          ⚠️ Tylko spóźnione
          {lateZS > 0 && <span style={{ marginLeft: 6, background: T.bn, color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{lateZS}</span>}
        </button>
        <button type="button"
          style={{ ...s.btn(!onlyLate), fontSize: 12 }}
          onClick={() => setOnlyLate(false)}>
          📋 Wszystkie ZS
        </button>
        <input
          type="text"
          placeholder="Szukaj klienta lub ZS..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 8,
            color: T.text, fontSize: 12, padding: '6px 12px', outline: 'none',
            marginLeft: 'auto', minWidth: 220,
          }}
        />
      </div>

      {/* Lista ZS */}
      {sorted.length === 0 ? (
        <div style={{ ...s.card, textAlign: 'center', color: T.ok, padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 14 }}>Brak spóźnionych zamówień</div>
        </div>
      ) : (
        sorted.map(group => <ZSGroup key={group.zs_id} group={group} />)
      )}
    </div>
  );
}

// ─── GRUPA ZS ─────────────────────────────────────────────────────────────────

function ZSGroup({ group }) {
  const headerColor = group.isLate ? T.bn : T.ok;

  return (
    <div style={{ border: `1px solid ${group.isLate ? T.bn : T.border}`, borderRadius: 12, overflow: 'hidden' }}>

      {/* Nagłówek ZS */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        background: group.isLate ? 'rgba(248,113,113,0.07)' : T.surface,
        borderBottom: `1px solid ${group.isLate ? T.bn : T.border}`,
      }}>
        <span style={{ fontSize: 16 }}>{group.isLate ? '⚠️' : '✅'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{group.zs_id}</span>
            <span style={{ fontSize: 12, color: T.text2 }}>{group.klient}</span>
          </div>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
            {group.items.length} {group.items.length === 1 ? 'pozycja' : group.items.length < 5 ? 'pozycje' : 'pozycji'}
            {group.isLate && <span style={{ color: T.bn, marginLeft: 8, fontWeight: 600 }}>· {group.lateCount} spóźnionych</span>}
          </div>
        </div>
        {group.isLate && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.bn, fontFamily: 'monospace' }}>+{group.worstDelay}d</div>
            <div style={{ fontSize: 10, color: T.text3 }}>maks. opóźnienie</div>
          </div>
        )}
      </div>

      {/* Tabela pozycji */}
      <div style={{ background: T.surface }}>
        {/* Nagłówek tabeli */}
        <div style={{ display: 'grid', gridTemplateColumns: '60px 90px 1fr 110px 110px 100px 80px 100px', gap: 8, padding: '6px 16px', borderBottom: `1px solid ${T.border}` }}>
          {['Poz.', 'ZP', 'Produkt', 'Due date', 'Koniec', 'Opóźnienie', 'Bottleneck', 'Status'].map(h => (
            <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.text3 }}>{h}</span>
          ))}
        </div>

        {/* Wiersze */}
        {group.items.map(z => {
          const zone    = tocZone(z.toc);
          const tc      = tocColor(zone);
          const isLate  = zone === 'black';
          const delayTxt = z.delayDays > 0 ? `+${z.delayDays}d` : '✓ OK';

          return (
            <div key={z.zp_id}
              style={{
                display: 'grid', gridTemplateColumns: '60px 90px 1fr 110px 110px 100px 80px 100px',
                gap: 8, padding: '10px 16px', alignItems: 'center',
                borderBottom: `1px solid ${T.border}`,
                background: isLate ? 'rgba(248,113,113,0.04)' : 'transparent',
              }}>

              {/* Pozycja */}
              <span style={{ fontSize: 11, color: T.text3 }}>poz.{z.pozycja ?? '—'}</span>

              {/* ZP */}
              <span style={{ fontSize: 12, fontWeight: 600, color: T.accent, fontFamily: 'monospace' }}>{z.zp_id}</span>

              {/* Produkt */}
              <span style={{ fontSize: 11, color: T.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{z.product}</span>

              {/* Due date */}
              <span style={{ fontSize: 11, color: T.text2, fontFamily: 'monospace' }}>{z.due_date}</span>

              {/* Koniec realny */}
              <span style={{ fontSize: 11, color: isLate ? T.bn : T.text2, fontFamily: 'monospace' }}>{fmtDate(z.realEnd)}</span>

              {/* Opóźnienie */}
              <span style={{
                fontSize: 12, fontWeight: 600, fontFamily: 'monospace',
                color: isLate ? T.bn : T.ok,
              }}>{delayTxt}</span>

              {/* Bottleneck */}
              <span style={{ fontSize: 11, color: T.text3 }}>{z.bottleneck || '—'}</span>

              {/* Status badge */}
              <span style={{
                ...s.tag(isLate ? T.bn : T.ok),
                fontSize: 10, fontWeight: 700, textAlign: 'center',
              }}>
                {isLate ? 'SPÓŹNIONE' : 'OK'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, color }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 12, padding: '16px 18px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.text3 }}>{label}</div>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, fontFamily: 'monospace', marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: T.text3 }}>{sub}</div>
    </div>
  );
}