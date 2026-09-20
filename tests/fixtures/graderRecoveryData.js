export const recoveryData = {
  version: 1, keyword: 'trattoria', scanId: '22222222-2222-4222-8222-222222222222', capturedAt: '2026-09-20T09:00:00Z',
  restaurantCity: 'Roma', website: 'https://locale.test', menuUrl: 'https://locale.test/menu', sourcePages: ['https://locale.test/contatti'],
  rankingResults: {
    mainResult: { rank: 2, zoneSize: 3, rankSource: 'local_pack', verdictCase: 'top3' },
    userRestaurant: { rank: 2, name: 'Locale Test', address: 'Via Roma 1', rating: 4.8, reviews: 100,
      monthlyReviews: 8, recent7Days: 0, coordinates: { lat: 0, lng: 12.5 } },
    analysis: { rank: 2, competitorsAhead: 1, totalResultsFound: 3, zoneAverageRating: 4.5,
      zoneAverageReviews: 80, monthlyReviews: 8, recent7Days: 0, leaderRecent7Days: 4, velocityLevel: 'low' },
    strategicResults: [{ kind: 'venue', rank: 2, placeName: 'Centro', lat: 0, lon: 12.5 }],
    competitors: [{ name: 'Primo', rank: 1, totalReviews: 200 }],
  },
};
