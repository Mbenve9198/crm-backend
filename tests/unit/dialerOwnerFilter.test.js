import mongoose from 'mongoose';
import { describe, it, expect } from 'vitest';
import {
  buildContactOwnerFilter,
  isContactOwnedByUser,
} from '../../services/dialerQueueService.js';

const emanueleId = new mongoose.Types.ObjectId();
const gianfrancoId = new mongoose.Types.ObjectId();

describe('buildContactOwnerFilter', () => {
  it('filtra sempre per l\'utente loggato, anche se admin', () => {
    const admin = { _id: emanueleId, role: 'admin' };
    const filter = buildContactOwnerFilter(admin);
    expect(filter.owner.toString()).toBe(emanueleId.toString());
  });

  it('filtra per l\'utente loggato anche se manager', () => {
    const manager = { _id: gianfrancoId, role: 'manager' };
    const filter = buildContactOwnerFilter(manager);
    expect(filter.owner.toString()).toBe(gianfrancoId.toString());
  });

  it('agent vede solo i propri', () => {
    const agent = { _id: emanueleId, role: 'agent' };
    expect(buildContactOwnerFilter(agent).owner.toString()).toBe(emanueleId.toString());
  });

  it('due utenti diversi non condividono il filtro owner', () => {
    const a = buildContactOwnerFilter({ _id: emanueleId, role: 'admin' });
    const b = buildContactOwnerFilter({ _id: gianfrancoId, role: 'admin' });
    expect(a.owner.toString()).not.toBe(b.owner.toString());
  });

  it('normalizza _id stringa in ObjectId (aggregation-safe)', () => {
    const filter = buildContactOwnerFilter({ _id: String(emanueleId), role: 'admin' });
    expect(filter.owner).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(filter.owner.toString()).toBe(emanueleId.toString());
  });
});

describe('isContactOwnedByUser', () => {
  it('true solo se owner coincide', () => {
    const user = { _id: emanueleId };
    expect(isContactOwnedByUser({ owner: emanueleId }, user)).toBe(true);
    expect(isContactOwnedByUser({ owner: gianfrancoId }, user)).toBe(false);
    expect(isContactOwnedByUser({ owner: { _id: emanueleId } }, user)).toBe(true);
    expect(isContactOwnedByUser({ owner: null }, user)).toBe(false);
  });
});
