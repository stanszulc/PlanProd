// ─── demoData.js ──────────────────────────────────────────────────────────────
// Oryginalne dane demo + DEMO_SCHEDULE (grafik maszyn) + DEMO_BRIGADE_MAP
// Brygada = spinacz maszyn. Dostępność brygady = suma dostępności jej maszyn.
// ─────────────────────────────────────────────────────────────────────────────
export const DEMO_ROUTING = `product,operation,workcenter,ct_min,sequence,capacity_h,predecessors
P-KOD-100-100,Wycinanie laserowe podstawy,G-01,3.0,1,8,
P-KOD-100-100,Gięcie profili podstawy,G-02,8.0,2,8,1
P-KOD-100-100,Spawanie narożników korpusu,G-03,6.0,3,8,
P-KOD-100-100,Izolacja PIR i montaż poliwęglanu,G-04,12.0,4,8,3
P-KOD-100-100,Montaż siłownika i testy KJ,G-05,15.0,5,8,2|4
P-TLU-KUL-01,Wycinanie paneli obudowy,G-01,5.0,1,8,
P-TLU-KUL-01,Gięcie obudowy zewnętrznej,G-02,4.0,2,8,
P-TLU-KUL-01,Spawanie i zgrzewanie obudowy,G-03,15.0,3,8,
P-TLU-KUL-01,Napełnianie kulis wełną,G-04,20.0,4,8,
P-TLU-KUL-01,Montaż końcowy i nitowanie,G-05,10.0,5,8,
P-SKR-ROZ-02,Wycinanie obudowy skrzynki,G-01,1.0,1,8,
P-SKR-ROZ-02,Gięcie skrzynki,G-02,2.0,2,8,
P-SKR-ROZ-02,Zgrzewanie liniowe korpusu,G-03,2.0,3,8,
P-SKR-ROZ-02,Wyklejanie matą kauczukową,G-04,5.0,4,8,
P-SKR-ROZ-02,Montaż króćców i przepustnicy,G-05,4.0,5,8,
P-KRA-MAS-03,Wycinanie ramki i lameli,G-01,0.4,1,8,
P-KRA-MAS-03,Gięcie ramki i profilowanie,G-02,0.6,2,8,
P-KRA-MAS-03,Montaż uszczelki i sprężynek,G-04,1.5,3,8,
P-KRA-MAS-03,Składanie żaluzji i nitowanie,G-05,3.0,4,8,`;

export const DEMO_ZP = `zp_id,product,volume,due_date,priority
ZP-001,P-KOD-100-100,30,2026-05-25,1
ZP-002,P-KRA-MAS-03,100,2026-05-25,4
ZP-003,P-SKR-ROZ-02,50,2026-05-25,3
ZP-004,P-TLU-KUL-01,25,2026-05-25,2
ZP-005,P-KOD-100-100,20,2026-05-26,1
ZP-006,P-KRA-MAS-03,150,2026-05-26,4
ZP-007,P-SKR-ROZ-02,60,2026-05-26,3
ZP-008,P-TLU-KUL-01,30,2026-05-26,2
ZP-009,P-KOD-100-100,40,2026-05-27,1
ZP-010,P-KRA-MAS-03,80,2026-05-27,4
ZP-011,P-SKR-ROZ-02,40,2026-05-27,3
ZP-012,P-TLU-KUL-01,20,2026-05-27,2`;

export const DEMO_ZS = `zs_id,pozycja,klient,product,volume,due_date,priority
ZS-001,1,Klima-Tech Sp. z o.o.,P-KOD-100-100,30,2026-05-25,1
ZS-002,1,VentPro S.A.,P-TLU-KUL-01,25,2026-05-25,2
ZS-003,1,AirSystem Kraków,P-SKR-ROZ-02,50,2026-05-25,3
ZS-004,1,HVAC Południe,P-KRA-MAS-03,100,2026-05-25,4
ZS-001,2,Klima-Tech Sp. z o.o.,P-KOD-100-100,20,2026-05-26,1
ZS-002,2,VentPro S.A.,P-TLU-KUL-01,30,2026-05-26,2
ZS-003,2,AirSystem Kraków,P-SKR-ROZ-02,60,2026-05-26,3
ZS-004,2,HVAC Południe,P-KRA-MAS-03,150,2026-05-26,4
ZS-001,3,Klima-Tech Sp. z o.o.,P-KOD-100-100,40,2026-05-27,1
ZS-002,3,VentPro S.A.,P-TLU-KUL-01,20,2026-05-27,2
ZS-003,3,AirSystem Kraków,P-SKR-ROZ-02,40,2026-05-27,3
ZS-004,3,HVAC Południe,P-KRA-MAS-03,80,2026-05-27,4
ZS-011,1,Klima-Tech Sp. z o.o.,P-KOD-100-100,30,2026-05-28,1`;

