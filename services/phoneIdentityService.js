const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

// I lead grader arrivano senza email: l'identità del contatto è il numero, quindi
// va ridotto a una forma sola prima di usarlo come chiave. Senza questo passaggio
// «+39 340 111 2233» e «3401112233» diventano due contatti diversi.
const stripDecorations = (raw) => String(raw ?? '')
  .replace(/^whatsapp:/i, '')
  .replace(/[\s\-().\u00a0\u2010-\u2015]/g, '');

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

  let candidate = cleaned;
  if (candidate.startsWith('00')) {
    candidate = `+${candidate.slice(2)}`;
  }

  const digits = candidate.replace(/\D/g, '');
  if (!digits) {
    return null;
  }

  let e164;
  if (candidate.startsWith('+')) {
    e164 = `+${digits}`;
  } else if (digits.startsWith('39') && digits.length >= 11) {
    // 39 + numero nazionale: un mobile italiano senza prefisso non parte mai per 39,
    // quindi a questa lunghezza il 39 iniziale è il prefisso internazionale.
    e164 = `+${digits}`;
  } else {
    e164 = `+39${digits}`;
  }

  return E164_PATTERN.test(e164) ? { e164, digits: e164.slice(1) } : null;
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
  syntheticGraderEmail,
  isSyntheticEmailAddress
};
