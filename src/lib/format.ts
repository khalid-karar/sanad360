/**
 * One formatting policy for the whole app (design system):
 *
 *  • Dates/times — localized wording, but PINNED to the Gregorian calendar and
 *    LATIN digits in both languages. Browsers differ on `ar-SA` defaults
 *    (some pick the Islamic calendar / Arabic-Indic digits), and operational
 *    Saudi software uses Gregorian + Latin digits for schedules and records.
 *  • Measurements, IDs, plates, phones — always Latin digits, always LTR.
 *
 * Use these everywhere instead of raw toLocaleString calls.
 */

const AR_DATE = 'ar-SA-u-ca-gregory-nu-latn';
const EN_DATE = 'en-GB';

export function formatDateTime(iso: string, isRTL: boolean): string {
  return new Date(iso).toLocaleString(isRTL ? AR_DATE : EN_DATE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string, isRTL: boolean): string {
  return new Date(iso).toLocaleDateString(isRTL ? AR_DATE : EN_DATE);
}

/** Weight and other measurements: Latin digits, unit localized. */
export function formatWeight(kg: number, isRTL: boolean): string {
  return isRTL ? `${kg} كجم` : `${kg} kg`;
}
