import validator from 'validator';

const invalid = () => Object.assign(new Error('Dati analisi recupero non validi'), { status: 400 });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const present = value => value !== undefined && value !== null && value !== '';

/** Accept the grader analysis only; never accept identity, consent or sales-status overrides. */
export function parseRecoveryData(value) {
  if (value === undefined) return undefined;
  if (!object(value) || value.version !== 1 || typeof value.keyword !== 'string' || !value.keyword.trim()
    || !validator.isUUID(String(value.scanId || '')) || !validator.isISO8601(String(value.capturedAt || ''))
    || !object(value.rankingResults) || !object(value.rankingResults.mainResult)
    || !object(value.rankingResults.userRestaurant) || !object(value.rankingResults.analysis)
    || !Number.isInteger(value.rankingResults.mainResult.rank) || value.rankingResults.mainResult.rank < 1
    || !Array.isArray(value.rankingResults.strategicResults) || !Array.isArray(value.rankingResults.competitors)) throw invalid();
  // Bound the authenticated JSON and reject keys that cannot safely be persisted in Mongo.
  function checkJson(item, depth = 0) {
    if (depth > 12 || typeof item === 'number' && !Number.isFinite(item)) throw invalid();
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (key.startsWith('$') || key.includes('.') || ['__proto__', 'prototype', 'constructor'].includes(key)) throw invalid();
      checkJson(child, depth + 1);
    }
  }
  checkJson(value);
  if (JSON.stringify(value).length > 250_000) throw invalid();
  const result = { version: 1, keyword: value.keyword.trim(), rankingResults: value.rankingResults,
    scanId: value.scanId, capturedAt: value.capturedAt };
  for (const key of ['website', 'menuUrl']) if (value[key] !== undefined) {
    if (typeof value[key] !== 'string' || !validator.isURL(value[key], { protocols: ['http', 'https'], require_protocol: true })) throw invalid();
    result[key] = value[key];
  }
  if (value.restaurantCity !== undefined) {
    if (typeof value.restaurantCity !== 'string' || !value.restaurantCity.trim() || value.restaurantCity.length > 500) throw invalid();
    result.restaurantCity = value.restaurantCity.trim();
  }
  if (!Array.isArray(value.sourcePages) || value.sourcePages.length > 4 || value.sourcePages.some(url =>
    typeof url !== 'string' || !validator.isURL(url, { protocols: ['http', 'https'], require_protocol: true }))) throw invalid();
  result.sourcePages = value.sourcePages;
  if (value.qualificationData !== undefined) {
    if (!object(value.qualificationData)) throw invalid();
    const qualification = {};
    for (const key of ['hasDigitalMenu', 'willingToAdoptMenu']) if (present(value.qualificationData[key])) {
      if (typeof value.qualificationData[key] !== 'boolean') throw invalid();
      qualification[key] = value.qualificationData[key];
    }
    for (const key of ['dailyCovers', 'weeklyCovers', 'estimatedMonthlyReviews']) if (present(value.qualificationData[key])) {
      const number = value.qualificationData[key];
      if (!Number.isSafeInteger(number) || number < (key === 'estimatedMonthlyReviews' ? 0 : 1)) throw invalid();
      qualification[key] = number;
    }
    if (Object.keys(qualification).length) result.qualificationData = qualification;
  }
  return result;
}

/** Fields consumed by the existing grader CRM detail view and internal notification. */
export function recoveryContactData(input) {
  const data = input.graderData;
  if (!data) return {};
  const results = data.rankingResults;
  const restaurant = results.userRestaurant;
  const qualification = data.qualificationData || {};
  const rankCheckerData = { placeId: input.placeId, keyword: data.keyword,
    ranking: { mainRank: results.mainResult.rank, competitorsAhead: results.analysis.competitorsAhead,
      totalResultsFound: results.analysis.totalResultsFound, strategicResults: results.strategicResults, fullResults: results },
    restaurantData: {}, leadCapturedAt: data.capturedAt };
  for (const [key, value] of Object.entries({ address: restaurant.address, rating: restaurant.rating, reviewCount: restaurant.reviews })) {
    if (present(value)) rankCheckerData.restaurantData[key] = value;
  }
  const coordinates = Object.fromEntries(Object.entries(restaurant.coordinates || {}).filter(([, value]) => present(value)));
  if (Object.keys(coordinates).length) rankCheckerData.restaurantData.coordinates = coordinates;
  for (const key of ['hasDigitalMenu', 'willingToAdoptMenu', 'dailyCovers', 'estimatedMonthlyReviews']) {
    if (present(qualification[key])) rankCheckerData[key] = qualification[key];
  }
  const properties = { rankCheckerReport: input.reportUrl,
    googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(input.placeId)}` };
  for (const [key, value] of Object.entries({ restaurantAddress: restaurant.address, restaurantCity: data.restaurantCity,
    website: data.website, menuUrl: data.menuUrl, weeklyCovers: qualification.weeklyCovers })) {
    if (present(value)) properties[key] = value;
  }
  return { rankCheckerData, properties };
}

/** Fill missing grader fields without resetting data entered by sales or a completed form. */
export function recoveryEnrichmentUpdate(input, previous) {
  const fields = recoveryContactData(input);
  const update = {};
  function visit(value, path) {
    const oldValue = path ? path.split('.').reduce((current, key) => current?.[key], previous) : previous;
    if (object(value)) {
      if (path && !present(oldValue)) {
        if (Object.keys(value).length) update[path] = value;
        return;
      }
      if (path && !object(oldValue)) return;
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
      return;
    }
    if (present(value) && !present(oldValue)) update[path] = value;
  }
  visit(fields, '');
  return update;
}
