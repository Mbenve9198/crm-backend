import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import { ownerUser } from '../setup/fixtures.js';
import { syntheticGraderEmail } from '../../services/phoneIdentityService.js';

const { sendInboundLeadNotificationMock } = vi.hoisted(() => ({
  sendInboundLeadNotificationMock: vi.fn(async () => ({ success: true }))
}));

vi.mock('../../services/emailNotificationService.js', () => ({
  sendInboundLeadNotification: sendInboundLeadNotificationMock
}));

let Contact;
let User;
let receiveRankCheckerLead;

const mockResponse = () => {
  const res = { statusCode: 200, body: null };
  res.status = (statusCode) => {
    res.statusCode = statusCode;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

const rankingResults = {
  mainResult: { rank: 7 },
  userRestaurant: {
    rank: 7,
    address: 'Via Roma 10, Firenze, FI',
    rating: 4.3,
    reviews: 128,
    coordinates: { lat: 43.7696, lng: 11.2558 }
  },
  strategicResults: [
    { label: 'Centro', rank: 7 },
    { label: 'Nord', rank: null },
    { label: 'Sud', position: 12 },
    { label: 'Est', rank: 4 },
    { label: 'Ovest', rank: 18 }
  ]
};

const basePayload = {
  restaurantName: 'Trattoria Test',
  phone: '+39 340-123 45 67',
  placeId: 'place-test',
  keyword: 'ristorante firenze',
  rankingResults,
  leadSource: 'grader-posizione',
  reportLink: 'https://grader.menuchat.it/report/test' // pragma: allowlist secret
};

const postLead = async (body) => {
  const req = { body };
  const res = mockResponse();
  await receiveRankCheckerLead(req, res);
  return res;
};

/** Contatto già nel database, come ce lo troviamo quando il lead arriva. */
const seedContact = async (overrides) => {
  const owner = await User.findOne();
  return Contact.create({
    name: 'Trattoria Test',
    source: 'inbound_rank_checker',
    owner: owner._id,
    createdBy: owner._id,
    ...overrides
  });
};

beforeAll(async () => {
  await connectTestDB();
  Contact = (await import('../../models/contactModel.js')).default;
  User = (await import('../../models/userModel.js')).default;
  receiveRankCheckerLead = (
    await import('../../controllers/inboundLeadController.js')
  ).receiveRankCheckerLead;
});

beforeEach(async () => {
  process.env.INBOUND_LEAD_DEFAULT_OWNER_EMAIL = '';
  await User.create(ownerUser);
  sendInboundLeadNotificationMock.mockClear();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

describe('receiveRankCheckerLead', () => {
  it('crea un lead con solo telefono e salva email sintetica e flag', async () => {
    const res = await postLead(basePayload);

    expect(res.statusCode).toBe(201);
    const contact = await Contact.findById(res.body.data.contactId);
    expect(contact.email).toBe('grader-393401234567@grader.menuchat.it'); // pragma: allowlist secret
    expect(contact.rankCheckerData.syntheticEmail).toBe(true);
    expect(contact.source).toBe('inbound_rank_checker');
    expect(contact.lists).toContain('Inbound - Rank Checker');
    expect(sendInboundLeadNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ isNew: true, leadSource: 'grader-posizione' })
    );
    expect(sendInboundLeadNotificationMock.mock.calls[0][0].contact.email).toBe(
      'grader-393401234567@grader.menuchat.it' // pragma: allowlist secret
    );
  });

  it('mantiene deduplica e riattivazione per un lead con email reale', async () => {
    const payload = {
      ...basePayload,
      email: 'INFO@TRATTORIATEST.IT'
    };
    const firstResponse = await postLead(payload);
    const originalContact = await Contact.findById(firstResponse.body.data.contactId);
    originalContact.status = 'contattato';
    await originalContact.save();
    sendInboundLeadNotificationMock.mockClear();

    const secondResponse = await postLead({
      ...payload,
      rankingResults: {
        ...rankingResults,
        mainResult: { rank: 5 }
      }
    });

    expect(secondResponse.statusCode).toBe(200);
    expect(await Contact.countDocuments({ email: 'info@trattoriatest.it' })).toBe(1);
    const updatedContact = await Contact.findById(originalContact._id);
    expect(updatedContact.status).toBe('da contattare');
    expect(updatedContact.reactivatedAt).toBeInstanceOf(Date);
    expect(updatedContact.rankCheckerData.syntheticEmail).not.toBe(true);
    expect(sendInboundLeadNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ isNew: false })
    );
  });

  it('non modifica uno status protetto durante la riattivazione', async () => {
    const payload = {
      ...basePayload,
      email: 'protetto@trattoriatest.it'
    };
    const firstResponse = await postLead(payload);
    const contact = await Contact.findById(firstResponse.body.data.contactId);
    contact.status = 'won';
    contact.mrr = 1290;
    await contact.save();

    const secondResponse = await postLead(payload);

    expect(secondResponse.statusCode).toBe(200);
    const updatedContact = await Contact.findById(contact._id);
    expect(updatedContact.status).toBe('won');
  });

  it('normalizza il telefono e riconosce lo stesso numero in formati diversi', async () => {
    const first = await postLead({ ...basePayload, phone: '3401234567' });
    expect(first.statusCode).toBe(201);
    const contact = await Contact.findById(first.body.data.contactId);
    expect(contact.phone).toBe('+393401234567');

    const second = await postLead({ ...basePayload, phone: '+39 340 123 4567' });
    expect(second.statusCode).toBe(200);
    expect(second.body.data.contactId.toString()).toBe(contact._id.toString());
    expect(await Contact.countDocuments()).toBe(1);
  });

  it('aggancia al contatto esistente il lead che poi porta la sua email vera', async () => {
    const first = await postLead(basePayload);
    const contactId = first.body.data.contactId;

    const second = await postLead({ ...basePayload, email: 'info@trattoriatest.it' });

    expect(second.statusCode).toBe(200);
    expect(second.body.data.contactId.toString()).toBe(contactId.toString());
    expect(await Contact.countDocuments()).toBe(1);
    const updated = await Contact.findById(contactId);
    expect(updated.email).toBe('info@trattoriatest.it');
    expect(updated.rankCheckerData.syntheticEmail).not.toBe(true);
  });

  it('rifiuta un telefono di soli spazi senza email', async () => {
    const res = await postLead({ ...basePayload, phone: '   ' });

    expect(res.statusCode).toBe(400);
    expect(await Contact.countDocuments()).toBe(0);
    expect(sendInboundLeadNotificationMock).not.toHaveBeenCalled();
  });

  it('rifiuta un telefono troppo corto per essere vero', async () => {
    const res = await postLead({ ...basePayload, phone: '12345' });

    expect(res.statusCode).toBe(400);
    expect(await Contact.countDocuments()).toBe(0);
  });

  it('accetta il lead con email valida scartando un telefono non normalizzabile', async () => {
    const res = await postLead({
      ...basePayload,
      phone: 'non un numero',
      email: 'info@trattoriatest.it'
    });

    expect(res.statusCode).toBe(201);
    const contact = await Contact.findById(res.body.data.contactId);
    expect(contact.email).toBe('info@trattoriatest.it');
    expect(contact.phone).toBeUndefined();
    expect(contact.properties.phoneWarning).toContain('E.164');
  });

  it('rifiuta un lead senza email e senza telefono', async () => {
    const res = await postLead({
      restaurantName: 'Trattoria Senza Recapito',
      leadSource: 'grader-posizione'
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('almeno uno tra email e telefono');
    expect(await Contact.countDocuments()).toBe(0);
    expect(sendInboundLeadNotificationMock).not.toHaveBeenCalled();
  });

  it('non notifica un qualification update che non aggiunge dati', async () => {
    await postLead(basePayload);
    sendInboundLeadNotificationMock.mockClear();

    const res = await postLead({
      ...basePayload,
      isQualificationUpdate: true
    });

    expect(res.statusCode).toBe(200);
    expect(sendInboundLeadNotificationMock).not.toHaveBeenCalled();
  });

  it('ritrova il contatto storico che ha il numero con i separatori dentro', async () => {
    // Prima che normalizzassimo i numeri il telefono finiva nel database come
    // arrivava. Se il lookup cercasse solo le due forme canoniche, questo
    // contatto sfuggirebbe e ne nascerebbe un doppione.
    const legacy = await seedContact({
      email: 'storico@trattoriatest.it',
      phone: '+39 340 123 45 67',
      source: 'manual'
    });

    const res = await postLead({ ...basePayload, placeId: 'place-test' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.contactId.toString()).toBe(legacy._id.toString());
    expect(await Contact.countDocuments()).toBe(1);
    // E il numero resta normalizzato, così la volta dopo basta l'indice.
    expect((await Contact.findById(legacy._id)).phone).toBe('+393401234567');
  });

  it('non sovrascrive un contatto che ha un\'altra email vera e un altro locale', async () => {
    const other = await seedContact({
      name: 'Osteria Vicina',
      email: 'titolare@osteriavicina.it',
      phone: '+393401234567',
      rankCheckerData: { placeId: 'place-altro' }
    });

    const res = await postLead({
      ...basePayload,
      email: 'info@trattoriatest.it',
      placeId: 'place-test'
    });

    // Scriverci sopra perderebbe il lead nuovo: nessuna scheda lo
    // rappresenterebbe più. Meglio due schede da fondere a mano.
    expect(res.statusCode).toBe(201);
    expect(res.body.data.contactId.toString()).not.toBe(other._id.toString());
    const untouched = await Contact.findById(other._id);
    expect(untouched.email).toBe('titolare@osteriavicina.it');
    expect(untouched.rankCheckerData.placeId).toBe('place-altro');
  });

  it('aggancia invece il lead quando il numero condiviso è dello stesso locale', async () => {
    const existing = await seedContact({
      email: 'vecchia@trattoriatest.it',
      phone: '+393401234567',
      rankCheckerData: { placeId: 'place-test' }
    });

    const res = await postLead({
      ...basePayload,
      email: 'nuova@trattoriatest.it',
      placeId: 'place-test'
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.contactId.toString()).toBe(existing._id.toString());
    expect(await Contact.countDocuments()).toBe(1);
  });

  it('non rimanda la stessa richiesta di chiamata a ogni retry', async () => {
    const callPayload = {
      ...basePayload,
      isQualificationUpdate: true,
      callRequested: true,
      callPreference: 'Lunedì 10:00-12:00',
      callRequestedAt: '2026-09-05T17:00:00.000Z'
    };

    await postLead(basePayload);
    sendInboundLeadNotificationMock.mockClear();

    await postLead(callPayload);
    expect(sendInboundLeadNotificationMock).toHaveBeenCalledTimes(1);

    // Il retry del worker ripete lo stesso payload: il team è già stato avvisato.
    sendInboundLeadNotificationMock.mockClear();
    await postLead(callPayload);
    expect(sendInboundLeadNotificationMock).not.toHaveBeenCalled();

    // Nemmeno con la nota vuota, che noi salviamo come null.
    sendInboundLeadNotificationMock.mockClear();
    await postLead({ ...callPayload, callNote: '' });
    expect(sendInboundLeadNotificationMock).not.toHaveBeenCalled();
  });

  it('avvisa il team anche quando la scheda nasce da un altro push in parallelo', async () => {
    const saveSpy = vi.spyOn(Contact.prototype, 'save');

    // Il contatto compare fra il nostro lookup e la nostra insert: è la
    // collisione che il ramo di recupero deve gestire senza perdere il payload,
    // richiesta di chiamata compresa.
    saveSpy.mockImplementationOnce(async () => {
      await seedContact({
        email: syntheticGraderEmail('+393401234567'),
        phone: '+393401234567'
      });
      const duplicateKeyError = new Error('E11000 duplicate key error');
      duplicateKeyError.code = 11000;
      throw duplicateKeyError;
    });

    const res = await postLead({
      ...basePayload,
      callRequested: true,
      callPreference: 'Martedì 15:00-17:00',
      callRequestedAt: '2026-09-05T17:00:00.000Z'
    });

    saveSpy.mockRestore();

    expect(res.statusCode).toBe(200);
    expect(await Contact.countDocuments()).toBe(1);
    expect(sendInboundLeadNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callRequest: expect.objectContaining({ preference: 'Martedì 15:00-17:00' })
      })
    );
  });

  it('segnala il doppione sintetico quando vince la scheda con l\'email vera', async () => {
    const synthetic = await seedContact({
      email: syntheticGraderEmail('+393401234567'),
      phone: '+393401234567',
      rankCheckerData: { placeId: 'place-test', syntheticEmail: true }
    });
    const real = await seedContact({
      email: 'info@trattoriatest.it',
      rankCheckerData: { placeId: 'place-test' }
    });

    await postLead({ ...basePayload, email: 'info@trattoriatest.it' });

    // Fondere due documenti da codice è rischioso: li segnaliamo e la fusione
    // la fa chi lavora il CRM.
    const flagged = await Contact.findById(synthetic._id);
    expect(flagged.properties.duplicateOfContactId).toBe(String(real._id));
    expect(flagged.properties.duplicateDetectedAt).toBeTruthy();
  });

  it('notifica una nuova qualificazione e la prima richiesta di chiamata', async () => {
    await postLead(basePayload);
    sendInboundLeadNotificationMock.mockClear();

    await postLead({
      ...basePayload,
      isQualificationUpdate: true,
      dailyCovers: 80
    });
    expect(sendInboundLeadNotificationMock).toHaveBeenCalledTimes(1);

    sendInboundLeadNotificationMock.mockClear();
    await postLead({
      ...basePayload,
      isQualificationUpdate: true,
      dailyCovers: 80,
      callRequested: true,
      callPreference: { day: 'Lunedì', timeSlot: '10:00-12:00' },
      callRequestedAt: '2026-09-05T17:00:00.000Z',
      callNote: 'Chiamare il titolare'
    });

    expect(sendInboundLeadNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isNew: false,
        callRequest: expect.objectContaining({
          requested: true,
          note: 'Chiamare il titolare'
        })
      })
    );
  });
});
