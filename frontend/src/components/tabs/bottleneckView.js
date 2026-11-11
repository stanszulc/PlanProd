import { calcBottlenecks } from '../../utils/bottleneck.js';

// Widok wąskich gardeł planu dla zakładek (Gantt, Routing): mapuje gniazdo na jego
// brygadę (grupę z calcBottlenecks) i wskazuje brygadę primary. Jedna definicja —
// patrz utils/bottleneck.js.
export function planBottleneckView({ fwdZP, wcSchedule, wcToBrygada }) {
  if (!fwdZP || !fwdZP.length) return { hasPlan: false, groupOfWc: {}, primaryName: null, primaryMembers: new Set() };
  const { groups, primary } = calcBottlenecks({ fwdZP, wcSchedule: wcSchedule || {}, wcToBrygada: wcToBrygada || {} });
  const groupOfWc = {};
  groups.forEach(g => g.members.forEach(wc => { groupOfWc[wc] = g; }));
  return {
    hasPlan: true,
    groupOfWc,
    primaryName: primary ? primary.name : null,
    primaryMembers: new Set(primary ? primary.members : []),
  };
}
