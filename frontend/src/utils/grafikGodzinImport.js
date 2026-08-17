// ─── IMPORT GRAFIKU GODZIN (z loadplanner) ───────────────────────────────────
// loadplanner liczy dostępne godziny per brygada (WC3) z realnego stanu
// zatrudnienia/absencji (capacity.build_balance_table) i eksportuje je jako
// zwykły arkusz xlsx (Brygada | Data | GodzinyDostepne) — patrz
// capacity.export_grafik_godzin. To NIE jest tabela przestawna (inaczej niż
// xlsxPivotCacheToZpTsv), więc czytamy wprost xl/worksheets/sheetN.xml zamiast
// cache pivota.
//
// planprod planuje per maszyna (patrz erpZpToSchedulerInput: workcenter =
// machine_id), a brygada to tylko grupowanie (wc_group/wcToBrygada) używane przez
// mechanizm "pool" (getPoolAvail sumuje dostępność wszystkich zasobów brygady).
//
// Podział godzin brygady na jej zasoby NIE jest już czysto równy (patrz
// splitBrigadeHours niżej) — maszyna (2xxxx, jeden operator) dostaje swoje
// skonfigurowane zapotrzebowanie (capowane na fizyczny sufit 24h/dobę), a
// dopiero reszta dzieli się równo na gniazda (3xxxx). Patrz POOL_BRYGADY_
// 2xxxx_3xxxx.md w katalogu projektu (planprod) — to jest ta sama zasada,
// co "maszyna ma domyślny priorytet do puli", tylko na warstwie statycznego
// importu/szablonu, nie samego silnika planującego.
// ──────────────────────────────────────────────────────────────────────────────

import JSZip from 'jszip';

const MACHINE_CEILING_H      = 24; // maszyna: jeden operator, fizyczny sufit kalendarzowy
const DEFAULT_MACHINE_CLAIM_H = 16; // fallback gdy brak wcCapacity dla nowego kodu maszyny

function isMachineWc(wc) {
  return String(wc).startsWith('2');
}

// Dzieli godziny brygady na jej zasoby: maszyny (2xxxx) dostają swoje skonfigurowane
// zapotrzebowanie (wcCapacity, capowane na MACHINE_CEILING_H), reszta trafia równo do
// gniazd (3xxxx). Jeśli suma zapotrzebowań maszyn przekracza realnie zaimportowane
// godziny (np. dzień świąteczny w loadplannerze), przycina je proporcjonalnie — suma
// nigdy nie przekracza `godziny`, żadne godziny nie są tworzone ani gubione.
function splitBrigadeHours(machines, godziny, wcCapacity) {
  const machineWcs = machines.filter(isMachineWc);
  const gniazdoWcs  = machines.filter(wc => !isMachineWc(wc));
  const perWc = {};

  if (!machineWcs.length) {
    // Brygada czysto-3xxxx — bez zmian, równy podział jak dotąd.
    const perMachine = godziny / machines.length;
    machines.forEach(wc => { perWc[wc] = perMachine; });
    return perWc;
  }

  const rawClaims  = machineWcs.map(wc => Math.min(wcCapacity?.[wc] ?? DEFAULT_MACHINE_CLAIM_H, MACHINE_CEILING_H));
  const totalClaim = rawClaims.reduce((s, h) => s + h, 0);
  const scale      = totalClaim > godziny && totalClaim > 0 ? godziny / totalClaim : 1;

  let usedByMachines = 0;
  machineWcs.forEach((wc, i) => {
    const claim = rawClaims[i] * scale;
    perWc[wc] = claim;
    usedByMachines += claim;
  });

  const remainder = Math.max(0, godziny - usedByMachines);
  if (gniazdoWcs.length) {
    const perGniazdo = remainder / gniazdoWcs.length;
    gniazdoWcs.forEach(wc => { perWc[wc] = perGniazdo; });
  } else {
    // Same maszyny, brak gniazd 3xxxx do wchłonięcia nadwyżki — degeneruje do
    // równego podziału całości, żeby nie zgubić godzin ponad sumę sufitów.
    const perMachine = godziny / machineWcs.length;
    machineWcs.forEach(wc => { perWc[wc] = perMachine; });
  }

  return perWc;
}

function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function colLetterFromRef(ref) {
  return ref.match(/^[A-Z]+/)[0];
}

function colIndexFromLetter(letter) {
  let idx = 0;
  for (const ch of letter) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1; // 0-based
}

function readSharedStrings(zip) {
  const file = zip.file('xl/sharedStrings.xml');
  if (!file) return [];
  return file.async('text').then(xml => {
    const doc = parseXml(xml);
    return [...doc.getElementsByTagName('si')].map(si => {
      const tNodes = si.getElementsByTagName('t');
      return [...tNodes].map(t => t.textContent).join('');
    });
  });
}

function cellValue(cellEl, sharedStrings) {
  const type = cellEl.getAttribute('t');
  const vEl = cellEl.getElementsByTagName('v')[0];
  if (type === 'inlineStr') {
    const isEl = cellEl.getElementsByTagName('is')[0];
    return isEl ? isEl.textContent : '';
  }
  if (!vEl) return '';
  const raw = vEl.textContent;
  if (type === 's') {
    const idx = parseInt(raw, 10);
    return sharedStrings[idx] ?? '';
  }
  return raw; // liczba (albo "str" — wynik formuły jako tekst) — parsowane dalej wg kolumny
}

