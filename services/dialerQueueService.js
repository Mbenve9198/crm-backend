import mongoose from 'mongoose';
import Contact from '../models/contactModel.js';
import {
  summarizeVisibilityCard,
  COLD_CALL_DEFAULT_LIST,
} from './coldCallScriptService.js';

/**
 * Owner filter allineato a getContacts (agent / manager|admin / else).
 */
export function buildContactOwnerFilter(user, ownerQuery) {
  if (user.role === 'agent') {
    return { owner: user._id };
  }
  if (user.role === 'manager' || user.role === 'admin') {
    if (ownerQuery && ownerQuery !== 'all') {
      if (!mongoose.Types.ObjectId.isValid(ownerQuery)) {
        const err = new Error('owner non valido');
        err.statusCode = 400;
        throw err;
      }
      return { owner: new mongoose.Types.ObjectId(ownerQuery) };
    }
    return {};
  }
  return { owner: user._id };
}

/** Telefono dialabile: + seguito da almeno una cifra (spazi ignorati). */
export function isDialablePhone(phone) {
  if (phone == null) return false;
  return /^\s*\+[0-9]/.test(String(phone));
}

/**
 * @returns {{ contacts: object[], total: number, list: string, status: string, limit: number, offset: number }}
 */
export async function fetchDialerQueue({ user, list, status, limit, offset, owner }) {
  const resolvedList = (list || COLD_CALL_DEFAULT_LIST).toString();
  const resolvedStatus = (status || 'da contattare').toString();
  const resolvedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const resolvedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const filter = {
    lists: resolvedList,
    // Allineato a isDialablePhone: + seguito da almeno una cifra
    phone: { $exists: true, $type: 'string', $regex: /^\s*\+[0-9]/ },
    // Escludi lead già re-geo come NON vicini al cliente Menu Chat
    'properties.nearbyVerified': { $ne: false },
    ...buildContactOwnerFilter(user, owner),
  };

  if (resolvedStatus && resolvedStatus !== 'all') {
    filter.status = resolvedStatus;
  }

  // Per la lista Vicini: richiedi ancora + dist_m import ≤ 1km (re-geo fine-grain in enrich)
  if (resolvedList === COLD_CALL_DEFAULT_LIST) {
    filter['properties.cliente_vicino'] = { $exists: true, $nin: [null, ''] };
    filter.$expr = {
      $lte: [
        {
          $convert: {
            input: '$properties.dist_m',
            to: 'double',
            onError: 1e12,
            onNull: 1e12,
          },
        },
        1000,
      ],
    };
  }

  const [total, contacts] = await Promise.all([
    Contact.countDocuments(filter),
    Contact.find(filter)
      .select('name phone email status lists owner source properties.cliente_vicino properties.dist_m properties.dist_km properties.city properties.category properties.visibilityCard properties.visibilityCardGeneratedAt properties.nearbyVerified properties.nearbyVerifiedDistM properties.nearbyClientStats updatedAt createdAt')
      .populate('owner', 'firstName lastName email role')
      .sort({ 'properties.dist_m': 1, updatedAt: -1 })
      .skip(resolvedOffset)
      .limit(resolvedLimit)
      .lean(),
  ]);

  const data = contacts.map((c) => {
    const summary = summarizeVisibilityCard(c);
    return {
      _id: c._id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      status: c.status,
      lists: c.lists,
      source: c.source,
      owner: c.owner,
      cardSummary: summary,
      hasVisibilityCard: summary.hasVisibilityCard,
      scriptReady: summary.hasVisibilityCard || !!(summary.nearbyClient?.name),
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
    };
  });

  return {
    contacts: data,
    total,
    list: resolvedList,
    status: resolvedStatus,
    limit: resolvedLimit,
    offset: resolvedOffset,
  };
}

export default {
  buildContactOwnerFilter,
  isDialablePhone,
  fetchDialerQueue,
};
