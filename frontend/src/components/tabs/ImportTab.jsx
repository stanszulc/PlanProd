import { useState } from 'react';
import { T, s } from '../../constants/theme.js';
import { DEMO_ZP_STATUS } from '../../constants/demoData.js';

function dlCSV(content, filename) {
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(content);
  a.download = filename;
  a.click();
}

const SAMPLE_CSVS = {
  routing: {
    filename: 'routing_przyklad.csv',
    content: `product,operation,workcenter,ct_min,sequence,capacity_h,predecessors
P-KOD-100-100,Wycinanie laserowe podstawy,G-01,3.0,1,8,
P-KOD-100-100,Gięcie profili podstawy,G-02,8.0,2,8,1
P-KOD-100-100,Spawanie narożników korpusu,G-03,6.0,3,8,
P-KOD-100-100,Izolacja PIR i montaż poliwęglanu,G-04,12.0,4,8,3
P-KOD-100-100,Montaż siłownika i testy KJ,G-05,15.0,5,8,2|4
P-SKR-ROZ-02,Wycinanie obudowy skrzynki,G-01,1.0,1,8,
P-SKR-ROZ-02,Gięcie skrzynki,G-02,2.0,2,8,
P-SKR-ROZ-02,Zgrzewanie liniowe korpusu,G-03,2.0,3,8,
P-SKR-ROZ-02,Wyklejanie matą kauczukową,G-04,5.0,4,8,
P-SKR-ROZ-02,Montaż króćców i przepustnicy,G-05,4.0,5,8,`,
  },
  zs: {
    filename: 'zs_przyklad.csv',
    content: `zs_id,pozycja,klient,product,volume,due_date,priority
ZS-001,1,Klima-Tech Sp. z o.o.,P-KOD-100-100,30,2026-05-25,1
ZS-001,2,Klima-Tech Sp. z o.o.,P-KOD-100-100,20,2026-05-26,1
ZS-002,1,VentPro S.A.,P-SKR-ROZ-02,50,2026-05-25,2
ZS-002,2,VentPro S.A.,P-SKR-ROZ-02,40,2026-05-26,2`,
  },
  zp_status: {
    filename: 'zp_status_przyklad.csv',
    content: `zp_id,parent_zp,zs_id,pozycja,klient,product,operation,workcenter,sequence,volume_plan,volume_actual,status,need_date,planned_start,planned_end,actual_start,actual_end,priority,reason_code
ZP-001/01/01,ZP-001/01,ZS-001,1,Kowalski,P-KOD,Wycinanie,G-01,1,30,30,CNF,2026-05-25,2026-05-20 07:00,2026-05-20 08:30,2026-05-20 07:00,2026-05-20 08:35,1,
ZP-001/01/02,ZP-001/01,ZS-001,1,Kowalski,P-KOD,Gięcie,G-02,2,30,30,WIP,2026-05-25,2026-05-20 09:00,2026-05-20 13:00,2026-05-20 09:10,,1,
ZP-001/01/03,ZP-001/01,ZS-001,1,Kowalski,P-KOD,Spawanie,G-03,3,30,0,PLAN,2026-05-25,2026-05-21 07:00,2026-05-21 10:00,,,1,`,
  },
};

