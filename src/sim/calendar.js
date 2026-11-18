// Spieltag <-> Datum. Tag 0 = Startdatum aus balance.json (31. August 1939).
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function dateOfDay(startIso, day) {
  const [y, m, d] = startIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + day));
}

export function formatDate(startIso, day) {
  const dt = dateOfDay(startIso, day);
  return `${dt.getUTCDate()}. ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

export function formatShort(startIso, day) {
  const dt = dateOfDay(startIso, day);
  return `${String(dt.getUTCDate()).padStart(2, '0')}.${String(dt.getUTCMonth() + 1).padStart(2, '0')}.`;
}

/** Ganzzahl mit Tausenderpunkt (ohne Intl, das beim ersten Aufruf langsam lädt). */
export function fmtInt(v) {
  const s = String(Math.round(v));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
