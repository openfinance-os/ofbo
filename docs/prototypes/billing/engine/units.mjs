// Money units for the OFBO billing engine.
//
// Everything is integer **milli-fils** (mf). 1 AED = 100 fils = 100,000 mf.
// Rationale: the scheme's smallest published unit is the fil, but tiered quote fees
// (5 / 7.5 / 10 / 12.5 fils) and bps-derived payment fees need sub-fil precision before
// rounding — the same milli-fil convention the reconciliation engine already uses.
// No floating point ever reaches a stored amount.

export const MF_PER_FIL = 1000;
export const FILS_PER_AED = 100;
export const MF_PER_AED = MF_PER_FIL * FILS_PER_AED; // 100_000

export const aed = (n) => Math.round(n * MF_PER_AED);
export const fils = (n) => Math.round(n * MF_PER_FIL);

/** Half-up rounding for integers produced by a division. Never used on stored amounts. */
export const divRound = (num, den) => Math.floor((num + Math.floor(den / 2)) / den);

/** Basis points of a value expressed in fils → fee in milli-fils. fee_fils = v*bps/10000. */
export const bpsOfFils = (valueFils, bps) => divRound(valueFils * bps, 10);

export const fmtAED = (mf, dp = 2) =>
  (mf / MF_PER_AED).toLocaleString('en-AE', { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const fmtFils = (mf) => {
  const f = mf / MF_PER_FIL;
  return `${Number.isInteger(f) ? f : f.toFixed(1)} fils`;
};
