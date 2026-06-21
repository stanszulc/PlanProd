# AUDYT TECHNICZNY — PlanProd
> Data: 2026-06-20 · Stack: React 19.2 + Vite (frontend), FastAPI + OR-Tools CP-SAT (backend niepodłączony)

---

## 1. ARCHITEKTURA

### 1.1 Diagram zależności komponentów

```
main.jsx
└── App.jsx (GOD COMPONENT — 517 linii, ~12 pól stanu)
    ├── NavMenu (inline w App.jsx:61–128)
    └── [conditional render — switch na `tab`]
        ├── DashboardTab
        ├── PlanTab
        │   ├── GanttTab (embedded=true)
        │   ├── GrafikTab (slave mode)
        │   └── [ZP Status table inline w PlanTab]
        ├── BottleneckTab
        ├── HeatmapTab
        ├── HeatmapPlanTab
        ├── SwimlaneTab
        ├── SankeyTab
        ├── RoutingTab
        ├── AnalysisTab
        │   ├── HistorySankeySection (inline)
        │   ├── TimesSection (inline)
        │   ├── HeatmapSection (inline)
        │   ├── StabilitySection (inline)
        │   └── ParetoSection (inline)
        ├── RealizacjaTab
        ├── LateZSTab
        ├── BufferTab
        ├── BufferZSTab
        ├── ImportTab
        ├── ScheduleDebugTab
        └── SettingsTab

Komponenty wspólne (importowane przez wiele zakładek):
    ├── Bar.jsx
    ├── KpiCard.jsx
    ├── DatePicker.jsx
    ├── Dot.jsx
    └── EmptyState.jsx
```

### 1.2 Gdzie mieszka stan — App.jsx

Cały stan aplikacji zamknięty jest w jednym komponencie `App.jsx`. Zidentyfikowane pola stanu (`useState`):

| Hook / pole | Opis |
|---|---|
| `tab` | aktywna zakładka nawigacji |
| `erpZp` | surowe dane z importu ERP (ZP) |
| `routing` | dane routingu technologicznego |
| `zp` | przetworzone zlecenia produkcyjne |
| `wcSchedule` | harmonogram dostępności gniazd roboczych |
| `subZP` | wynik schedulera (backward) |
| `fwdZP` | wynik schedulera (forward) |
| `zpStatus` | wynik `calcHybridZpStatus()` |
| `scheduleConfig` | konfiguracja harmonogramu (priorytety, VIP) |
| `historyData` | dane historyczne realizacji |
| `zpStatusData` | dane importowane z `zp_status.csv` |

Scheduler działa w Web Workerze (`scheduler.worker.js`), wynik trafia z powrotem do `App.jsx` i jest rozproszony przez props do wszystkich zakładek.

### 1.3 Przepływ danych

```
[Plik TSV/CSV użytkownika]
        │
        ▼
ImportTab.jsx → onLoad() callback do App.jsx
        │
        ▼
App.jsx: parseZPFromERP() + erpZpToSchedulerInput()   ← utils/scheduler.js
        │
        ▼
scheduler.worker.js (Web Worker)
        │  postMessage(input) / onmessage(result)
        ▼
App.jsx setState: { subZP, fwdZP, wcSchedule }
        │
        ▼
calcHybridZpStatus() → zpStatus                       ← utils/scheduler.js
enrichWithStandards() + calcWaitTimes()               ← utils/analysisUtils.js
        │
        ▼
App.jsx render → props drilling do każdej zakładki
        │
        ├── PlanTab(routing, zp, wcSchedule, subZP, fwdZP, zpStatus, ...)  [12 propsów]
        ├── BottleneckTab(routing, zp, globalLookups, wcSchedule, subZP)
        ├── DashboardTab(routing, zp, zpStatus, wcSchedule, historyData, ...)
        └── ... (pozostałe 12 zakładek)
```

**Problem**: transformacja danych w kilku miejscach — część w `App.jsx` inline, część w `utils/scheduler.js`, część w `utils/analysisUtils.js`, bez jednoznacznej granicy odpowiedzialności.

### 1.4 Problemy architektoniczne

#### A. God Component — `App.jsx`

