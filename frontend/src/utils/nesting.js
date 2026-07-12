// ─── nesting.js ──────────────────────────────────────────────────────────────
// BETA: rozkrój (nesting) formatek na wykrawarkach. Odizolowane od scheduler.js/
// scheduler.worker.js — woła się osobno, po już policzonym fwdZP. Wyłączenie
// przełącznika `nestingBeta` w Import/Eksport oznacza, że nic z tego pliku
// nigdy się nie uruchamia — aplikacja działa jak dziś.
//
// Algorytm (uzgodniony z użytkownikiem): dla dnia N zbierz formatki zaplanowane
// na wykrawarki tego dnia (tej samej blachy — materiał+grubość), policz %
// odpadu przy nestingu. Jeśli odpad <= progu — zostaje. Jeśli nie — dołóż
// formatki z dnia N+1 i sprawdź ponownie, aż do limitu dni do przodu.
// ─────────────────────────────────────────────────────────────────────────────

import { MaxRectsPacker } from 'maxrects-packer';
import { localDateStr } from './scheduler.js';

const DEFAULT_WASTE_THRESHOLD   = 0.05;
const DEFAULT_MAX_LOOKAHEAD_DAYS = 3;

// smart/pot wyłączone celowo — to opcje pod atlasy sprite'ów (auto-shrink do
// najmniejszego rozmiaru + zaokrąglenie do potęgi 2), a arkusz blachy ma
// FIZYCZNY, stały rozmiar. Z smart:false bin.width/height == sheetW/sheetH.
const PACK_OPTIONS = { smart: false, pot: false, square: false, allowRotation: true, border: 0 };

// packDay: pakuje pulę formatek (tego samego materiału+grubości) na arkusze
// o stałym rozmiarze sheetW x sheetH. Zwraca liczbę potrzebnych arkuszy i %
// odpadu (1 - suma pól formatek / (pole arkusza * liczba użytych arkuszy)).
export function packDay(formatki, sheetW, sheetH) {
  const packer = new MaxRectsPacker(sheetW, sheetH, 0, PACK_OPTIONS);
  const rects = [];
  formatki.forEach(f => {
    const qty = Math.max(1, Math.round(f.qty || 1));
    for (let i = 0; i < qty; i++) {
      rects.push({ width: f.w, height: f.h, data: { key: f.key } });
    }
  });
  if (!rects.length) return { sheetsUsed: 0, wastePct: 0, bins: [] };

  packer.addArray(rects);

  const totalPartsArea = rects.reduce((s, r) => s + r.width * r.height, 0);
  const sheetsUsed      = packer.bins.length;
  const totalSheetArea  = sheetsUsed * sheetW * sheetH;
  const wastePct        = totalSheetArea > 0 ? 1 - totalPartsArea / totalSheetArea : 0;

  return { sheetsUsed, wastePct, bins: packer.bins };
}

