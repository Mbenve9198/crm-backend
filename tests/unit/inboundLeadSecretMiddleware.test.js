import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireInboundLeadSecret } from '../../middleware/inboundLeadSecretMiddleware.js';

const mockResponse = () => {
  const res = { statusCode: 200, body: null };
  res.status = (statusCode) => {
    res.statusCode = statusCode;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

const runMiddleware = (providedSecret) => {
  const req = {
    headers: providedSecret === undefined
      ? {}
      : { 'x-inbound-secret': providedSecret }
  };
  const res = mockResponse();
  const next = vi.fn();
  requireInboundLeadSecret(req, res, next);
  return { res, next };
};

afterEach(() => {
  delete process.env.INBOUND_LEAD_SECRET;
});

describe('requireInboundLeadSecret', () => {
  it('lascia passare l’header corretto quando il secret è configurato', () => {
    process.env.INBOUND_LEAD_SECRET = 'secret-corretto';

    const { next } = runMiddleware('secret-corretto');

    expect(next).toHaveBeenCalledOnce();
  });

  it('risponde 403 quando l’header è sbagliato', () => {
    process.env.INBOUND_LEAD_SECRET = 'secret-corretto';

    const { res, next } = runMiddleware('secret-diverso-e-piu-lungo');

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('risponde 403 quando l’header manca', () => {
    process.env.INBOUND_LEAD_SECRET = 'secret-corretto';

    const { res, next } = runMiddleware();

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('resta pubblico senza INBOUND_LEAD_SECRET', () => {
    delete process.env.INBOUND_LEAD_SECRET;

    const { next } = runMiddleware();

    expect(next).toHaveBeenCalledOnce();
  });
});
