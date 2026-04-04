import { describe, it, expect, beforeAll } from 'vitest';

let generateSignedActionUrl, verifySignedUrl;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret-for-signed-urls-32chars!';
  process.env.BACKEND_URL = 'http://localhost:3099';
  const mod = await import('../../services/signedUrlService.js');
  generateSignedActionUrl = mod.generateSignedActionUrl;
  verifySignedUrl = mod.verifySignedUrl;
});

describe('signedUrlService', () => {
  it('genera URL valido con tutti i parametri', () => {
    const url = generateSignedActionUrl('conv123', 'approve');
    expect(url).toContain('http://localhost:3099/api/agent/email-action');
    expect(url).toContain('id=conv123');
    expect(url).toContain('action=approve');
    expect(url).toContain('exp=');
    expect(url).toContain('token=');
  });

  it('verifica un URL appena generato -> true', () => {
    const url = new URL(generateSignedActionUrl('conv456', 'discard'));
    const params = url.searchParams;
    const valid = verifySignedUrl(params.get('id'), params.get('action'), params.get('exp'), params.get('token'));
    expect(valid).toBe(true);
  });

  it('URL scaduto -> false', () => {
    const expiredExp = (Date.now() - 10000).toString();
    const valid = verifySignedUrl('conv789', 'approve', expiredExp, 'fake-token');
    expect(valid).toBe(false);
  });

  it('token manomesso -> false', () => {
    const url = new URL(generateSignedActionUrl('convABC', 'approve'));
    const params = url.searchParams;
    const valid = verifySignedUrl(params.get('id'), params.get('action'), params.get('exp'), 'manomesso');
    expect(valid).toBe(false);
  });

  it('conversationId diverso -> false', () => {
    const url = new URL(generateSignedActionUrl('convOriginal', 'approve'));
    const params = url.searchParams;
    const valid = verifySignedUrl('convDIVERSO', params.get('action'), params.get('exp'), params.get('token'));
    expect(valid).toBe(false);
  });

  it('azione diversa -> false', () => {
    const url = new URL(generateSignedActionUrl('conv111', 'approve'));
    const params = url.searchParams;
    const valid = verifySignedUrl(params.get('id'), 'discard', params.get('exp'), params.get('token'));
    expect(valid).toBe(false);
  });

  it('scadenza custom (1 ora)', () => {
    const url = generateSignedActionUrl('convShort', 'approve', 1);
    expect(url).toContain('id=convShort');
    const parsed = new URL(url);
    const exp = parseInt(parsed.searchParams.get('exp'));
    const now = Date.now();
    expect(exp).toBeGreaterThan(now);
    expect(exp).toBeLessThan(now + 2 * 60 * 60 * 1000);
  });
});