// Zwraca [{brygada, data, godziny}, ...] — jedna tablica na cały arkusz.
export async function parseGrafikGodzinXlsx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const sharedStrings = await readSharedStrings(zip);

  const sheetPath = Object.keys(zip.files)
    .find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!sheetPath) {
    throw new Error('Nie znaleziono arkusza w tym pliku xlsx.');
  }

  const doc = parseXml(await zip.file(sheetPath).async('text'));
  const rowEls = [...doc.getElementsByTagName('row')];
  if (rowEls.length < 2) return [];

  function readRow(rowEl) {
    const cells = [];
    for (const cellEl of rowEl.getElementsByTagName('c')) {
      const ref = cellEl.getAttribute('r');
      const idx = colIndexFromLetter(colLetterFromRef(ref));
      cells[idx] = cellValue(cellEl, sharedStrings);
    }
    return cells;
  }

  const headers = readRow(rowEls[0]).map(h => String(h).trim().toLowerCase());
  const colBrygada = headers.indexOf('brygada');
  const colData = headers.indexOf('data');
  const colGodziny = headers.indexOf('godzinydostepne');
  if (colBrygada === -1 || colData === -1 || colGodziny === -1) {
    throw new Error('Oczekiwano kolumn Brygada, Data, GodzinyDostepne w arkuszu grafiku godzin.');
  }

  return rowEls.slice(1).map(rowEl => {
    const cells = readRow(rowEl);
    return {
      brygada: String(cells[colBrygada] ?? '').trim(),
      data: String(cells[colData] ?? '').trim(),
      godziny: parseFloat(cells[colGodziny]) || 0,
    };
  }).filter(r => r.brygada && r.data);
}

// Rozdziela godziny każdej brygady równo na jej maszyny (wg wcToBrygada — { machine_id
// → brygada }, budowane automatycznie przy imporcie ERP) i scala (merge, nie
// replace) z istniejącym wcSchedule. Zwraca { schedule, warnings } — brygada bez
// żadnej znanej maszyny trafia do warnings zamiast rzucać błąd (np. literówka w
// nazwie brygady albo import zrobiony przed importem ERP).
export function mergeGrafikGodzinIntoSchedule(rows, wcToBrygada, wcSchedule, wcCapacity = {}) {
  const machinesByBrigade = {};
  Object.entries(wcToBrygada || {}).forEach(([machineId, brigade]) => {
    if (!machinesByBrigade[brigade]) machinesByBrigade[brigade] = [];
    machinesByBrigade[brigade].push(machineId);
  });

  const schedule = { ...(wcSchedule || {}) };
  const warnings = [];
  const warnedBrigades = new Set();

  for (const { brygada, data, godziny } of rows) {
    const machines = machinesByBrigade[brygada];
    if (!machines || !machines.length) {
      if (!warnedBrigades.has(brygada)) {
        warnedBrigades.add(brygada);
        warnings.push(
          `Brygada "${brygada}" nie ma żadnej znanej maszyny (brak w bieżącym imporcie ERP) — pominięto.`
        );
      }
      continue;
    }
    const perWc = splitBrigadeHours(machines, godziny, wcCapacity);
    for (const [machineId, h] of Object.entries(perWc)) {
      schedule[machineId] = { ...(schedule[machineId] || {}), [data]: h };
    }
  }

  return { schedule, warnings };
}

// Wyciąga z zaimportowanego tygodnia powtarzalny wzorzec dzień-tygodnia → godziny,
// per maszyna: { machine_id: { 0: h_nd, 1: h_pon, ..., 6: h_sob } } (indeks jak
// Date.getDay()). Używany jako trwały fallback w buildWcSchedule — pozwala jednemu
// importowi grafiku (7 dni) pokryć CAŁY horyzont planowania, nie tylko te 7 dat,
// bo "Planuj od" może się przesunąć poza pierwotnie zaimportowany zakres w obie
// strony. Brygada bez znanych maszyn jest po cichu pomijana (już zgłoszona jako
// warning przez mergeGrafikGodzinIntoSchedule przy tym samym imporcie).
export function buildWeeklyTemplateFromGrafik(rows, wcToBrygada, wcCapacity = {}) {
  const machinesByBrigade = {};
  Object.entries(wcToBrygada || {}).forEach(([machineId, brigade]) => {
    if (!machinesByBrigade[brigade]) machinesByBrigade[brigade] = [];
    machinesByBrigade[brigade].push(machineId);
  });

  const template = {};
  for (const { brygada, data, godziny } of rows) {
    const machines = machinesByBrigade[brygada];
    if (!machines || !machines.length) continue;
    const weekday = new Date(data + 'T12:00:00').getDay();
    const perWc = splitBrigadeHours(machines, godziny, wcCapacity);
    for (const [machineId, h] of Object.entries(perWc)) {
      if (!template[machineId]) template[machineId] = {};
      template[machineId][weekday] = h;
    }
  }
  return template;
}