`App.jsx` (517 linii) robi wszystko naraz:
- zarządza całym stanem aplikacji (~12 `useState`)
- orkiestruje Web Workera
- renderuje nawigację (`NavMenu` zdefiniowany wewnątrz tego samego pliku, linie 61–128)
- routuje do 16 zakładek przez gigantyczny blok warunkowy (linie 480–514)
- wywołuje logikę biznesową (`parseZPFromERP`, `calcHybridZpStatus`, `enrichWithStandards`)

Brak jakiegokolwiek Context API, Redux, Zustand ani żadnego mechanizmu zarządzania stanem.

#### B. Prop Drilling — systematyczny problem

Każda zakładka otrzymuje od 5 do 12 propsów, wiele z nich przekazywanych przez pośrednie komponenty bez ich używania:
- `PlanTab` przyjmuje 12 propsów i przekazuje większość bez modyfikacji do `GanttTab` i `GrafikTab`
- `DashboardTab` przyjmuje `onTabChange` — callback nawigacyjny z `App.jsx` przekazywany w dół tylko po to, żeby karty KPI mogły zmienić zakładkę

#### C. Duplikacja logiki domenowej

`BufferTab.jsx` i `BufferZSTab.jsx` zawierają **identyczne kopie** funkcji pomocniczych:
- `parseDt()`, `opStatus()`, `calcBufferRatio()`, `zoneOrder()` — zduplikowane 1:1
- `StatusBadge`, `RatioBar` — zduplikowane komponenty React (różnica: `height: 8` vs `height: 6`)

Łącznie ~150 linii kodu skopiowanych między dwoma plikami.

#### D. Logika domenowa w komponentach UI

`AnalysisTab.jsx` (1110 linii) zawiera wewnątrz definicje komponentów sekcji, funkcje obliczeniowe (`calcBoxStats`, `isoWeekStr`, `localDay`) oraz drag-handler logic — wszystko zmieszane w jednym pliku.

`BottleneckTab.jsx` zawiera funkcję `dateColor()` (~linie 50–62), która wywołuje `computeLoads()` dla każdej daty osobno przy każdym renderze — brak memoizacji na poziomie listy dat.

#### E. Dwie wersje `KpiCard`

`KpiCard` istnieje jednocześnie jako `components/common/KpiCard.jsx` i jako komponent lokalny zdefiniowany na dole `DashboardTab.jsx` — dwie potencjalnie rozbieżne wersje.

#### F. Bug — `setPanY` nie istnieje

`GanttTab.jsx:228` wywołuje `setPanY(0)`, ale w komponencie nie ma stanu `panY` ani settera `setPanY`. Runtime error przy określonych interakcjach.

#### G. `computeLoads()` bez warstwy cache

`computeLoads()` jest importowane i wywoływane bezpośrednio w `HeatmapTab.jsx`, `BottleneckTab.jsx`, `DashboardTab.jsx`, `SwimlaneTab.jsx`, `SankeyTab.jsx` — 5 różnych konsumentów bez żadnej cache'ującej warstwy pośredniej.

### 1.5 Co jest w złym miejscu

| Co | Gdzie jest | Gdzie powinno być |
|---|---|---|
| `NavMenu` | `App.jsx:61–128` | `components/layout/NavMenu.jsx` |
| `parseDt`, `opStatus`, `calcBufferRatio`, `zoneOrder` | zduplikowane w `BufferTab.jsx` i `BufferZSTab.jsx` | `utils/bufferUtils.js` |
| Sekcje `AnalysisTab` | wewnątrz `AnalysisTab.jsx` | osobne pliki w `components/tabs/analysis/` |
| `KpiCard` (wersja lokalna) | dół `DashboardTab.jsx` | usunąć, użyć `components/common/KpiCard.jsx` |
| `DAY_NAMES` | dół `EmptyState.jsx` | `constants/` |
| `calcHybridZpStatus`, `enrichWithStandards` | inline w `App.jsx` | hook `useSchedulerData()` lub store |
| Stan całej aplikacji | `App.jsx` | Context + reducery lub Zustand |

---

## 2. ALGORYTM SCHEDULINGU

### 2.1 Architektura — dwa niezależne systemy

Projekt zawiera dwa całkowicie odrębne silniki planowania, które **nie komunikują się ze sobą**:

- **`scheduler.js`** — deterministyczny greedy forward/backward scheduler w przeglądarce (JS)
- **`optimizer.py`** — solver CP-SAT (Google OR-Tools) po stronie serwera

