import mongoose from 'mongoose';
import { describe, it, expect } from 'vitest';
import {
  evaluateWrapUpCall,
  resolveDialerContactStatus,
  applyDialerContactStatus,
} from '../../services/dialerWrapUpService.js';

const contactId = new mongoose.Types.ObjectId();
const otherContactId = new mongoose.Types.ObjectId();
const agentId = new mongoose.Types.ObjectId();
const otherAgentId = new mongoose.Types.ObjectId();
const callId = new mongoose.Types.ObjectId();

describe('evaluateWrapUpCall', () => {
  it('senza callId procede senza chiamata', () => {
    const result = evaluateWrapUpCall({
      call: null,
      contactId,
      userId: agentId,
      userRole: 'agent',
    });
    expect(result).toEqual({ ok: true, call: null });
  });

  it('callId assente dal DB non blocca il wrap-up del contatto', () => {
    const result = evaluateWrapUpCall({
      call: null,
      callId: String(callId),
      contactId,
      userId: agentId,
      userRole: 'agent',
    });
    expect(result.ok).toBe(true);
    expect(result.call).toBeNull();
    expect(result.missingCall).toBe(true);
  });

  it('rifiuta una chiamata di un altro contatto', () => {
    const result = evaluateWrapUpCall({
      call: { contact: otherContactId, initiatedBy: agentId },
      callId: String(callId),
      contactId,
      userId: agentId,
      userRole: 'agent',
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('rifiuta se l\'agent non ha iniziato la chiamata', () => {
    const result = evaluateWrapUpCall({
      call: { contact: contactId, initiatedBy: otherAgentId },
      callId: String(callId),
      contactId,
      userId: agentId,
      userRole: 'agent',
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('admin può chiudere la chiamata di un altro agent', () => {
    const call = { contact: contactId, initiatedBy: otherAgentId };
    const result = evaluateWrapUpCall({
      call,
      callId: String(callId),
      contactId,
      userId: agentId,
      userRole: 'admin',
    });
    expect(result).toEqual({ ok: true, call });
  });

  it('accetta la chiamata dell\'agent che l\'ha iniziata', () => {
    const call = { contact: { _id: contactId }, initiatedBy: { _id: agentId } };
    const result = evaluateWrapUpCall({
      call,
      callId: String(callId),
      contactId,
      userId: agentId,
      userRole: 'agent',
    });
    expect(result).toEqual({ ok: true, call });
  });
});

describe('resolveDialerContactStatus', () => {
  it('Non interessato senza status esplicito va in do_not_contact', () => {
    expect(resolveDialerContactStatus('not-interested', undefined)).toBe('do_not_contact');
    expect(resolveDialerContactStatus('not-interested', null)).toBe('do_not_contact');
  });

  it('lo status esplicito vince sulla mappa esito', () => {
    expect(resolveDialerContactStatus('not-interested', 'lost before free trial')).toBe(
      'lost before free trial'
    );
  });

  it('mappa gli altri esiti dialer', () => {
    expect(resolveDialerContactStatus('voicemail')).toBe('da richiamare');
    expect(resolveDialerContactStatus('first-call')).toBe('contattato');
    expect(resolveDialerContactStatus('free-trial-sold')).toBe('free trial iniziato');
    expect(resolveDialerContactStatus('not-logged')).toBeNull();
  });
});

describe('applyDialerContactStatus', () => {
  it('Non interessato esce da da contattare senza MRR', () => {
    const contact = { status: 'da contattare', mrr: undefined };
    const result = applyDialerContactStatus(contact, 'do_not_contact');
    expect(result).toEqual({ changed: true, oldStatus: 'da contattare' });
    expect(contact.status).toBe('do_not_contact');
  });

  it('lost before free trial senza MRR usa 0', () => {
    const contact = { status: 'da contattare' };
    applyDialerContactStatus(contact, 'lost before free trial');
    expect(contact.status).toBe('lost before free trial');
    expect(contact.mrr).toBe(0);
  });

  it('non cambia se lo status è già quello', () => {
    const contact = { status: 'do_not_contact' };
    expect(applyDialerContactStatus(contact, 'do_not_contact').changed).toBe(false);
  });
});
