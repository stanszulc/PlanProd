# Pool godzin w brygadzie — maszyna (2xxxx) + gniazda (3xxxx)

Data: 2026-08-17. Status: **model ustalony, niezaimplementowany**.

---

## Problem

Obłożenie gniazd w heatmapie pokazywało dla mieszanej brygady (np. Gniazdo KTM/KTS: 1×
maszyna 2xxxx + 3× gniazdo 3xxxx) wartości typu 300% na jednym gnieździe i 0% na sąsiednim,
mimo że agregat brygady wychodził zdrowy (~90%). Objaw doprowadził do właściwego pytania:
**czy silnik faktycznie wykorzystuje dostępne godziny brygady optymalnie, czy je gubi przez
sztywny, równy podział na maszyny/gniazda?**

### Fakty wejściowe (potwierdzone przez użytkownika)

- Godziny dostępności brygady pochodzą z RCP (rejestracja czasu pracy) — to jedna, wspólna,
  realna pula osobogodzin, nie oddzielne budżety per zasób.
- Obciążenie (load) pochodzi z normatywów czynności (`ct_min`) — niezależne od tego, kto/co
  wykonuje pracę.
- `2xxxx` / `3xxxx` to tylko opis zasobu w ERP, nie osobne pule godzin. Realna różnica:
  - **2xxxx (maszyna)** — obsługiwana przez **jednego operatora naraz**, twardy sufit
    **24h/dobę** (wynika z czasu kalendarzowego × 1 stanowisko obsługi, nie z limitu
    technicznego samej maszyny — nie da się przyspieszyć dokładając ludzi).
  - **3xxxx (gniazdo montażowe)** — przyjmuje tyle osób ile przydzielisz, **bez** takiego
    sufitu (capacity = liczba_osób × zmiany × 8h, liniowo skalowalne).
- W rzeczywistości brygadzista **w ~95% przypadków najpierw obstawia maszynę** do jej
  sufitu, dopiero reszta ludzi idzie do montażu. Wyjątek (~5%) to nie osobna reguła — to
  po prostu sytuacja, gdy konkretne ZP na montażu jest pilniejsze (VIP / bliski termin) niż
  to, co akurat czeka na maszynę.

---

## Model ustalony

**Jedna wspólna pula godzin (RCP) na brygadę, konsumowana przez zasoby o różnej zdolności
absorpcji, z domyślnym priorytetem zasobu, przełamywalnym pilnością konkretnego ZP:**

1. Wszystkie zasoby brygady (2xxxx + 3xxxx) dzielą jedną pulę godzin, nie osobne, z góry
   ustalone udziały.
2. Gniazda 3xxxx: brak sufitu, konsumują pulę wg zwykłej kolejki ZP (priorytet/ATC/CR —
   jak dziś).
3. Maszyna 2xxxx: **domyślny priorytet** do puli, do swojego sufitu 24h/dobę.
4. Pilne ZP na montażu (VIP / bliski termin) może przebić domyślny priorytet maszyny —
   to naturalny efekt istniejącego rankingu ZP, nie nowa, osobna reguła.

Innymi słowy: priorytet **domyślny na poziomie zasobu**, a nie twarda, bezwyjątkowa reguła
"maszyna zawsze pierwsza" — i nie czysty ranking ZP bez uwzględnienia typu zasobu (bo to nie
zagwarantowałoby maszynie pierwszeństwa w tych 95% przypadków, gdyby akurat trafiły się mniej
urgentne ZP na maszynę niż na montaż).

---

## Zakres zmian do wdrożenia (frontend, JS — obecny silnik)

### 1. Statyczny podział — `frontend/src/utils/grafikGodzinImport.js`

Dziś `mergeGrafikGodzinIntoSchedule`/`buildWeeklyTemplateFromGrafik` dzielą godziny brygady
**równo po wszystkich maszynach**, bez rozróżnienia typu zasobu — maszyna 2xxxx dostaje taki
sam arytmetyczny udział jak każde gniazdo 3xxxx. To niespójne nawet ze statycznym,
przybliżonym modelem. Do naprawy: maszyna dostaje swoje realne, typowe zapotrzebowanie
(np. z liczby zmian × 8h, nie z równego podziału), reszta puli brygady (RCP minus
zapotrzebowanie maszyny) dzieli się na gniazda 3xxxx. Dotyczy warstwy fallback/szablonu
używanej zanim/gdy silnik faktycznie planuje.

### 2. Silnik — `frontend/src/utils/scheduler.worker.js`

Dziś `getPoolAvail`/`getOccKey` poolują **tylko** kody zaczynające się od "3", całkowicie
osobno od maszyny 2xxxx tej samej brygady (`if (!String(wc).startsWith('3')) return wc;`).
Do zmiany:
- Włączyć 2xxxx do tego samego `POOL_<brygada>` co jego gniazda 3xxxx.
- Dodać sufit per-zasób w ramach poola (24h dla maszyny, brak dla gniazd) — wymaga
  śledzenia zużycia per-zasób wewnątrz poola, nie tylko zbiorczo.