Nie ma żadnego API call łączącego te dwa systemy. Frontend planuje lokalnie i nigdy nie wysyła zadania do solvera. Są to de facto dwa różne produkty w jednym repo.

### 2.2 Forward scheduler — krok po kroku

**Krok 1 — sortowanie ZP:**
```js
// forwardSchedule, linia ~401
const sorted = [...zpList].sort((a, b) =>
  a.priority - b.priority || a.due_date.localeCompare(b.due_date)
);
```
Błąd: `localeCompare` na stringu `'DD.MM.YYYY'` (format z ERP) posortuje się błędnie. Poprawne tylko dla ISO 8601.

**Krok 2 — iteracja po operacjach:** operacje każdego ZP przetwarzane liniowo. Kursor startuje z `planStart`, przesuwa się do `max(doneEnds[...predecessorSeqs])` gdy są poprzedniki.

**Krok 3 — `forwardScheduleOp`: przydzielanie czasu:**
```js
// linia ~337–383
while (remaining > EPSILON && safety++ < SAFETY_LIMIT) {
  // ...
  occupancy[wc].push({ from, to });
  occupancy[wc].sort((a, b) => a.from - b.from);  // sort po KAŻDEJ rezerwacji
}
```
Occupancy sortowane po każdej nowej rezerwacji wewnątrz pętli — O(K log K) per iterację.

### 2.3 Back scheduler — krytyczny błąd

Back scheduler **nie prowadzi słownika `occupancy`**. Każde ZP jest planowane niezależnie bez wiedzy o pozostałych. Wyjście zawiera nakładające się interwały na tych samych centrach roboczych. Frontend wyświetla nakładki bez ostrzeżenia.

### 2.4 Złożoność obliczeniowa

#### scheduler.js

| Fragment | Złożoność | Uwagi |
|---|---|---|
| sortowanie ZP | O(Z log Z) | Z = liczba ZP |
| pętla główna forwardSchedule | O(Z × N) | N = śr. operacji na ZP |
| forwardScheduleOp — pętla while | O(D × K) na wywołanie | D = dni horyzontu, K = rezerwacji na WC |
| sort occupancy per rezerwację | O(K log K) | wewnątrz pętli |
| calcBrigadeBalance | O(B × days × ops × segs) | pełny scan per brygada per dzień |

Łączna złożoność pesymistyczna: **O(Z × N × D × K log K)**. Dla Z=200, N=5, D=30, K=1000 → niezarządzalne w przeglądarce.

#### optimizer.py — ukryty problem skali

Faza 1 z 5 kandydatami CCR i 3 opcjami zmian = 3^5=243 kombinacje × solve CP-SAT 8s = **~33 minuty sekwencyjnie**. Brak parallelizacji pętli `enumerate(combos)` — wielowątkowość jest tylko wewnątrz jednego wywołania `solve()`.

### 2.5 Poprawność wyników

#### optimizer.py — fałszywe poczucie optymalności

CP-SAT z `time_limit=8.0s` zwraca status `FEASIBLE`, nie `OPTIMAL`. Kod nie rozróżnia tych statusów:
```python
if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    return None
```
Brak komunikatu "wynik FEASIBLE, nie OPTIMAL". Brak logowania `solver.ObjectiveBound()`.

**Błąd w `work_to_cal_schedule`:** czas kalendarzowy obliczany z założeniem, że operacja zaczyna się na początku dnia 0. Offset startowy nie jest uwzględniony → za wczesne starty i za późne końce.

**Błąd w `count_tardy`:** `due_to_cal` oblicza deadline jako `cal_days * 24 * 60 + max_h * 60`, gdzie `max_h` to maksimum godzin spośród WSZYSTKICH WC, nie konkretnego WC dla danego ZP.

#### scheduler.js

**Błąd w `calcDelay`:**
```js
// linia ~463
const delayDays = +(delayH / DEFAULT_AVAIL).toFixed(1);
// DEFAULT_AVAIL = 16, DEFAULT_CAP = 8
```
Konwersja opóźnienia zakłada 16h/dzień roboczy, ale `DEFAULT_CAP = 8h`. Opóźnienia zaniżone 2x → OTIF raporty systemowo kłamią.

**`erpZpToSchedulerInput`:** przyjmuje pierwszy routing dla danego produktu i ignoruje resztę (linia ~769: `if (!routingByProduct[zp.product])`). Warianty technologiczne tego samego produktu są cicho ignorowane.

