import axios from 'axios';

/**
 * Servizio per interagire con Serper API (Google Maps search)
 * Utilizzato per trovare competitor di ristoranti e analizzare ranking
 */

class SerperService {
  constructor() {
    this.apiKey = process.env.SERPER_API_KEY;
    this.apiUrl = 'https://google.serper.dev/maps';
  }

  /**
   * 🆕 Trova le coordinate di un ristorante usando nome e indirizzo
   * @param {string} restaurantName - Nome del ristorante
   * @param {string} address - Indirizzo
   * @param {string} city - Città
   * @returns {Promise<Object>} - Coordinate e dati ristorante
   */
  async findRestaurantCoordinates(restaurantName, address, city) {
    try {
      if (!this.apiKey) {
        throw new Error('SERPER_API_KEY non configurata');
      }

      // Costruisci query di ricerca
      const searchQuery = `${restaurantName} ${address} ${city}`;
      
      console.log(`🔍 Serper Step 1: Ricerca coordinate per "${searchQuery}"`);
      
      const response = await axios.post(
        this.apiUrl,
        {
          q: searchQuery,
          num: 5 // Primi 5 risultati
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

      // Prendi il primo risultato (dovrebbe essere il ristorante cercato)
      const restaurant = places[0];
      
      console.log(`✅ Ristorante trovato: ${restaurant.title}`);
      console.log(`📍 Coordinate: ${restaurant.latitude}, ${restaurant.longitude}`);
      
      return {
        name: restaurant.title,
        address: restaurant.address,
        latitude: restaurant.latitude,
        longitude: restaurant.longitude,
        rating: restaurant.rating,
        reviews: restaurant.reviews || restaurant.ratingCount || 0,
        placeId: restaurant.placeId
      };
      
    } catch (error) {
      console.error(`❌ Errore ricerca coordinate:`, error.response?.data || error.message);
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
      
      console.log(`🔍 Serper Step 2: "${keyword}" @ ${ll}`);
      
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
   * 🆕 NUOVO FLUSSO: Usa nome + indirizzo per trovare coordinate, poi cerca competitor
   * @param {Object} contact - Contatto da analizzare
   * @returns {Promise<Object>} - Dati di analisi per generazione messaggio
   */
  async analyzeContactContext(contact) {
    try {
      // Estrai dati dal contatto (CAMPI REALI: Città, Indirizzo con maiuscole!)
      const restaurantName = contact.name; // Nome dal campo base
      const city = contact.properties?.Città || contact.properties?.city || '';
      const address = contact.properties?.Indirizzo || contact.properties?.address || '';
      const keyword = contact.properties?.keyword || 'ristorante';
      
      // Controlla se ha già coordinate
      let lat = contact.properties?.latitude;
      let lng = contact.properties?.longitude;
      let userRating = parseFloat(contact.properties?.Rating || contact.properties?.rating || 0);
      let userReviews = parseInt(contact.properties?.Recensioni || contact.properties?.reviews_count || contact.properties?.reviews || 0);

      // Se non ha coordinate, cercale con Serper
      if (!lat || !lng) {
        if (!address || !city) {
          console.warn(`⚠️  Contatto ${contact.name} senza indirizzo o città`);
          return {
            hasData: false,
            error: 'Indirizzo o città mancanti (richiesti per trovare coordinate)'
          };
        }

        console.log(`🔍 Step 1: Cerco coordinate per ${restaurantName} a ${city}...`);
        
        // STEP 1: Trova coordinate del ristorante
        const restaurantData = await this.findRestaurantCoordinates(restaurantName, address, city);
        
        if (!restaurantData || !restaurantData.latitude || !restaurantData.longitude) {
          console.warn(`⚠️  Impossibile trovare coordinate per ${restaurantName}`);
          return {
            hasData: false,
            error: 'Coordinate non trovate su Google Maps'
          };
        }

        lat = restaurantData.latitude;
        lng = restaurantData.longitude;
        
        // Usa anche i dati trovati se non presenti
        if (!userRating && restaurantData.rating) {
          userRating = restaurantData.rating;
        }
        if (!userReviews && restaurantData.reviews) {
          userReviews = restaurantData.reviews;
        }
        
        console.log(`✅ Coordinate trovate: ${lat}, ${lng}`);
      } else {
        console.log(`✅ Coordinate già presenti: ${lat}, ${lng}`);
      }

      console.log(`🔍 Step 2: Cerco competitor vicino a ${restaurantName}...`);

      // STEP 2: Cerca ranking e competitor
      const rankingData = await this.getGoogleMapsRanking(restaurantName, keyword, lat, lng);
      
      if (!rankingData) {
        console.warn(`⚠️  Dati ranking non disponibili per ${restaurantName}`);
        return {
          hasData: false,
          error: 'Dati ranking non disponibili'
        };
      }

      // Filtra competitor non null e ordina per numero di recensioni
      const competitors = [
        rankingData.competitor1,
        rankingData.competitor2,
        rankingData.competitor3
      ].filter(c => c !== null)
       .sort((a, b) => b.reviews - a.reviews);

      if (competitors.length === 0) {
        console.warn(`⚠️  Nessun competitor trovato per ${restaurantName}`);
        return {
          hasData: false,
          error: 'Nessun competitor trovato'
        };
      }

      return {
        hasData: true,
        restaurantName,
        keyword,
        competitors: competitors,
        userRank: rankingData.userRank,
        userReviews: rankingData.userReviews || userReviews,
        userRating: rankingData.userRating || userRating,
        city: city,
        address: address,
        coordinates: { lat, lng } // Salva per uso futuro
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

