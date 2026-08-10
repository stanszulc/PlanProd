import { useState, Fragment } from 'react';
import { T, s } from '../../constants/theme.js';
import { DEMO_ZP_STATUS, DEMO_PARALLEL_MACHINES, DEMO_BOM_FORMATKI } from '../../constants/demoData.js';
import { runNestingConsolidation, buildBomIndex } from '../../utils/nesting.js';
import { xlsxPivotCacheToZpTsv } from '../../utils/pivotXlsxImport.js';

function dlCSV(content, filename) {
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(content);
  a.download = filename;
  a.click();
}

// [ZMIANA] Sample CSV zastąpiony formatem ERP (TSV z realnych danych)
const SAMPLE_CSVS = {
  erp_zp: {
    filename: 'erp_zp_przyklad.csv',
    content: `Numer ZP\tKlient/zam\tNumer ZS\tData zak\tData wys\tKod\tNazwa\tIlość ZP\tWyprod.\tOP\tWC\tWCname\tWC2\tCzasPlan\tCzasPozost
7310980009\tAIRTEAM [MindeT]\t2000034452\t2026-06-24 00:00\t2026-07-27 00:00\t1274449\tZUP-L /1/304048\t1\t0\t010\t20043\tWykrawarko-gilotyna SG6 M107\tMaszyny\t0,35\t0,35
7310980009\tAIRTEAM [MindeT]\t2000034452\t2026-06-24 00:00\t2026-07-27 00:00\t1274449\tZUP-L /1/304048\t1\t0\t020\t30009\tCentrum gięć\tMaszyny\t0,15\t0,15
7310980009\tAIRTEAM [MindeT]\t2000034452\t2026-06-24 00:00\t2026-07-27 00:00\t1274449\tZUP-L /1/304048\t1\t0\t040\t30052\tŚlusarnia - iSWAY\tiSWAY\t2\t2
7310980010\tAIRTEAM [MindeT]\t2000034452\t2026-06-24 00:00\t2026-07-27 00:00\t1274450\tZUP-L /2/304048\t1\t0\t010\t20043\tWykrawarko-gilotyna SG6 M107\tMaszyny\t0,35\t0,35
7310980010\tAIRTEAM [MindeT]\t2000034452\t2026-06-24 00:00\t2026-07-27 00:00\t1274450\tZUP-L /2/304048\t1\t0\t020\t30009\tCentrum gięć\tMaszyny\t0,15\t0,15
7310980010\tAIRTEAM [MindeT]\t2000034452\t2026-06-24 00:00\t2026-07-27 00:00\t1274450\tZUP-L /2/304048\t1\t0\t040\t30052\tŚlusarnia - iSWAY\tiSWAY\t2\t2
7310982834\tROCKFIN [S101326]\t1000227356\t2026-07-08 00:00\t2026-07-09 00:00\t1238582\tTAPS-HA-1000x2000x700\t6\t0\t010\t20005\tPiła taśmowa STG230 DPG M002\tPilarnia Stalowa\t0,74064\t0,74064
7310982834\tROCKFIN [S101326]\t1000227356\t2026-07-08 00:00\t2026-07-09 00:00\t1238582\tTAPS-HA-1000x2000x700\t6\t0\t011\t20059\tWykrawarko-gilotyna SGe_2 M227\tMaszyny\t0,683\t0,683
7310982834\tROCKFIN [S101326]\t1000227356\t2026-07-08 00:00\t2026-07-09 00:00\t1238582\tTAPS-HA-1000x2000x700\t6\t0\t015\t30009\tCentrum gięć\tMaszyny\t0,45002\t0,45002
7310982834\tROCKFIN [S101326]\t1000227356\t2026-07-08 00:00\t2026-07-09 00:00\t1238582\tTAPS-HA-1000x2000x700\t6\t0\t019\t30003\tŚlusarnia - kanały\tKanały\t21,9332\t21,9332`,
  },
  zp_status: {
    filename: 'zp_status_przyklad.csv',
    content: `zp_id,parent_zp,zs_id,pozycja,klient,product,operation,workcenter,sequence,volume_plan,volume_actual,status,need_date,planned_start,planned_end,actual_start,actual_end,priority,reason_code
ZP-001/01/01,ZP-001/01,ZS-001,1,Kowalski,P-KOD,Wycinanie,G-01,1,30,30,CNF,2026-05-25,2026-05-20 07:00,2026-05-20 08:30,2026-05-20 07:00,2026-05-20 08:35,1,
ZP-001/01/02,ZP-001/01,ZS-001,1,Kowalski,P-KOD,Gięcie,G-02,2,30,30,WIP,2026-05-25,2026-05-20 09:00,2026-05-20 13:00,2026-05-20 09:10,,1,
ZP-001/01/03,ZP-001/01,ZS-001,1,Kowalski,P-KOD,Spawanie,G-03,3,30,0,PLAN,2026-05-25,2026-05-21 07:00,2026-05-21 10:00,,,1,`,
  },
  parallel_machines: {
    filename: 'maszyny_rownolegle_przyklad.csv',
    content: `WC
20005
20059`,
  },
  bom_formatek: {
    filename: 'formatki_rozkroj_przyklad.csv',
    content: `zp_id,sequence,szerokosc_mm,wysokosc_mm,material,grubosc_mm,arkusz_szerokosc_mm,arkusz_wysokosc_mm
7310980009,10,150,100,DC01,0.8,1500,3000
7310982834,11,200,133,DC01,0.6,1500,3000`,
  },
};

