# PlanProd — FlowOps Capacity Planning Tool

Narzędzie do **planowania produkcji i harmonogramowania zdolności** dla środowisk manufakturowych. Optymalizuje przydział pracy na stanowiska robocze, minimalizuje nadgodziny i śledzi realizację zleceń produkcyjnych.

Demo: [stanszulc.github.io/PlanProd/](https://stanszulc.github.io/PlanProd/)

---

## Stack technologiczny

| Warstwa | Technologie |
|---------|------------|
| Frontend | React 19.2 + Vite, JavaScript, CSS |
| Wizualizacja | Własne komponenty SVG/D3 (Gantt, Sankey, Heatmapy) |
| Backend | FastAPI (Python) + OR-Tools CP-SAT |
| Deploy | GitHub Pages |

---

## Struktura projektu

```
PlanProd/
├── frontend/
│   └── src/
│       ├── App.jsx               # Główny router + kontener stanu
│       ├── components/
│       │   ├── common/           # Atomy UI (Bar, KpiCard, Dot...)
│       │   └── tabs/             # 15 zakładek funkcjonalnych
│       ├── utils/
│       │   ├── scheduler.js      # Silnik symulacji harmonogramu
│       │   └── analysisUtils.js  # KPI, OTIF, analiza strat zdolności
│       └── constants/
│           ├── theme.js          # Paleta ciemnego motywu, kolory statusów
│           └── demoData.js       # Przykładowe dane CSV
│
└── backend/
    ├── main.py                   # FastAPI (health, /optimize endpoint)
    └── core/
        └── optimizer.py          # Solver CP-SAT — dwufazowa optymalizacja
```

---

## Jak działa

### 1. Import danych

Użytkownik wczytuje przez zakładkę **Import** dwa pliki CSV:

- **Routing** — Produkt → Operacje → Stanowiska (czasy cyklu, kolejność, warunki poprzedności)
- **ZP (Zamówienia produkcji)** — ID, produkt, ilość, termin realizacji, priorytet

### 2. Symulacja frontendowa

`scheduler.js` przelicza lokalnie (bez backendu):

- Obciążenia stanowisk na 30-dniowym horyzoncie
- Timeline dla wykresu Gantta
- Obliczenia buforów TOC (Theory of Constraints)

### 3. Optymalizacja backendu

`optimizer.py` — dwufazowy solver OR-Tools CP-SAT:

- **Faza 1** — Testuje stałe warianty zmian (8h/10h/12h) → wybiera Top 3 harmonogramów
- **Faza 2** — Zachłanna optymalizacja dzień-po-dniu na CCR (zasobie krytycznym) → minimalizuje nadgodziny (**-89% OT** vs baseline)

### 4. Wizualizacja — 15 zakładek

| Zakładka | Funkcja |
|----------|---------|
| Dashboard | KPI, alerty, przegląd zdolności produkcyjnych |
| Harmonogram | Siatka planowania + symulacja |
| Gantt | Wykres Gantta zleceń produkcyjnych |
| Wąskie Gardła | Identyfikacja bottlenecków |
| Heatmapa Obciążeń | Obciążenie stanowisk × dzień |
| Swimlane | Zdolności per stanowisko |
| Przepływ (Sankey) | Wizualizacja przepływu materiału |
| Routing | Edytor struktury routingu |
| Raport OTIF | Realizacja vs plan (On-Time In-Full) |
| Bufor TOC | Zarządzanie buforami — widok dyspozytora |
| Bufor ZS | Widok dla handlowca |
| Spóźnione ZS | Śledzenie opóźnionych zleceń |
| Analiza Procesu | Historyczne metryki, Pareto, box ploty |
| Import / Eksport | Ładowanie i zapis CSV |

---

## Uruchomienie lokalne

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Aplikacja dostępna pod `http://localhost:5173`.

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

API dostępne pod `http://localhost:8000`.

---

## Stan projektu

- Frontend wdrożony na GitHub Pages
- Backend (`/optimize`) — solver CP-SAT gotowy w `optimizer.py`, integracja REST frontend↔backend do dokończenia
- Aktualnie obliczenia harmonogramu wykonują się po stronie frontendu (`scheduler.js`)

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