export const DEMO_HISTORY = `zp_id,product,workcenter,operation,start_ts,end_ts,reason_code,volume
ZP-H01,P-KOD-100-100,G-01,"Wycinanie laserowe podstawy",2026-05-01 07:00,2026-05-01 07:03,,10
ZP-H01,P-KOD-100-100,G-02,"Gięcie profili podstawy",2026-05-01 07:10,2026-05-01 07:30,PRZEZBROJENIE,10
ZP-H01,P-KOD-100-100,G-03,"Spawanie narożników korpusu",2026-05-01 08:27,2026-05-01 08:40,KONTROLA_KJ,10
ZP-H01,P-KOD-100-100,G-04,"Izolacja PIR i montaż poliwęglanu",2026-05-01 09:15,2026-05-01 09:29,,10
ZP-H01,P-KOD-100-100,G-05,"Montaż siłownika i testy KJ",2026-05-01 11:14,2026-05-01 11:31,,10
ZP-H02,P-TLU-KUL-01,G-01,"Wycinanie paneli obudowy",2026-05-03 09:00,2026-05-03 09:06,,8
ZP-H02,P-TLU-KUL-01,G-02,"Gięcie obudowy zewnętrznej",2026-05-03 09:31,2026-05-03 09:35,,8
ZP-H02,P-TLU-KUL-01,G-03,"Spawanie i zgrzewanie obudowy",2026-05-03 10:29,2026-05-03 10:57,KONTROLA_KJ,8
ZP-H02,P-TLU-KUL-01,G-04,"Napełnianie kulis wełną",2026-05-03 12:04,2026-05-03 13:05,,8
ZP-H02,P-TLU-KUL-01,G-05,"Montaż końcowy i nitowanie",2026-05-03 13:31,2026-05-03 13:50,BRAK_OPERATORA,8
ZP-H03,P-SKR-ROZ-02,G-01,"Wycinanie obudowy skrzynki",2026-04-30 07:00,2026-04-30 07:01,,20
ZP-H03,P-SKR-ROZ-02,G-02,"Gięcie skrzynki",2026-04-30 07:22,2026-04-30 07:26,,20
ZP-H03,P-SKR-ROZ-02,G-03,"Zgrzewanie liniowe korpusu",2026-04-30 08:34,2026-04-30 08:46,INNE,20
ZP-H03,P-SKR-ROZ-02,G-04,"Wyklejanie matą kauczukową",2026-04-30 10:09,2026-04-30 10:19,AWARIA,20
ZP-H03,P-SKR-ROZ-02,G-05,"Montaż króćców i przepustnicy",2026-04-30 11:37,2026-04-30 11:53,BRAK_OPERATORA,20
ZP-H04,P-KRA-MAS-03,G-01,"Wycinanie ramki i lameli",2026-05-15 07:00,2026-05-15 07:01,,50
ZP-H04,P-KRA-MAS-03,G-02,"Gięcie ramki i profilowanie",2026-05-15 07:36,2026-05-15 07:42,,50
ZP-H04,P-KRA-MAS-03,G-04,"Montaż uszczelki i sprężynek",2026-05-15 08:05,2026-05-15 08:32,BRAK_MATERIALU,50
ZP-H04,P-KRA-MAS-03,G-05,"Składanie żaluzji i nitowanie",2026-05-15 09:45,2026-05-15 10:02,,50
ZP-H05,P-KOD-100-100,G-01,"Wycinanie laserowe podstawy",2026-05-05 09:00,2026-05-05 09:05,,15
ZP-H05,P-KOD-100-100,G-02,"Gięcie profili podstawy",2026-05-05 09:32,2026-05-05 09:55,,15
ZP-H05,P-KOD-100-100,G-03,"Spawanie narożników korpusu",2026-05-05 10:48,2026-05-05 11:12,AWARIA,15
ZP-H05,P-KOD-100-100,G-04,"Izolacja PIR i montaż poliwęglanu",2026-05-05 11:19,2026-05-05 11:40,BRAK_MATERIALU,15
ZP-H05,P-KOD-100-100,G-05,"Montaż siłownika i testy KJ",2026-05-05 13:02,2026-05-05 13:56,,15
ZP-H06,P-SKR-ROZ-02,G-01,"Wycinanie obudowy skrzynki",2026-04-28 09:00,2026-04-28 09:04,,30
ZP-H06,P-SKR-ROZ-02,G-02,"Gięcie skrzynki",2026-04-28 10:31,2026-04-28 10:39,,30
ZP-H06,P-SKR-ROZ-02,G-03,"Zgrzewanie liniowe korpusu",2026-04-28 12:23,2026-04-28 12:33,,30
ZP-H06,P-SKR-ROZ-02,G-04,"Wyklejanie matą kauczukową",2026-04-28 13:18,2026-04-28 13:38,,30
ZP-H06,P-SKR-ROZ-02,G-05,"Montaż króćców i przepustnicy",2026-04-28 13:57,2026-04-28 14:16,BRAK_OPERATORA,30
ZP-H07,P-TLU-KUL-01,G-01,"Wycinanie paneli obudowy",2026-05-03 09:00,2026-05-03 09:15,,12
ZP-H07,P-TLU-KUL-01,G-02,"Gięcie obudowy zewnętrznej",2026-05-03 09:39,2026-05-03 09:44,,12
ZP-H07,P-TLU-KUL-01,G-03,"Spawanie i zgrzewanie obudowy",2026-05-03 10:37,2026-05-03 11:07,,12
ZP-H07,P-TLU-KUL-01,G-04,"Napełnianie kulis wełną",2026-05-03 11:47,2026-05-03 12:22,,12
ZP-H07,P-TLU-KUL-01,G-05,"Montaż końcowy i nitowanie",2026-05-03 12:52,2026-05-03 13:07,,12
ZP-H08,P-KRA-MAS-03,G-01,"Wycinanie ramki i lameli",2026-05-15 07:00,2026-05-15 07:02,,40
ZP-H08,P-KRA-MAS-03,G-02,"Gięcie ramki i profilowanie",2026-05-15 08:23,2026-05-15 08:28,,40
ZP-H08,P-KRA-MAS-03,G-04,"Montaż uszczelki i sprężynek",2026-05-15 09:57,2026-05-15 10:12,BRAK_MATERIALU,40
ZP-H08,P-KRA-MAS-03,G-05,"Składanie żaluzji i nitowanie",2026-05-15 10:56,2026-05-15 11:13,BRAK_OPERATORA,40
ZP-H09,P-KOD-100-100,G-01,"Wycinanie laserowe podstawy",2026-05-08 07:00,2026-05-08 07:03,,8
ZP-H09,P-KOD-100-100,G-02,"Gięcie profili podstawy",2026-05-08 07:56,2026-05-08 08:11,,8
ZP-H09,P-KOD-100-100,G-03,"Spawanie narożników korpusu",2026-05-08 09:05,2026-05-08 09:24,INNE,8
ZP-H09,P-KOD-100-100,G-04,"Izolacja PIR i montaż poliwęglanu",2026-05-08 10:45,2026-05-08 11:07,AWARIA,8
ZP-H09,P-KOD-100-100,G-05,"Montaż siłownika i testy KJ",2026-05-08 11:07,2026-05-08 11:28,,8
ZP-H10,P-TLU-KUL-01,G-01,"Wycinanie paneli obudowy",2026-05-01 09:00,2026-05-01 09:05,,6
ZP-H10,P-TLU-KUL-01,G-02,"Gięcie obudowy zewnętrznej",2026-05-01 10:03,2026-05-01 10:07,,6
ZP-H10,P-TLU-KUL-01,G-03,"Spawanie i zgrzewanie obudowy",2026-05-01 11:43,2026-05-01 12:03,AWARIA,6
ZP-H10,P-TLU-KUL-01,G-04,"Napełnianie kulis wełną",2026-05-01 12:27,2026-05-01 13:00,BRAK_MATERIALU,6
ZP-H10,P-TLU-KUL-01,G-05,"Montaż końcowy i nitowanie",2026-05-01 13:30,2026-05-01 13:45,,6
ZP-H11,P-SKR-ROZ-02,G-01,"Wycinanie obudowy skrzynki",2026-05-15 07:00,2026-05-15 07:06,,25
ZP-H11,P-SKR-ROZ-02,G-02,"Gięcie skrzynki",2026-05-15 08:02,2026-05-15 08:11,INNE,25
ZP-H11,P-SKR-ROZ-02,G-03,"Zgrzewanie liniowe korpusu",2026-05-15 09:25,2026-05-15 09:34,AWARIA,25
ZP-H11,P-SKR-ROZ-02,G-04,"Wyklejanie matą kauczukową",2026-05-15 10:14,2026-05-15 10:40,,25
ZP-H11,P-SKR-ROZ-02,G-05,"Montaż króćców i przepustnicy",2026-05-15 12:00,2026-05-15 12:07,,25
ZP-H12,P-KRA-MAS-03,G-01,"Wycinanie ramki i lameli",2026-05-15 09:00,2026-05-15 09:03,,60
ZP-H12,P-KRA-MAS-03,G-02,"Gięcie ramki i profilowanie",2026-05-15 09:03,2026-05-15 09:09,PRZEZBROJENIE,60
ZP-H12,P-KRA-MAS-03,G-04,"Montaż uszczelki i sprężynek",2026-05-15 09:36,2026-05-15 09:46,,60
ZP-H12,P-KRA-MAS-03,G-05,"Składanie żaluzji i nitowanie",2026-05-15 10:48,2026-05-15 12:00,KONTROLA_KJ,60`;

