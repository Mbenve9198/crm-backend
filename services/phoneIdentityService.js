const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const ITALY_CC = '39';

// I lead grader arrivano senza email: l'identità del contatto è il numero, quindi
// va ridotto a una forma sola prima di usarlo come chiave. Senza questo passaggio
// «+39 340 111 2233» e «3401112233» diventano due contatti diversi.
const stripDecorations = (raw) => String(raw ?? '')
  .replace(/^whatsapp:/i, '')
  .replace(/[\s\-().\u00a0\u2010-\u2015]/g, '');

/**
 * Un numero italiano plausibile: cellulare di dieci cifre che parte per 3, fisso
 * di nove-undici cifre che parte per 0. Sono le stesse regole con cui il form del
 * grader valida il campo, e vanno ripetute qui perché il webhook è pubblico e
 * riceve anche da altri client: senza di esse «123456» diventa «+39123456» e un
 * cellulare spagnolo diventa «+3934600111222».
 */
const isPlausibleItalianNumber = (national) => {
  if (national.startsWith('3')) {
    return national.length === 10;
  }
  if (national.startsWith('0')) {
    return national.length >= 9 && national.length <= 11;
  }
  return false;
};

const italianNumber = (national) => (
  isPlausibleItalianNumber(national)
    ? { e164: `+${ITALY_CC}${national}`, digits: `${ITALY_CC}${national}` }
    : null
);

/**
 * Riduce un numero a E.164, assumendo l'Italia quando il prefisso manca.
 * @param {string} raw - Numero come è arrivato dal webhook.
 * @returns {{ e164: string, digits: string } | null} null se non è un numero utilizzabile.
 */
export const normalizePhoneToE164 = (raw) => {
  const cleaned = stripDecorations(raw);
  if (!cleaned) {
    return null;
  }

  const candidate = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;

  // Qualunque cosa che non sia una cifra, dopo il «+» iniziale, rende il numero
  // inaffidabile: togliere le lettere da «340 111 2233 ext 7» non lascia lo
  // stesso numero scritto male, lascia un numero diverso.
  if (!/^\+?\d+$/.test(candidate)) {
    return null;
  }

  const digits = candidate.slice(candidate.startsWith('+') ? 1 : 0);

  if (candidate.startsWith('+')) {
    if (digits.startsWith(ITALY_CC)) {
      return italianNumber(digits.slice(ITALY_CC.length));
    }
    // Prefisso estero dichiarato: i piani di numerazione altrui non li
    // conosciamo, quindi ci fermiamo alla forma E.164.
    const e164 = `+${digits}`;
    return E164_PATTERN.test(e164) ? { e164, digits } : null;
  }

  // Senza «+» il 39 iniziale è ambiguo: «391 234 5678» è un cellulare italiano
  // valido, «39 340 111 2233» è lo stesso numero col prefisso attaccato. Vince
  // la lettura che produce un numero nazionale plausibile.
  if (digits.startsWith(ITALY_CC) && isPlausibleItalianNumber(digits.slice(ITALY_CC.length))) {
    return { e164: `+${digits}`, digits };
  }

  return italianNumber(digits);
};

/**
 * Ritrova i numeri salvati prima che li normalizzassimo: nel database restano
 * «+39 340 111 2233» e «340-111-2233», che non corrispondono a nessuna delle due
 * forme canoniche e farebbero nascere un doppione a ogni lead senza email. Il
 * pattern tollera separatori qualsiasi fra le cifre e il prefisso facoltativo.
 *
 * Non usa l'indice, quindi va interrogato solo dopo che le due ricerche esatte
 * hanno fallito.
 * @param {string} e164
 * @returns {RegExp | null}
 */
export const legacyPhoneLookupPattern = (e164) => {
  const digits = String(e164 ?? '').replace(/\D/g, '');
  if (!digits) {
    return null;
  }

  const national = digits.startsWith(ITALY_CC) ? digits.slice(ITALY_CC.length) : digits;
  if (!national) {
    return null;
  }

  const spaced = national.split('').join('\\D*');
  return new RegExp(`^\\D*(?:\\+?\\D*0{0,2}\\D*${ITALY_CC})?\\D*${spaced}\\D*$`);
};

/**
 * Email sintetica derivata dal numero: è la chiave di deduplica dei lead senza email.
 * @param {string} e164 - Numero già normalizzato.
 * @returns {string}
 */
export const syntheticGraderEmail = (e164) => (
  `grader-${String(e164).replace(/\D/g, '')}@grader.menuchat.it` // pragma: allowlist secret
);

/**
 * Riconosce gli indirizzi che abbiamo generato noi: non sono recapiti reali,
 * quindi nessun outreach via email deve partire verso di loro.
 * @param {string} email
 * @returns {boolean}
 */
export const isSyntheticEmailAddress = (email) => (
  /@(grader|acquisition|landing)\.menuchat\.it$/i.test(String(email ?? '').trim()) // pragma: allowlist secret
);

export default {
  normalizePhoneToE164,
  legacyPhoneLookupPattern,
  syntheticGraderEmail,
  isSyntheticEmailAddress
};
