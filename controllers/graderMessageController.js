import Contact from '../models/contactModel.js';
import Conversation from '../models/conversationModel.js';
import { resolveInboundContact } from '../services/inboundContactIdentityService.js';
import { inputError, optionalInstant, optionalText, optionalUuid } from '../services/graderIntakeService.js';

export const receiveGraderMessages = async (req, res) => {
  try {
    const body = req.body;
    const graderLeadId = optionalUuid(body.graderLeadId, 'graderLeadId');
    const restaurantId = optionalUuid(body.restaurantId, 'restaurantId');
    if (!graderLeadId || !restaurantId || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 50) {
      throw inputError('graderLeadId, restaurantId e da 1 a 50 messaggi richiesti');
    }
    const messages = body.messages.map(msg => {
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw inputError('Messaggio non valido');
      const externalId = optionalText(msg.id, 'message.id', 200);
      const createdAt = optionalInstant(msg.createdAt, 'message.createdAt');
      if (!externalId || !createdAt || !['lead', 'agent'].includes(msg.role)
          || typeof msg.content !== 'string' || !msg.content.trim() || msg.content.length > 4000
          || new Date(createdAt).getTime() > Date.now() + 300000) throw inputError('Messaggio non valido');
      return { externalId, role: msg.role, content: msg.content, channel: 'whatsapp', createdAt: new Date(createdAt),
        metadata: { source: 'menuchat-v2', wasAutoSent: msg.role === 'agent', isAutoresponder: msg.isAutoresponder === true } };
    });
    const contact = await resolveInboundContact({ graderLeadId });
    if (!contact) return res.status(404).json({ success: false, message: 'Contatto non trovato' });
    const externalThreadId = `v2:${contact._id}:${restaurantId}`;
    let conversation;
    try {
      conversation = await Conversation.findOneAndUpdate({ externalThreadId }, { $setOnInsert: {
        contact: contact._id, channel: 'whatsapp', status: 'paused', stage: 'engaged', messages: [],
      } }, { upsert: true, new: true, runValidators: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      conversation = await Conversation.findOne({ externalThreadId });
      if (!conversation) throw error;
    }
    for (const message of messages) {
      const humanLead = message.role === 'lead' && !message.metadata.isAutoresponder;
      await Conversation.updateOne({ _id: conversation._id, 'messages.externalId': { $ne: message.externalId } }, {
        $push: { messages: message },
        $inc: { 'metrics.messagesCount': 1, 'metrics.agentMessagesCount': message.role === 'agent' ? 1 : 0, 'metrics.leadMessagesCount': humanLead ? 1 : 0 },
      }, { runValidators: true });
    }
    // Recompute from persisted messages, so retrying does not inflate the badge.
    const threads = await Conversation.find({ contact: contact._id, channel: 'whatsapp' }).select('messages.role messages.metadata messages.createdAt').lean();
    const all = threads.flatMap(thread => thread.messages || []);
    const human = all.filter(msg => msg.role === 'lead' && !msg.metadata?.isAutoresponder);
    const engagement = human.length ? 'engaged' : all.some(msg => msg.metadata?.isAutoresponder) ? 'autoresponder_only' : all.length ? 'outbound_only' : 'empty';
    const latestHuman = human.reduce((latest, msg) => Math.max(latest, new Date(msg.createdAt).getTime()), 0);
    // Imported threads are append-only: an older concurrent refresh cannot lower engagement.
    const rank = { empty: 0, outbound_only: 1, autoresponder_only: 2, engaged: 3 }[engagement];
    await Contact.updateOne({ _id: contact._id }, [{ $set: {
      'properties.waLeadMessageCount': { $max: [{ $ifNull: ['$properties.waLeadMessageCount', 0] }, human.length] },
      'properties.waEngagementStatus': { $cond: [{ $gte: [rank, { $ifNull: ['$properties.waEngagementRank', 0] }] }, engagement, '$properties.waEngagementStatus'] },
      'properties.waEngagementRank': { $max: [{ $ifNull: ['$properties.waEngagementRank', 0] }, rank] },
      'properties.waLastSyncedAt': new Date().toISOString(),
      ...(latestHuman ? { lastActivityAt: { $max: ['$lastActivityAt', new Date(latestHuman)] } } : {}),
    } }]);
    return res.json({ success: true, conversationId: conversation._id });
  } catch (error) {
    console.error('[grader-messages] Failed', { code: error.status || 500 });
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Sincronizzazione messaggi fallita' });
  }
};
