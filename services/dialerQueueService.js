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

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Status “da lavorare” nel power dialer: mai contattati + da richiamare. */
export const DIALER_ACTIONABLE_STATUSES = ['da contattare', 'da richiamare'];

function applyStatusFilter(filter, status) {
  const resolvedStatus = (status || 'actionable').toString().trim();
  if (!resolvedStatus || resolvedStatus === 'all') {
    return { filter, resolvedStatus: resolvedStatus || 'all' };
  }
  if (resolvedStatus === 'actionable') {
    return {
      filter: { ...filter, status: { $in: DIALER_ACTIONABLE_STATUSES } },
      resolvedStatus: 'actionable',
    };
  }
  if (resolvedStatus.includes(',')) {
    const list = resolvedStatus
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      filter: { ...filter, status: { $in: list } },
      resolvedStatus,
    };
  }
  return { filter: { ...filter, status: resolvedStatus }, resolvedStatus };
}

function buildBaseQueueFilter({ user, list, status, owner }) {
  const resolvedList = (list || COLD_CALL_DEFAULT_LIST).toString();

  let filter = {
    lists: resolvedList,
    phone: { $exists: true, $type: 'string', $regex: /^\s*\+[0-9]/ },
    'properties.nearbyVerified': { $ne: false },
    ...buildContactOwnerFilter(user, owner),
  };

  const statusApplied = applyStatusFilter(filter, status);
  filter = statusApplied.filter;
  const resolvedStatus = statusApplied.resolvedStatus;

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

  return { filter, resolvedList, resolvedStatus };
}

function applyCityFilter(filter, city) {
  const cityTrim = city != null ? String(city).trim() : '';
  if (!cityTrim || cityTrim === 'all') return filter;

  const cityRe = new RegExp(`^${escapeRegex(cityTrim)}$`, 'i');
  const cityClause = {
    $or: [
      { 'properties.city': cityRe },
      { 'properties.visibilityCard.contact.city': cityRe },
      { 'properties.visibilityCard.place.address': new RegExp(escapeRegex(cityTrim), 'i') },
    ],
  };

  if (Array.isArray(filter.$and)) {
    return { ...filter, $and: [...filter.$and, cityClause] };
  }
  return { ...filter, $and: [cityClause] };
}

/**
 * @returns {{ contacts: object[], total: number, list: string, status: string, city: string, cities: {name:string,count:number}[], limit: number, offset: number }}
 */
export async function fetchDialerQueue({ user, list, status, limit, offset, owner, city }) {
  const resolvedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const resolvedOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const cityTrim = city != null ? String(city).trim() : '';
  const resolvedCity = !cityTrim || cityTrim === 'all' ? 'all' : cityTrim;

  const { filter: baseFilter, resolvedList, resolvedStatus } = buildBaseQueueFilter({
    user,
    list,
    status,
    owner,
  });
  const filter = applyCityFilter(baseFilter, resolvedCity);

  const [total, contacts, cityFacet] = await Promise.all([
    Contact.countDocuments(filter),
    Contact.find(filter)
      .select(
        'name phone email status lists owner source properties.cliente_vicino properties.dist_m properties.dist_km properties.city properties.category properties.visibilityCard properties.visibilityCardGeneratedAt properties.nearbyVerified properties.nearbyVerifiedDistM properties.nearbyClientStats updatedAt createdAt'
      )
      .populate('owner', 'firstName lastName email role')
      .sort({ 'properties.dist_m': 1, updatedAt: -1 })
      .skip(resolvedOffset)
      .limit(resolvedLimit)
      .lean(),
    Contact.aggregate([
      { $match: baseFilter },
      {
        $project: {
          city: {
            $trim: {
              input: {
                $ifNull: [
                  '$properties.city',
                  { $ifNull: ['$properties.visibilityCard.contact.city', ''] },
                ],
              },
            },
          },
        },
      },
      { $match: { city: { $nin: [null, ''] } } },
      { $group: { _id: '$city', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 80 },
    ]),
  ]);

  const cities = cityFacet.map((row) => ({
    name: row._id,
    count: row.count,
  }));

  const data = contacts.map((c) => {
    const summary = summarizeVisibilityCard(c);
    const cityName =
      (typeof c.properties?.city === 'string' && c.properties.city.trim()) ||
      summary.city ||
      null;
    return {
      _id: c._id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      status: c.status,
      lists: c.lists,
      source: c.source,
      owner: c.owner,
      city: cityName,
      cardSummary: summary.city ? summary : { ...summary, city: cityName },
      hasVisibilityCard: summary.hasVisibilityCard,
      scriptReady: summary.hasVisibilityCard || !!summary.nearbyClient?.name,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
    };
  });

  return {
    contacts: data,
    total,
    list: resolvedList,
    status: resolvedStatus,
    city: resolvedCity,
    cities,
    limit: resolvedLimit,
    offset: resolvedOffset,
  };
}

export default {
  buildContactOwnerFilter,
  isDialablePhone,
  fetchDialerQueue,
  DIALER_ACTIONABLE_STATUSES,
};