- Dać operacjom na maszynie domyślnie podniesiony priorytet w kolejce ZP tej brygady, tak
  żeby wygrywały z rutynowym montażem, ale przegrywały z realnie pilniejszym (VIP/termin)
  ZP na montażu.

---

## Warianty rozważone i odrzucone (dla kontekstu)

| Wariant | Opis | Czemu nie ten |
|---|---|---|
| Statyczny klucz (równy podział) | Podział godzin brygady z góry, silnik traktuje każde gniazdo jako niezależny limit | To jest dokładnie problem opisany na wstępie — klucz z góry nie może trafić w nierówny, zmienny rozkład obciążenia |
| Pełna optymalizacja (CP-SAT/LP) jako część silnika JS | Alokacja godzin jako zmienna decyzyjna w tym samym modelu co harmonogram | Inna klasa problemu niż obecny silnik zachłanny/kolejkowy — zbyt duża zmiana architektury na teraz (patrz opcja backend Python niżej) |
| Kalibracja iteracyjna | Statyczny podział + pętla ucząca się z wyniku poprzedniego przebiegu | Heurystyczne, nie gwarantuje zbieżności przy bardzo nierównym obciążeniu dzień-do-dnia — nasz przypadek |

---

## Opcja na przyszłość: backend Python (OR-Tools CP-SAT)

Repo ma już **działający, ale niepodłączony do frontendu** backend z solverem CP-SAT:

- `backend/cpsat_tardiness.py` (397 linii) — model weighted tardiness: terminy jako miękkie
  ograniczenia (kara za spóźnienie, nie hard constraint → nie ma INFEASIBLE przy przeciążeniu),
  wagi priorytetu (VIP ×5), `AddNoOverlap` dla maszyn 1:1, `AddCumulative` dla gniazd pool,
  pre-check obciążenia z ostrzeżeniem zamiast twardego błędu.
- `backend/core/optimizer.py` (433 linii), `backend/server.py` (773 linii), `backend/main.py`.

**Czego jeszcze nie robi ten backend:** jego "pool" to dziś capacity **pojedynczego**
gniazda (np. stanowisko z 3 osobami = capacity 3 równoległe zadania), **nie** wspólna pula
współdzielona między kilkoma różnymi gniazdami/maszynami tej samej brygady. Czyli nie
implementuje jeszcze crossresource poolingu, który mamy w JS silniku dla 3xxxx (`getPoolAvail`
sumujący sąsiadów) — a tym bardziej nie implementuje modelu z tej notatki (wspólna pula
2xxxx+3xxxx z sufitem per-zasób).

**Jak by to wyglądało w CP-SAT (szkic, nie specyfikacja):**
- Jeden zasób `AddCumulative` per brygada per dzień, capacity = pula RCP tego dnia,
  współdzielony przez wszystkie zadania na maszynie i na gniazdach tej brygady.
- Osobne ograniczenie górne na sumę godzin maszyny w danym dniu (≤ 24h) — dodatkowy,
  węższy `AddCumulative` albo liniowe ograniczenie na podzbiór zadań maszyny.
- Priorytet "maszyna domyślnie pierwsza, ale ustępuje pilniejszemu ZP" **nie wymaga ręcznej
  reguły w CP-SAT** — wystarczy odpowiednio ustawić wagi w funkcji celu (tak jak już działa
  VIP ×5) i solver sam znajdzie globalnie najlepszy podział, zamiast zachłannie iterować
  jak w silniku JS.

**Plusy vs obecny silnik JS:** globalne, nie zachłanne rozwiązanie (widzi cały horyzont na
raz, nie tylko "co jest wolne teraz"); priorytet z wyjątkami wynika naturalnie z funkcji celu,
nie z ręcznie zakodowanej reguły tie-breaka; już ma infrastrukturę dla miękkich terminów i
poola per gniazdo, więc rozszerzenie na cross-resource pool jest ewolucją, nie zaczynaniem
od zera.

**Minusy / koszt:** backend nie jest dziś wołany przez frontend (App.jsx komunikuje się
wyłącznie z `scheduler.worker.js`) — podłączenie wymaga nowej ścieżki komunikacji
frontend↔backend (dziś jej nie ma), dodatkowej infrastruktury (uruchomiony serwer Python
przy planowaniu), i czasu rozwiązania solvera (niepewny, zależny od rozmiaru problemu) vs
natychmiastowy wynik silnika JS w przeglądarce.

**Status:** potencjalny kierunek docelowy, jeśli greedy podejście w JS zacznie nie
wystarczać (np. gdy reguł priorytetu/wyjątków przybędzie i zachłanna logika stanie się
trudna do utrzymania) — nie blokuje wdrożenia modelu z tej notatki w obecnym silniku JS.
