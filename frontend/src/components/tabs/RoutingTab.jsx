import { useState, useMemo, useRef, useCallback } from 'react';
import { T, PALETTE, s, tocColor, uStatus } from '../../constants/theme.js';
import { localDateStr, fmtDt, computeLoads, getAvail } from '../../utils/scheduler.js';
import { Dot } from '../common/Dot.jsx';
import { EmptyState } from '../common/EmptyState.jsx';

// Łamie nazwę maszyny na maks. 2 linijki (SVG <text> nie zawija tekstu samo) —
// dzieli przy spacji najbliższej połowie długości, albo twardo jeśli brak spacji.
function wrapTwoLines(text, maxCharsPerLine = 13) {
  if (!text) return ['', ''];
  if (text.length <= maxCharsPerLine) return [text, ''];

  // Kandydaci na miejsce złamania: spacja (łam przed nią) albo myślnik (łam po nim).
  const candidates = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ') candidates.push(i);
    if (text[i] === '-') candidates.push(i + 1);
  }

  let idx = [...candidates].reverse().find(c => c <= maxCharsPerLine);
  if (idx === undefined) idx = candidates.find(c => c > maxCharsPerLine);
  if (idx === undefined) idx = maxCharsPerLine;

  return [text.slice(0, idx).trim(), text.slice(idx).trim()];
}

