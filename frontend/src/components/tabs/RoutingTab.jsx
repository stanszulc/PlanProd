import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { T, PALETTE, s, tocColor, uStatus } from '../../constants/theme.js';
import { localDateStr, fmtDt, computeLoads, getAvail } from '../../utils/scheduler.js';
import { Dot } from '../common/Dot.jsx';
import { EmptyState } from '../common/EmptyState.jsx';

export function RoutingTab({ routing, zp, globalLookups }) {
  const productNames = useMemo(() => {
    const m = {};
    (zp || []).forEach(z => { if (z.product && z.product_name) m[z.product] = z.product_name; });
    return m;
  }, [zp]);
  const [filterWC, setFilterWC] = useState('');
  const [inputVal, setInputVal] = useState('');
  const [rowTooltip, setRowTooltip] = useState(null); // {x, y, products, name}
  const svgWrapRef = useRef(null);

  // Poziomy scroll kółkiem myszy
  useEffect(() => {
    const el = svgWrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // trackpad poziomy — bez zmian
      if (e.shiftKey) return; // Shift+scroll — normalne pionowe przewijanie strony
      e.preventDefault();
      el.scrollLeft += e.deltaY * 2;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const dates = useMemo(() => [...new Set(zp.map(z => z.due_date))].sort(), [zp]);

  // Wszystkie unikalne gniazda — do dropdownu
  const allWC = useMemo(() => {
    const set = new Map();
    routing.forEach(r => {
      if (!set.has(r.workcenter)) set.set(r.workcenter, r.operation || r.workcenter);
    });
    return [...set.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }, [routing]);

  // Grupuj produkty po identycznym fingerprint routingu (sekwencja gniazd)
  const uniqueRoutings = useMemo(() => {
    const groups = new Map(); // fingerprint → {ops, products[]}
    const allProducts = [...new Set(routing.map(r => r.product))];
    allProducts.forEach(p => {
      const ops = (globalLookups.routingByProduct[p] || []).slice().sort((a, b) => a.sequence - b.sequence);
      const fp = ops.map(o => String(o.workcenter)).join('|');
      if (!groups.has(fp)) groups.set(fp, { ops, products: [] });
      groups.get(fp).products.push(p);
    });
    return [...groups.values()];
  }, [routing, globalLookups]);

  // Filtrowane unikalne routingi — tylko te zawierające wybrane gniazdo
  const filteredRoutings = useMemo(() => {
    if (!filterWC) return uniqueRoutings;
    return uniqueRoutings.filter(r => r.ops.some(op => String(op.workcenter) === filterWC));
  }, [uniqueRoutings, filterWC]);

  const firstDateZP = useMemo(() => dates.length ? zp.filter(z => z.due_date === dates[0]) : [], [zp, dates]);
  const wcLoads = useMemo(() => dates.length ? computeLoads(globalLookups.routingByProduct, firstDateZP) : {}, [dates.join(','), firstDateZP.length]);
  const maxUtil = Object.values(wcLoads).length ? Math.max(...Object.values(wcLoads).map(v => v.util)) : 0;

  if (!routing.length) return <EmptyState icon="🔀" title="Brak danych" sub="Wgraj routing.csv" />;

  const BW = 120, BH = 72, GAP = 36, ROW_H = 140, LEFT = 180;
  const maxOps = filteredRoutings.length
    ? Math.max(...filteredRoutings.map(r => r.ops.length))
    : 1;
  const svgW = LEFT + maxOps * (BW + GAP) + 40;
  const svgH = filteredRoutings.length * ROW_H + 60;

  // Nazwa gniazda do wyświetlenia w filtrze
  const wcName = filterWC ? (allWC.find(([id]) => id === filterWC)?.[1] || filterWC) : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Pasek filtrowania */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: T.text3, fontWeight: 500 }}>Filtruj wg gniazda:</span>
        <div style={{ position: 'relative', flex: '0 0 280px' }}>
          <input
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            placeholder="Wpisz kod lub nazwę gniazda..."
            style={{ width: '100%', fontSize: 12, padding: '5px 10px', borderRadius: 6, border: `1px solid ${T.border2}`, background: T.surface1, color: T.text, outline: 'none', boxSizing: 'border-box' }}
          />
          {/* Dropdown z pasującymi gniazdami */}
          {inputVal && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 6, maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', marginTop: 2 }}>
              {allWC
                .filter(([id, name]) =>
                  String(id).toLowerCase().includes(inputVal.toLowerCase()) ||
                  name.toLowerCase().includes(inputVal.toLowerCase())
                )
                .slice(0, 30)
                .map(([id, name]) => (
                  <div key={id}
                    onClick={() => { setFilterWC(String(id)); setInputVal(''); }}
                    style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 12, color: T.text, borderBottom: `0.5px solid ${T.border}`, display: 'flex', gap: 8, alignItems: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.background = T.surface1}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <code style={{ fontSize: 11, color: T.accent, background: T.accentBg, padding: '1px 5px', borderRadius: 4 }}>{id}</code>
                    <span style={{ color: T.text2 }}>{name}</span>
                  </div>
                ))}
              {allWC.filter(([id, name]) =>
                String(id).toLowerCase().includes(inputVal.toLowerCase()) ||
                name.toLowerCase().includes(inputVal.toLowerCase())
              ).length === 0 && (
                <div style={{ padding: '10px', fontSize: 12, color: T.text3, textAlign: 'center' }}>Brak wyników</div>
              )}
            </div>
          )}
        </div>

        {/* Aktywny filtr */}
        {filterWC && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 16, background: T.accentBg, border: `1px solid ${T.accent}`, fontSize: 12 }}>
            <code style={{ color: T.accent, fontWeight: 600 }}>{filterWC}</code>
            {wcName !== filterWC && <span style={{ color: T.text2 }}>{wcName}</span>}
            <button onClick={() => setFilterWC('')} style={{ fontSize: 11, color: T.text3, border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>✕</button>
          </div>
        )}

        <span style={{ fontSize: 11, color: T.text3, marginLeft: 'auto' }}>
          {filteredRoutings.length} / {uniqueRoutings.length} unikalnych routingów · {routing.length > 0 ? [...new Set(routing.map(r => r.product))].length : 0} produktów
        </span>
      </div>

      {/* SVG */}
      {filteredRoutings.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: T.text3, fontSize: 13 }}>
          Brak routingów zawierających gniazdo <code style={{ color: T.accent }}>{filterWC}</code>
        </div>
      ) : (
        <div style={{ ...s.card, overflow: 'visible', padding: 0 }}>
          <div style={{ padding: '10px 14px', borderBottom: `0.5px solid ${T.border}`, ...s.cardTitle }}>
            Wizualizacja procesów technologicznych (Routingu)
          </div>
          <div ref={svgWrapRef} style={{ overflowX: 'auto', overflowY: 'visible', WebkitOverflowScrolling: 'touch', cursor: 'default' }}>
            <svg width={svgW} height={svgH} style={{ display: 'block', minWidth: svgW }}>
              <defs>
                <marker id="ra" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M1 1L9 5L1 9" fill="none" stroke="#555c6b" strokeWidth="1.5" />
                </marker>
              </defs>
              {filteredRoutings.map((route, pi) => {
                const { ops, products: routeProducts } = route;
                const rowY = 30 + pi * ROW_H;
                const boxY = rowY + (ROW_H - 30 - BH) / 2;
                // Kolor po pierwszym produkcie z grupy
                const p0 = routeProducts[0];
                const col = PALETTE[(globalLookups.productIndexMap[p0] ?? pi) % PALETTE.length];
                const tooltipId = `rt-${pi}`;
                return (
                  <g key={pi}>
                    {pi > 0 && <line x1="0" y1={rowY - 10} x2={svgW} y2={rowY - 10} stroke={T.border} />}
                    {/* Etykieta z liczbą produktów + title */}
                    <title>{routeProducts.map(p => productNames[p] ? `${p} — ${productNames[p]}` : p).join('\n')}</title>
                    <text x={LEFT - 10} y={boxY + BH / 2 - 16} fontSize="11" fontWeight="700" fill={col} textAnchor="end" dominantBaseline="central">{routeProducts.length}×</text>
                    <text x={LEFT - 10} y={boxY + BH / 2 - 2} fontSize="8" fill="#a8b0c0" textAnchor="end" dominantBaseline="central">{routeProducts.slice(0,3).join(', ')}{routeProducts.length > 3 ? '…' : ''}</text>
                    <text x={LEFT - 10} y={boxY + BH / 2 + 12} fontSize="8" fill="#6b7280" textAnchor="end" dominantBaseline="central" style={{fontStyle:'italic'}}>{(productNames[routeProducts[0]] || '').slice(0, 28)}{(productNames[routeProducts[0]] || '').length > 28 ? '…' : ''}</text>
                    {ops.map((op, oi) => {
                      const boxX = LEFT + oi * (BW + GAP);
                      const wcData = wcLoads[op.workcenter] || { util: 0 };
                      const u = wcData.util;
                      const isBn = Math.abs(u - maxUtil) < 0.001 && u > 0.85;
                      const isHighlighted = filterWC && String(op.workcenter) === filterWC;
                      return (
                        <g key={oi}>
                          <rect x={boxX} y={boxY} width={BW} height={BH} rx="8"
                            fill={isHighlighted ? 'rgba(77,148,255,0.12)' : T.surface2}
                            stroke={isHighlighted ? T.accent : isBn ? T.bn : T.border2}
                            strokeWidth={isHighlighted ? 2 : isBn ? 2 : 1}
                          />
                          <rect x={boxX} y={boxY} width={BW} height={4} fill={isHighlighted ? T.accent : col} rx="2" />
                          <text x={boxX + BW / 2} y={boxY + 22} textAnchor="middle" fontSize="13" fontWeight="700" fill={isHighlighted ? T.accent : T.text}>{op.workcenter}</text>
                          <text x={boxX + BW / 2} y={boxY + 40} textAnchor="middle" fontSize="10" fill={T.text2}>{op.operation}</text>
                          <text x={boxX + BW / 2} y={boxY + 58} textAnchor="middle" fontSize="10" fill={T.text3}>{op.ct_min} min</text>
                          {oi < ops.length - 1 && (
                            <line x1={boxX + BW + 2} y1={boxY + BH / 2} x2={boxX + BW + GAP - 4} y2={boxY + BH / 2} stroke="#555c6b" strokeWidth="1.5" markerEnd="url(#ra)" />
                          )}
                        </g>
                      );
                    })}
                    {/* Hover rect — tooltip z listą produktów */}
                    <rect x={0} y={boxY - 10} width={LEFT - 15} height={BH + 20} fill="transparent"
                      style={{ cursor: 'default' }}
                      onMouseEnter={e => {
                        const rect = svgWrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
                        setRowTooltip({
                          x: e.clientX - rect.left + 12,
                          y: e.clientY - rect.top - 10,
                          products: routeProducts,
                        });
                      }}
                      onMouseLeave={() => setRowTooltip(null)}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}
      {/* Tooltip z listą produktów */}
      {rowTooltip && (
        <div style={{
          position: 'fixed',
          left: rowTooltip.x,
          top: rowTooltip.y,
          background: T.surface2,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 11,
          color: T.text,
          zIndex: 1000,
          pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          maxHeight: 300,
          overflowY: 'auto',
          minWidth: 220,
        }}>
          <div style={{ fontSize: 10, color: T.text3, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            {rowTooltip.products.length} produktów
          </div>
          {rowTooltip.products.map(p => (
            <div key={p} style={{ display: 'flex', gap: 8, padding: '3px 0', borderBottom: `0.5px solid ${T.border}` }}>
              <code style={{ color: T.accent, background: T.accentBg, padding: '1px 5px', borderRadius: 4, fontSize: 10, flexShrink: 0 }}>{p}</code>
              <span style={{ color: T.text2, fontSize: 11 }}>{productNames[p] || '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ZAKŁADKA: SWIMLANE ──────────────────────────────────────────────────────