export const DEMO_ZP_STATUS = `zp_id,parent_zp,zs_id,pozycja,klient,product,operation,workcenter,sequence,volume_plan,volume_actual,status,need_date,planned_start,planned_end,actual_start,actual_end,priority,reason_code
ZP-001/01/01,ZP-001/01,ZS-001,1,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Wycinanie laserowe podstawy",G-01,1,30,30,CNF,2026-05-25,2026-05-22 07:00,2026-05-22 08:30,2026-05-22 06:57,2026-05-22 08:18,1,
ZP-001/01/02,ZP-001/01,ZS-001,1,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Gięcie profili podstawy",G-02,2,30,30,CNF,2026-05-25,2026-05-22 09:25,2026-05-22 13:25,2026-05-22 09:23,2026-05-22 14:09,1,
ZP-001/01/03,ZP-001/01,ZS-001,1,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Spawanie narożników korpusu",G-03,3,30,30,CNF,2026-05-25,2026-05-22 13:54,2026-05-22 16:54,2026-05-22 13:49,2026-05-22 17:13,1,AWARIA
ZP-001/01/04,ZP-001/01,ZS-001,1,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Izolacja PIR i montaż poliwęglanu",G-04,4,30,30,CNF,2026-05-25,2026-05-22 17:43,2026-05-22 23:43,2026-05-22 17:47,2026-05-23 00:23,1,BRAK_MATERIALU
ZP-001/01/05,ZP-001/01,ZS-001,1,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Montaż siłownika i testy KJ",G-05,5,30,30,CNF,2026-05-25,2026-05-23 00:11,2026-05-23 07:41,2026-05-23 00:35,2026-05-23 08:35,1,
ZP-002/01/01,ZP-002/01,ZS-002,1,VentPro S.A.,P-TLU-KUL-01,"Wycinanie paneli obudowy",G-01,1,25,25,CNF,2026-05-25,2026-05-22 09:00,2026-05-22 11:05,2026-05-22 08:50,2026-05-22 11:20,2,PRZEZBROJENIE
ZP-002/01/02,ZP-002/01,ZS-002,1,VentPro S.A.,P-TLU-KUL-01,"Gięcie obudowy zewnętrznej",G-02,2,25,25,CNF,2026-05-25,2026-05-22 11:37,2026-05-22 13:17,2026-05-22 11:44,2026-05-22 13:20,2,
ZP-002/01/03,ZP-002/01,ZS-002,1,VentPro S.A.,P-TLU-KUL-01,"Spawanie i zgrzewanie obudowy",G-03,3,25,25,CNF,2026-05-25,2026-05-22 13:53,2026-05-22 20:08,2026-05-22 13:49,2026-05-22 19:40,2,BRAK_OPERATORA
ZP-002/01/04,ZP-002/01,ZS-002,1,VentPro S.A.,P-TLU-KUL-01,"Napełnianie kulis wełną",G-04,4,25,25,CNF,2026-05-25,2026-05-22 20:44,2026-05-23 05:04,2026-05-22 20:50,2026-05-23 07:01,2,
ZP-002/01/05,ZP-002/01,ZS-002,1,VentPro S.A.,P-TLU-KUL-01,"Montaż końcowy i nitowanie",G-05,5,25,25,CNF,2026-05-25,2026-05-23 05:57,2026-05-23 10:07,2026-05-23 05:54,2026-05-23 11:16,2,
ZP-003/01/01,ZP-003/01,ZS-003,1,AirSystem Kraków,P-SKR-ROZ-02,"Wycinanie obudowy skrzynki",G-01,1,50,50,CNF,2026-05-25,2026-05-22 11:00,2026-05-22 11:50,2026-05-22 11:08,2026-05-22 12:09,3,
ZP-003/01/02,ZP-003/01,ZS-003,1,AirSystem Kraków,P-SKR-ROZ-02,"Gięcie skrzynki",G-02,2,50,50,CNF,2026-05-25,2026-05-22 12:40,2026-05-22 14:20,2026-05-22 13:06,2026-05-22 14:43,3,
ZP-003/01/03,ZP-003/01,ZS-003,1,AirSystem Kraków,P-SKR-ROZ-02,"Zgrzewanie liniowe korpusu",G-03,3,50,50,CNF,2026-05-25,2026-05-22 14:58,2026-05-22 16:38,2026-05-22 15:06,2026-05-22 17:15,3,
ZP-003/01/04,ZP-003/01,ZS-003,1,AirSystem Kraków,P-SKR-ROZ-02,"Wyklejanie matą kauczukową",G-04,4,50,50,CNF,2026-05-25,2026-05-22 17:07,2026-05-22 21:17,2026-05-22 17:21,2026-05-22 21:33,3,
ZP-003/01/05,ZP-003/01,ZS-003,1,AirSystem Kraków,P-SKR-ROZ-02,"Montaż króćców i przepustnicy",G-05,5,50,50,CNF,2026-05-25,2026-05-22 21:38,2026-05-23 00:58,2026-05-22 21:38,2026-05-23 01:07,3,
ZP-004/01/01,ZP-004/01,ZS-004,1,HVAC Południe,P-KRA-MAS-03,"Wycinanie ramki i lameli",G-01,1,100,100,CNF,2026-05-25,2026-05-22 13:00,2026-05-22 13:40,2026-05-22 12:54,2026-05-22 13:39,4,
ZP-004/01/02,ZP-004/01,ZS-004,1,HVAC Południe,P-KRA-MAS-03,"Gięcie ramki i profilowanie",G-02,2,100,100,CNF,2026-05-25,2026-05-22 14:12,2026-05-22 15:12,2026-05-22 14:12,2026-05-22 15:17,4,
ZP-004/01/03,ZP-004/01,ZS-004,1,HVAC Południe,P-KRA-MAS-03,"Montaż uszczelki i sprężynek",G-04,3,100,100,CNF,2026-05-25,2026-05-22 15:42,2026-05-22 18:12,2026-05-22 16:07,2026-05-22 18:35,4,
ZP-004/01/04,ZP-004/01,ZS-004,1,HVAC Południe,P-KRA-MAS-03,"Składanie żaluzji i nitowanie",G-05,4,100,100,CNF,2026-05-25,2026-05-22 19:07,2026-05-23 00:07,2026-05-22 19:11,2026-05-23 01:19,4,
ZP-001/02/01,ZP-001/02,ZS-001,2,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Wycinanie laserowe podstawy",G-01,1,20,20,CNF,2026-05-26,2026-05-22 15:00,2026-05-22 16:00,2026-05-22 15:08,2026-05-22 16:05,1,
ZP-001/02/02,ZP-001/02,ZS-001,2,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Gięcie profili podstawy",G-02,2,20,20,CNF,2026-05-26,2026-05-22 16:40,2026-05-22 19:20,2026-05-22 16:50,2026-05-22 19:30,1,
ZP-001/02/03,ZP-001/02,ZS-001,2,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Spawanie narożników korpusu",G-03,3,20,10,WIP,2026-05-26,2026-05-22 20:11,2026-05-22 22:11,2026-05-22 20:40,,1,AWARIA
ZP-001/02/04,ZP-001/02,ZS-001,2,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Izolacja PIR i montaż poliwęglanu",G-04,4,20,0,PLAN,2026-05-26,2026-05-22 23:07,2026-05-23 03:07,,,1,
ZP-001/02/05,ZP-001/02,ZS-001,2,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Montaż siłownika i testy KJ",G-05,5,20,0,PLAN,2026-05-26,2026-05-23 03:38,2026-05-23 08:38,,,1,
ZP-002/02/01,ZP-002/02,ZS-002,2,VentPro S.A.,P-TLU-KUL-01,"Wycinanie paneli obudowy",G-01,1,30,30,CNF,2026-05-26,2026-05-22 17:00,2026-05-22 19:30,2026-05-22 17:17,2026-05-22 19:59,2,
ZP-002/02/02,ZP-002/02,ZS-002,2,VentPro S.A.,P-TLU-KUL-01,"Gięcie obudowy zewnętrznej",G-02,2,30,30,CNF,2026-05-26,2026-05-22 20:00,2026-05-22 22:00,2026-05-22 20:18,2026-05-22 22:23,2,
ZP-002/02/03,ZP-002/02,ZS-002,2,VentPro S.A.,P-TLU-KUL-01,"Spawanie i zgrzewanie obudowy",G-03,3,30,15,WIP,2026-05-26,2026-05-22 22:42,2026-05-23 06:12,2026-05-22 23:14,,2,BRAK_MATERIALU
ZP-002/02/04,ZP-002/02,ZS-002,2,VentPro S.A.,P-TLU-KUL-01,"Napełnianie kulis wełną",G-04,4,30,0,PLAN,2026-05-26,2026-05-23 06:35,2026-05-23 16:35,,,2,
ZP-002/02/05,ZP-002/02,ZS-002,2,VentPro S.A.,P-TLU-KUL-01,"Montaż końcowy i nitowanie",G-05,5,30,0,PLAN,2026-05-26,2026-05-23 16:55,2026-05-23 21:55,,,2,
ZP-003/02/01,ZP-003/02,ZS-003,2,AirSystem Kraków,P-SKR-ROZ-02,"Wycinanie obudowy skrzynki",G-01,1,60,0,CNC,2026-05-26,2026-05-22 19:00,2026-05-22 20:00,,,3,ANULOWANE
ZP-003/02/02,ZP-003/02,ZS-003,2,AirSystem Kraków,P-SKR-ROZ-02,"Gięcie skrzynki",G-02,2,60,0,CNC,2026-05-26,2026-05-22 20:22,2026-05-22 22:22,,,3,ANULOWANE
ZP-003/02/03,ZP-003/02,ZS-003,2,AirSystem Kraków,P-SKR-ROZ-02,"Zgrzewanie liniowe korpusu",G-03,3,60,0,CNC,2026-05-26,2026-05-22 22:46,2026-05-23 00:46,,,3,ANULOWANE
ZP-003/02/04,ZP-003/02,ZS-003,2,AirSystem Kraków,P-SKR-ROZ-02,"Wyklejanie matą kauczukową",G-04,4,60,0,CNC,2026-05-26,2026-05-23 01:41,2026-05-23 06:41,,,3,ANULOWANE
ZP-003/02/05,ZP-003/02,ZS-003,2,AirSystem Kraków,P-SKR-ROZ-02,"Montaż króćców i przepustnicy",G-05,5,60,0,CNC,2026-05-26,2026-05-23 07:06,2026-05-23 11:06,,,3,ANULOWANE
ZP-004/02/01,ZP-004/02,ZS-004,2,HVAC Południe,P-KRA-MAS-03,"Wycinanie ramki i lameli",G-01,1,150,150,CNF,2026-05-26,2026-05-22 21:00,2026-05-22 22:00,2026-05-22 21:19,2026-05-22 22:16,4,
ZP-004/02/02,ZP-004/02,ZS-004,2,HVAC Południe,P-KRA-MAS-03,"Gięcie ramki i profilowanie",G-02,2,150,150,CNF,2026-05-26,2026-05-22 22:42,2026-05-23 00:12,2026-05-22 22:58,2026-05-23 00:29,4,
ZP-004/02/03,ZP-004/02,ZS-004,2,HVAC Południe,P-KRA-MAS-03,"Montaż uszczelki i sprężynek",G-04,3,150,75,WIP,2026-05-26,2026-05-23 00:56,2026-05-23 04:41,2026-05-23 01:39,,4,
ZP-004/02/04,ZP-004/02,ZS-004,2,HVAC Południe,P-KRA-MAS-03,"Składanie żaluzji i nitowanie",G-05,4,150,0,PLAN,2026-05-26,2026-05-23 04:56,2026-05-23 12:26,,,4,
ZP-001/03/01,ZP-001/03,ZS-001,3,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Wycinanie laserowe podstawy",G-01,1,40,0,PLAN,2026-05-27,2026-05-22 23:00,2026-05-23 01:00,,,1,
ZP-001/03/02,ZP-001/03,ZS-001,3,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Gięcie profili podstawy",G-02,2,40,0,PLAN,2026-05-27,2026-05-23 01:58,2026-05-23 07:18,,,1,
ZP-001/03/03,ZP-001/03,ZS-001,3,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Spawanie narożników korpusu",G-03,3,40,0,PLAN,2026-05-27,2026-05-23 08:07,2026-05-23 12:07,,,1,
ZP-001/03/04,ZP-001/03,ZS-001,3,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Izolacja PIR i montaż poliwęglanu",G-04,4,40,0,PLAN,2026-05-27,2026-05-23 12:39,2026-05-23 20:39,,,1,
ZP-001/03/05,ZP-001/03,ZS-001,3,Klima-Tech Sp. z o.o.,P-KOD-100-100,"Montaż siłownika i testy KJ",G-05,5,40,0,PLAN,2026-05-27,2026-05-23 21:35,2026-05-24 07:35,,,1,
ZP-002/03/01,ZP-002/03,ZS-002,3,VentPro S.A.,P-TLU-KUL-01,"Wycinanie paneli obudowy",G-01,1,20,0,PLAN,2026-05-27,2026-05-23 01:00,2026-05-23 02:40,,,2,
ZP-002/03/02,ZP-002/03,ZS-002,3,VentPro S.A.,P-TLU-KUL-01,"Gięcie obudowy zewnętrznej",G-02,2,20,0,PLAN,2026-05-27,2026-05-23 03:02,2026-05-23 04:22,,,2,
ZP-002/03/03,ZP-002/03,ZS-002,3,VentPro S.A.,P-TLU-KUL-01,"Spawanie i zgrzewanie obudowy",G-03,3,20,0,PLAN,2026-05-27,2026-05-23 04:55,2026-05-23 09:55,,,2,
ZP-002/03/04,ZP-002/03,ZS-002,3,VentPro S.A.,P-TLU-KUL-01,"Napełnianie kulis wełną",G-04,4,20,0,PLAN,2026-05-27,2026-05-23 10:37,2026-05-23 17:17,,,2,
ZP-002/03/05,ZP-002/03,ZS-002,3,VentPro S.A.,P-TLU-KUL-01,"Montaż końcowy i nitowanie",G-05,5,20,0,PLAN,2026-05-27,2026-05-23 17:42,2026-05-23 21:02,,,2,
ZP-003/03/01,ZP-003/03,ZS-003,3,AirSystem Kraków,P-SKR-ROZ-02,"Wycinanie obudowy skrzynki",G-01,1,40,0,PLAN,2026-05-27,2026-05-23 03:00,2026-05-23 03:40,,,3,
ZP-003/03/02,ZP-003/03,ZS-003,3,AirSystem Kraków,P-SKR-ROZ-02,"Gięcie skrzynki",G-02,2,40,0,PLAN,2026-05-27,2026-05-23 03:55,2026-05-23 05:15,,,3,
ZP-003/03/03,ZP-003/03,ZS-003,3,AirSystem Kraków,P-SKR-ROZ-02,"Zgrzewanie liniowe korpusu",G-03,3,40,0,PLAN,2026-05-27,2026-05-23 05:46,2026-05-23 07:06,,,3,
ZP-003/03/04,ZP-003/03,ZS-003,3,AirSystem Kraków,P-SKR-ROZ-02,"Wyklejanie matą kauczukową",G-04,4,40,0,PLAN,2026-05-27,2026-05-23 07:53,2026-05-23 11:13,,,3,
ZP-003/03/05,ZP-003/03,ZS-003,3,AirSystem Kraków,P-SKR-ROZ-02,"Montaż króćców i przepustnicy",G-05,5,40,0,PLAN,2026-05-27,2026-05-23 11:39,2026-05-23 14:19,,,3,
ZP-004/03/01,ZP-004/03,ZS-004,3,HVAC Południe,P-KRA-MAS-03,"Wycinanie ramki i lameli",G-01,1,80,0,PLAN,2026-05-27,2026-05-23 05:00,2026-05-23 05:32,,,4,
ZP-004/03/02,ZP-004/03,ZS-004,3,HVAC Południe,P-KRA-MAS-03,"Gięcie ramki i profilowanie",G-02,2,80,0,PLAN,2026-05-27,2026-05-23 05:53,2026-05-23 06:41,,,4,
ZP-004/03/03,ZP-004/03,ZS-004,3,HVAC Południe,P-KRA-MAS-03,"Montaż uszczelki i sprężynek",G-04,3,80,0,PLAN,2026-05-27,2026-05-23 07:36,2026-05-23 09:36,,,4,
ZP-004/03/04,ZP-004/03,ZS-004,3,HVAC Południe,P-KRA-MAS-03,"Składanie żaluzji i nitowanie",G-05,4,80,0,PLAN,2026-05-27,2026-05-23 10:10,2026-05-23 14:10,,,4,
ZP-005/01/01,ZP-005/01,ZS-005,1,ThermoAir Wrocław,P-KOD-100-100,"Wycinanie laserowe podstawy",G-01,1,35,35,CNF,2026-05-28,2026-05-22 06:00,2026-05-22 07:45,2026-05-22 05:58,2026-05-22 07:51,1,
ZP-005/01/02,ZP-005/01,ZS-005,1,ThermoAir Wrocław,P-KOD-100-100,"Gięcie profili podstawy",G-02,2,35,35,CNF,2026-05-28,2026-05-22 08:30,2026-05-22 12:30,2026-05-22 08:44,2026-05-22 13:10,1,PRZEZBROJENIE
ZP-005/01/03,ZP-005/01,ZS-005,1,ThermoAir Wrocław,P-KOD-100-100,"Spawanie narożników korpusu",G-03,3,35,35,CNF,2026-05-28,2026-05-22 13:40,2026-05-22 16:40,2026-05-22 14:05,2026-05-22 17:45,1,AWARIA
ZP-005/01/04,ZP-005/01,ZS-005,1,ThermoAir Wrocław,P-KOD-100-100,"Izolacja PIR i montaż poliwęglanu",G-04,4,35,20,WIP,2026-05-28,2026-05-23 06:00,2026-05-23 14:00,2026-05-23 06:40,,1,BRAK_MATERIALU
ZP-005/01/05,ZP-005/01,ZS-005,1,ThermoAir Wrocław,P-KOD-100-100,"Montaż siłownika i testy KJ",G-05,5,35,0,PLAN,2026-05-28,2026-05-23 15:00,2026-05-23 22:45,,,1,
ZP-006/01/01,ZP-006/01,ZS-006,1,ProVent Gdańsk,P-TLU-KUL-01,"Wycinanie paneli obudowy",G-01,1,18,18,CNF,2026-05-29,2026-05-22 08:00,2026-05-22 09:30,2026-05-22 07:55,2026-05-22 09:44,2,
ZP-006/01/02,ZP-006/01,ZS-006,1,ProVent Gdańsk,P-TLU-KUL-01,"Gięcie obudowy zewnętrznej",G-02,2,18,18,CNF,2026-05-29,2026-05-22 10:10,2026-05-22 11:22,2026-05-22 10:22,2026-05-22 11:35,2,
ZP-006/01/03,ZP-006/01,ZS-006,1,ProVent Gdańsk,P-TLU-KUL-01,"Spawanie i zgrzewanie obudowy",G-03,3,18,10,WIP,2026-05-29,2026-05-22 12:05,2026-05-22 16:35,2026-05-22 12:30,,2,KONTROLA_KJ
ZP-006/01/04,ZP-006/01,ZS-006,1,ProVent Gdańsk,P-TLU-KUL-01,"Napełnianie kulis wełną",G-04,4,18,0,PLAN,2026-05-29,2026-05-22 17:10,2026-05-23 03:30,,,2,
ZP-006/01/05,ZP-006/01,ZS-006,1,ProVent Gdańsk,P-TLU-KUL-01,"Montaż końcowy i nitowanie",G-05,5,18,0,PLAN,2026-05-29,2026-05-23 04:05,2026-05-23 07:05,,,2,
ZP-007/01/01,ZP-007/01,ZS-007,1,KlimaSystem Łódź,P-SKR-ROZ-02,"Wycinanie obudowy skrzynki",G-01,1,45,45,CNF,2026-05-30,2026-05-23 06:00,2026-05-23 06:45,2026-05-23 06:02,2026-05-23 06:51,3,
ZP-007/01/02,ZP-007/01,ZS-007,1,KlimaSystem Łódź,P-SKR-ROZ-02,"Gięcie skrzynki",G-02,2,45,45,CNF,2026-05-30,2026-05-23 07:20,2026-05-23 08:50,2026-05-23 07:35,2026-05-23 09:05,3,
ZP-007/01/03,ZP-007/01,ZS-007,1,KlimaSystem Łódź,P-SKR-ROZ-02,"Zgrzewanie liniowe korpusu",G-03,3,45,45,CNF,2026-05-30,2026-05-23 09:30,2026-05-23 11:00,2026-05-23 09:28,2026-05-23 11:22,3,INNE
ZP-007/01/04,ZP-007/01,ZS-007,1,KlimaSystem Łódź,P-SKR-ROZ-02,"Wyklejanie matą kauczukową",G-04,4,45,30,WIP,2026-05-30,2026-05-23 11:45,2026-05-23 15:30,2026-05-23 12:10,,3,
ZP-007/01/05,ZP-007/01,ZS-007,1,KlimaSystem Łódź,P-SKR-ROZ-02,"Montaż króćców i przepustnicy",G-05,5,45,0,PLAN,2026-05-30,2026-05-23 16:10,2026-05-23 19:10,,,3,`;


