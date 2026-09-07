import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resendSendMock } = vi.hoisted(() => ({
  resendSendMock: vi.fn()
}));

vi.mock('resend', () => ({
  Resend: class {
    constructor() {
      this.emails = { send: resendSendMock };
    }
  }
}));

const importNotificationService = async ({ withApiKey = true } = {}) => {
  if (withApiKey) {
    process.env.RESEND_API_KEY = 'test-resend-key';
  } else {
    delete process.env.RESEND_API_KEY;
  }
  vi.resetModules();
  return import('../../services/emailNotificationService.js');
};

beforeEach(() => {
  resendSendMock.mockReset();
  resendSendMock.mockResolvedValue({ data: { id: 'email-test-id' } });
});

afterEach(() => {
  process.env.RESEND_API_KEY = 'test-resend-key';
});

describe('sendInboundLeadNotification', () => {
  it('gestisce rankCheckerData parziale o malformato senza lanciare', async () => {
    const { sendInboundLeadNotification } = await importNotificationService();

    await expect(sendInboundLeadNotification({
      contact: {
        _id: 'contact-test',
        name: 'Locale <Test>',
        phone: '+39 340 123 4567',
        email: 'grader-393401234567@grader.menuchat.it', // pragma: allowlist secret
        properties: {}
      },
      isNew: true,
      leadSource: 'grader-posizione',
      rankCheckerData: {
        syntheticEmail: true,
        keyword: { valore: 'non valido' },
        ranking: {
          mainRank: { valore: 12 },
          strategicResults: { non: 'un array' }
        },
        restaurantData: 'dato-non-valido',
        dailyCovers: { valore: 50 }
      },
      reportLink: 'javascript:alert(1)',
      callRequest: null
    })).resolves.toMatchObject({ success: true });

    expect(resendSendMock).toHaveBeenCalledOnce();
    const email = resendSendMock.mock.calls[0][0];
    expect(email.subject).toContain('Nuovo lead grader');
    expect(email.html).toContain('indirizzo sintetico, non scrivere');
    const pointsSection = email.html.match(/<ol[^>]*>(.*?)<\/ol>/)?.[1] || '';
    expect(pointsSection).toContain('Nessun punto letto');
    expect(email.html).not.toContain('javascript:alert');
  });

  it('rende i punti strategici col payload vero del worker', async () => {
    const { sendInboundLeadNotification } = await importNotificationService();

    await sendInboundLeadNotification({
      contact: {
        _id: 'contact-strategic',
        name: 'Trattoria da Mario',
        phone: '+393401112233',
        email: 'grader-393401112233@grader.[REDACTED].it', // pragma: allowlist secret
        properties: {}
      },
      isNew: true,
      leadSource: 'grader-posizione',
      rankCheckerData: {
        syntheticEmail: true,
        keyword: 'ristorante bologna',
        ranking: {
          mainRank: 4,
          strategicResults: [
            { kind: 'venue', placeName: null, rank: 4, packSize: 10, outOfPack: false, unavailable: false },
            { kind: 'station', placeName: 'Bologna Centrale', rank: 7, packSize: 10, outOfPack: false, unavailable: false },
            { kind: 'lodging', placeName: 'Hotel Centrale', rank: null, packSize: 10, outOfPack: true, unavailable: false },
            { kind: 'landmark', placeName: 'Due Torri', rank: null, packSize: 0, outOfPack: false, unavailable: true }
          ]
        },
        restaurantData: { address: 'Via Saragozza 12, Bologna, BO' }
      },
      reportLink: 'https://grader.[REDACTED].it/posizione/r/tok', // pragma: allowlist secret
      callRequest: {
        requested: true,
        preference: 'lunedì 7 settembre 2026, ore 10-12',
        requestedAt: '2026-09-05T17:00:00.000Z',
        note: null
      }
    });

    const email = resendSendMock.mock.calls[0][0];
    const pointsSection = email.html.match(/<ol[^>]*>(.*?)<\/ol>/)?.[1] || '';

    // Il punto senza nome da Places prende l'etichetta del tipo, non «Punto N».
    expect(pointsSection).toContain('Dal locale');
    expect(pointsSection).not.toContain('Punto 1');
    expect(pointsSection).toContain('Bologna Centrale');
    expect(pointsSection).toContain('#7 su 10');
    // Fuori dal pack e lettura fallita restano due esiti distinti.
    expect(pointsSection).toContain('fuori dal pack');
    expect(pointsSection).toContain('lettura non disponibile');
    // Solo i punti davvero letti: nessun riempimento a cinque.
    expect(pointsSection.match(/<li/g)).toHaveLength(4);

    // La preferenza arriva già formattata: non va spezzata in Giorno/Fascia.
    expect(email.html).toContain('lunedì 7 settembre 2026, ore 10-12');
    expect(email.html).not.toContain('<strong>Giorno:</strong> N/D');
  });

  it('neutralizza HTML e header injection nel template Smartlead', async () => {
    const { sendSmartleadInterestedNotification } = await importNotificationService();

    await sendSmartleadInterestedNotification({
      email: 'lead@example.com',
      name: 'Mario\r\nBcc: attaccante@example.com',
      phone: '+39 340 111 2233',
      campaignName: 'Campagna <b>bold</b>',
      replyText: '</div><a href="https://phishing.example">clicca qui</a>',
      aiClassification: { confidence: 0.8, reason: '<script>alert(1)</script>' },
      subject: 'Re: offerta',
      website: 'javascript:alert(1)',
      location: 'Bologna',
      customFields: { '<b>chiave</b>': '<img src=x onerror=alert(1)>' }
    });

    const email = resendSendMock.mock.calls[0][0];
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<a href="https://phishing.example"');
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).not.toContain('javascript:alert');
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it('usa i destinatari Smartlead e crea la variante richiesta chiamata', async () => {
    const {
      sendInboundLeadNotification,
      sendSmartleadInterestedNotification
    } = await importNotificationService();

    await sendInboundLeadNotification({
      contact: {
        _id: 'contact-call',
        name: 'Osteria Centrale',
        phone: '+393401234567',
        email: 'titolare@osteriacentrale.it',
        properties: {}
      },
      isNew: false,
      leadSource: 'grader-posizione',
      rankCheckerData: {
        keyword: 'ristorante centro',
        ranking: {
          mainRank: 9,
          strategicResults: [{ rank: 9 }, { rank: null }]
        },
        restaurantData: {
          address: 'Via Centrale 1, Bologna, BO',
          rating: 4.4,
          reviewCount: 87
        },
        dailyCovers: 60,
        estimatedMonthlyReviews: 12,
        hasDigitalMenu: false,
        willingToAdoptMenu: true
      },
      reportLink: 'https://grader.menuchat.it/report/call', // pragma: allowlist secret
      callRequest: {
        requested: true,
        preference: { day: 'Lunedì', timeSlot: '10:00-12:00' },
        requestedAt: '2026-09-05T17:00:00.000Z',
        note: 'Chiamare il titolare'
      }
    });
    const inboundEmail = resendSendMock.mock.calls[0][0];

    await sendSmartleadInterestedNotification({
      email: 'lead@example.com',
      name: 'Lead Smartlead',
      aiClassification: { confidence: 0.9 }
    });
    const smartleadEmail = resendSendMock.mock.calls[1][0];

    expect(inboundEmail.to).toEqual(smartleadEmail.to);
    expect(inboundEmail.bcc).toEqual(smartleadEmail.bcc);
    expect(inboundEmail.subject).toContain('📞 Chiamata richiesta dal lead grader');
    expect(inboundEmail.subject).toContain('#9');
    expect(inboundEmail.html).toContain('Lunedì');
    expect(inboundEmail.html).toContain('10:00-12:00');
    expect(inboundEmail.html).toContain('https://wa.me/393401234567');
    expect(inboundEmail.html).toContain('/contacts/contact-call');
  });

  it('non rilancia quando Resend fallisce', async () => {
    resendSendMock.mockRejectedValueOnce(new Error('Resend non disponibile'));
    const { sendInboundLeadNotification } = await importNotificationService();

    await expect(sendInboundLeadNotification({
      contact: { name: 'Locale Test' },
      rankCheckerData: {}
    })).resolves.toMatchObject({ success: false });
  });

  it('gestisce una risposta di errore restituita da Resend', async () => {
    resendSendMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Mittente non valido' }
    });
    const { sendInboundLeadNotification } = await importNotificationService();

    await expect(sendInboundLeadNotification({
      contact: { name: 'Locale Test' },
      rankCheckerData: {}
    })).resolves.toEqual({
      success: false,
      error: 'Mittente non valido'
    });
  });

  it('ritorna senza inviare se RESEND_API_KEY manca', async () => {
    const { sendInboundLeadNotification } = await importNotificationService({
      withApiKey: false
    });

    await expect(sendInboundLeadNotification({
      contact: { name: 'Locale Test' },
      rankCheckerData: {}
    })).resolves.toMatchObject({
      success: false,
      error: 'Resend non configurato'
    });
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});
