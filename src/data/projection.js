// ETRS89 / LAEA Europe (EPSG:3035), ellipsoidisch (GRS80).
// Formeln nach EPSG Guidance Note 7-2, Abschnitt "Lambert Azimuthal Equal Area".
const A = 6378137.0;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const E = Math.sqrt(E2);
const LAT0 = (52 * Math.PI) / 180;
const LON0 = (10 * Math.PI) / 180;
const FE = 4321000.0;
const FN = 3210000.0;

function q(phi) {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
}

const QP = q(Math.PI / 2);
const BETA0 = Math.asin(q(LAT0) / QP);
const RQ = A * Math.sqrt(QP / 2);
const D = (A * (Math.cos(LAT0) / Math.sqrt(1 - E2 * Math.sin(LAT0) ** 2))) / (RQ * Math.cos(BETA0));

/** Länge/Breite in Grad -> [x, y] in Metern (EPSG:3035). */
export function forward(lon, lat) {
  const phi = (lat * Math.PI) / 180;
  const dl = (lon * Math.PI) / 180 - LON0;
  const beta = Math.asin(q(phi) / QP);
  const B = RQ * Math.sqrt(2 / (1 + Math.sin(BETA0) * Math.sin(beta) + Math.cos(BETA0) * Math.cos(beta) * Math.cos(dl)));
  const x = FE + B * D * Math.cos(beta) * Math.sin(dl);
  const y = FN + (B / D) * (Math.cos(BETA0) * Math.sin(beta) - Math.sin(BETA0) * Math.cos(beta) * Math.cos(dl));
  return [x, y];
}

/** [x, y] in Metern (EPSG:3035) -> [Länge, Breite] in Grad. */
export function inverse(x, y) {
  const dx = x - FE;
  const dy = y - FN;
  const rho = Math.hypot(dx / D, D * dy);
  if (rho < 1e-9) return [(LON0 * 180) / Math.PI, (LAT0 * 180) / Math.PI];
  const C = 2 * Math.asin(rho / (2 * RQ));
  const betaP = Math.asin(Math.cos(C) * Math.sin(BETA0) + (D * dy * Math.sin(C) * Math.cos(BETA0)) / rho);
  const lon = LON0 + Math.atan2(dx * Math.sin(C), D * rho * Math.cos(BETA0) * Math.cos(C) - D * D * dy * Math.sin(BETA0) * Math.sin(C));
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const phi = betaP
    + (E2 / 3 + (31 * e4) / 180 + (517 * e6) / 5040) * Math.sin(2 * betaP)
    + ((23 * e4) / 360 + (251 * e6) / 3780) * Math.sin(4 * betaP)
    + ((761 * e6) / 45360) * Math.sin(6 * betaP);
  return [(lon * 180) / Math.PI, (phi * 180) / Math.PI];
}