// ─── GRAFIK MASZYN (2 tygodnie robocze: 2026-06-01 → 2026-06-12) ─────────────
// Format: date,workcenter,brigade,hours
// Logika:
//   G-01 Brygada-Ciecia   — laser 2-zmianowy (16h), środa tyg.1 = 0h (przegląd)
//   G-02 Brygada-Giecia   — prasy 1-zmianowy (8h), piątek skrócony do 6h
//   G-03 Brygada-Spawania — spawarki 2-zmianowy (16h), czwartek tyg.2 = 0h (awaria)
//   G-04 Brygada-Montazu  — montaż 1-zmianowy (8h)
//   G-05 Brygada-Montazu  — montaż 1-zmianowy (8h) — ta sama brygada co G-04!
//        → Brygada-Montazu = spinacz G-04 + G-05, dostępność = 8+8 = 16h/dzień
export const DEMO_SCHEDULE = `date,workcenter,brigade,hours
2026-06-01,G-01,Brygada-Ciecia,16
2026-06-02,G-01,Brygada-Ciecia,16
2026-06-03,G-01,Brygada-Ciecia,0
2026-06-04,G-01,Brygada-Ciecia,16
2026-06-05,G-01,Brygada-Ciecia,16
2026-06-08,G-01,Brygada-Ciecia,16
2026-06-09,G-01,Brygada-Ciecia,16
2026-06-10,G-01,Brygada-Ciecia,16
2026-06-11,G-01,Brygada-Ciecia,16
2026-06-12,G-01,Brygada-Ciecia,16
2026-06-01,G-02,Brygada-Giecia,8
2026-06-02,G-02,Brygada-Giecia,8
2026-06-03,G-02,Brygada-Giecia,8
2026-06-04,G-02,Brygada-Giecia,8
2026-06-05,G-02,Brygada-Giecia,6
2026-06-08,G-02,Brygada-Giecia,8
2026-06-09,G-02,Brygada-Giecia,8
2026-06-10,G-02,Brygada-Giecia,8
2026-06-11,G-02,Brygada-Giecia,8
2026-06-12,G-02,Brygada-Giecia,6
2026-06-01,G-03,Brygada-Spawania,16
2026-06-02,G-03,Brygada-Spawania,16
2026-06-03,G-03,Brygada-Spawania,16
2026-06-04,G-03,Brygada-Spawania,16
2026-06-05,G-03,Brygada-Spawania,16
2026-06-08,G-03,Brygada-Spawania,16
2026-06-09,G-03,Brygada-Spawania,16
2026-06-10,G-03,Brygada-Spawania,16
2026-06-11,G-03,Brygada-Spawania,0
2026-06-12,G-03,Brygada-Spawania,16
2026-06-01,G-04,Brygada-Montazu,8
2026-06-02,G-04,Brygada-Montazu,8
2026-06-03,G-04,Brygada-Montazu,8
2026-06-04,G-04,Brygada-Montazu,8
2026-06-05,G-04,Brygada-Montazu,8
2026-06-08,G-04,Brygada-Montazu,8
2026-06-09,G-04,Brygada-Montazu,8
2026-06-10,G-04,Brygada-Montazu,8
2026-06-11,G-04,Brygada-Montazu,8
2026-06-12,G-04,Brygada-Montazu,8
2026-06-01,G-05,Brygada-Montazu,8
2026-06-02,G-05,Brygada-Montazu,8
2026-06-03,G-05,Brygada-Montazu,8
2026-06-04,G-05,Brygada-Montazu,8
2026-06-05,G-05,Brygada-Montazu,8
2026-06-08,G-05,Brygada-Montazu,8
2026-06-09,G-05,Brygada-Montazu,8
2026-06-10,G-05,Brygada-Montazu,8
2026-06-11,G-05,Brygada-Montazu,8
2026-06-12,G-05,Brygada-Montazu,8`;


