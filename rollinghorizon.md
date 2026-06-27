# Rolling Horizon Scheduler — Specyfikacja

## Kontekst

Obecny scheduler (`scheduleAll` w `scheduler.worker.js`) sortuje ZP **raz** na początku
wg Critical Ratio i planuje po kolei. Nie uwzględnia że pilność zmienia się każdego dnia
— ZP które dziś ma slack=2 dni, jutro ma slack=1 dzień i powinno wyprzedzić inne.

---

## Cel

Scheduler który planuje **dzień po dniu**, każdego dnia re-sortując co wchodzi na maszynę
wg aktualnej pilności z perspektywy tego dnia.

---

## Definicje kategorii pilności (per gniazdo × dzień)

| Kategoria | Kolor | Warunek |
|-----------|-------|---------|
| VIP       | 🔴    | `priority === 1` — stałe, nie zmienia się |
| Pilne     | 🟠    | `slack ≤ urgencyThresholdDays` (konfigurowalne, domyślnie 2) |
| Normalne  | 🟡    | `slack > urgencyThresholdDays` |
| Zaległe   | ⚫    | `realEnd > due_date` — już po terminie |

Gdzie `slack = due_date - currentPlanningDay` w dniach kalendarzowych.

---

## Algorytm: Rolling Horizon

### Wejście
```
zpList          — lista ZP z due_date, priority, operacjami
routingByProduct — routing per produkt
wcSchedule      — capacity per maszyna per dzień
planStart       — data startowa
urgencyThresholdDays — próg pilności (default: 2)
```

### Struktury danych
```
remainingOps[zp_id] = [
  { op, durRemH, predecessorsDone }
]
// durRemH = ile godzin zostało do wykonania tej operacji
// Na start: durRemH = op._durH

occupancy[wc][date] = h_zajęte
// ile godzin już zajęte na maszynie w danym dniu

result[] = segmenty zaplanowanych operacji (jak teraz)
```

### Pętla główna

```
dla każdego dnia D od planStart do endDate:
  dla każdego gniazda WC:
    availH = wcSchedule[WC][D]
    jeśli availH === 0: pomiń (weekend / brak zmiany)
    
    // 1. Zbierz kandydatów — operacje które MOGĄ wejść na WC w dniu D
    kandydaci = remainingOps
      .filter(op => op.workcenter === WC)
      .filter(op => poprzednia operacja tego ZP jest skończona przed D)
      .filter(op => durRemH > 0)
    
    // 2. Posortuj wg pilności z perspektywy dnia D
    kandydaci.sort(wg priorytetu dnia D):
      1. WIP (operacja już zaczęta, durRemH < durH) — zawsze pierwszy
      2. VIP (priority === 1)
      3. Pilne (due_date - D ≤ urgencyThresholdDays)
      4. Normalne (due_date - D > urgencyThresholdDays)
      // W ramach każdej kategorii: sortuj wg due_date ASC (wcześniejszy termin → wyżej)
    
    // 3. Przydziel godziny zachłannie
    pozostałeH = availH
    dla każdego kandydata wg kolejności:
      take = min(kandydat.durRemH, pozostałeH)
      zaplanuj segment: { wc: WC, date: D, startH: ..., durH: take }
      kandydat.durRemH -= take
      pozostałeH -= take
      jeśli pozostałeH === 0: break
      
      // jeśli kandydat.durRemH === 0: operacja skończona
      // odblokuj następną operację tego ZP (predecessors)
```

### Wyznaczenie realEnd per ZP

Po zakończeniu pętli:
```
dla każdego ZP:
  realEnd = max(segEnd) wszystkich segmentów tego ZP
  late = realEnd > due_date
  delayH = max(0, realEnd - due_date) / MS
  delayDays = delayH / 8
```

---

## Nowy widok: Heatmapa dzienna z kategoriami

### Format danych wyjściowych (nowy)

Oprócz obecnego `fwdZP` (segmenty), scheduler zwraca też:

```
dailyLoad[wc][date] = {
  vip:     h,  // godziny operacji VIP zaplanowane na ten dzień
  urgent:  h,  // godziny operacji Pilnych
  normal:  h,  // godziny operacji Normalnych
  overdue: h,  // godziny operacji Zaległych (realEnd już przekroczone)
  total:   h,  // suma
  avail:   h,  // wcSchedule[wc][date]
}
```

### Widok tabeli

```
Gniazdo  | Cap | 22.06 Pon           | 23.06 Wt            | ...
---------|-----|---------------------|---------------------|
iSWAY    | 8h  | 🔴2h 🟠4h 🟡2h ⚫0h | 🔴0h 🟠6h 🟡0h ⚫2h | ...
Kanały   | 16h | 🔴0h 🟠8h 🟡8h ⚫0h | 🔴0h 🟠6h 🟡4h ⚫6h | ...
```

Suma kategorii > cap → nadmiar widoczny jako overflow (czerwone tło komórki).

### Pasek podsumowania (nad tabelą)

```
📦 842 ZP  |  🔴 VIP: 12  |  ⚫ Spóźnione: 127 → [po przeliczeniu: 89]  |  ⌀ opóźnienie: 3.2 dni
```

Strzałka `→` pokazuje delta przed/po zmianie capacity (scenariusz).

---

## Konfiguracja (SettingsTab)

```
urgencyThresholdDays: 2   // ZP z slack ≤ 2 dni → kategoria "Pilne"
```

---

## Implementacja — pliki do zmiany

| Plik | Zmiana |
|------|--------|
| `scheduler.worker.js` | Nowa funkcja `scheduleRolling()` obok `scheduleAll()` — przełącznik w config |
| `App.jsx` | Przekaż `config.schedulerMode: 'rolling' \| 'forward'` do workera |
| `HeatmapPlanTab.jsx` | Nowy panel z `dailyLoad` zamiast obecnej heatmapy % |
| `SettingsTab.jsx` | Dodaj `urgencyThresholdDays` i `schedulerMode` |

---

## Kolejność implementacji

1. `scheduleRolling()` w workerze — tylko logika, bez UI
2. Testy matematyczne: czy WIP zostaje, czy pilne wyprzedzają normalne
3. `dailyLoad` struktura danych z workera
4. Nowy widok w `HeatmapPlanTab`
5. Pasek podsumowania przed/po
6. `SettingsTab` — konfiguracja progu pilności

---

## Otwarte pytania

- Czy WIP może być przerwany (podzielony między dni)? → zakładamy TAK (obecny scheduler też dzieli)
- Slack w dniach kalendarzowych czy roboczych? → TBD
- Czy `urgencyThresholdDays` jest globalny czy per brygada? → globalny na start
- Scenariusz "przed/po" — czy zapisywać snapshot wyników przed zmianą capacity? → TBD
