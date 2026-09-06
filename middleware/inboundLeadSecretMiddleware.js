import { createHash, timingSafeEqual } from 'crypto';

const secretsMatch = (providedSecret, expectedSecret) => {
  const providedDigest = createHash('sha256')
    .update(String(providedSecret || ''), 'utf8')
    .digest();
  const expectedDigest = createHash('sha256')
    .update(String(expectedSecret || ''), 'utf8')
    .digest();

  return timingSafeEqual(providedDigest, expectedDigest);
};

/**
 * Protegge opzionalmente il webhook rank checker con X-Inbound-Secret.
 * Senza INBOUND_LEAD_SECRET configurata mantiene il comportamento pubblico legacy.
 */
export const requireInboundLeadSecret = (req, res, next) => {
  const expectedSecret = process.env.INBOUND_LEAD_SECRET;
  if (!expectedSecret) {
    return next();
  }

  const providedSecret = req.get?.('X-Inbound-Secret')
    || req.headers?.['x-inbound-secret'];

  if (!secretsMatch(providedSecret, expectedSecret)) {
    console.warn('⚠️ Secret inbound non valido per il Rank Checker');
    return res.status(403).json({
      success: false,
      message: 'Secret inbound non valido'
    });
  }

  return next();
};
