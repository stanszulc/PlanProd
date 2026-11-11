// Długość dnia roboczego w godzinach — JEDNA wartość dla przeliczania godzin
// opóźnienia na „dni opóźnienia" w całej aplikacji (silnik, Plan, Dashboard,
// Spóźnione ZS, Realizacja). Fabryka pracuje w ok. 80% na dwie zmiany = 16 h.
//
// To założenie uproszczone: maszyny (2xxxx) mają sztywny sufit 24 h/dobę, a gniazda
// (3xxxx) nie mają limitu (można dodawać ludzi), więc realna dostępność zależy od
// brygady i dnia. Backend ma tę samą wartość jako DEFAULT_H = 16 (server.py,
// cpsat_tardiness.py) — przy zmianie tutaj zmień też tam.
export const WORK_DAY_H = 16;
