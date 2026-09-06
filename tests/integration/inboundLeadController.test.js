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
