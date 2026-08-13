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

const QUEUE_CONTACT_SELECT =
  'name phone email status lists owner source properties.cliente_vicino properties.dist_m properties.dist_km properties.city properties.category properties.visibilityCard properties.visibilityCardGeneratedAt properties.nearbyVerified properties.nearbyVerifiedDistM properties.nearbyClientStats properties.callbackAt properties.callbackNote updatedAt createdAt';

export function andFilter(filter, clause) {
  const extra = Array.isArray(filter.$and) ? [...filter.$and] : [];
  extra.push(clause);
  return { ...filter, $and: extra };
}

export function dueCallbackClause(nowIso) {
  return {
    status: 'da richiamare',
    'properties.callbackAt': { $exists: true, $nin: [null, ''], $lte: nowIso },
  };
}

/** Nasconde i richiami futuri: restano in coda solo quelli senza data o già scaduti. */
export function notFutureCallbackClause(nowIso) {
  return {
    $or: [
      { 'properties.callbackAt': { $exists: false } },
      { 'properties.callbackAt': null },
      { 'properties.callbackAt': { $lte: nowIso } },
    ],
  };
}

/**
 * Default "da contattare": include anche i richiami già scaduti (callbackAt <= now)
 * così riappaiono in coda all'orario fissato.
 */
export function applyCallbackQueueRules(filter, resolvedStatus, nowIso) {
  if (resolvedStatus === 'da contattare') {
    const next = { ...filter };
    delete next.status;
    return andFilter(next, {
      $or: [{ status: 'da contattare' }, dueCallbackClause(nowIso)],
    });
  }
  return andFilter(filter, notFutureCallbackClause(nowIso));
}

function buildBaseQueueFilter({ user, list, status, owner }) {
  const resolvedList = (list || COLD_CALL_DEFAULT_LIST).toString();
  const resolvedStatus = (status || 'da contattare').toString();

  const filter = {
    lists: resolvedList,
    phone: { $exists: true, $type: 'string', $regex: /^\s*\+[0-9]/ },
    'properties.nearbyVerified': { $ne: false },
    ...buildContactOwnerFilter(user, owner),
  };

  if (resolvedStatus && resolvedStatus !== 'all') {
    filter.status = resolvedStatus;
  }

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

function mapQueueContact(c) {
  const summary = summarizeVisibilityCard(c);
  const cityName =
    (typeof c.properties?.city === 'string' && c.properties.city.trim()) ||
    summary.city ||
    null;
  const callbackAt = c.properties?.callbackAt || null;
  const callbackNote = c.properties?.callbackNote || null;
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
    callbackAt,
    callbackNote,
    cardSummary: summary.city ? summary : { ...summary, city: cityName },
    hasVisibilityCard: summary.hasVisibilityCard,
    scriptReady: summary.hasVisibilityCard || !!summary.nearbyClient?.name,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
  };
}

function queueFind(filter, { sort, skip = 0, limit }) {
  let q = Contact.find(filter)
    .select(QUEUE_CONTACT_SELECT)
    .populate('owner', 'firstName lastName email role')
    .sort(sort);
  if (skip) q = q.skip(skip);
  if (limit != null) q = q.limit(limit);
  return q.lean();
}

/**
 * @returns {{ contacts: object[], total: number, list: string, status: string, city: string, cities: {name:string,count:number}[], limit: number, offset: number }}
 */
export async function fetchDialerQueue({ user, list, status, limit, offset, owner, city }) {
  const resolvedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const resolvedOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const cityTrim = city != null ? String(city).trim() : '';
  const resolvedCity = !cityTrim || cityTrim === 'all' ? 'all' : cityTrim;
  const nowIso = new Date().toISOString();

  const { filter: baseFilter, resolvedList, resolvedStatus } = buildBaseQueueFilter({
    user,
    list,
    status,
    owner,
  });
  const callbackAwareBase = applyCallbackQueueRules(baseFilter, resolvedStatus, nowIso);
  const filter = applyCityFilter(callbackAwareBase, resolvedCity);

  const distSort = { 'properties.dist_m': 1, updatedAt: -1 };
  const callbackSort = { 'properties.callbackAt': 1, 'properties.dist_m': 1, updatedAt: -1 };
  const includeDueFirst =
    resolvedOffset === 0 &&
    (resolvedStatus === 'da contattare' || resolvedStatus === 'all');

  let total;
  let contacts;

  if (includeDueFirst) {
    const withoutStatus = { ...baseFilter };
    delete withoutStatus.status;
    const dueFilter = applyCityFilter(
      { ...withoutStatus, ...dueCallbackClause(nowIso) },
      resolvedCity
    );

    const dueContacts = await queueFind(dueFilter, {
      sort: { 'properties.callbackAt': 1 },
      limit: resolvedLimit,
    });
    const dueIds = dueContacts.map((c) => c._id);
    const restLimit = Math.max(resolvedLimit - dueContacts.length, 0);
    const restFilter = dueIds.length ? { ...filter, _id: { $nin: dueIds } } : filter;

    const [restTotal, restContacts, dueTotal] = await Promise.all([
      Contact.countDocuments(restFilter),
      restLimit > 0
        ? queueFind(restFilter, { sort: distSort, limit: restLimit })
        : Promise.resolve([]),
      Contact.countDocuments(dueFilter),
    ]);

    contacts = [...dueContacts, ...restContacts];
    total = dueTotal + restTotal;
  } else {
    const sort = resolvedStatus === 'da richiamare' ? callbackSort : distSort;
    [total, contacts] = await Promise.all([
      Contact.countDocuments(filter),
      queueFind(filter, { sort, skip: resolvedOffset, limit: resolvedLimit }),
    ]);
  }

  const cityFacet = await Contact.aggregate([
    { $match: callbackAwareBase },
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
  ]);

  const cities = cityFacet.map((row) => ({
    name: row._id,
    count: row.count,
  }));

  return {
    contacts: contacts.map(mapQueueContact),
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
  applyCallbackQueueRules,
  dueCallbackClause,
  notFutureCallbackClause,
};
