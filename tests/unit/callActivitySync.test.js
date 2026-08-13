import { describe, it, expect } from 'vitest';
import {
  resolveActivityNotes,
  buildCallActivityDescription,
  mapTwilioStatusToOutcome,
} from '../../services/callActivitySyncService.js';

describe('resolveActivityNotes', () => {
  it('riusa le note esistenti se il webhook omette notes', () => {
    expect(resolveActivityNotes(undefined, 'Richiamare lunedì')).toBe('Richiamare lunedì');
    expect(resolveActivityNotes(null, 'Richiamare lunedì')).toBe('Richiamare lunedì');
  });

  it('sovrascrive quando le note arrivano esplicitamente', () => {
    expect(resolveActivityNotes('  nuove note  ', 'vecchie')).toBe('nuove note');
    expect(resolveActivityNotes('', 'vecchie')).toBe('');
  });

  it('restituisce stringa vuota se non ci sono note', () => {
    expect(resolveActivityNotes(undefined, undefined)).toBe('');
  });
});

describe('buildCallActivityDescription', () => {
  it('include le note nel description', () => {
    expect(buildCallActivityDescription('callback', 90, 'Richiamare')).toBe(
      'Chiamata completata - callback (1:30)\n\nRichiamare'
    );
  });

  it('non cancella il testo se le note sono vuote', () => {
    expect(buildCallActivityDescription('no-answer', 0, '')).toBe(
      'Chiamata completata - no-answer'
    );
  });
});

describe('mapTwilioStatusToOutcome', () => {
  it('mappa gli stati Twilio', () => {
    expect(mapTwilioStatusToOutcome('no-answer')).toBe('no-answer');
    expect(mapTwilioStatusToOutcome('completed')).toBe('not-logged');
  });
});