### 2.6 Brakujące constrainty

**W optimizer.py:**
1. Brak ograniczenia dostępności pracowników (operator)
2. Brak setup time / sequence-dependent changeover
3. Brak ograniczenia WIP (Work-In-Progress)
4. Brak modelowania transportu między WC (zerowy czas)
5. Brak ograniczenia "partia musi być pełna"

**W scheduler.js:**
6. Brak detekcji konfliktu zasobów w back-schedulerze
7. `volume = 0` → `max(1, 0) = 1` → ZP z zerowym wolumenem pojawia się w planie

### 2.7 Edge case'y

| Przypadek | Zachowanie | Ocena |
|---|---|---|
| Brak routingu dla produktu | ZP ignorowane bez ostrzeżenia | Cichy błąd |
| Cykl w grafie operacji (predecessors) | Wynik logicznie błędny, brak crash | Cichy błąd |
| `volume = 0` | Traktowane jak `volume = 1` | Bug |
| `SAFETY_LIMIT = 10_000` przekroczony | Niekompletne segmenty bez ostrzeżenia | Cichy błąd |
| Wszystkie dni = 0h w grafiku | Nieskończona pętla 10 000 iteracji, UI zamrożone | CRITICAL |

---

## 3. WYDAJNOŚĆ

### 3.1 Brakujące `useMemo` / `useCallback`

**App.jsx — brak memoizacji globalnych danych:**

- `globalLookups` — jeśli wyliczane inline w JSX bez `useMemo`, każde dziecko widzi nową referencję i re-renderuje się
- Callbacki `onRecalc`, `onTabChange`, `onPlanStartChange` — bez `useCallback` są nową funkcją przy każdym renderze, niszcząc memoizację dzieci

**AnalysisTab.jsx — 1100 linii, zero `useCallback`:**

Jeśli 5 sekcji (`HistorySankeySection`, `TimesSection` itd.) jest definiowanych wewnątrz ciała `AnalysisTab`, React odmontowuje i montuje je od nowa przy każdym re-renderze. Handlery drag bez `useCallback` rebindują słuchaczy przy każdym renderze.

**HeatmapTab.jsx — `loadsCache` bez `useMemo`:**
```
for każdy due_date:
  computeLoads(routingByProduct, zpForDate, wcSchedule, date)
```
Przy 50 terminach: 1500 wywołań `computeLoads` per render gdy brak `useMemo([zp, routing, wcSchedule])`.

**BufferTab.jsx / BufferZSTab.jsx — `now = new Date()` jako dep:**

`useMemo(..., [zpStatusData, now])` gdzie `now = new Date()` nie pomaga — `now` zawsze jest "nowe", cache nigdy nie jest trafny.

### 3.2 Re-rendery

| Komponent | Powód re-renderu | Skutek |
|---|---|---|
| `NavMenu` (App.jsx:61) | każda zmiana stanu w App | re-render przy każdym kliknięciu zakładki |
| `GrafikTab` (slave PlanTab) | zmiana `sharedView` (pan/zoom Gantt) | pełny re-render grafiku przy przeciąganiu |
| `DashboardTab` | nowe referencje `routing`/`zp`/`wcSchedule` | re-przeliczenie `computeLoads` |
| `AnalysisTab` | zmiana `filterWc` | przerysowanie całego SVG Sankey + boxplot |

### 3.3 Ciężkie obliczenia na głównym wątku

**Scheduler w workerze — ✓ poprawnie**, ale wyniki wracają bez stabilnych referencji → re-render całej aplikacji.

**`parseZPFromERP` i `erpZpToSchedulerInput`** — parsowanie CSV na main thread. Przy setkach ZP blokują UI.

**`zpStatusToHistoryFormat` → `enrichWithStandards` → `calcWaitTimes`** — łańcuch w `App.jsx` bez `useMemo`. Przy 5000 rekordach: ~8–15 ms per kliknięcie w menu.

**`calcZpHeaderStatus`** — `new Date()` wewnątrz każdej iteracji ZP. Bez `useMemo([zpStatusData])` kosztuje per render.

**`exportZpStatusCsv` — `Array.find` w zagnieżdżonej pętli:**
```js
zp.forEach(zpItem => {
  ops.forEach((op, idx) => {
    const fwd = fwdZP.find(f => ...); // O(n) per operacja
  });
});
```
100 ZP × 8 op × 800 fwdZP = 640 000 porównań. Wymaga `Map` przed pętlą.

