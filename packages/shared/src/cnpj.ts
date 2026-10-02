/**
 * CNPJ check digits, numeric or alphanumeric (IN RFB 2.229/2024): each of
 * the first 12 characters is worth its ASCII code minus 48, and the two
 * check digits stay numeric.
 */
const FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const SECOND_WEIGHTS = [6, ...FIRST_WEIGHTS];

function checkDigit(body: string, weights: readonly number[]): number {
  let sum = 0;

  for (let index = 0; index < body.length; index += 1) {
    sum += (body.charCodeAt(index) - 48) * (weights[index] as number);
  }

  const remainder = sum % 11;

  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * The CNPJ as `XX.XXX.XXX/XXXX-XX`, or `null` when it is malformed or its
 * check digits do not match. Punctuation and case in the input are ignored.
 */
export function normalizeCnpj(text: string): string | null {
  const raw = text.toUpperCase().replace(/[.\-/\s]/g, "");

  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(raw) || /^(.)\1{13}$/.test(raw)) {
    return null;
  }

  const first = checkDigit(raw.slice(0, 12), FIRST_WEIGHTS);
  const second = checkDigit(`${raw.slice(0, 12)}${first}`, SECOND_WEIGHTS);

  if (raw.slice(12) !== `${first}${second}`) {
    return null;
  }

  return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
}