// [ZMIANA] Props: usunięto `routing` (zastąpione przez erpZp),
// dodano `erpZp` — lista ZP sparsowana z parseZPFromERP
export function ImportTab({
  erpZp, zpStatusData, parallelMachines, fwdZP, bomFormatki,
  onLoad, onExportZpStatus,
  hybridMode, onHybridModeChange,
  nestingBeta, onNestingBetaChange,
}) {
  const [erpLoaded,      setErpLoaded]      = useState(erpZp?.length > 0);
  const [zpLoaded,       setZpLoaded]       = useState(zpStatusData?.length > 0);
  const [parallelLoaded, setParallelLoaded] = useState(parallelMachines?.length > 0);
  const [bomLoaded,      setBomLoaded]      = useState(bomFormatki?.length > 0);
  const [rejectLog, setRejectLog] = useState([]);
  const [erpInfo,   setErpInfo]   = useState(null); // { zpCount, machineCount, opCount }
  const [parallelCount, setParallelCount] = useState(parallelMachines?.length || 0);
  const [bomCount, setBomCount] = useState(bomFormatki?.length || 0);
  const [nestingResults, setNestingResults] = useState(null);
  const [nestingError, setNestingError] = useState(null);
  const [expandedResult, setExpandedResult] = useState(null); // indeks wiersza z rozwiniętą zawartością arkusza
  const [xlsxError, setXlsxError] = useState(null);
  const [xlsxSourceInfo, setXlsxSourceInfo] = useState(null); // { rowCount } — ostatni import z xlsx

  function applyErpTsv(tsvText) {
    const result = onLoad(tsvText, 'erp_zp');
    setErpLoaded(true);
    if (result?.zpList) {
      const machines = new Set(
        result.zpList.flatMap(z => (z.ops || []).map(op => op.machine_id))
      );
      setErpInfo({
        zpCount:      result.zpList.length,
        machineCount: machines.size,
        opCount:      result.zpList.reduce((s, z) => s + (z.ops?.length || 0), 0),
      });
    }
  }

  function readFile(file, type) {
    // Eksport ZP można też podać jako xlsx (skoroszyt "Pulpit produkcji") —
    // czytamy wtedy cache tabeli przestawnej OBCIĄŻENIE zamiast ręcznie
    // eksportowanego TSV, żeby dane zawsze odzwierciedlały ostatnie
    // "Dane → Odśwież wszystko" w Excelu.
    if (type === 'erp_zp' && /\.xlsx$/i.test(file.name)) {
      setXlsxError(null);
      const reader = new FileReader();
      reader.onload = async e => {
        try {
          const { tsv, rowCount } = await xlsxPivotCacheToZpTsv(e.target.result);
          applyErpTsv(tsv);
          setXlsxSourceInfo({ rowCount });
        } catch (err) {
          setXlsxError(err.message);
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      if (type === 'erp_zp') {
        applyErpTsv(e.target.result);
        return;
      }
      const result = onLoad(e.target.result, type);
      if (type === 'zp_status') {
        setZpLoaded(true);
        if (result?.rejected?.length) setRejectLog(result.rejected);
        else setRejectLog([]);
      }
      if (type === 'parallel_machines') {
        setParallelLoaded(true);
        setParallelCount(result?.count ?? 0);
      }
      if (type === 'bom_formatek') {
        setBomLoaded(true);
        setBomCount(result?.count ?? 0);
        setNestingResults(null);
        if (result?.rejected?.length) setRejectLog(result.rejected);
      }
    };
    reader.readAsText(file, 'UTF-8');
  }

  // BETA: rozkrój — liczone lokalnie w tej zakładce, na żądanie (przycisk),
  // nigdy automatycznie — patrz nesting.js. Błąd nie psuje reszty aplikacji.
  function runNesting() {
    try {
      const bomByOp = buildBomIndex(bomFormatki);
      // zpMeta: prawdziwa ilość + nazwa produktu z surowego importu ERP —
      // fwdZP niesie tylko volume=1 (patrz komentarz w nesting.js) i kod produktu.
      const zpMeta = new Map((erpZp || []).map(z => [z.zp_id, { volume: z.volume, product_name: z.product_name }]));
      const results = runNestingConsolidation({ fwdZP, bomByOp, parallelMachines, zpMeta });
      setNestingResults(results);
      setNestingError(null);
      setExpandedResult(null);
    } catch (err) {
      setNestingError(err.message);
      setNestingResults(null);
    }
  }

  // [ZMIANA] DropBox — uproszczony, obsługuje drag & drop i click
  const DropBox = ({ type, loaded, label, icon, desc, cols, info, infoText }) => (
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
      {loaded ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ fontSize: 12, color: T.ok, fontWeight: 600 }}>✓ Załadowano</div>
          {info && (
            <div style={{ fontSize: 10, color: T.text3, lineHeight: 1.6 }}>
              {info.zpCount} ZP · {info.opCount} operacji · {info.machineCount} maszyn
            </div>
          )}
          {infoText && (
            <div style={{ fontSize: 10, color: T.text3, lineHeight: 1.6 }}>{infoText}</div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 5, justifyContent: 'center', flexWrap: 'wrap' }}>
          {cols.map(c => (
            <span key={c.n} style={{ ...s.tag(c.req ? T.accent : T.text3), fontSize: 10 }}>{c.n}</span>
          ))}
        </div>
      )}
      <input
        id={`file_${type}`} type="file"
        accept={type === 'erp_zp' ? '.csv,.tsv,.txt,.xlsx' : '.csv,.tsv,.txt'}
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files[0]; if (f) readFile(f, type); }}
      />
    </div>
  );

  const hasErpData    = erpZp?.length > 0;
  const hasStatusData = zpStatusData?.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ── 1. WGRAJ PLIKI ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeader icon="📥" label="Wgraj pliki" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
          <DropBox
            type="erp_zp"
            loaded={erpLoaded || hasErpData}
            label="Eksport ZP z ERP"
            icon="🏭"
            desc="Plik TSV z ERP (ZP + operacje + maszyny + czasy) — albo skoroszyt .xlsx z zakładką OBCIĄŻENIE: dane wczytywane są wtedy z cache pivota, więc odzwierciedlają ostatnie Dane → Odśwież wszystko w Excelu."
            info={erpInfo}
            infoText={xlsxSourceInfo ? `Źródło: cache pivota xlsx · ${xlsxSourceInfo.rowCount} rekordów` : undefined}
            cols={[
              { n: 'Numer ZP',   req: true  },
              { n: 'OP',         req: true  },
              { n: 'WC',         req: true  },
              { n: 'WC2',        req: true  },
              { n: 'WCname',     req: false },
              { n: 'CzasPlan',   req: true  },
              { n: 'CzasPozost', req: true  },
              { n: 'Data zak',   req: true  },
              { n: 'Klient/zam', req: false },
              { n: 'Numer ZS',   req: false },
            ]}
          />
          <DropBox
            type="zp_status"
            loaded={zpLoaded || hasStatusData}
            label="zp_status.csv"
            icon="📋"
            desc="Status realizacji ZP — daty rzeczywiste, ilości, statusy operacji (CNF/WIP/PLAN)."
            cols={[
              { n: 'zp_id',         req: true  },
              { n: 'parent_zp',     req: true  },
              { n: 'status',        req: true  },
              { n: 'actual_start',  req: false },
              { n: 'actual_end',    req: false },
              { n: 'volume_actual', req: false },
            ]}
          />
          <DropBox
            type="parallel_machines"
            loaded={parallelLoaded || parallelMachines?.length > 0}
            label="Maszyny równoległe"
            icon="🔀"
            desc="Kody WC, które zawsze działają niezależnie od reszty trasy (np. piły startowe) — kolejna operacja czeka na wszystkie naraz."
            infoText={`${parallelCount} maszyn`}
            cols={[
              { n: 'WC', req: true },
            ]}
          />
          <DropBox
            type="bom_formatek"
            loaded={bomLoaded || bomFormatki?.length > 0}
            label="Formatki do rozkroju"
            icon="✂️"
            desc="BETA — wymiary formatek na wykrawarkach, do nestingu. Wymagane tylko gdy włączona funkcja eksperymentalna niżej."
            infoText={`${bomCount} formatek`}
            cols={[
              { n: 'zp_id',       req: true },
              { n: 'sequence',    req: true },
              { n: 'szerokosc_mm', req: true },
              { n: 'wysokosc_mm',  req: true },
              { n: 'material',    req: true },
              { n: 'grubosc_mm',  req: true },
            ]}
          />
        </div>

        {/* Błąd importu z xlsx (cache pivota) */}
        {xlsxError && (
          <div style={{
            background: 'rgba(248,113,113,0.07)',
            border: `1px solid ${T.bn}`,
            borderRadius: 10, padding: '12px 16px', marginTop: 14,
            fontSize: 12, color: T.bn,
          }}>
            ⚠ Nie udało się wczytać xlsx: {xlsxError}
          </div>
        )}

        {/* Log odrzuconych */}
        {rejectLog.length > 0 && (
          <div style={{
            background: 'rgba(248,113,113,0.07)',
            border: `1px solid ${T.bn}`,
            borderRadius: 10, padding: '12px 16px', marginTop: 14,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.bn, marginBottom: 8 }}>
              ⚠ Odrzucono {rejectLog.length} rekordów
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 100, overflowY: 'auto' }}>
              {rejectLog.map((r, i) => (
                <div key={i} style={{ fontSize: 11, color: T.text2 }}>
                  Linia {r.line}: {r.data?.zp_id || '?'} — {r.reason}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* [NOWE] Info o formacie pliku ERP */}
        <div style={{
          marginTop: 12,
          padding: '10px 14px',
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          fontSize: 11,
          color: T.text3,
          lineHeight: 1.7,
        }}>
          <strong style={{ color: T.text2 }}>Format pliku ERP:</strong>{' '}
          TSV (tabulatory) lub CSV (średniki). Separator dziesiętny: przecinek.
          Kolumny: <code>WC</code> = numer maszyny, <code>WC2</code> = gniazdo/linia,
          <code> WCname</code> = pełna nazwa maszyny, <code>CzasPlan</code> = czas całkowity [h].
        </div>

        {/* Info o formacie pliku maszyn równoległych */}
        <div style={{
          marginTop: 8,
          padding: '10px 14px',
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          fontSize: 11,
          color: T.text3,
          lineHeight: 1.7,
        }}>
          <strong style={{ color: T.text2 }}>Format pliku maszyn równoległych:</strong>{' '}
          Jedna kolumna <code>WC</code> (kod maszyny) na wiersz, nagłówek opcjonalny.
          Operacje na tych maszynach zawsze startują niezależnie od siebie i od reszty trasy —
          pierwsza kolejna operacja czeka aż wszystkie się zakończą.
        </div>

        {/* Info o formacie pliku formatek do rozkroju (BETA) */}
        <div style={{
          marginTop: 8,
          padding: '10px 14px',
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          fontSize: 11,
          color: T.text3,
          lineHeight: 1.7,
        }}>
          <strong style={{ color: T.text2 }}>Format pliku formatek do rozkroju (BETA):</strong>{' '}
          Jeden wiersz = jedna operacja na wykrawarce. Klucz złączenia: <code>zp_id</code>+<code>sequence</code> (te
          same wartości co <code>Numer ZP</code>/<code>OP</code> w eksporcie ERP). Rozmiar arkusza (<code>arkusz_szerokosc_mm</code>,{' '}
          <code>arkusz_wysokosc_mm</code>) podany w każdym wierszu.
        </div>
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
              Załaduj przykładowe dane ERP — gotowe ZP z operacjami, maszynami i czasami.
            </div>
            <button
              style={{ ...s.btn(true), fontSize: 12, marginTop: 'auto' }}
              onClick={() => {
                onLoad(null, 'demo');
                onLoad(DEMO_ZP_STATUS, 'zp_status');
                const parallelResult = onLoad(DEMO_PARALLEL_MACHINES, 'parallel_machines');
                const bomResult = onLoad(DEMO_BOM_FORMATKI, 'bom_formatek');
                setZpLoaded(true);
                setErpLoaded(true);
                setParallelLoaded(true);
                setParallelCount(parallelResult?.count ?? 0);
                setBomLoaded(true);
                setBomCount(bomResult?.count ?? 0);
              }}>
              ▶ Załaduj demo
            </button>
          </div>

          {/* Eksport ZP */}
          <div style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 22 }}>📤</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Eksportuj ZP → zp_status.csv</div>
            <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.5 }}>
              Generuje szablon z datami z APS (status PLAN). Uzupełnij w ERP i wgraj z powrotem.
            </div>
            <button
              style={{
                ...s.btn(hasErpData), fontSize: 12, marginTop: 'auto',
                opacity: hasErpData ? 1 : 0.4,
                cursor: hasErpData ? 'pointer' : 'not-allowed',
              }}
              disabled={!hasErpData}
              onClick={onExportZpStatus}>
              ↓ Eksportuj ZP → CSV
            </button>
            {!hasErpData && (
              <div style={{ fontSize: 10, color: T.text3 }}>Wczytaj plik ERP najpierw</div>
            )}
          </div>
        </div>
      </section>

      {/* ── 3. POBIERZ PRZYKŁADY ───────────────────────────────────────────── */}
      <section>
        <SectionHeader icon="📋" label="Pobierz przykłady" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          {[
            { key: 'erp_zp',            label: 'erp_zp_przyklad.csv',              icon: '🏭', desc: 'Eksport ZP z ERP (format TSV)' },
            { key: 'zp_status',         label: 'zp_status_przyklad.csv',           icon: '📋', desc: 'Status realizacji ZP' },
            { key: 'parallel_machines', label: 'maszyny_rownolegle_przyklad.csv',  icon: '🔀', desc: 'Lista maszyn równoległych' },
            { key: 'bom_formatek',      label: 'formatki_rozkroj_przyklad.csv',    icon: '✂️', desc: 'Formatki do rozkroju (BETA)' },
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

        {/* Rozkrój (nesting) na wykrawarkach — BETA */}
        <div style={{
          marginTop: 16,
          border: `1.5px solid ${nestingBeta ? T.accent : T.border2}`,
          borderRadius: 12, padding: 20,
          background: nestingBeta ? 'rgba(77,148,255,0.05)' : T.surface,
          transition: 'all 0.2s',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>✂️</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                  Rozkrój (nesting) na wykrawarkach
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                  background: 'rgba(251,191,36,0.15)', color: '#fbbf24',
                  border: '1px solid #fbbf24', borderRadius: 4, padding: '2px 6px',
                }}>BETA</span>
              </div>
              <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.7, marginBottom: 10 }}>
                <strong style={{ color: T.text2 }}>Gdy włączony:</strong> dzienne grupowanie formatek na maszynach
                z listy "Maszyny równoległe" + nesting (tylko prostokąty, odpad ≤ 5%, do 3 dni do przodu).<br />
                <strong style={{ color: T.text2 }}>Gdy wyłączony:</strong> aplikacja działa dokładnie jak dziś.<br />
                <span style={{ color: T.warn }}>⚠ Wymaga wgranego pliku formatek do rozkroju i przeliczonego harmonogramu.</span>
              </div>
              {nestingBeta && !(bomFormatki?.length > 0) && (
                <div style={{ fontSize: 11, color: T.bn, marginBottom: 6 }}>
                  ✗ Brak pliku formatek do rozkroju — nie ma czego nestingować.
                </div>
              )}
              {nestingBeta && bomFormatki?.length > 0 && (
                <div style={{ fontSize: 11, color: T.ok, marginBottom: 10 }}>
                  ✓ {bomFormatki.length} formatek załadowanych.
                </div>
              )}
              {nestingBeta && bomFormatki?.length > 0 && (
                <button style={{ ...s.btn(true), fontSize: 12 }} onClick={runNesting}>
                  Policz rozkrój
                </button>
              )}
              {nestingBeta && nestingError && (
                <div style={{ fontSize: 11, color: T.bn, marginTop: 8 }}>✗ Błąd: {nestingError}</div>
              )}
              {nestingBeta && nestingResults && (
                <div style={{ marginTop: 12, overflowX: 'auto' }}>
                  {nestingResults.length === 0 ? (
                    <div style={{ fontSize: 11, color: T.text3 }}>
                      Brak operacji na maszynach z listy równoległych dopasowanych do wgranych formatek.
                    </div>
                  ) : (
                    <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: T.text3, textAlign: 'left' }}>
                          <th style={{ padding: '4px 8px' }}></th>
                          <th style={{ padding: '4px 8px' }}>Dzień (kotwica)</th>
                          <th style={{ padding: '4px 8px' }}>Materiał</th>
                          <th style={{ padding: '4px 8px' }}>Grubość</th>
                          <th style={{ padding: '4px 8px' }}>Formatek</th>
                          <th style={{ padding: '4px 8px' }}>Arkuszy</th>
                          <th style={{ padding: '4px 8px' }}>Odpad</th>
                          <th style={{ padding: '4px 8px' }}>Dni skonsolidowanych</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nestingResults.map((r, i) => {
                          const isOpen = expandedResult === i;
                          return (
                          <Fragment key={i}>
                            <tr
                              style={{ borderTop: `1px solid ${T.border}`, cursor: 'pointer' }}
                              onClick={() => setExpandedResult(isOpen ? null : i)}>
                              <td style={{ padding: '4px 8px', color: T.text3 }}>{isOpen ? '▾' : '▸'}</td>
                              <td style={{ padding: '4px 8px', color: T.text }}>{r.anchorDate}</td>
                              <td style={{ padding: '4px 8px', color: T.text }}>{r.material}</td>
                              <td style={{ padding: '4px 8px', color: T.text2 }}>{r.grubosc_mm}mm</td>
                              <td style={{ padding: '4px 8px', color: T.text2 }}>{r.formatkiCount}</td>
                              <td style={{ padding: '4px 8px', color: T.text2 }}>{r.sheetsUsed}</td>
                              <td style={{ padding: '4px 8px', color: r.wastePct > 0.05 ? T.bn : T.ok, fontWeight: 600 }}>
                                {(r.wastePct * 100).toFixed(1)}%
                              </td>
                              <td style={{ padding: '4px 8px', color: T.text2 }}>{r.usedDaysSpan}</td>
                            </tr>
                            {isOpen && (
                              <tr>
                                <td colSpan={8} style={{ padding: '4px 8px 14px 24px', background: T.surface2 }}>
                                  <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                                    <thead>
                                      <tr style={{ color: T.text3, textAlign: 'left' }}>
                                        <th style={{ padding: '3px 6px' }}>ID ZP</th>
                                        <th style={{ padding: '3px 6px' }}>Klient</th>
                                        <th style={{ padding: '3px 6px' }}>Nazwa detalu</th>
                                        <th style={{ padding: '3px 6px' }}>Rozmiar (mm)</th>
                                        <th style={{ padding: '3px 6px' }}>Sztuk</th>
                                        <th style={{ padding: '3px 6px' }}>Priorytet</th>
                                        <th style={{ padding: '3px 6px' }}>Dzień pierwotny</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {r.formatki.map((f, fi) => (
                                        <tr key={fi} style={{ borderTop: `1px solid ${T.border}` }}>
                                          <td style={{ padding: '3px 6px', color: T.accent, fontFamily: 'monospace' }}>{f.zpId}</td>
                                          <td style={{ padding: '3px 6px', color: T.text2 }}>{f.klient}</td>
                                          <td style={{ padding: '3px 6px', color: T.text2 }}>{f.produkt}</td>
                                          <td style={{ padding: '3px 6px', color: T.text }}>{f.szerokosc_mm} × {f.wysokosc_mm}</td>
                                          <td style={{ padding: '3px 6px', color: T.text }}>{f.qty}</td>
                                          <td style={{ padding: '3px 6px' }}>{f.priority === 1 ? '🔴 VIP' : '🟢 Standard'}</td>
                                          <td style={{ padding: '3px 6px', color: T.text2 }}>
                                            {f.origDay}{f.origDay !== r.anchorDate ? ' (dociągnięte)' : ''}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>

            {/* Toggle */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div
                onClick={() => onNestingBetaChange(!nestingBeta)}
                style={{
                  width: 48, height: 26, borderRadius: 13, cursor: 'pointer',
                  background: nestingBeta ? T.accent : T.surface3,
                  border: `1px solid ${nestingBeta ? T.accent : T.border2}`,
                  position: 'relative', transition: 'all 0.2s',
                }}>
                <div style={{
                  position: 'absolute', top: 3,
                  left: nestingBeta ? 24 : 3,
                  width: 18, height: 18, borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </div>
              <span style={{ fontSize: 10, color: nestingBeta ? T.accent : T.text3, fontWeight: 600 }}>
                {nestingBeta ? 'WŁĄCZONY' : 'WYŁĄCZONY'}
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