### 3.4 SVG rendering

**GanttTab — pan przez `setState`:**

Każdy `onMouseMove` podczas przeciągania → `setPanX` → pełny re-render całego SVG. Przy 200 ZP × 8 op = 1600 rect — ~5–15 ms per klatka → ~20 fps. Rozwiązanie: `ref` na `transform` podczas drag, `setState` po `mouseup`.

### 3.5 Szacunkowe zyski

| Problem | Aktualny koszt | Po naprawie | Nakład |
|---|---|---|---|
| `loadsCache` bez `useMemo` w HeatmapTab | ~30–80 ms per render | 0 ms (cache) | 30 min |
| `zpStatusToHistoryFormat` bez `useMemo` | ~10–20 ms per render | 0 ms (cache) | 30 min |
| `exportZpStatusCsv` — `find` w pętli | ~50–200 ms blokady | <5 ms | 1h |
| `parseZpStatus` na main thread | ~60–120 ms blokady | 0 ms (worker) | 4h |
| GanttTab pan — setState per mousemove | ~20 fps | 60 fps | 2h |
| `calcZpHeaderStatus` bez `useMemo` | ~5–10 ms per render | 0 ms | 30 min |

---

## 4. BUGS I EDGE CASE'Y

**Łącznie: 6 CRITICAL, 9 HIGH, 8 MEDIUM, 5 LOW**

### CRITICAL

**[C1] `GanttTab.jsx:228` — `setPanY(0)` na nieistniejącym stanie**
- `panY` i `setPanY` nie są zdefiniowane w komponencie
- Runtime error przy każdej akcji triggerującej tę gałąź

**[C2] `scheduler.js` — backScheduleOp z zerowym grafikiem**
- Przy grafiku ze wszystkimi zerami pętla while wykonuje 10 000 iteracji synchronicznie
- UI zamrożone na kilka sekund, wynik to data z odległej przeszłości

**[C3] `App.jsx` / Worker — brak cleanup i race condition**
- Brak `worker.terminate()` przy odmontowaniu komponentu → memory leak
- Brak sequence numbering przy szybkim klikaniu "Przelicz" → wyświetlenie przestarzałego harmonogramu

**[C4] `scheduler.js:~462` — `delayDays = delayH / 16` przy 8h grafiku**
- `DEFAULT_AVAIL = 16`, `DEFAULT_CAP = 8` — niespójność
- Opóźnienia zaniżane 2x → raporty OTIF systemowo kłamią

**[C5] `scheduler.js:~580` — `wipOp.actual_start.getTime()` na stringu**
- `actual_start` z ERP to string — `.getTime()` crashes
- Obsługiwany przez `try/catch` → silent data corruption bez alertu użytkownika

**[C6] Back-scheduler — nakładające się sloty**
- Brak `occupancy` w back-schedulerze → dwa ZP mogą dostać identyczny slot na tym samym WC
- Plan jest logicznie niespójny, wyświetlany bez ostrzeżenia

### HIGH

**[H1] `scheduler.js:~769` — routing tylko z pierwszego ZP dla produktu**
- `if (!routingByProduct[zp.product])` — warianty technologiczne cicho ignorowane

**[H2] `optimizer.py` — FEASIBLE ≠ OPTIMAL bez informacji dla użytkownika**
- Solver przerywany po 8s, wynik może być daleki od optymalnego
- Brak logu `solver.ObjectiveBound()`, brak komunikatu ostrzegawczego

**[H3] `optimizer.py — count_tardy` — deadline liczony do złego WC**
- `max_h` to maximum ze wszystkich WC, nie konkretnego ZP

**[H4] `optimizer.py — work_to_cal_schedule` — offset startowy ignorowany**
- Czasy za wcześnie/za późno w modelu CP

**[H5] `localeCompare` na datach DD.MM.YYYY**
- Sortowanie ZP po terminie błędne dla formatu ERP

**[H6] `forwardScheduleOp` — SAFETY_LIMIT bez ostrzeżenia**
- `remaining > 0` po wyjściu z pętli nie jest sprawdzane
- Caller dostaje niekompletne segmenty bez informacji

