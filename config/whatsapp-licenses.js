/**
 * Configurazione Licenze OpenWA per Numero
 * 
 * Questo file permette di associare licenze specifiche a numeri WhatsApp.
 * Ogni licenza OpenWA è valida per UN SOLO numero.
 */

const WHATSAPP_LICENSES = {
  // Numero principale - Licenza attuale (già funzionante)
  '393342746427': process.env.OPENWA_LICENSE_KEY_PRINCIPALE || process.env.OPENWA_LICENSE_KEY,
  
  // Numero marketing - Nuova licenza da acquistare
  '393663153304': process.env.OPENWA_LICENSE_KEY_MARKETING,
  
  // Aggiungi qui altri numeri/licenze se necessario
  // 'altronumero': process.env.OPENWA_LICENSE_KEY_ALTRO,
};

/**
 * Ottiene la licenza per un numero specifico
 * @param {string} phoneNumber - Numero WhatsApp (senza + e spazi)
 * @returns {string|null} - Licenza o null se non trovata
 */
function getLicenseForNumber(phoneNumber) {
  // Pulisce il numero (rimuove +, spazi, trattini)
  const cleanNumber = phoneNumber.replace(/[\+\s\-]/g, '');
  
  return WHATSAPP_LICENSES[cleanNumber] || null;
}

/**
 * Verifica se un numero ha una licenza configurata
 * @param {string} phoneNumber - Numero WhatsApp
 * @returns {boolean}
 */
function hasLicenseForNumber(phoneNumber) {
  return getLicenseForNumber(phoneNumber) !== null;
}

/**
 * Lista tutti i numeri configurati
 * @returns {Array} Array di numeri configurati
 */
function getConfiguredNumbers() {
  return Object.keys(WHATSAPP_LICENSES).filter(num => WHATSAPP_LICENSES[num]);
}

module.exports = {
  getLicenseForNumber,
  hasLicenseForNumber,
  getConfiguredNumbers,
  WHATSAPP_LICENSES
}; 