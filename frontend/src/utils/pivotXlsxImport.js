// ─── IMPORT ZP Z PLIKU XLSX (PULPIT PRODUKCJI) ───────────────────────────────
// Zamiast ręcznego kopiowania z drill-through ("Szczegóły181", martwy snapshot),
// czyta dane bezpośrednio z cache tabeli przestawnej OBCIĄŻENIE (zapytanie
// Power Query "WcObc_Oblozenie" → SmayDB.dbo.ExScaWcObc_Obl w SQL). Ten cache
// jest żywy — odświeża się razem z pivotem w Excelu (Dane → Odśwież wszystko)
// i zawiera dokładnie te same kolumny co eksport TSV z ERP.
//
// xlsx to zip: cache tabeli przestawnej to dwa pliki XML wewnątrz:
//   xl/pivotCache/pivotCacheDefinitionN.xml — nazwy pól + słowniki współdzielonych wartości
//   xl/pivotCache/pivotCacheRecordsN.xml    — właściwe wiersze, jeden <r> na rekord
// Znajdujemy właściwy cache po nazwach pól (Numer ZP + CzasPozost), nie po
// numerze pliku — bo ten może się zmieniać między zapisami skoroszytu.
// ──────────────────────────────────────────────────────────────────────────────

import JSZip from 'jszip';

const REQUIRED_FIELDS = ['Numer ZP', 'CzasPozost'];

function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

// Zwraca { fieldNames: string[], sharedItems: (Array|null)[] } — sharedItems[i]
// to lista wartości pola i (w kolejności <x v="idx">) albo null gdy pole nie
// ma słownika (wartość jest zapisana wprost w rekordzie).
function parseCacheDefinition(doc) {
  const fieldNames = [];
  const sharedItems = [];

  for (const fieldEl of doc.getElementsByTagName('cacheField')) {
    fieldNames.push(fieldEl.getAttribute('name'));

    const itemsEl = fieldEl.getElementsByTagName('sharedItems')[0];
    const children = itemsEl ? [...itemsEl.children] : [];
    if (children.length === 0) {
      sharedItems.push(null); // brak słownika -> wartość wprost w rekordzie
      continue;
    }
    sharedItems.push(children.map(readValueNode));
  }

  return { fieldNames, sharedItems };
}

function readValueNode(el) {
  switch (el.tagName) {
    case 'm': return '';                       // brak wartości
    case 'b': return el.getAttribute('v') === '1';
    default:  return el.getAttribute('v');      // s (tekst), n (liczba), d (data) — wszystkie jako string
  }
}

// Parsuje pivotCacheRecords.xml na tablicę wierszy (jeden wiersz = tablica
// wartości w kolejności fieldNames).
function parseCacheRecords(doc, sharedItems) {
  const rows = [];
  for (const rEl of doc.getElementsByTagName('r')) {
    const row = [];
    let i = 0;
    for (const child of rEl.children) {
      const value = child.tagName === 'x'
        ? sharedItems[i][parseInt(child.getAttribute('v'), 10)]
        : readValueNode(child);
      row.push(value);
      i++;
    }
    rows.push(row);
  }
  return rows;
}

function tsvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[\t\n\r]/.test(s) ? s.replace(/[\t\n\r]+/g, ' ') : s;
}

// Zwraca tekst TSV gotowy do wrzucenia wprost do parseZPFromERP(), albo rzuca
// błąd z czytelnym komunikatem jeśli nie znaleziono właściwego cache.
export async function xlsxPivotCacheToZpTsv(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);

  const defFiles = Object.keys(zip.files)
    .filter(n => /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(n));

  if (defFiles.length === 0) {
    throw new Error('Nie znaleziono żadnej tabeli przestawnej w tym pliku xlsx.');
  }

  for (const defPath of defFiles) {
    const defXml = await zip.file(defPath).async('text');
    const defDoc = parseXml(defXml);
    const { fieldNames, sharedItems } = parseCacheDefinition(defDoc);

    if (!REQUIRED_FIELDS.every(f => fieldNames.includes(f))) continue;

    const n = defPath.match(/(\d+)\.xml$/)[1];
    const recPath = `xl/pivotCache/pivotCacheRecords${n}.xml`;
    const recFile = zip.file(recPath);
    if (!recFile) continue;

    const recXml = await recFile.async('text');
    const recDoc = parseXml(recXml);
    const rows = parseCacheRecords(recDoc, sharedItems);

    const lines = [fieldNames.join('\t')];
    for (const row of rows) lines.push(row.map(tsvEscape).join('\t'));
    return { tsv: lines.join('\n'), rowCount: rows.length, fieldNames };
  }

  throw new Error(
    'Nie znaleziono w pliku tabeli przestawnej z kolumnami "Numer ZP" / "CzasPozost" ' +
    '(oczekiwano cache zapytania WcObc_Oblozenie z zakładki OBCIĄŻENIE).'
  );
}