**[H7] `calcZpHeaderStatus` — `Math.min` dla wolumenu**
- `volume_actual = Math.min(...ops.map(o => o.volume_actual))` — minimum zamiast maximum lub wartości z pierwszej operacji → błąd logiczny

**[H8] `volume = 0` → planowane jako `volume = 1`**
- `max(1, int(op['ct_min'] * 0)) = 1` — ZP bez wolumenu pojawia się w planie

**[H9] `zpStatusData` z `new Date()` jako dep w `useMemo`**
- Cache nigdy nie jest trafny → ciągłe przeliczanie buforów

### MEDIUM

**[M1]** `parseDt` / `opStatus` / `calcBufferRatio` zduplikowane w `BufferTab.jsx` i `BufferZSTab.jsx` — poprawka w jednym miejscu nie idzie do drugiego

**[M2]** Brak detekcji cyklu w grafie operacji — wynik cicho błędny

**[M3]** Brak obsługi braku routingu — ZP ignorowane bez komunikatu w UI

**[M4]** Progi TOC (`0.5`, `0.8`, `1.0`) hardcoded w 3+ miejscach — niespójne między zakładkami

**[M5]** Progi obciążenia (`85%`, `100%`, `130%`) hardcoded w `BottleneckTab`, `HeatmapTab`, `DashboardTab` — `HeatmapTab` dodaje próg `110%` nieobecny w pozostałych

**[M6]** `fmtDt` reimplementowane lokalnie w `analysisUtils.js` mimo eksportu z `scheduler.js`

**[M7]** `volume_actual = Math.min(...)` — prawdopodobny błąd logiczny nieudokumentowany

**[M8]** `parseZPFromERP` i `parseZpStatus` blokują main thread przy dużych importach

### LOW

**[L1]** `DAY_NAMES` wklejone do `EmptyState.jsx` — martwa stała w złym pliku

**[L2]** Komentarz o `Bar.jsx` w `Dot.jsx` — aktywnie wprowadza w błąd

**[L3]** `NavMenu` zdefiniowany w `App.jsx` zamiast w `components/`

**[L4]** Zero PropTypes lub JSDoc — 15 zakładek z 5–13 propsami bez dokumentacji kontraktu

**[L5]** `subZP` vs `fwdZP` — niespójne nazewnictwo bez dokumentacji rozróżnienia

---

## 5. JAKOŚĆ KODU

### 5.1 Duplikaty kodu

`BufferTab.jsx` ↔ `BufferZSTab.jsx` — ~150 linii skopiowanych 1:1:
- `parseDt(str)`, `opStatus(op, now)`, `calcBufferRatio(ops, now)`, `zoneOrder(zone)`
- Komponenty `StatusBadge`, `RatioBar` (jedyna różnica: `height: 8` vs `height: 6`)

`LateZSTab.jsx` i `DashboardTab.jsx` — obydwa reimplementują `tocZone()`. DashboardTab definiuje lokalny helper, LateZSTab używa `toc.zone === 'black'` wprost.

`avg()`, `sum()`, `stdDev()`, `isoWeek()` w `analysisUtils.js` — prywatne, prawdopodobnie duplikują utility z `scheduler.js`. Brak wspólnego `mathUtils.js`.

### 5.2 Martwy kod

- `EmptyState.jsx` — `const DAY_NAMES = [...]` na końcu pliku, niezeksportowane, nieużywane
- `Dot.jsx` — komentarz opisujący zmianę w `Bar.jsx`, wklejony do złego pliku
- `GanttTab.jsx:228` — `setPanY(0)` wywołuje nieistniejący setter (jednocześnie bug i martwy kod)

### 5.3 Niespójności

**Nazewnictwo:**

| Plik | Konwencja | Przykład |
|---|---|---|
| `analysisUtils.js` | `camelCase` | `calcWaitTimes`, `enrichWithStandards` |
| `scheduler.js` | mix | `tocBuffer`, `dlCSV`, `erpZpToSchedulerInput` |
| `App.jsx` | mix | `erpZp`, `subZP`, `fwdZP`, `wcSchedule` |

**Separator CSV** — wykrywanie heurystyczne (`lines[0].includes(';') ? ';' : ','`) rozproszone w co najmniej dwóch miejscach.

**Formatowanie dat** — `fmtDt` zdefiniowane lokalnie w `exportZpStatusCsv` mimo identycznej funkcji eksportowanej z `scheduler.js`.

