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
ZS-004,3,HVAC Południe,P-KRA-MAS-03,80,2026-05-27,4`;
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