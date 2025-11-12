import axios from 'axios';

/**
 * Servizio per interagire con Serper API (Google Maps search)
 * Utilizzato per trovare competitor di ristoranti e analizzare ranking
 */

class SerperService {
  constructor() {
    this.apiKey = process.env.SERPER_API_KEY;
    this.mapsApiUrl = 'https://google.serper.dev/maps';
    this.placesApiUrl = 'https://google.serper.dev/places';
  }

  /**
   * Trova coordinate GPS di un ristorante tramite nome e indirizzo/città
   * @param {string} restaurantName - Nome del ristorante
   * @param {string} address - Indirizzo (opzionale)
   * @param {string} city - Città
   * @returns {Promise<Object>} - Coordinate e dati del ristorante
   */
  async geocodeRestaurant(restaurantName, address = null, city = null) {
    try {
      if (!this.apiKey) {
        throw new Error('SERPER_API_KEY non configurata');
      }

      // Costruisci query di ricerca
      let query = restaurantName;
      if (address) {
        query += `, ${address}`;
      }
      if (city) {
        query += `, ${city}`;
      }

      console.log(`📍 Geocoding: "${query}"`);

      const response = await axios.post(
        this.mapsApiUrl,
        {
          q: query,
          num: 5 // Primi 5 risultati per trovare il ristorante giusto
        },
        {
          headers: {
            'X-API-KEY': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const places = response.data.places || [];

      if (places.length === 0) {
        console.log('❌ Nessun risultato trovato per geocoding');
        return null;
      }

      // Prendi il primo risultato (quello più rilevante)
      const place = places[0];
      
      // DEBUG: Mostra struttura completa per capire formato
      console.log(`🔍 DEBUG place keys:`, Object.keys(place));
      console.log(`🔍 DEBUG gpsCoordinates:`, place.gpsCoordinates);
      
      // Estrai coordinate (Serper può usare formati diversi)
      let latitude, longitude;
      
      if (place.gpsCoordinates) {
        latitude = place.gpsCoordinates.latitude;
        longitude = place.gpsCoordinates.longitude;
      } else if (place.latitude !== undefined && place.longitude !== undefined) {
        latitude = place.latitude;
        longitude = place.longitude;
      } else if (place.position) {
        latitude = place.position.lat;
        longitude = place.position.lng;
      }

      console.log(`✅ Trovato: ${place.title}`);
      console.log(`   Coordinate: ${latitude}, ${longitude}`);
      console.log(`   Indirizzo: ${place.address}`);
      console.log(`   Rating: ${place.rating}, Reviews: ${place.reviews || place.ratingCount || 0}`);

      if (!latitude || !longitude) {
        console.error(`❌ ERRORE: Coordinate non trovate in place object`);
        console.error(`   Full place object:`, JSON.stringify(place, null, 2));
        return null;
      }

      return {
        name: place.title,
        latitude: latitude,
        longitude: longitude,
        address: place.address,
        rating: place.rating,
        reviews: place.reviews || place.ratingCount || 0,
        placeId: place.placeId
      };

    } catch (error) {
      console.error('❌ Errore geocoding:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Cerca un ristorante su Google Maps e trova i competitor nelle vicinanze
   * @param {string} restaurantName - Nome del ristorante
   * @param {string} keyword - Parola chiave di ricerca (es. "ristorante italiano")
   * @param {number} lat - Latitudine
   * @param {number} lng - Longitudine
   * @param {number} radius - Raggio di ricerca (default 15z = quartiere)
   * @returns {Promise<Object>} - Dati di ranking e competitor
   */
  async getGoogleMapsRanking(restaurantName, keyword, lat, lng, radius = 15) {
    try {
      if (!this.apiKey) {
        throw new Error('SERPER_API_KEY non configurata');
      }

      // Costruisci query e location (zoom quartiere per risultati locali)
      const ll = `@${lat},${lng},${radius}z`;
      
      console.log(`🔍 Serper: "${keyword}" @ ${ll}`);
      
      const response = await axios.post(
        this.apiUrl,
        {
          q: keyword,
          ll: ll,
          num: 20 // Top 20 risultati
        },
        {
          headers: {
            'X-API-KEY': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
      
      const places = response.data.places || [];
      
      if (places.length === 0) {
        console.log('⚠️  Nessun risultato trovato');
        return null;
      }
      
      // Cerca il ristorante nella lista
      let userRank = null;
      let userIndex = -1;
      
      for (let i = 0; i < places.length; i++) {
        const place = places[i];
        
        // Match per nome (normalizzato)
        const placeName = place.title?.toLowerCase() || '';
        const searchName = restaurantName.toLowerCase();
        
        const isMatch = placeName.includes(searchName) || 
                       searchName.includes(placeName);
        
        if (isMatch) {
          userRank = place.position || (i + 1);
          userIndex = i;
          console.log(`✅ Trovato in posizione #${userRank}`);
          break;
        }
      }
      
      if (!userRank) {
        console.log(`⚠️  "${restaurantName}" non trovato nei primi 20`);
        userRank = 'Fuori Top 20';
      }
      
      // Estrai TOP 3 competitor CHE SONO DAVANTI (rank migliore)
      const competitors = places
        .filter(p => {
          // SOLO quelli con ranking MIGLIORE (numero più basso)
          const placeRank = p.position || (places.indexOf(p) + 1);
          return typeof userRank === 'number' && placeRank < userRank;
        })
        .slice(0, 3)
        .map((place) => ({
          rank: place.position || (places.indexOf(place) + 1),
          name: place.title,
          rating: place.rating,
          reviews: place.reviews || place.ratingCount || 0,
          address: place.address
        }));
      
      return {
        userRank,
        userRating: places[userIndex]?.rating || null,
        userReviews: places[userIndex]?.reviews || places[userIndex]?.ratingCount || 0,
        competitor1: competitors[0] || null,
        competitor2: competitors[1] || null,
        competitor3: competitors[2] || null,
        totalResultsFound: places.length,
        keyword: keyword,
        location: { lat, lng }
      };
      
    } catch (error) {
      console.error(`❌ Errore Serper:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Trova i 3 competitor principali con più recensioni (usato per autopilot)
   * @param {string} restaurantName - Nome del ristorante
   * @param {string} keyword - Parola chiave di ricerca
   * @param {number} lat - Latitudine
   * @param {number} lng - Longitudine
   * @returns {Promise<Array>} - Array dei top 3 competitor
   */
  async getTopCompetitors(restaurantName, keyword, lat, lng) {
    try {
      const rankingData = await this.getGoogleMapsRanking(restaurantName, keyword, lat, lng);
      
      if (!rankingData) {
        return [];
      }

      // Filtra competitor non null e ordina per numero di recensioni
      const competitors = [
        rankingData.competitor1,
        rankingData.competitor2,
        rankingData.competitor3
      ].filter(c => c !== null)
       .sort((a, b) => b.reviews - a.reviews);

      return competitors;
      
    } catch (error) {
      console.error('❌ Errore ottenimento competitor:', error);
      return [];
    }
  }

  /**
   * Analizza il contesto del contatto per generare dati utili al messaggio
   * @param {Object} contact - Contatto da analizzare
   * @returns {Promise<Object>} - Dati di analisi per generazione messaggio
   */
  async analyzeContactContext(contact) {
    try {
      // Estrai dati dal contatto (supporta vari formati di properties)
      const restaurantName = contact.properties?.restaurant_name || contact.name;
      const keyword = contact.properties?.keyword || 'ristorante';
      
      // Supporta sia minuscolo che maiuscolo (database reale ha Città, Indirizzo)
      const city = contact.properties?.Città || contact.properties?.city || contact.properties?.città || null;
      const address = contact.properties?.Indirizzo || contact.properties?.address || contact.properties?.indirizzo || null;
      const userReviews = parseInt(contact.properties?.Recensioni || contact.properties?.recensioni || contact.properties?.reviews || 0);
      const userRating = parseFloat(contact.properties?.Rating || contact.properties?.rating || 0);

      console.log(`🔍 Analisi contatto: ${restaurantName}`);
      console.log(`   Città: ${city || 'N/A'}`);
      console.log(`   Indirizzo: ${address || 'N/A'}`);
      console.log(`   Reviews: ${userReviews}, Rating: ${userRating}`);

      // STEP 1: Geocoding - Trova coordinate del ristorante
      let lat, lng, geocodedData;
      
      // Prova prima con coordinate esistenti
      lat = contact.properties?.latitude;
      lng = contact.properties?.longitude;

      if (!lat || !lng) {
        console.log(`📍 Coordinate mancanti, eseguo geocoding...`);
        
        if (!city && !address) {
          console.warn(`⚠️  Impossibile geocodare: mancano città E indirizzo`);
          return {
            hasData: false,
            error: 'Indirizzo o città necessari per geocoding'
          };
        }

        // Fa geocoding con Serper
        geocodedData = await this.geocodeRestaurant(restaurantName, address, city);
        
        if (!geocodedData || !geocodedData.latitude || !geocodedData.longitude) {
          console.warn(`⚠️  Geocoding fallito per ${restaurantName}`);
          return {
            hasData: false,
            error: 'Geocoding fallito - ristorante non trovato'
          };
        }

        lat = geocodedData.latitude;
        lng = geocodedData.longitude;
        
        console.log(`✅ Coordinate ottenute: ${lat}, ${lng}`);
      } else {
        console.log(`✅ Coordinate già disponibili: ${lat}, ${lng}`);
      }

      // STEP 2: Trova competitor usando le coordinate
      const rankingData = await this.getGoogleMapsRanking(restaurantName, keyword, lat, lng);
      
      if (!rankingData) {
        console.warn(`⚠️  Nessun dato ranking trovato per ${restaurantName}`);
        return {
          hasData: false,
          error: 'Nessun dato ranking trovato'
        };
      }

      // Estrai competitor che sono davanti
      const competitors = [
        rankingData.competitor1,
        rankingData.competitor2,
        rankingData.competitor3
      ].filter(c => c !== null);

      if (competitors.length === 0) {
        console.warn(`⚠️  Nessun competitor trovato per ${restaurantName}`);
        return {
          hasData: false,
          error: 'Nessun competitor trovato'
        };
      }

      return {
        hasData: true,
        restaurantName: geocodedData?.name || restaurantName, // Usa nome da geocoding se disponibile
        keyword,
        userRank: rankingData.userRank,
        competitors: competitors,
        userReviews: rankingData.userReviews || userReviews,
        userRating: rankingData.userRating || userRating,
        city: city || geocodedData?.address?.split(',').pop()?.trim() || '',
        address: geocodedData?.address || address || '',
        coordinates: { lat, lng }
      };

    } catch (error) {
      console.error(`❌ Errore analisi contesto per ${contact.name}:`, error);
      return {
        hasData: false,
        error: error.message
      };
    }
  }
}

// Esporta istanza singleton
const serperService = new SerperService();
export default serperService;