// ─── MAPA BRYGAD ──────────────────────────────────────────────────────────────
// Wynika z DEMO_SCHEDULE (parseScheduleCSV buduje to automatycznie),
// ale eksportujemy też jako stałą do użycia bez parsowania CSV.
// Użycie: przekaż do calcBrigadeBalance(brigadeToWC, wcSchedule, scheduledOps, days)
export const DEMO_BRIGADE_MAP = {
  'Brygada-Ciecia':   ['G-01'],
  'Brygada-Giecia':   ['G-02'],
  'Brygada-Spawania': ['G-03'],
  'Brygada-Montazu':  ['G-04', 'G-05'],  // spinacz — obie maszyny, jedna brygada
};


// ─── HELPER: dni robocze z DEMO_SCHEDULE ─────────────────────────────────────
// Gotowa lista dat do przekazania jako `days` do calcBrigadeBalance
export const DEMO_SCHEDULE_DAYS = [
  '2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05',
  '2026-06-08','2026-06-09','2026-06-10','2026-06-11','2026-06-12',
];

// ─── DEMO ERP ZP ─────────────────────────────────────────────────────────────
// Zastępuje DEMO_ROUTING + DEMO_ZS — format TSV zgodny z parseZPFromERP()
// Dane przykładowe: 4 ZP, różne maszyny, różna liczba operacji
export const DEMO_ERP_ZP = `Numer ZP	Klient/zam	Numer ZS	Data zak	Data wys	Kod	Nazwa	Ilość ZP	Wyprod.	OP	WC	WCname	WC2	CzasPlan	CzasPozost
7310980009	AIRTEAM [MindeT]	2000034452	2026-06-24 00:00	2026-06-25 00:00	1274449	ZUP-L /1/304048	1	0	010	20043	Wykrawarko-gilotyna SG6 M107	Maszyny	2	2
7310980009	AIRTEAM [MindeT]	2000034452	2026-06-24 00:00	2026-06-25 00:00	1274449	ZUP-L /1/304048	1	0	020	30009	Centrum gięć	Maszyny	4	4
7310980009	AIRTEAM [MindeT]	2000034452	2026-06-24 00:00	2026-06-25 00:00	1274449	ZUP-L /1/304048	1	0	040	30052	Ślusarnia - iSWAY	iSWAY	8	8
7310980010	AIRTEAM [MindeT]	2000034452	2026-06-24 00:00	2026-06-25 00:00	1274449	ZUP-L /2/304048	1	0	010	20043	Wykrawarko-gilotyna SG6 M107	Maszyny	2	2
7310980010	AIRTEAM [MindeT]	2000034452	2026-06-24 00:00	2026-06-25 00:00	1274449	ZUP-L /2/304048	1	0	020	30009	Centrum gięć	Maszyny	4	4
7310980010	AIRTEAM [MindeT]	2000034452	2026-06-24 00:00	2026-06-25 00:00	1274449	ZUP-L /2/304048	1	0	040	30052	Ślusarnia - iSWAY	iSWAY	8	8
7310980011	AIRTEAM [MindeT]	2000034452	2026-06-24 00:00	2026-06-25 00:00	1274449	ZUP-L /3/304048	1	0	010	20043	Wykrawarko-gilotyna SG6 M107	Maszyny	2	2
7310980011	AIRTEAM [MindeT]	2000034452	2026-06-24 00:00	2026-06-25 00:00	1274449	ZUP-L /3/304048	1	0	020	30009	Centrum gięć	Maszyny	4	4
7310980011	AIRTEAM [MindeT]	2000034452	2026-06-24 00:00	2026-06-25 00:00	1274449	ZUP-L /3/304048	1	0	040	30052	Ślusarnia - iSWAY	iSWAY	8	8
7310982834	ROCKFIN [S101326]	1000227356	2026-06-24 00:00	2026-06-25 00:00	1238582	TAPS-HA-1000x2000x700 (200x133)x3	6	0	010	20005	Piła taśmowa STG230 DPG M002	Pilarnia Stalowa	2	2
7310982834	ROCKFIN [S101326]	1000227356	2026-06-24 00:00	2026-06-25 00:00	1238582	TAPS-HA-1000x2000x700 (200x133)x3	6	0	011	20059	Wykrawarko-gilotyna SGe_2 M227	Maszyny	3	3
7310982834	ROCKFIN [S101326]	1000227356	2026-06-24 00:00	2026-06-25 00:00	1238582	TAPS-HA-1000x2000x700 (200x133)x3	6	0	015	30009	Centrum gięć	Maszyny	6	6
7310982834	ROCKFIN [S101326]	1000227356	2026-06-24 00:00	2026-06-25 00:00	1238582	TAPS-HA-1000x2000x700 (200x133)x3	6	0	019	30003	Ślusarnia - kanały	Kanały	20	20
7311017392	KORGAS [2026.06.10./Deimant]	2000044436	2026-06-25 00:00	2026-06-26 00:00	1290544	KWP-P-E-1400x520-350 -BEN230-M	2	0	010	20043	Wykrawarko-gilotyna SG6 M107	Maszyny	3	3
7311017392	KORGAS [2026.06.10./Deimant]	2000044436	2026-06-25 00:00	2026-06-26 00:00	1290544	KWP-P-E-1400x520-350 -BEN230-M	2	0	020	30009	Centrum gięć	Maszyny	5	5
7311017392	KORGAS [2026.06.10./Deimant]	2000044436	2026-06-25 00:00	2026-06-26 00:00	1290544	KWP-P-E-1400x520-350 -BEN230-M	2	0	040	30052	Ślusarnia - iSWAY	iSWAY	10	10
7311017393	KORGAS [2026.06.10./Deimant]	2000044436	2026-06-25 00:00	2026-06-26 00:00	1290545	KWP-P-E-1100x670-350 -BEN230-M	2	0	010	20043	Wykrawarko-gilotyna SG6 M107	Maszyny	3	3
7311017393	KORGAS [2026.06.10./Deimant]	2000044436	2026-06-25 00:00	2026-06-26 00:00	1290545	KWP-P-E-1100x670-350 -BEN230-M	2	0	020	30009	Centrum gięć	Maszyny	5	5
7311017393	KORGAS [2026.06.10./Deimant]	2000044436	2026-06-25 00:00	2026-06-26 00:00	1290545	KWP-P-E-1100x670-350 -BEN230-M	2	0	040	30052	Ślusarnia - iSWAY	iSWAY	10	10
7310899766	TECHNOINSTAL SP.Z O.O.	1000207265	2026-06-25 00:00	2026-06-26 00:00	1236762	ZUP /1/203839	1	0	020	30009	Centrum gięć	Maszyny	4	4
7310899766	TECHNOINSTAL SP.Z O.O.	1000207265	2026-06-25 00:00	2026-06-26 00:00	1236762	ZUP /1/203839	1	0	040	30052	Ślusarnia - iSWAY	iSWAY	12	12
7311017236	KLIMABAZAR [z dn. 10.06.2026r.]	1000235338	2026-06-26 00:00	2026-06-27 00:00	1225930	KWP-O-E-1300x400-350 -BFN24-T	1	0	010	20043	Wykrawarko-gilotyna SG6 M107	Maszyny	2	2
7311017236	KLIMABAZAR [z dn. 10.06.2026r.]	1000235338	2026-06-26 00:00	2026-06-27 00:00	1225930	KWP-O-E-1300x400-350 -BFN24-T	1	0	020	30009	Centrum gięć	Maszyny	4	4
7311017236	KLIMABAZAR [z dn. 10.06.2026r.]	1000235338	2026-06-26 00:00	2026-06-27 00:00	1225930	KWP-O-E-1300x400-350 -BFN24-T	1	0	040	30052	Ślusarnia - iSWAY	iSWAY	8	8
7311017240	KLIMABAZAR [z dn. 10.06.2026r.]	1000235338	2026-06-26 00:00	2026-06-27 00:00	1209741	KWP-LE-800x400-350 -BFN24-T	2	0	010	20043	Wykrawarko-gilotyna SG6 M107	Maszyny	2	2
7311017240	KLIMABAZAR [z dn. 10.06.2026r.]	1000235338	2026-06-26 00:00	2026-06-27 00:00	1209741	KWP-LE-800x400-350 -BFN24-T	2	0	020	30009	Centrum gięć	Maszyny	4	4
7311017240	KLIMABAZAR [z dn. 10.06.2026r.]	1000235338	2026-06-26 00:00	2026-06-27 00:00	1209741	KWP-LE-800x400-350 -BFN24-T	2	0	040	30052	Ślusarnia - iSWAY	iSWAY	8	8
7310930520	SMAY REKLAMACJE	0901011826	2026-06-23 00:00	2026-06-24 00:00	95001	Naprawa kielichów NSDZ	1	0	010	30003	Ślusarnia - kanały	Kanały	24	24
7310930520	SMAY REKLAMACJE	0901011826	2026-06-23 00:00	2026-06-24 00:00	95001	Naprawa kielichów NSDZ	1	0	020	30052	Ślusarnia - iSWAY	iSWAY	16	16`;

