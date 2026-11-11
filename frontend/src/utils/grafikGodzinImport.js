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

const MAX_ENTRY_BYTES = 50 * 1024 * 1024; // limit rozmiaru wpisu xlsx po rozpakowaniu (ochrona przed zip-bombą)

// DOMParser nie rzuca przy złym XML — zwraca dokument z <parsererror>.
function parseXml(text, label = 'xlsx') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error(`Plik xlsx jest uszkodzony — nieprawidłowy XML w ${label}.`);
  }
  return doc;
}

async function readEntryText(zipFile, name) {
  const tooBig = () => new Error(
    `Plik xlsx jest zbyt duży po rozpakowaniu (${name}, limit ${MAX_ENTRY_BYTES / 1024 / 1024} MB).`
  );
  const declared = zipFile?._data?.uncompressedSize;
  if (typeof declared === 'number' && declared > MAX_ENTRY_BYTES) throw tooBig();
  const text = await zipFile.async('text');
  if (text.length > MAX_ENTRY_BYTES) throw tooBig();
  return text;
}

function colLetterFromRef(ref) {
  const m = typeof ref === 'string' ? ref.match(/^[A-Z]+/) : null;
  return m ? m[0] : null;
}

// Excel: serial dni od 1899-12-30 -> 'YYYY-MM-DD' (UTC, bez przesunięć strefowych).
function serialToIso(n) {
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
}

function isoIfValid(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

// Normalizuje komórkę daty do 'YYYY-MM-DD': ISO (z opcjonalną godziną), DD.MM.YYYY,
// DD/MM/YYYY albo serial Excela. Nieparsowalne/nieistniejące (31.02) -> null.
export function parseExcelDateToIso(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return isoIfValid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[T ].*)?$/);
  if (m) return isoIfValid(+m[3], +m[2], +m[1]);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n >= 1 && n < 2958466) return serialToIso(n); // do 9999-12-31
  }
  return null;
}

// Godziny: przecinek dziesiętny i spacje tolerowane; puste/nieliczbowe -> NaN.
function parseHours(raw) {
  const s = String(raw ?? '').replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return parseFloat(s);
}

function colIndexFromLetter(letter) {
  let idx = 0;
  for (const ch of letter) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1; // 0-based
}

function readSharedStrings(zip) {
  const file = zip.file('xl/sharedStrings.xml');
  if (!file) return [];
  return readEntryText(file, 'xl/sharedStrings.xml').then(xml => {
    const doc = parseXml(xml, 'sharedStrings.xml');
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

// Zwraca [{brygada, data, godziny}, ...] — jedna tablica na cały arkusz, z dodatkową
// własnością `warnings` (string[]) na samej tablicy (kształt tablicy bez zmian, więc
// App.jsx działa jak dotąd). Wiersze z pustymi/błędnymi/ujemnymi/>24 godzinami albo
// nieparsowalną datą są POMIJANE z ostrzeżeniem (nie zamieniane w 0 = "zamknięta").
// Duplikat brygada+data: wygrywa OSTATNI wiersz w arkuszu, z ostrzeżeniem.
export async function parseGrafikGodzinXlsx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const sharedStrings = await readSharedStrings(zip);

  const sheetPath = Object.keys(zip.files)
    .find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!sheetPath) {
    throw new Error('Nie znaleziono arkusza w tym pliku xlsx.');
  }

  const doc = parseXml(await readEntryText(zip.file(sheetPath), sheetPath), sheetPath);
  const rowEls = [...doc.getElementsByTagName('row')];
  const warnings = [];
  if (rowEls.length < 2) { const empty = []; empty.warnings = warnings; return empty; }

  function readRow(rowEl) {
    const cells = [];
    let next = 0; // komórka bez atrybutu r -> kolumna następna po poprzedniej
    for (const cellEl of rowEl.getElementsByTagName('c')) {
      const letter = colLetterFromRef(cellEl.getAttribute('r'));
      const idx = letter ? colIndexFromLetter(letter) : next;
      cells[idx] = cellValue(cellEl, sharedStrings);
      next = idx + 1;
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

  const out = [];
  const indexByKey = new Map();
  rowEls.slice(1).forEach((rowEl, i) => {
    const cells = readRow(rowEl);
    const lineNo = i + 2;
    const brygada = String(cells[colBrygada] ?? '').trim();
    const dataRaw = String(cells[colData] ?? '').trim();
    if (!brygada || !dataRaw) return; // pusty wiersz — pomijany cicho jak dotąd
    const data = parseExcelDateToIso(dataRaw);
    if (!data) {
      warnings.push(`Wiersz ${lineNo}: nieprawidłowa data "${dataRaw}" (brygada "${brygada}") — pominięto.`);
      return;
    }
    const godziny = parseHours(cells[colGodziny]);
    if (!Number.isFinite(godziny) || godziny < 0 || godziny > 24) {
      warnings.push(`Wiersz ${lineNo}: nieprawidłowe godziny "${String(cells[colGodziny] ?? '').trim()}" (brygada "${brygada}", ${data}) — dozwolone 0–24, pominięto.`);
      return;
    }
    const key = `${brygada}\u0000${data}`;
    if (indexByKey.has(key)) {
      warnings.push(`Wiersz ${lineNo}: duplikat brygada "${brygada}" + data ${data} — użyto ostatniej wartości (${godziny} h).`);
      out[indexByKey.get(key)] = { brygada, data, godziny };
      return;
    }
    indexByKey.set(key, out.length);
    out.push({ brygada, data, godziny });
  });
  out.warnings = warnings;
  return out;
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
