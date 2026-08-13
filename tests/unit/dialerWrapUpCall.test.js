import mongoose from 'mongoose';
import { describe, it, expect } from 'vitest';
import { evaluateWrapUpCall } from '../../services/dialerWrapUpService.js';

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
