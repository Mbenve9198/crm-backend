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
      // Estrai dati necessari dal contatto
      const restaurantName = contact.properties?.restaurant_name || contact.name;
      const keyword = contact.properties?.keyword || 'ristorante';
      const lat = contact.properties?.latitude;
      const lng = contact.properties?.longitude;

      if (!lat || !lng) {
        console.warn(`⚠️  Contatto ${contact.name} senza coordinate GPS`);
        return {
          hasData: false,
          error: 'Coordinate GPS mancanti'
        };
      }

      // Ottieni competitor
      const competitors = await this.getTopCompetitors(restaurantName, keyword, lat, lng);
      
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
        userReviews: contact.properties?.reviews || 0,
        userRating: contact.properties?.rating || 0,
        city: contact.properties?.city || '',
        address: contact.properties?.address || ''
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