export function RoutingTab({ routing, zp, globalLookups, wcSchedule }) {
  // Kolor per brygada (WC3) — stabilny w całym zbiorze danych (nie tylko widocznych
  // po filtrze), żeby ten sam kolor zawsze znaczył tę samą brygadę.
  const brigadeColorMap = useMemo(() => {
    const map = {};
    const order = [...new Set((routing || []).map(r => r.wc_group).filter(Boolean))].sort();
    order.forEach((g, i) => { map[g] = PALETTE[i % PALETTE.length]; });
    return map;
  }, [routing]);

  const productNames = useMemo(() => {
    const m = {};
    (zp || []).forEach(z => { if (z.product && z.product_name) m[z.product] = z.product_name; });
    return m;
  }, [zp]);
  const [filterWC, setFilterWC] = useState('');
  const [inputVal, setInputVal] = useState('');
  const [rowTooltip, setRowTooltip] = useState(null); // {x, y, products, name}
  const svgWrapRef = useRef(null);

  const dates = useMemo(() => [...new Set(zp.map(z => z.due_date))].sort(), [zp]);

  // Wszystkie unikalne gniazda — do dropdownu
  const allWC = useMemo(() => {
    const set = new Map();
    routing.forEach(r => {
      if (!set.has(r.workcenter)) set.set(r.workcenter, r.operation || r.workcenter);
    });
    return [...set.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }, [routing]);

  // Klucz zależności zgodny z silnikiem (scheduler.worker.js): _opUid gdy nadany
  // przez applyParallelPredecessors, inaczej numer OP (naiwny łańcuch bez maszyn równoległych).
  const opKey = op => op._opUid ?? op.sequence;

  // Grupuj produkty po identycznym fingerprint routingu — sekwencja gniazd ORAZ
  // struktura zależności (predecessors), nie tylko sama kolejność. Dwa routingi
  // z tymi samymi maszynami, ale innym grafem (np. jeden liniowy, drugi z maszynami
  // równoległymi) to różne wizualnie routingi, nie powinny się scalać w jedną grupę.
  const uniqueRoutings = useMemo(() => {
    const groups = new Map(); // fingerprint → {ops, products[]}
    const allProducts = [...new Set(routing.map(r => r.product))];
    allProducts.forEach(p => {
      const ops = (globalLookups.routingByProduct[p] || []).slice().sort((a, b) => a.sequence - b.sequence);
      const posOf = new Map(ops.map((op, i) => [opKey(op), i]));
      const fp = ops.map(op => {
        const predPos = (op.predecessors || []).map(pk => posOf.get(pk)).filter(x => x !== undefined).sort((a, b) => a - b);
        return `${op.workcenter}<${predPos.join(',')}>`;
      }).join('|');
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

  // Układ węzłów wg grafu zależności: kolumna (depth) = najdłuższa ścieżka od korzenia,
  // operacje bez wzajemnej zależności w tej samej kolumnie mogą stanąć jedna nad drugą
  // (widać wtedy rozgałęzienie/zbiegnięcie zamiast sztucznego liniowego łańcucha).
  const ROWGAP = 14;
  const layoutedRoutings = useMemo(() => {
    return filteredRoutings.map(route => {
      const { ops } = route;
      const byKey = new Map(ops.map(op => [opKey(op), op]));
      const depthCache = new Map();
      function depthOf(op) {
        const k = opKey(op);
        if (depthCache.has(k)) return depthCache.get(k);
        depthCache.set(k, 0); // guard przed ewentualnym cyklem
        const preds = (op.predecessors || []).filter(p => byKey.has(p) && p !== k);
        const d = preds.length === 0 ? 0 : 1 + Math.max(...preds.map(p => depthOf(byKey.get(p))));
        depthCache.set(k, d);
        return d;
      }
      ops.forEach(depthOf);

      const columns = new Map(); // depth -> [op,...]
      ops.forEach(op => {
        const d = depthCache.get(opKey(op));
        if (!columns.has(d)) columns.set(d, []);
        columns.get(d).push(op);
      });
      columns.forEach(list => list.sort((a, b) => a.sequence - b.sequence));

      const positions = new Map(); // key -> { depth, idx, colSize }
      columns.forEach((list, depth) => {
        list.forEach((op, idx) => positions.set(opKey(op), { depth, idx, colSize: list.length }));
      });

      const maxDepth = columns.size ? Math.max(...columns.keys()) : 0;
      const maxColSize = columns.size ? Math.max(...[...columns.values()].map(c => c.length)) : 1;
      return { ...route, byKey, positions, maxDepth, maxColSize };
    });
  }, [filteredRoutings]);

  const firstDateZP = useMemo(() => dates.length ? zp.filter(z => z.due_date === dates[0]) : [], [zp, dates]);
  const wcLoads = useMemo(() => dates.length ? computeLoads(globalLookups.routingByProduct, firstDateZP, wcSchedule, dates[0]) : {}, [dates.join(','), firstDateZP.length, globalLookups, wcSchedule]);
  const maxUtil = Object.values(wcLoads).length ? Math.max(...Object.values(wcLoads).map(v => v.util)) : 0;

  if (!routing.length) return <EmptyState icon="🔀" title="Brak danych" sub="Wgraj routing.csv" />;

  const BW = 120, BH = 82, GAP = 36, ROW_H = 150, LEFT = 180;
  const maxDepthAll = layoutedRoutings.length ? Math.max(...layoutedRoutings.map(r => r.maxDepth)) : 0;
  const groupHeights = layoutedRoutings.map(r => Math.max(ROW_H, r.maxColSize * (BH + ROWGAP) + 60));
  const groupTops = [];
  groupHeights.reduce((top, h) => { groupTops.push(top); return top + h; }, 30);
  const svgW = LEFT + (maxDepthAll + 1) * (BW + GAP) + 40;
  const svgH = groupHeights.reduce((a, b) => a + b, 30);

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
              {layoutedRoutings.map((route, pi) => {
                const { ops, products: routeProducts, positions, maxColSize } = route;
                const groupTop = groupTops[pi];
                const groupH = groupHeights[pi];
                const groupMidY = groupTop + groupH / 2;
                const colBlockH = maxColSize * (BH + ROWGAP) - ROWGAP;
                // Kolor po pierwszym produkcie z grupy
                const p0 = routeProducts[0];
                const col = PALETTE[(globalLookups.productIndexMap[p0] ?? pi) % PALETTE.length];

                // Pozycja pudełka danej operacji — kolumna wg głębokości w grafie,
                // wewnątrz kolumny wycentrowana wg liczby operacji na tym samym poziomie.
                function boxPos(op) {
                  const { depth, idx, colSize } = positions.get(opKey(op));
                  const colH = colSize * (BH + ROWGAP) - ROWGAP;
                  const x = LEFT + depth * (BW + GAP);
                  const y = groupTop + 30 + (colBlockH - colH) / 2 + idx * (BH + ROWGAP);
                  return { x, y };
                }

                return (
                  <g key={pi}>
                    {pi > 0 && <line x1="0" y1={groupTop - 10} x2={svgW} y2={groupTop - 10} stroke={T.border} />}
                    {/* Etykieta z liczbą produktów + title */}
                    <title>{routeProducts.map(p => productNames[p] ? `${p} — ${productNames[p]}` : p).join('\n')}</title>
                    <text x={LEFT - 10} y={groupMidY - 16} fontSize="11" fontWeight="700" fill={col} textAnchor="end" dominantBaseline="central">{routeProducts.length}×</text>
                    <text x={LEFT - 10} y={groupMidY - 2} fontSize="8" fill="#a8b0c0" textAnchor="end" dominantBaseline="central">{routeProducts.slice(0,3).join(', ')}{routeProducts.length > 3 ? '…' : ''}</text>
                    <text x={LEFT - 10} y={groupMidY + 12} fontSize="8" fill="#6b7280" textAnchor="end" dominantBaseline="central" style={{fontStyle:'italic'}}>{(productNames[routeProducts[0]] || '').slice(0, 28)}{(productNames[routeProducts[0]] || '').length > 28 ? '…' : ''}</text>

                    {/* Krawędzie zależności — z predecessors (fan-out/fan-in), nie z kolejności w tablicy */}
                    {ops.map(op => {
                      const to = boxPos(op);
                      return (op.predecessors || []).map(predKey => {
                        const predOp = route.byKey.get(predKey);
                        if (!predOp) return null;
                        const from = boxPos(predOp);
                        const x1 = from.x + BW, y1 = from.y + BH / 2;
                        const x2 = to.x, y2 = to.y + BH / 2;
                        const midX = (x1 + x2) / 2;
                        return (
                          <path key={`${predKey}->${opKey(op)}`}
                            d={`M ${x1} ${y1} C ${midX} ${y1} ${midX} ${y2} ${x2 - 4} ${y2}`}
                            fill="none" stroke="#555c6b" strokeWidth="1.5" markerEnd="url(#ra)" />
                        );
                      });
                    })}

                    {ops.map(op => {
                      const { x: boxX, y: boxY } = boxPos(op);
                      const wcData = wcLoads[op.workcenter] || { util: 0 };
                      const u = wcData.util;
                      const isBn = Math.abs(u - maxUtil) < 0.001 && u > 0.85;
                      const isHighlighted = filterWC && String(op.workcenter) === filterWC;
                      const brigadeColor = brigadeColorMap[op.wc_group] || T.border2;
                      const [nameLine1, nameLine2] = wrapTwoLines(op.machine_name || op.operation || '');
                      return (
                        <g key={opKey(op)}>
                          <rect x={boxX} y={boxY} width={BW} height={BH} rx="8"
                            fill={isHighlighted ? 'rgba(77,148,255,0.12)' : T.surface2}
                            stroke={isHighlighted ? T.accent : isBn ? T.bn : T.border2}
                            strokeWidth={isHighlighted ? 2 : isBn ? 2 : 1}
                          />
                          {op.wc_group && (
                            <rect x={boxX} y={boxY} width={4} height={BH} fill={brigadeColor} rx="2" />
                          )}
                          {op.wc_group && (
                            <text x={boxX + BW / 2} y={boxY + 13} textAnchor="middle" fontSize="9" fill={T.text3}>{op.wc_group}</text>
                          )}
                          <text x={boxX + BW / 2} y={boxY + 29} textAnchor="middle" fontSize="13" fontWeight="700" fill={isHighlighted ? T.accent : T.text}>{op.workcenter}</text>
                          <text x={boxX + BW / 2} y={boxY + 44} textAnchor="middle" fontSize="9" fill={T.text2}>{nameLine1}</text>
                          {nameLine2 && (
                            <text x={boxX + BW / 2} y={boxY + 55} textAnchor="middle" fontSize="9" fill={T.text2}>{nameLine2}</text>
                          )}
                        </g>
                      );
                    })}
                    {/* Hover rect — tooltip z listą produktów */}
                    <rect x={0} y={groupTop} width={LEFT - 15} height={groupH} fill="transparent"
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