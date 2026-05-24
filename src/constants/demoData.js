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
