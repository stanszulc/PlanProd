# PlanProd — FlowOps Capacity Planning Tool

Narzędzie do **planowania produkcji i harmonogramowania zdolności** dla środowisk manufakturowych. Optymalizuje przydział pracy na stanowiska robocze, minimalizuje nadgodziny i śledzi realizację zleceń produkcyjnych.

Demo: [stanszulc.github.io/PlanProd/](https://stanszulc.github.io/PlanProd/)

---

## Stack technologiczny

| Warstwa | Technologie |
|---------|------------|
| Frontend | React 19.2 + Vite, JavaScript, CSS |
| Silnik harmonogramowania | Web Worker (`scheduler.worker.js`) — cała symulacja liczy się w tle, bez blokowania UI |
| Wizualizacja | Własne komponenty SVG (Gantt, Sankey, macierz przepływów, heatmapy) |
| Backend | FastAPI (Python) + OR-Tools CP-SAT — eksperymentalny, patrz [Stan projektu](#stan-projektu) |
| Deploy | GitHub Pages |

---

## Struktura projektu

```
PlanProd/
├── frontend/
│   └── src/
│       ├── App.jsx                    # Główny router + kontener stanu
│       ├── components/
│       │   ├── common/                # Atomy UI (Bar, KpiCard, Dot...)
│       │   └── tabs/                  # zakładki funkcjonalne
│       ├── utils/
│       │   ├── scheduler.js           # Parsery ERP + adaptery wejścia dla workera, getAvail, computeLoads
│       │   ├── scheduler.worker.js    # Żywy silnik harmonogramowania (patrz niżej)
│       │   └── analysisUtils.js       # KPI, OTIF, analiza strat zdolności
│       └── constants/
│           ├── theme.js               # Paleta ciemnego motywu, kolory statusów
│           └── demoData.js            # Przykładowe dane ERP + lista maszyn równoległych
│
└── backend/
    ├── server.py                      # Serwer FastAPI (greedy / SA / CP-SAT), używany z zakładki Diagnostyka
    ├── cpsat_tardiness.py             # Solver CP-SAT minimalizujący opóźnienia (okna dostępności, predecessors)
    └── tests/                         # Testy pytest (API i solver)
```

---

## Jak działa

### 1. Import danych

Przez zakładkę **Import / Eksport** wczytuje się:

- **Eksport ZP z ERP** (TSV) — jeden wiersz na operację: numer ZP, klient, termin, kod i nazwa produktu, numer operacji, kod maszyny/gniazda, planowany i pozostały czas. Routing technologiczny wynika bezpośrednio z tych wierszy — nie ma osobnego pliku routingu.
- **zp_status.csv** — status realizacji (CNF/WIP/PLAN), daty rzeczywiste, ilości — do trybu REALIZACJA i raportu OTIF.
- **Maszyny równoległe** — osobna, krótka lista kodów maszyn, które zawsze działają niezależnie od reszty trasy (patrz [Maszyny równoległe](#maszyny-równoległe-fan-outfan-in)).

### 2. Silnik harmonogramowania (frontend)

#### W skrócie

Każde zlecenie produkcyjne (ZP) to ciąg operacji, z których każda potrzebuje konkretnej maszyny na jakiś czas. Silnik działa jak inteligentna kolejka: w każdym kroku wybiera operację, która **teraz** jest najpilniejsza (licząc priorytet, termin i ile pracy jeszcze zostało), wstawia ją w najbliższe wolne okno na jej maszynie, po czym przelicza pilność na nowo i powtarza — dzięki temu zlecenie, które traci zapas czasu, może "wyprzedzić w kolejce" inne, mniej pilne. Całość liczy się w tle (Web Worker), więc interfejs się nie zawiesza.

#### Trochę dokładniej

`scheduleAll()` w `scheduler.worker.js` to **dynamiczny dyspozytor oparty o kopiec (MinHeap)**, nie jedno sortowanie na starcie:

1. Każde ZP dostaje "stan": wskaźnik na aktualną operację i kursor czasu (start = `planStart` w trybie **ASAP**, albo wyliczony najpóźniejszy bezpieczny start w trybie **ALAP**).
2. Kopiec wyciąga zawsze ZP o **najniższej wartości pilności**, planuje mu **tylko jedną, najbliższą operację** (szuka pierwszego wolnego okna na danym gnieździe), przesuwa jego kursor i wrzuca z powrotem do kopca — z pilnością przeliczoną na nowo dla nowego czasu.
3. Pilność liczona jest jedną z czterech wybieralnych metod (zakładka Ustawienia):
   - **ATC — Apparent Tardiness Cost** (domyślna): `-(w/p) · exp(-slack / (K · średni_czas_ZP))`, gdzie `w`=waga priorytetu, `p`=czas trwania ZP, `slack`=zapas czasu. Im mniejszy zapas, tym mocniej rośnie pilność.
   - **Critical Ratio** — `pozostały_czas_do_terminu / pozostała_praca`.
   - **Due date** — czysto FIFO po terminie.
   - **Slack** — bezwzględny zapas czasu w milisekundach.
4. Klienci VIP (`priority = 1`) dostają efektywnie wcześniejszy termin (`due_date − vipBufferDays`), więc wyglądają na pilniejszych, zanim realnie zaczną się spóźniać.
5. Zasoby dzielą się na dwa typy po kodzie: **maszyny** (`2xxxx`) — zasób ekskluzywny, zajętość liczona co do minuty; **stanowiska/brygady** (`3xxxx`) — zasób pulowany, dzienna zdolność to suma wszystkich maszyn danej brygady, współdzielona przez wiele ZP naraz.

#### Maszyny równoległe (fan-out/fan-in)

Domyślnie operacje jednego ZP idą ściśle jedna-po-drugiej. Jeśli skonfigurujesz listę "maszyn równoległych" (Import / Eksport), operacje na tych maszynach — **o ile faktycznie są na samym początku trasy** — startują niezależnie od siebie (np. dwie różne piły tnące różne elementy), a pierwsza kolejna operacja czeka, aż **wszystkie** się skończą (fan-in), zamiast na nie czekać po kolei. Tryb przełącza się w Ustawieniach (`Graph` — zalecany, domyślny / `Legacy` — dawne, ściśle sekwencyjne zachowanie, zawsze dostępne jako powrót).

### 3. Backend CP-SAT (eksperymentalny, niepodłączony do głównego flow)

`backend/server.py` + `backend/cpsat_tardiness.py` implementują dodatkowe solvery (greedy, symulowane wyżarzanie, CP-SAT minimalizujący sumę opóźnień) — wywoływane wyłącznie z zakładki **Diagnostyka harmonogramu**, jako alternatywa do porównania z wynikiem silnika frontendowego. Wymaga ręcznego uruchomienia (`python server.py`) i działania pod `localhost:8765`. Solver CP-SAT uwzględnia okna dostępności maszyn, `predecessors` z transferem między gniazdami i przybliżony model puli gniazd 3xxxx; greedy i SA to uproszczenia i oznaczają to w polu `warnings`.

### 4. Wizualizacja — zakładki

| Zakładka | Funkcja |
|----------|---------|
| Dashboard | KPI, alerty, przegląd zdolności produkcyjnych |
| Harmonogram | Gantt + Grafik brygad + status ZP w jednym widoku |
| Wąskie gardła | Ranking brygad wg planu: wąskie gardło = brygada z największą nadwyżką godzin ponad dostępność (tryb „wg terminów" pokazuje prognozę popytu) |
| Heatmapa obciążeń | Obciążenie stanowisk wg terminów ZP |
| Heatmapa planu | Obciążenie stanowisk × dni wg rzeczywistego harmonogramu + grafik pracy brygad |
| Przepływy (macierz) | Macierz przepływów między gniazdami/brygadami, z klastrowaniem |
| Swimlane | Zdolności per stanowisko |
| Przepływ (Sankey) | Wizualizacja przepływu materiału między gniazdami |
| Routing | Wizualizacja struktury tras technologicznych (graf zależności operacji) |
| Raport OTIF | Realizacja vs plan (On-Time In-Full) |
| Bufor TOC | Zarządzanie buforami — widok dyspozytora |
| Bufor ZS | Widok dla handlowca |
| Spóźnione ZS | Śledzenie opóźnionych zleceń |
| Analiza Procesu | Historyczne metryki, Pareto, box ploty |
| Import / Eksport | Ładowanie i zapis CSV/TSV |
| Diagnostyka harmonogramu | Porównanie silnika frontendowego z solverami backendu |
| Ustawienia planowania | Parametry silnika, capacity maszyn, tryb harmonogramowania |

---

## Uruchomienie lokalne

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Aplikacja dostępna pod `http://localhost:5173`.

Testy i lint frontendu: `npm test` oraz `npm run lint`. `npm run deploy` uruchamia lint, testy i build przed publikacją na GitHub Pages.

### Backend (opcjonalnie, tylko do zakładki Diagnostyka harmonogramu)

```bash
cd backend
pip install -r requirements.txt
python server.py
```

API dostępne pod `http://localhost:8765`. Dozwolone originy (CORS) ustawia zmienna `PLANPROD_CORS_ORIGINS` (lista po przecinku; domyślnie `localhost`/`127.0.0.1` na portach 5173, 5174, 3000). Błędy zwracają kody HTTP 400/422/500 z opisem w polu `detail`.

Testy backendu:

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest tests -q
```

---

## Stan projektu

- Frontend wdrożony na GitHub Pages, cała symulacja harmonogramu liczy się lokalnie w przeglądarce (`scheduler.worker.js`).
- Backend (`server.py` + `cpsat_tardiness.py`) działa i jest wywoływany z zakładki Diagnostyka — ale wyłącznie do porównawczego podglądu, nie zasila głównego flow planowania.
- Martwy kod z poprzednich wersji (`backSchedule`/`forwardSchedule`, `GrafikTab`, `backend/main.py`, `core/optimizer.py`, stary prototyp `FF05.html`) został usunięty — pozostaje w historii gita.
- Dni opóźnienia liczone są przy założeniu dnia roboczego 16 h (`constants/schedule.js`, w backendzie `DEFAULT_H`).

---

## Słownik

| Skrót | Znaczenie |
|-------|-----------|
| ZP | Zamówienie Produkcji |
| ZS | Zainteresowanie Sprzedaży |
| TOC | Theory of Constraints |
| OTIF | On-Time In-Full |
| CCR | Capacity Constrained Resource (zasób krytyczny) |
| OT | Overtime (nadgodziny) |
| ATC | Apparent Tardiness Cost — metoda liczenia pilności ZP |
| ASAP / ALAP | As Soon/Late As Possible — tryb startu harmonogramu |
| Fan-out / fan-in | Rozgałęzienie operacji na niezależne równoległe ścieżki / zbiegnięcie ich w jednej kolejnej operacji |