export function ImportTab({ routing, zp, zpStatusData, onLoad, onExportZpStatus, hybridMode, onHybridModeChange }) {
  const [rLoaded,   setRLoaded]   = useState(routing.length > 0);
  const [zsLoaded,  setZsLoaded]  = useState(false);
  const [zpLoaded,  setZpLoaded]  = useState(zpStatusData?.length > 0);
  const [rejectLog, setRejectLog] = useState([]);

  function readFile(file, type) {
    const reader = new FileReader();
    reader.onload = e => {
      const result = onLoad(e.target.result, type);
      if (type === 'routing')   setRLoaded(true);
      if (type === 'zs')        setZsLoaded(true);
      if (type === 'zp_status') {
        setZpLoaded(true);
        if (result?.rejected?.length) setRejectLog(result.rejected);
        else setRejectLog([]);
      }
    };
    reader.readAsText(file);
  }

  const DropBox = ({ type, loaded, label, icon, desc, cols }) => (
    <div
      style={{
        border: `1.5px dashed ${loaded ? T.ok : T.border2}`,
        borderRadius: 12, padding: 24, textAlign: 'center',
        background: loaded ? 'rgba(34,197,94,0.05)' : T.surface,
        cursor: 'pointer', transition: 'all 0.2s',
      }}
      onClick={() => document.getElementById(`file_${type}`).click()}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) readFile(f, type); }}
    >
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: T.text2, marginBottom: 10, lineHeight: 1.5 }}>{desc}</div>
      {loaded
        ? <div style={{ fontSize: 12, color: T.ok, fontWeight: 600 }}>✓ Załadowano</div>
        : <div style={{ display: 'flex', gap: 5, justifyContent: 'center', flexWrap: 'wrap' }}>
            {cols.map(c => <span key={c.n} style={{ ...s.tag(c.req ? T.accent : T.text3), fontSize: 10 }}>{c.n}</span>)}
          </div>
      }
      <input id={`file_${type}`} type="file" accept=".csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files[0]; if (f) readFile(f, type); }} />
    </div>
  );

  const hasPlanData   = routing.length > 0 && zp.length > 0;
  const hasStatusData = zpStatusData?.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ── 1. WGRAJ PLIKI ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeader icon="📥" label="Wgraj pliki" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <DropBox type="routing" loaded={rLoaded || routing.length > 0}
            label="routing.csv" icon="🗂️"
            desc="Marszruty technologiczne — operacje, gniazda, czasy cyklu"
            cols={[{n:'product',req:true},{n:'operation',req:true},{n:'workcenter',req:true},{n:'ct_min',req:true},{n:'sequence',req:true},{n:'capacity_h',req:false}]} />
          <DropBox type="zs" loaded={zsLoaded}
            label="zs.csv" icon="🧾"
            desc="Zamówienia sprzedaży — klienci, produkty, ilości, terminy"
            cols={[{n:'zs_id',req:true},{n:'pozycja',req:true},{n:'klient',req:false},{n:'product',req:true},{n:'volume',req:true},{n:'due_date',req:true},{n:'priority',req:false}]} />
          <DropBox type="zp_status" loaded={zpLoaded || hasStatusData}
            label="zp_status.csv" icon="🏭"
            desc="Status realizacji ZP z ERP — daty, ilości, statusy operacji"
            cols={[{n:'zp_id',req:true},{n:'parent_zp',req:true},{n:'status',req:true},{n:'need_date',req:true},{n:'actual_start',req:false},{n:'actual_end',req:false},{n:'volume_actual',req:false}]} />
        </div>

        {/* Log odrzuconych */}
        {rejectLog.length > 0 && (
          <div style={{ background: 'rgba(248,113,113,0.07)', border: `1px solid ${T.bn}`, borderRadius: 10, padding: '12px 16px', marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.bn, marginBottom: 8 }}>
              ⚠ Odrzucono {rejectLog.length} rekordów
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 100, overflowY: 'auto' }}>
              {rejectLog.map((r, i) => (
                <div key={i} style={{ fontSize: 11, color: T.text2 }}>
                  Linia {r.line}: {r.data.zp_id || '?'} — {r.reason}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── 2. EKSPORTUJ ───────────────────────────────────────────────────── */}
      <section>
        <SectionHeader icon="📤" label="Eksportuj" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* Demo */}
          <div style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 22 }}>🎮</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Demo data</div>
            <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.5 }}>
              Załaduj przykładowe routing + zs — gotowe dane do testowania wszystkich widoków.
            </div>
            <button
              style={{ ...s.btn(true), fontSize: 12, marginTop: 'auto' }}
              onClick={() => { onLoad(null, 'demo'); onLoad(DEMO_ZP_STATUS, 'zp_status'); setZpLoaded(true); }}>
              ▶ Załaduj demo
            </button>
          </div>

          {/* Eksport ZP */}
          <div style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 22 }}>📤</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Eksportuj ZP → zp_status.csv</div>
            <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.5 }}>
              Generuje szablon z datami z APS (status PLAN). Uzupełnij w ERP: actual_start, actual_end, volume_actual, status — i wgraj z powrotem.
            </div>
            <button
              style={{ ...s.btn(hasPlanData), fontSize: 12, marginTop: 'auto',
                opacity: hasPlanData ? 1 : 0.4,
                cursor: hasPlanData ? 'pointer' : 'not-allowed' }}
              disabled={!hasPlanData}
              onClick={onExportZpStatus}>
              ↓ Eksportuj ZP → CSV
            </button>
            {!hasPlanData && (
              <div style={{ fontSize: 10, color: T.text3 }}>Wczytaj routing + zs najpierw</div>
            )}
          </div>
        </div>
      </section>

      {/* ── 3. POBIERZ PRZYKŁADY ───────────────────────────────────────────── */}
      <section>
        <SectionHeader icon="📋" label="Pobierz przykłady CSV" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {[
            { key: 'routing',   label: 'routing.csv',   icon: '🗂️', desc: 'Marszruty technologiczne' },
            { key: 'zs',        label: 'zs.csv',        icon: '🧾', desc: 'Zamówienia sprzedaży' },
            { key: 'zp_status', label: 'zp_status.csv', icon: '🏭', desc: 'Status realizacji ZP' },
          ].map(({ key, label, icon, desc }) => (
            <div key={key} style={{ ...s.card, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{label}</div>
                <div style={{ fontSize: 11, color: T.text3 }}>{desc}</div>
              </div>
              <button
                type="button"
                style={{ ...s.btn(false), fontSize: 11, flexShrink: 0 }}
                onClick={() => dlCSV(SAMPLE_CSVS[key].content, SAMPLE_CSVS[key].filename)}>
                ↓ Pobierz
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── 4. FUNKCJE EKSPERYMENTALNE ─────────────────────────────────────── */}
      <section>
        <SectionHeader icon="⚗️" label="Funkcje eksperymentalne" />
        <div style={{
          border: `1.5px solid ${hybridMode ? T.accent : T.border2}`,
          borderRadius: 12, padding: 20,
          background: hybridMode ? 'rgba(77,148,255,0.05)' : T.surface,
          transition: 'all 0.2s',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>🔬</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                  Tryb REALIZACJA — WIP-initialized scheduling
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                  background: 'rgba(251,191,36,0.15)', color: '#fbbf24',
                  border: '1px solid #fbbf24', borderRadius: 4, padding: '2px 6px',
                }}>BETA</span>
              </div>
              <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.7, marginBottom: 10 }}>
                <strong style={{ color: T.text2 }}>Gdy włączony:</strong> opóźnienia liczone z rzeczywistych danych —
                CNF operacje z <code style={{ color: T.accent }}>actual_end</code>,
                WIP z pozostałego czasu, PLAN z forward schedule.<br />
                <strong style={{ color: T.text2 }}>Gdy wyłączony:</strong> klasyczny forward schedule (tylko plan).<br />
                <span style={{ color: T.warn }}>⚠ Wymaga wgranego zp_status.csv z wypełnionymi actual_start/actual_end.</span>
              </div>
              {!hasStatusData && hybridMode && (
                <div style={{ fontSize: 11, color: T.bn, marginBottom: 6 }}>
                  ✗ Brak zp_status.csv — tryb REALIZACJA nie ma danych, używany jest plan.
                </div>
              )}
              {hasStatusData && hybridMode && (
                <div style={{ fontSize: 11, color: T.ok }}>
                  ✓ zp_status załadowany — tryb REALIZACJA aktywny.
                </div>
              )}
            </div>

            {/* Toggle */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div
                onClick={() => onHybridModeChange(!hybridMode)}
                style={{
                  width: 48, height: 26, borderRadius: 13, cursor: 'pointer',
                  background: hybridMode ? T.accent : T.surface3,
                  border: `1px solid ${hybridMode ? T.accent : T.border2}`,
                  position: 'relative', transition: 'all 0.2s',
                }}>
                <div style={{
                  position: 'absolute', top: 3,
                  left: hybridMode ? 24 : 3,
                  width: 18, height: 18, borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </div>
              <span style={{ fontSize: 10, color: hybridMode ? T.accent : T.text3, fontWeight: 600 }}>
                {hybridMode ? 'WŁĄCZONY' : 'WYŁĄCZONY'}
              </span>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}

function SectionHeader({ icon, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.text2 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: T.border, marginLeft: 4 }} />
    </div>
  );
}