**Props slave Gantt** — `GrafikTab` przyjmuje 4 osobne propsy (`slavePanX`, `slaveScaleIdx`, `slaveHourW`, `slaveScrollY`) zamiast jednego obiektu `slaveView`.

### 5.4 Magic numbers i hardcoded values

```js
// analysisUtils.js
if (actual_ct_min < 0.1 || actual_ct_min > 72 * 60) // skąd 72h?
const wcLoad = Math.min(100, wcLoadMap[r.workcenter] ?? 50); // dlaczego 50%?
const stability = cv_pct < 10 ? 'stable' : cv_pct < 25 ? 'moderate' : 'unstable'; // skąd 10/25?

// 3 różne miejsca tych samych progów:
zone: ratio < 0.5 ? 'green' : ratio < 0.8 ? 'yellow' : ratio < 1.0 ? 'red' : 'black'
// BottleneckTab: 85%, 100%, 130%
// HeatmapTab: 85%, 100%, 110%, 130% (dodatkowy próg)
// DashboardTab: 85%, 100%
```

Potrzebny: `constants/thresholds.js`.

### 5.5 Komentarze vs rzeczywistość

```js
// analysisUtils.js
// Zastępuje parseHistory + sanitizeHistoryData
```
Jeśli `parseHistory` i `sanitizeHistoryData` nadal gdzieś istnieją — komentarz jest niebezpiecznie mylący.

```js
// calcCapacityLoss
// capacity_loss_h = (wait_min / 60) × (wcLoad / 100)
```
Komentarz pomija `Math.min(100, ...)` i fallback `?? 50` — kluczowe szczegóły wpływające na wynik.

### 5.6 Brakujące PropTypes / JSDoc

Zero. Żaden komponent ani funkcja nie ma PropTypes ani JSDoc. `GanttTab` przyjmuje 13 propsów bez żadnej dokumentacji który jest opcjonalny.

### 5.7 Ranking najgorszych plików

| Miejsce | Plik | Powód |
|---|---|---|
| 1 | `BufferZSTab.jsx` | ~150 linii skopiowanych z BufferTab, zero wydzielenia |
| 2 | `BufferTab.jsx` | Źródło duplikatów, progi TOC hardcoded, `Math.min` dla wolumenu |
| 3 | `analysisUtils.js` | `fmtDt` reimplementowane, `volume_actual = Math.min(...)` błąd logiczny, stale opisane komentarzami kłamiącymi |
| 4 | `App.jsx` | 517-liniowy monolith bez Context/store |
| 5 | `EmptyState.jsx` | `DAY_NAMES` z obcego modułu — symptom braku code review |

**Najczystsze pliki:** `Bar.jsx`, `KpiCard.jsx`, `DatePicker.jsx` — małe, jednocelowe.

---

## 6. NASTĘPNE KROKI

### Backlog priorytetowy

