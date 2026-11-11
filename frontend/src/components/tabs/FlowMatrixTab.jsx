import { useMemo, useState, useRef } from 'react';

// ── Paleta klastrów — jasna, czytelna ─────────────────────────────────────────
const CL = [
  { bg: '#EEF4FF', border: '#4A7FD4', text: '#1E3A6E', badge: '#4A7FD4' },
  { bg: '#EEFAF4', border: '#2E9E6B', text: '#145235', badge: '#2E9E6B' },
  { bg: '#FFF8EC', border: '#D4871A', text: '#6B3F00', badge: '#D4871A' },
  { bg: '#FFF0F5', border: '#C94F7C', text: '#6B1535', badge: '#C94F7C' },
  { bg: '#F3F0FF', border: '#7B6FD4', text: '#2D2169', badge: '#7B6FD4' },
  { bg: '#F0F8FF', border: '#3A9EC4', text: '#0D4060', badge: '#3A9EC4' },
];

function clusterByFlow(nodes, flowMap, threshold = 0.15) {
  const parent = {}, rank = {};
  nodes.forEach(n => { parent[n] = n; rank[n] = 0; });
  function find(x) { if (parent[x] !== x) parent[x] = find(parent[x]); return parent[x]; }
  function union(x, y) {
    const px = find(x), py = find(y);
    if (px === py) return;
    if (rank[px] < rank[py]) parent[px] = py;
    else if (rank[px] > rank[py]) parent[py] = px;
    else { parent[py] = px; rank[px]++; }
  }
  let maxFlow = 0;
  Object.values(flowMap).forEach(row => Object.values(row).forEach(v => { if (v > maxFlow) maxFlow = v; }));
  nodes.forEach(a => nodes.forEach(b => {
    if (a >= b) return;
    const v = (flowMap[a]?.[b] || 0) + (flowMap[b]?.[a] || 0);
    if (maxFlow > 0 && v / maxFlow >= threshold) union(a, b);
  }));
  const clusters = {};
  nodes.forEach(n => { const r = find(n); if (!clusters[r]) clusters[r] = []; clusters[r].push(n); });
  const sorted = Object.values(clusters).sort((a, b) => b.length - a.length);
  const clusterMap = {};
  sorted.forEach((cl, idx) => cl.forEach(n => { clusterMap[n] = idx; }));
  return { clusterMap, clusters: sorted };
}

function heatBg(v, max) {
  if (!v || max === 0) return '#f8f9fa';
  const t = Math.min(v / max, 1);
  if (t < 0.15) return '#dbeafe';
  if (t < 0.35) return '#93c5fd';
  if (t < 0.6)  return '#3b82f6';
  if (t < 0.8)  return '#1d4ed8';
  return '#1e3a8a';
}

function heatText(v, max) {
  if (!v || max === 0) return 'transparent';
  const t = v / max;
  return t > 0.3 ? '#fff' : '#1e3a8a';
}