// ─── CAPACITY PER MASZYNA [rbh/dzień, pon-pt] ────────────────────────────────
// Capacity per WC [rbh/dzień] = capacity_brygady / liczba_maszyn_w_brygadzie
// Suma maszyn gniazda = pełna capacity brygady (BRIGADE_CAPACITY)
export const WC_DAILY_CAPACITY = {
  '20074': 21.2, '30042': 21.2, '30043': 21.2, '30045': 21.2,  // Gniazdo KTM/KTS
  '30020': 16.0,  // Gniazdo NSDZ
  '30057': 16.0,  // Gniazdo ZS
  '30017': 32.0,  // Gniazdo montażu SN
  '20049':  8.0,  // Heager
  '30052': 48.0,  // iSWAY
  '30003': 90.2, '30031': 90.2,  // Kanały
  '20065':  8.0,  // Klinczarka
  '30002': 46.7, '30022': 46.7, '30023': 46.7,  // Kratki Aluminium
  '30001': 22.4, '30012': 22.4, '30014': 22.4, '30016': 22.4,
  '30021': 22.4, '30056': 22.4, '30060': 22.4,  // Kratki Stalowe
  '30040': 54.9,  // Linia KWP/KWP-L
  '30053': 24.5, '30054': 24.5, '30055': 24.5,  // Linia WKP
  '20017': 16.9, '20043': 16.9, '20045': 16.9, '20047': 16.9,
  '20048': 16.9, '20050': 16.9, '20058': 16.9, '20059': 16.9,
  '20067': 16.9, '20068': 16.9, '30009': 16.9, '30025': 16.9,  // Maszyny
  '20007': 20.0, '20034': 20.0, '30013': 20.0,  // Montaż Podzespołów
  '20025':  8.9, '20035':  8.9, '20051':  8.9, '20055':  8.9,
  '20056':  8.9, '20063':  8.9, '30081':  8.9, '30083':  8.9, '30084':  8.9,  // Pilarnia Aluminium
  '20005': 12.0, '20011': 12.0, '20012': 12.0, '20040': 12.0,
  '30008': 12.0, '30019': 12.0,  // Pilarnia Stalowa
  '30005': 30.8, '30050': 30.8, '30051': 30.8,  // Przepustnice
  '20072': 20.8, '30006': 20.8, '30061': 20.8, '30062': 20.8,
  '30068': 20.8, '30069': 20.8,  // Regulatory VAV/NSDZ
  '30011': 28.0, '30026': 28.0,  // Spawalnia
  '30015':  8.0,  // Szlifiernia Stal
};