// runNestingConsolidation: pętla dzień-po-dniu per (materiał, grubość).
// fwdZP     — wynik silnika (te same obiekty co Gantt/HeatmapPlan).
// bomByOp   — Map<`${zp_id}/${sequence}`, rekord z parseBomFormatek>.
// parallelMachines — lista kodów maszyn (te same co dla fan-out/fan-in) — tu
//   pełnią rolę "które maszyny robią rozkrój" (wykrawarki).
// zpMeta — (opcjonalna) Map<zp_id, {volume, product_name}> z surowego importu
//   ERP (przed erpZpToSchedulerInput). Potrzebna z dwóch powodów: (1) `op.volume`
//   w fwdZP jest ZAWSZE 1 (erpZpToSchedulerInput celowo nie mnoży — durH to już
//   czas całkowity partii, nie per sztukę) — bez realnej ilości nesting liczyłby
//   zawsze 1 sztukę na formatkę; (2) fwdZP niesie tylko kod produktu, nie jego
//   opisową nazwę. Fallback na op.volume||1 / op.product dla testów syntetycznych.
export function runNestingConsolidation({
  fwdZP,
  bomByOp,
  parallelMachines,
  zpMeta,
  wasteThreshold = DEFAULT_WASTE_THRESHOLD,
  maxLookaheadDays = DEFAULT_MAX_LOOKAHEAD_DAYS,
}) {
  const parallelSet = new Set((parallelMachines || []).map(String));

  // 1) Zbierz operacje na wykrawarkach z dopasowanym wpisem BOM, pogrupowane
  //    po (materiał+grubość) -> dzień startu -> lista formatek.
  const byMaterial = new Map(); // matKey -> Map(dayStr -> formatka[])

  (fwdZP || []).forEach(op => {
    if (!parallelSet.has(String(op.workcenter))) return;
    const zpKey = op.parent_zp || op.zp_id;
    const bomKey = `${zpKey}/${op.sequence}`;
    const bom = bomByOp.get(bomKey);
    if (!bom) return;

    const seg = (op.segments || [])[0];
    if (!seg || !seg.segStart) return;
    const day = localDateStr(seg.segStart);
    const meta = zpMeta?.get(zpKey);
    const qty = meta?.volume ?? op.volume ?? 1;

    const matKey = `${bom.material}/${bom.grubosc_mm}`;
    if (!byMaterial.has(matKey)) byMaterial.set(matKey, new Map());
    const dayMap = byMaterial.get(matKey);
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day).push({
      key: op.zp_id,
      zpId: zpKey,
      klient: op.klient || '',
      produkt: meta?.product_name || op.product || '',
      priority: op.priority,
      dueDate: op.due_date,
      origDay: day,
      w: bom.szerokosc_mm,
      h: bom.wysokosc_mm,
      qty,
      sheetW: bom.arkusz_szerokosc_mm,
      sheetH: bom.arkusz_wysokosc_mm,
    });
  });

  // 2) Dla każdego materiału: idź dzień po dniu, rozszerzaj okno aż odpad
  //    zejdzie poniżej progu lub skończy się limit dni do przodu.
  const results = [];

  byMaterial.forEach((dayMap, matKey) => {
    const sortedDays = [...dayMap.keys()].sort();
    const consumed   = new Set();

    sortedDays.forEach((anchorDay, anchorIdx) => {
      if (consumed.has(anchorDay)) return;

      let pool     = [...dayMap.get(anchorDay)];
      let usedDays = [anchorDay];
      const sheetW = pool[0].sheetW, sheetH = pool[0].sheetH;
      let { wastePct, sheetsUsed } = packDay(pool, sheetW, sheetH);

      let lookIdx = anchorIdx;
      while (wastePct > wasteThreshold && usedDays.length < maxLookaheadDays) {
        lookIdx++;
        const nextDay = sortedDays[lookIdx];
        if (!nextDay || consumed.has(nextDay)) break;
        pool = pool.concat(dayMap.get(nextDay));
        usedDays.push(nextDay);
        ({ wastePct, sheetsUsed } = packDay(pool, sheetW, sheetH));
      }

      usedDays.forEach(d => consumed.add(d));
      const [material, grubosc_mm] = matKey.split('/');
      const formatkiCount = pool.reduce((sum, f) => sum + Math.max(1, Math.round(f.qty || 1)), 0);
      results.push({
        anchorDate:     anchorDay,
        material,
        grubosc_mm:     parseFloat(grubosc_mm),
        wastePct,
        sheetsUsed,
        formatkiCount,  // suma sztuk (qty), nie liczba wpisów w puli
        usedDaysSpan:   usedDays.length,
        usedDays,
        // Zawartość arkusza — do rozwijanej tabeli szczegółów (Sekcja C).
        formatki: pool.map(f => ({
          zpId: f.zpId, klient: f.klient, produkt: f.produkt,
          szerokosc_mm: f.w, wysokosc_mm: f.h, qty: Math.max(1, Math.round(f.qty || 1)),
          priority: f.priority, dueDate: f.dueDate, origDay: f.origDay,
        })),
      });
    });
  });

  return results.sort((a, b) => a.anchorDate.localeCompare(b.anchorDate));
}

// buildBomIndex: BOM records (z parseBomFormatek) -> Map po kluczu zp_id/sequence.
export function buildBomIndex(bomRecords) {
  const map = new Map();
  (bomRecords || []).forEach(r => map.set(`${r.zp_id}/${r.sequence}`, r));
  return map;
}
