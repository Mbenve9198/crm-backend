import { describe, it, expect } from 'vitest';

const inferStage = (conversation, toolsUsed) => {
  const hasBookedCallback = toolsUsed.some(t => t.name === 'book_callback');
  if (hasBookedCallback) return 'handoff';

  const hasScheduledFollowup = toolsUsed.some(t => t.name === 'schedule_followup');
  if (hasScheduledFollowup) return conversation.stage;

  const msgCount = conversation.messages?.length || 0;
  const objCount = conversation.context?.objections?.length || 0;

  if (objCount > 0) return 'objection_handling';
  if (msgCount >= 4) return 'qualification';
  return conversation.stage || 'initial_reply';
};

describe('inferStage', () => {
  it('book_callback -> handoff', () => {
    const conv = { stage: 'qualification', messages: [], context: {} };
    const tools = [{ name: 'book_callback' }];
    expect(inferStage(conv, tools)).toBe('handoff');
  });

  it('schedule_followup -> mantiene stage corrente', () => {
    const conv = { stage: 'objection_handling', messages: [], context: {} };
    const tools = [{ name: 'schedule_followup' }];
    expect(inferStage(conv, tools)).toBe('objection_handling');
  });

  it('obiezioni presenti -> objection_handling', () => {
    const conv = { stage: 'initial_reply', messages: [1, 2], context: { objections: ['no_tempo'] } };
    expect(inferStage(conv, [])).toBe('objection_handling');
  });

  it('4+ messaggi senza obiezioni -> qualification', () => {
    const conv = { stage: 'initial_reply', messages: [1, 2, 3, 4], context: { objections: [] } };
    expect(inferStage(conv, [])).toBe('qualification');
  });

  it('pochi messaggi, nessuna obiezione -> stage corrente', () => {
    const conv = { stage: 'initial_reply', messages: [1], context: { objections: [] } };
    expect(inferStage(conv, [])).toBe('initial_reply');
  });

  it('nessuno stage impostato -> initial_reply default', () => {
    const conv = { messages: [], context: {} };
    expect(inferStage(conv, [])).toBe('initial_reply');
  });

  it('book_callback ha priorita su tutto', () => {
    const conv = { stage: 'initial_reply', messages: [1, 2, 3, 4, 5], context: { objections: ['prezzo', 'no_tempo'] } };
    const tools = [{ name: 'book_callback' }, { name: 'schedule_followup' }];
    expect(inferStage(conv, tools)).toBe('handoff');
  });
});