// Buduje wcSchedule z WC_DAILY_CAPACITY — pon-pt = capacity, sob-nd = 0
// [pon, wt, sr, czw, pt, sob, nd]
export function buildWcScheduleFromCapacity(wcList) {
  const schedule = {};
  for (const wc of wcList) {
    const h = WC_DAILY_CAPACITY[wc] ?? 16;
    schedule[wc] = [h, h, h, h, h, 0, 0];
  }
  return schedule;
}
export const WC_TO_WC2 = {
  '20074': 'Gniazdo KTM/KTS',
  '30042': 'Gniazdo KTM/KTS',
  '30043': 'Gniazdo KTM/KTS',
  '30045': 'Gniazdo KTM/KTS',
  '30017': 'Gniazdo montażu SN',
  '30020': 'Gniazdo NSDZ',
  '30057': 'Gniazdo ZS',
  '20049': 'Heager',
  '30052': 'iSWAY',
  '30003': 'Kanały',
  '30031': 'Kanały',
  '20065': 'Klinczarka',
  '30002': 'Kratki Aluminium',
  '30022': 'Kratki Aluminium',
  '30023': 'Kratki Aluminium',
  '30001': 'Kratki Stalowe',
  '30012': 'Kratki Stalowe',
  '30014': 'Kratki Stalowe',
  '30016': 'Kratki Stalowe',
  '30021': 'Kratki Stalowe',
  '30056': 'Kratki Stalowe',
  '30060': 'Kratki Stalowe',
  '30040': 'Linia KWP/KWP-L',
  '30053': 'Linia WKP',
  '30054': 'Linia WKP',
  '30055': 'Linia WKP',
  '20017': 'Maszyny',
  '20043': 'Maszyny',
  '20045': 'Maszyny',
  '20047': 'Maszyny',
  '20048': 'Maszyny',
  '20050': 'Maszyny',
  '20058': 'Maszyny',
  '20059': 'Maszyny',
  '20067': 'Maszyny',
  '20068': 'Maszyny',
  '30009': 'Maszyny',
  '30025': 'Maszyny',
  '20007': 'Montaż Podzespołów',
  '20034': 'Montaż Podzespołów',
  '30013': 'Montaż Podzespołów',
  '20025': 'Pilarnia Aluminium',
  '20035': 'Pilarnia Aluminium',
  '20051': 'Pilarnia Aluminium',
  '20055': 'Pilarnia Aluminium',
  '20056': 'Pilarnia Aluminium',
  '20063': 'Pilarnia Aluminium',
  '30081': 'Pilarnia Aluminium',
  '30083': 'Pilarnia Aluminium',
  '30084': 'Pilarnia Aluminium',
  '20005': 'Pilarnia Stalowa',
  '20011': 'Pilarnia Stalowa',
  '20012': 'Pilarnia Stalowa',
  '20040': 'Pilarnia Stalowa',
  '30008': 'Pilarnia Stalowa',
  '30019': 'Pilarnia Stalowa',
  '30005': 'Przepustnice',
  '30050': 'Przepustnice',
  '30051': 'Przepustnice',
  '20072': 'Regulatory VAV/NSDZ',
  '30006': 'Regulatory VAV/NSDZ',
  '30061': 'Regulatory VAV/NSDZ',
  '30062': 'Regulatory VAV/NSDZ',
  '30068': 'Regulatory VAV/NSDZ',
  '30069': 'Regulatory VAV/NSDZ',
  '30011': 'Spawalnia',
  '30026': 'Spawalnia',
  '30015': 'Szlifiernia Stal',
};
