import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../setup/dbSetup.js';
import Contact from '../../models/contactModel.js';
import Conversation from '../../models/conversationModel.js';
import { receiveGraderMessages } from '../../controllers/graderMessageController.js';

const lead = '11111111-1111-4111-8111-111111111111';
const restaurant = '22222222-2222-4222-8222-222222222222';
beforeAll(async () => { await connectTestDB(); await Promise.all([Contact.init(), Conversation.init()]); });
afterAll(disconnectTestDB);
afterEach(clearTestDB);
const post = async body => {
  const res = { code: 200 };
  res.status = code => { res.code = code; return res; };
  res.json = value => { res.body = value; return res; };
  await receiveGraderMessages({ body }, res);
  return res;
};
const message = { id: 'in:SM-test:0', role: 'lead', content: 'Vorrei informazioni', createdAt: '2026-01-01T10:00:00Z' };

describe('grader message archive', () => {
  it('returns retryable 404 until lead intake exists', async () => {
    expect((await post({ graderLeadId: lead, restaurantId: restaurant, messages: [message] })).code).toBe(404);
    expect(await Conversation.countDocuments()).toBe(0);
  });
  it('deduplicates concurrent deliveries and keeps the imported agent paused', async () => {
    const contact = await Contact.create({ name: 'Test', createdBy: '111111111111111111111111', graderLeadId: lead, status: 'da contattare' });
    const results = await Promise.all(Array.from({ length: 5 }, () => post({ graderLeadId: lead, restaurantId: restaurant, messages: [message] })));
    expect(results.every(result => result.code === 200)).toBe(true);
    const threads = await Conversation.find({ contact: contact._id });
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(1);
    expect(threads[0].status).toBe('paused');
    expect(threads[0].metrics.leadMessagesCount).toBe(1);
    const saved = await Contact.findById(contact._id);
    expect(saved.status).toBe('da contattare');
    expect(saved.properties.waLeadMessageCount).toBe(1);
    expect(saved.properties.waEngagementStatus).toBe('engaged');
  });
  it('validates a whole batch before persisting anything', async () => {
    await Contact.create({ name: 'Test', createdBy: '111111111111111111111111', graderLeadId: lead });
    expect((await post({ graderLeadId: lead, restaurantId: restaurant, messages: [message, { ...message, id: 'bad', role: 'system' }] })).code).toBe(400);
    expect(await Conversation.countDocuments()).toBe(0);
  });
});
