import { describe, it, expect } from 'vitest';
import {
  applyCallbackQueueRules,
  dueCallbackClause,
  notFutureCallbackClause,
} from '../../services/dialerQueueService.js';

const NOW = '2026-08-13T10:00:00.000Z';

describe('applyCallbackQueueRules', () => {
  it('da contattare include i richiami già scaduti', () => {
    const filter = applyCallbackQueueRules(
      { lists: 'Cold Call - Vicini Clienti', status: 'da contattare' },
      'da contattare',
      NOW
    );
    expect(filter.status).toBeUndefined();
    expect(filter.$and).toHaveLength(1);
    expect(filter.$and[0].$or).toEqual([
      { status: 'da contattare' },
      dueCallbackClause(NOW),
    ]);
  });

  it('da richiamare nasconde i richiami futuri', () => {
    const filter = applyCallbackQueueRules(
      { status: 'da richiamare' },
      'da richiamare',
      NOW
    );
    expect(filter.status).toBe('da richiamare');
    expect(filter.$and[0]).toEqual(notFutureCallbackClause(NOW));
  });

  it('dueCallbackClause usa callbackAt <= now', () => {
    const clause = dueCallbackClause(NOW);
    expect(clause.status).toBe('da richiamare');
    expect(clause['properties.callbackAt'].$lte).toBe(NOW);
  });
});