| Priorytet | Zadanie | Effort | Impact | Pliki |
|---|---|---|---|---|
| 🔴 P0 | Naprawić `setPanY(0)` — crash Gantt | 30 min | CRITICAL | `GanttTab.jsx:228` |
| 🔴 P0 | Race condition Worker — dodać sequence ID + cleanup | 2h | CRITICAL | `App.jsx` |
| 🔴 P0 | Naprawić `delayDays = delayH / 16` → `/DEFAULT_CAP` | 30 min | CRITICAL | `scheduler.js:~462` |
| 🔴 P0 | Guard `backScheduleOp` — grafik z 0h wszystkich dni | 1h | CRITICAL | `scheduler.js` |
| 🟠 P1 | `useMemo` na `zpStatusToHistoryFormat`, `calcZpHeaderStatus`, `calcHybridZpStatus` | 1h | 20 ms/klik | `App.jsx` |
| 🟠 P1 | `useMemo` na `loadsCache` w HeatmapTab | 30 min | ~50 ms/render | `HeatmapTab.jsx` |
| 🟠 P1 | GanttTab pan — ref-based zamiast setState per mousemove | 2h | 20fps → 60fps | `GanttTab.jsx` |
| 🟠 P1 | `exportZpStatusCsv` — zbudować `Map` przed pętlą | 30 min | ~200 ms export | `analysisUtils.js` |
| 🟠 P1 | `BufferTab` / `BufferZSTab` — wydzielić do `utils/bufferUtils.js` | 3h | eliminacja 150 linii duplikatów | `BufferTab.jsx`, `BufferZSTab.jsx` |
| 🟠 P1 | Naprawić sortowanie ZP — `localeCompare` na DD.MM.YYYY | 1h | HIGH — błędna kolejność planu | `scheduler.js:~401` |
| 🟡 P2 | `constants/thresholds.js` — wyciągnąć progi TOC i obciążeń | 2h | 3 źródła → 1 | `BottleneckTab`, `HeatmapTab`, `DashboardTab`, `BufferTab` |
| 🟡 P2 | Przenieść `parseZpStatus` i `parseZPFromERP` do workera | 4h | 100 ms blokady → 0 | `analysisUtils.js`, `scheduler.worker.js` |
| 🟡 P2 | Dodać ostrzeżenie w UI gdy ZP nie ma routingu | 1h | UX — ciche pomijanie → komunikat | `scheduler.js` |
| 🟡 P2 | Naprawić `volume_actual = Math.min(...)` → `max` lub pierwsza operacja | 30 min | HIGH — błąd logiczny | `analysisUtils.js` |
| 🟡 P2 | optimizer.py — log FEASIBLE vs OPTIMAL + `ObjectiveBound()` | 1h | jakość rozwiązania | `backend/core/optimizer.py` |
| 🟡 P2 | optimizer.py — naprawić `count_tardy` (max_h per WC, nie globalny) | 2h | HIGH — błędne liczenie opóźnień | `backend/core/optimizer.py` |
| 🔵 P3 | Wyciągnąć `NavMenu` z `App.jsx` do `components/layout/` | 2h | architektura | `App.jsx:61–128` |
| 🔵 P3 | Usunąć lokalną kopię `KpiCard` z `DashboardTab.jsx` | 30 min | eliminacja dywergencji | `DashboardTab.jsx` |
| 🔵 P3 | `fmtDt` — używać eksportu z `scheduler.js` zamiast lokalnej kopii | 30 min | DRY | `analysisUtils.js` |
| 🔵 P3 | Dodać `React.memo` do `NavMenu`, `GrafikTab` | 1h | eliminacja zbędnych re-renderów | |
| 🔵 P3 | Wyciągnąć sekcje `AnalysisTab` do osobnych plików | 8h | 1100 linii → 5 plików po ~200 | `AnalysisTab.jsx` |
| 🔵 P3 | PropTypes lub migracja do TypeScript | 2–40h | bezpieczeństwo refaktoryzacji | wszystkie komponenty |
| ⚪ P4 | Integracja frontend ↔ backend `/optimize` endpoint | 2–4 dni | uruchomienie CP-SAT solvera | `App.jsx`, `backend/main.py` |
| ⚪ P4 | Zustand / Context — wyciągnąć stan z App.jsx | 3–5 dni | eliminacja prop drilling | `App.jsx`, wszystkie zakładki |

---

## EXECUTIVE SUMMARY

**Pilne (P0) — przed jakimkolwiek wdrożeniem produkcyjnym:** trzy krytyczne bugi powodują albo crash UI (`setPanY` w GanttTab), albo ciche fałszowanie wyników biznesowych (`delayDays / 16` → błędne OTIF), albo race condition przy szybkich kliknięciach "Przelicz" (brak sequence ID w Worker). Każdy z nich można naprawić w ciągu 30 minut–2 godzin.

**Ważne (P1) — w ciągu 1–2 sprintów:** memoizacja kosztownych transformacji w `App.jsx` i `HeatmapTab`, naprawienie sortowania ZP po terminie (format DD.MM.YYYY), ref-based pan w Gantt (20fps → 60fps), oraz wydzielenie zduplikowanych 150 linii z BufferTab. Te zmiany łącznie dają ~200 ms zysku per interakcję i eliminują największe duplikaty.

**Architektura (P3–P4):** brak Context/store i systematyczny prop drilling to dług techniczny, ale nie powoduje błędów — można adresować stopniowo. Integracja z backendem CP-SAT (solver jest napisany, endpoint jest placeholderem) to osobny projekt na 2–4 dni.

**Backend `optimizer.py`** jest kodem martwym z perspektywy użytkownika — frontend nigdy go nie wywołuje. Faza 1 z 5 CCR zajęłaby 33 minuty sekwencyjnie i wymagałaby parallelizacji przed jakimkolwiek wdrożeniem po stronie serwera.
