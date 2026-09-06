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
 * Protegge il webhook rank checker con X-Inbound-Secret.
 *
 * In produzione il secret è obbligatorio: senza, chiunque conosca l'URL potrebbe
 * creare o sovrascrivere lead e farci arrivare email interne. Il vecchio
 * comportamento pubblico resta raggiungibile solo dichiarandolo a mano con
 * INBOUND_LEAD_ALLOW_PUBLIC=true, e lo scriviamo nei log a ogni avvio.
 */
export const requireInboundLeadSecret = (req, res, next) => {
  const expectedSecret = process.env.INBOUND_LEAD_SECRET;
  if (!expectedSecret) {
    const allowsPublic = String(process.env.INBOUND_LEAD_ALLOW_PUBLIC || '').toLowerCase() === 'true';
    if (process.env.NODE_ENV === 'production' && !allowsPublic) {
      console.error('❌ INBOUND_LEAD_SECRET non configurata: webhook rank checker chiuso');
      return res.status(503).json({
        success: false,
        message: 'Webhook inbound non configurato'
      });
    }

    console.warn('⚠️ Webhook rank checker senza secret: accesso pubblico');
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