export function FlowMatrixTab({ fwdZP = [], routing = [], wcToBrygada = {} }) {
  const [view,      setView]      = useState('machine');
  const [metric,    setMetric]    = useState('count');
  const [threshold, setThreshold] = useState(15);
  const [tooltip,   setTooltip]   = useState(null);
  const [selected,  setSelected]  = useState(null);
  const wrapRef = useRef(null);

  // Nazwy gniazd
  const wcNames = useMemo(() => {
    const m = {};
    routing.forEach(r => { const wc = String(r.workcenter); if (!m[wc]) m[wc] = r.machine_name || r.operation || wc; });
    return m;
  }, [routing]);

  const brygadaNames = useMemo(() => {
    const m = {};
    routing.forEach(r => { const brygada = wcToBrygada[String(r.workcenter)]; if (brygada && !m[brygada]) m[brygada] = r.wc_group || brygada; });
    return m;
  }, [routing, wcToBrygada]);

  function label(id) { return wcNames[id] || brygadaNames[id] || id; }

  // Buduj macierze przepływów
  const { machineFlow, brigadeFlow, machines, brigades } = useMemo(() => {
    if (!fwdZP.length) return { machineFlow: {}, brigadeFlow: {}, machines: [], brigades: [] };
    const byZP = {};
    fwdZP.forEach(op => {
      const id = op.parent_zp || op.zp_id?.split('/')[0];
      if (!byZP[id]) byZP[id] = [];
      byZP[id].push(op);
    });
    // Klucz zależności zgodny z silnikiem: _opUid gdy nadany (maszyny równoległe),
    // inaczej numer OP. Przepływ budowany z rzeczywistych predecessors, nie z
    // sąsiedztwa po posortowaniu — inaczej dwie niezależne równoległe operacje
    // (np. piła + gilotyna) wyglądałyby na wzajemnie zależne, a prawdziwe
    // połączenie do operacji zbiegającej by zniknęło.
    const opKey = op => op._opUid ?? op.sequence;
    const mFlow = {}, bFlow = {};
    Object.values(byZP).forEach(ops => {
      const byKey = new Map(ops.map(op => [opKey(op), op]));
      ops.forEach(op => {
        (op.predecessors || []).forEach(predKey => {
          const predOp = byKey.get(predKey);
          if (!predOp) return;
          const from = String(predOp.workcenter), to = String(op.workcenter);
          if (from === to) return;
          const durH = op.durH || 0;
          if (!mFlow[from]) mFlow[from] = {};
          if (!mFlow[from][to]) mFlow[from][to] = { count: 0, hours: 0 };
          mFlow[from][to].count++; mFlow[from][to].hours += durH;
          const bFrom = wcToBrygada[from] || from, bTo = wcToBrygada[to] || to;
          if (bFrom === bTo) return;
          if (!bFlow[bFrom]) bFlow[bFrom] = {};
          if (!bFlow[bFrom][bTo]) bFlow[bFrom][bTo] = { count: 0, hours: 0 };
          bFlow[bFrom][bTo].count++; bFlow[bFrom][bTo].hours += durH;
        });
      });
    });
    const wcSet      = new Set([...Object.keys(mFlow), ...Object.values(mFlow).flatMap(r => Object.keys(r))]);
    const brygadaSet = new Set([...Object.keys(bFlow), ...Object.values(bFlow).flatMap(r => Object.keys(r))]);
    return { machineFlow: mFlow, brigadeFlow: bFlow, machines: [...wcSet].sort(), brigades: [...brygadaSet].sort() };
  }, [fwdZP, wcToBrygada]);

  // Klastrowanie
  const { mCluster, bCluster } = useMemo(() => {
    const thresh = threshold / 100;
    const mMap = {}, bMap = {};
    machines.forEach(a => { mMap[a] = {}; machines.forEach(b => { mMap[a][b] = machineFlow[a]?.[b]?.count || 0; }); });
    brigades.forEach(a => { bMap[a] = {}; brigades.forEach(b => { bMap[a][b] = brigadeFlow[a]?.[b]?.count || 0; }); });
    return {
      mCluster: clusterByFlow(machines, mMap, thresh).clusterMap,
      bCluster: clusterByFlow(brigades, bMap, thresh).clusterMap,
    };
  }, [machines, brigades, machineFlow, brigadeFlow, threshold]);

  const sortedMachines = useMemo(() => [...machines].sort((a, b) => (mCluster[a] ?? 99) - (mCluster[b] ?? 99) || a.localeCompare(b)), [machines, mCluster]);
  const sortedBrigades = useMemo(() => [...brigades].sort((a, b) => (bCluster[a] ?? 99) - (bCluster[b] ?? 99) || a.localeCompare(b)), [brigades, bCluster]);

  const activeNodes   = view === 'machine' ? sortedMachines : sortedBrigades;
  const activeFlow    = view === 'machine' ? machineFlow    : brigadeFlow;
  const activeCluster = view === 'machine' ? mCluster       : bCluster;

  const activeMax = useMemo(() => {
    let max = 0;
    activeNodes.forEach(a => activeNodes.forEach(b => {
      const v = metric === 'count' ? (activeFlow[a]?.[b]?.count || 0) : (activeFlow[a]?.[b]?.hours || 0);
      if (v > max) max = v;
    }));
    return max;
  }, [activeNodes, activeFlow, metric]);

  const kpi = useMemo(() => {
    const nClusters = new Set(Object.values(activeCluster)).size;
    let edges = 0, total = 0;
    activeNodes.forEach(a => activeNodes.forEach(b => {
      const v = activeFlow[a]?.[b]?.count || 0;
      if (v > 0) { edges++; total += v; }
    }));
    return { nodes: activeNodes.length, nClusters, edges, total };
  }, [activeNodes, activeFlow, activeCluster]);

  const LABEL_W = view === 'machine' ? 76 : 120;
  const CELL_W  = view === 'machine' ? 20 : 44;
  const CELL_H  = view === 'machine' ? 20 : 32;
  const COL_H   = view === 'machine' ? 80 : 90;

  if (!fwdZP.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 64, gap: 12, color: '#666' }}>
      <div style={{ fontSize: 32 }}>🔀</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: '#333' }}>Brak danych harmonogramu</div>
      <div style={{ fontSize: 12 }}>Zaplanuj harmonogram żeby zobaczyć przepływy między gniazdami</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} ref={wrapRef}>

      {/* Pasek narzędzi */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '8px 12px', background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 2, background: '#f1f5f9', borderRadius: 6, padding: 2 }}>
          {[['machine','⚙️ Maszyny'],['brigade','👷 Brygady']].map(([id, lbl]) => (
            <button key={id} onClick={() => setView(id)} style={{ padding: '4px 12px', fontSize: 12, fontWeight: view === id ? 600 : 400, borderRadius: 4, border: 'none', cursor: 'pointer', background: view === id ? '#fff' : 'transparent', color: view === id ? '#1e40af' : '#64748b', boxShadow: view === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', fontFamily: 'inherit' }}>{lbl}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: '#e2e8f0' }} />
        <div style={{ display: 'flex', gap: 2, background: '#f1f5f9', borderRadius: 6, padding: 2 }}>
          {[['count','Liczba ZP'],['hours','Godziny']].map(([id, lbl]) => (
            <button key={id} onClick={() => setMetric(id)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: metric === id ? 600 : 400, borderRadius: 4, border: 'none', cursor: 'pointer', background: metric === id ? '#fff' : 'transparent', color: metric === id ? '#1e40af' : '#64748b', fontFamily: 'inherit' }}>{lbl}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: '#e2e8f0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>Próg klastra:</span>
          <input type="range" min={5} max={50} step={5} value={threshold} onChange={e => setThreshold(+e.target.value)} style={{ width: 80 }} />
          <span style={{ fontSize: 11, color: '#334155', minWidth: 28, fontFamily: 'monospace' }}>{threshold}%</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 10, color: '#94a3b8' }}>Intensywność:</span>
          {['#dbeafe','#93c5fd','#3b82f6','#1d4ed8','#1e3a8a'].map((c, i) => (
            <div key={i} style={{ width: 18, height: 10, borderRadius: 2, background: c, border: '0.5px solid #cbd5e1' }} />
          ))}
          <span style={{ fontSize: 10, color: '#94a3b8' }}>max</span>
        </div>
      </div>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
        {[
          { label: view === 'machine' ? 'Gniazd' : 'Brygad', val: kpi.nodes },
          { label: 'Klastrów',   val: kpi.nClusters },
          { label: 'Przepływów', val: kpi.edges },
          { label: 'Łącznie ZP', val: kpi.total.toLocaleString('pl') },
          { label: 'Próg',       val: `${threshold}%` },
        ].map(({ label: lbl, val }) => (
          <div key={lbl} style={{ background: '#fff', borderRadius: 8, padding: '8px 12px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.05em' }}>{lbl}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: '#1e293b' }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Legenda klastrów */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '6px 10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>Klastry:</span>
        {[...new Set(Object.values(activeCluster))].sort().map(cl => {
          const cc = CL[cl % CL.length];
          const cnt = activeNodes.filter(n => (activeCluster[n] ?? 0) === cl).length;
          return (
            <span key={cl} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '2px 8px', borderRadius: 10, background: cc.bg, border: `1px solid ${cc.border}`, color: cc.text }}>
              <span style={{ fontWeight: 600 }}>K{cl+1}</span>
              <span style={{ opacity: .7 }}>— {cnt} {view === 'machine' ? 'gniazd' : 'brygad'}</span>
            </span>
          );
        })}
      </div>

      {/* Macierz */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {/* Narożnik */}
                <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 4, width: LABEL_W, minWidth: LABEL_W, height: COL_H, background: '#f8fafc', borderRight: '2px solid #cbd5e1', borderBottom: '2px solid #cbd5e1' }} />
                {activeNodes.map((col, j) => {
                  const cl = activeCluster[col] ?? 0;
                  const cc = CL[cl % CL.length];
                  const prevCl = j > 0 ? (activeCluster[activeNodes[j-1]] ?? 0) : -1;
                  return (
                    <th key={col} title={`${col} — ${label(col)}`} style={{
                      position: 'sticky', top: 0, zIndex: 3,
                      width: CELL_W, minWidth: CELL_W, height: COL_H,
                      background: '#fff',
                      borderLeft: prevCl !== cl ? `2px solid ${cc.border}` : '1px solid #e2e8f0',
                      borderBottom: `3px solid ${cc.border}`,
                      padding: '4px 2px 0',
                      verticalAlign: 'bottom',
                    }}>
                      <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 9, color: '#334155', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', maxHeight: COL_H - 8, textOverflow: 'ellipsis' }}>{col}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {activeNodes.map((row, i) => {
                const cl = activeCluster[row] ?? 0;
                const cc = CL[cl % CL.length];
                const prevCl = i > 0 ? (activeCluster[activeNodes[i-1]] ?? 0) : -1;
                return (
                  <tr key={row}>
                    {/* Etykieta wiersza */}
                    <td title={`${row} — ${label(row)}`} style={{
                      position: 'sticky', left: 0, zIndex: 2,
                      background: '#fff',
                      borderRight: `3px solid ${cc.border}`,
                      borderTop: prevCl !== cl ? `2px solid ${cc.border}` : '1px solid #e2e8f0',
                      borderBottom: '1px solid #e2e8f0',
                      padding: '0 6px',
                      textAlign: 'right',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      maxWidth: LABEL_W,
                      textOverflow: 'ellipsis',
                      width: LABEL_W,
                      height: CELL_H,
                    }}>
                      <span style={{ display: 'inline-block', fontSize: 8, padding: '1px 4px', borderRadius: 8, background: cc.badge, color: '#fff', marginRight: 3, fontWeight: 600 }}>K{cl+1}</span>
                      <span style={{ fontSize: 9, color: '#334155', fontWeight: 500 }}>{row}</span>
                    </td>
                    {/* Komórki */}
                    {activeNodes.map((col, j) => {
                      const v = Math.round(metric === 'count' ? (activeFlow[row]?.[col]?.count || 0) : (activeFlow[row]?.[col]?.hours || 0));
                      const colCl = activeCluster[col] ?? 0;
                      const prevColCl = j > 0 ? (activeCluster[activeNodes[j-1]] ?? 0) : -1;
                      const isSelected = selected?.from === row && selected?.to === col;
                      const isDiag = row === col;
                      const bg = isDiag ? '#f1f5f9' : heatBg(v, activeMax);
                      return (
                        <td key={col}
                          onClick={() => setSelected(v > 0 ? { from: row, to: col, v } : null)}
                          onMouseEnter={e => {
                            if (!v) return;
                            const rect = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
                            setTooltip({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 32, from: row, to: col, v });
                          }}
                          onMouseLeave={() => setTooltip(null)}
                          style={{
                            width: CELL_W, minWidth: CELL_W, height: CELL_H,
                            background: bg,
                            borderTop: prevCl !== cl ? `2px solid ${CL[cl % CL.length].border}` : '1px solid #e2e8f0',
                            borderLeft: prevColCl !== colCl ? `2px solid ${CL[colCl % CL.length].border}` : '1px solid #e2e8f0',
                            borderBottom: '1px solid #e2e8f0',
                            cursor: v > 0 ? 'pointer' : 'default',
                            outline: isSelected ? '2px solid #f59e0b' : 'none',
                            outlineOffset: -2,
                            textAlign: 'center', verticalAlign: 'middle',
                            fontSize: 8, fontFamily: 'monospace',
                            color: heatText(v, activeMax),
                            userSelect: 'none',
                          }}
                        >{v > 0 && activeMax > 0 && v / activeMax > 0.2 ? v : ''}</td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Szczegóły */}
      {selected && (
        <div style={{ padding: '8px 14px', background: '#fff', border: '1px solid #fbbf24', borderRadius: 8, fontSize: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#94a3b8' }}>Przepływ:</span>
          <code style={{ background: '#eff6ff', color: '#1d4ed8', padding: '2px 6px', borderRadius: 4 }}>{selected.from}</code>
          <span style={{ color: '#94a3b8' }}>→</span>
          <code style={{ background: '#eff6ff', color: '#1d4ed8', padding: '2px 6px', borderRadius: 4 }}>{selected.to}</code>
          <span style={{ fontWeight: 600, color: '#1e293b' }}>{metric === 'count' ? `${selected.v} ZP` : `${selected.v} h`}</span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{label(selected.from)} → {label(selected.to)}</span>
          <button onClick={() => setSelected(null)} style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div style={{ position: 'absolute', left: tooltip.x, top: tooltip.y, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#1e293b', pointerEvents: 'none', zIndex: 100, whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{label(tooltip.from)} → {label(tooltip.to)}</div>
          <div style={{ color: '#64748b' }}>{tooltip.from} → {tooltip.to}</div>
          <div style={{ color: '#1d4ed8', fontWeight: 600, marginTop: 2 }}>{metric === 'count' ? `${tooltip.v} ZP` : `${tooltip.v} h`}</div>
        </div>
      )}
    </div>
  );
}