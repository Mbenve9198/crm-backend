import { describe, it, expect } from 'vitest';
import {
  applyCallbackQueueRules,
  dueCallbackClause,
  anyCallbackClause,
  notFutureCallbackClause,
  dueFirstExpr,
} from '../../services/dialerQueueService.js';

const NOW = '2026-08-13T10:00:00.000Z';

describe('applyCallbackQueueRules', () => {
  it('da contattare include i richiami già scaduti e nasconde quelli futuri', () => {
    const filter = applyCallbackQueueRules(
      { lists: 'Cold Call - Vicini Clienti', status: 'da contattare' },
      'da contattare',
      NOW
    );
    expect(filter.status).toBeUndefined();
    expect(filter.$and).toHaveLength(2);
    expect(filter.$and[0].$or).toEqual([
      { status: 'da contattare' },
      dueCallbackClause(NOW),
    ]);
    expect(filter.$and[1]).toEqual(notFutureCallbackClause(NOW));
  });

  it('da richiamare mostra tutti i richiami fissati, anche in programma', () => {
    const filter = applyCallbackQueueRules(
      { status: 'da richiamare' },
      'da richiamare',
      NOW
    );
    expect(filter.status).toBeUndefined();
    expect(filter.$and).toHaveLength(1);
    expect(filter.$and[0].$or).toEqual([
      { status: 'da richiamare' },
      anyCallbackClause(),
    ]);
  });

  it('all nasconde i richiami futuri', () => {
    const filter = applyCallbackQueueRules({ status: 'all' }, 'all', NOW);
    expect(filter.$and[0]).toEqual(notFutureCallbackClause(NOW));
  });

  it('dueCallbackClause usa callbackAt <= now senza vincolare lo status', () => {
    const clause = dueCallbackClause(NOW);
    expect(clause.status).toBeUndefined();
    expect(clause['properties.callbackAt'].$lte).toBe(NOW);
  });

  it('dueFirstExpr mette i richiami scaduti in testa a prescindere dallo status', () => {
    const expr = dueFirstExpr(NOW);
    expect(expr.$cond[1]).toBe(0);
    expect(expr.$cond[2]).toBe(1);
    expect(expr.$cond[0].$and).toEqual(
      expect.arrayContaining([{ $lte: ['$properties.callbackAt', NOW] }])
    );
    expect(expr.$cond[0].$and).not.toEqual(
      expect.arrayContaining([{ $eq: ['$status', 'da richiamare'] }])
    );
  });
});
