import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('Prompt Injection Red Team (multi-agent)', () => {
  it('strategist prompt NON contiene descrizione prodotto dettagliata', () => {
    const source = fs.readFileSync(new URL('../../services/agents/prompts/strategist.js', import.meta.url), 'utf-8');
    expect(source).not.toContain('QR code sui tuoi tavoli');
    expect(source).not.toContain('filtro intelligente');
    expect(source).toContain('strategist');
  });

  it('writer prompt NON contiene descrizione prodotto', () => {
    const source = fs.readFileSync(new URL('../../services/agents/prompts/writer.js', import.meta.url), 'utf-8');
    expect(source).not.toContain('QR code');
    expect(source).not.toContain('WhatsApp bot');
    expect(source).not.toContain('filtro recensioni');
  });

  it('writer prompt impone identita e firma', () => {
    const source = fs.readFileSync(new URL('../../services/agents/prompts/writer.js', import.meta.url), 'utf-8');
    expect(source).toContain('identity.name');
    expect(source).toContain('identity.surname');
    expect(source).toContain('Firma solo');
  });

  it('writer prompt ha regole anti-allucinazione', () => {
    const source = fs.readFileSync(new URL('../../services/agents/prompts/writer.js', import.meta.url), 'utf-8');
    expect(source).toContain('NON inventare MAI');
    expect(source).toContain('NON attribuire al lead');
  });

  it('reviewer prompt controlla prezzo numerico al primo contatto ma permette prova gratuita', () => {
    const source = fs.readFileSync(new URL('../../services/agents/prompts/reviewer.js', import.meta.url), 'utf-8');
    expect(source).toContain('isFirstContact');
    expect(source).toContain('PREZZO NUMERICO');
    expect(source).toContain('prova gratuita');
  });

  it('reviewer prompt controlla meccanismo tecnico', () => {
    const source = fs.readFileSync(new URL('../../services/agents/prompts/reviewer.js', import.meta.url), 'utf-8');
    expect(source).toContain('QR code');
    expect(source).toContain('WhatsApp bot');
    expect(source).toContain('filtro recensioni');
  });

  it('reviewer prompt controlla allucinazioni vs dati disponibili', () => {
    const source = fs.readFileSync(new URL('../../services/agents/prompts/reviewer.js', import.meta.url), 'utf-8');
    expect(source).toContain('ALLUCINAZIONE');
    expect(source).toContain('DATI DISPONIBILI');
  });

  it('reviewer prompt controlla videochiamate', () => {
    const source = fs.readFileSync(new URL('../../services/agents/prompts/reviewer.js', import.meta.url), 'utf-8');
    expect(source).toContain('Zoom');
    expect(source).toContain('Google Meet');
  });

  it('playbook rank checker vieta prezzo e meccanismo', async () => {
    const playbook = (await import('../../services/agents/playbooks/inbound_rankchecker.js')).default;
    const doNotJoined = playbook.doNot.join(' ').toLowerCase();
    expect(doNotJoined).toContain('prezzo');
    expect(doNotJoined).toContain('qr');
    expect(doNotJoined).toContain('whatsapp');
  });

  it('playbook outbound vieta prezzo pieno e meccanismo ma propone chiamata', async () => {
    const playbook = (await import('../../services/agents/playbooks/outbound_initial.js')).default;
    const doNotJoined = playbook.doNot.join(' ').toLowerCase();
    expect(doNotJoined).toContain('1.290');
    expect(doNotJoined).toContain('qr');
    expect(playbook.objective.toLowerCase()).toContain('chiamata');
  });
});
