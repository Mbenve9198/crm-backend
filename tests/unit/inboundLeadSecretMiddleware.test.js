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

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  delete process.env.INBOUND_LEAD_SECRET;
  delete process.env.INBOUND_LEAD_ALLOW_PUBLIC;
  process.env.NODE_ENV = originalNodeEnv;
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

  it('resta pubblico senza INBOUND_LEAD_SECRET fuori produzione', () => {
    delete process.env.INBOUND_LEAD_SECRET;
    process.env.NODE_ENV = 'test';

    const { next } = runMiddleware();

    expect(next).toHaveBeenCalledOnce();
  });

  it('chiude il webhook in produzione se il secret non è configurato', () => {
    delete process.env.INBOUND_LEAD_SECRET;
    process.env.NODE_ENV = 'production';

    const { res, next } = runMiddleware();

    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('in produzione l’accesso pubblico va dichiarato a mano', () => {
    delete process.env.INBOUND_LEAD_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.INBOUND_LEAD_ALLOW_PUBLIC = 'true';

    const { next } = runMiddleware();

    expect(next).toHaveBeenCalledOnce();
  });
});
