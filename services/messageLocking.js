/**
 * Message Locking Service - Previene Invio Duplicati
 * Utilizza Redis per lock distribuiti thread-safe
 */

import redisManager from '../config/redis.js';

class MessageLockingService {
  constructor() {
    this.lockTimeout = 300; // 5 minuti in secondi
    this.lockPrefix = 'msg_lock:';
  }

  /**
   * Acquisisce lock per un messaggio specifico
   * @param {string} campaignId - ID della campagna
   * @param {string} contactId - ID del contatto
   * @param {number} sequenceIndex - Indice sequenza (0 = principale)
   * @returns {Promise<string|null>} lockKey se acquisito, null se già lockato
   */
  async acquireLock(campaignId, contactId, sequenceIndex) {
    try {
      // Genera chiave univoca per il messaggio
      const lockKey = this.generateLockKey(campaignId, contactId, sequenceIndex);
      
      if (!redisManager.isAvailable()) {
        // Fallback senza Redis - assumiamo che sia sicuro
        console.warn('⚠️ Redis not available - skipping message lock');
        return lockKey;
      }

      const redis = redisManager.getClient();
      
      // SET con EX (expiry) e NX (only if not exists)
      const lockValue = `${Date.now()}_${Math.random()}`;
      const result = await redis.set(lockKey, lockValue, 'EX', this.lockTimeout, 'NX');
      
      if (result === 'OK') {
        console.log(`🔒 Lock acquired: ${lockKey}`);
        return lockKey;
      } else {
        console.log(`⏳ Lock already exists: ${lockKey}`);
        return null;
      }

    } catch (error) {
      console.error('❌ Error acquiring message lock:', error.message);
      // In caso di errore, permettiamo l'invio per non bloccare il sistema
      return this.generateLockKey(campaignId, contactId, sequenceIndex);
    }
  }

  /**
   * Rilascia lock per un messaggio
   * @param {string} lockKey - Chiave del lock da rilasciare
   */
  async releaseLock(lockKey) {
    try {
      if (!redisManager.isAvailable() || !lockKey) {
        return;
      }

      const redis = redisManager.getClient();
      const result = await redis.del(lockKey);
      
      if (result === 1) {
        console.log(`🔓 Lock released: ${lockKey}`);
      }

    } catch (error) {
      console.error('❌ Error releasing message lock:', error.message);
      // Non è critico se non riusciamo a rilasciare - scadrà automaticamente
    }
  }

  /**
   * Verifica se un messaggio è attualmente lockato
   * @param {string} campaignId 
   * @param {string} contactId 
   * @param {number} sequenceIndex 
   * @returns {Promise<boolean>}
   */
  async isLocked(campaignId, contactId, sequenceIndex) {
    try {
      if (!redisManager.isAvailable()) {
        return false;
      }

      const lockKey = this.generateLockKey(campaignId, contactId, sequenceIndex);
      const redis = redisManager.getClient();
      const exists = await redis.exists(lockKey);
      
      return exists === 1;

    } catch (error) {
      console.error('❌ Error checking message lock:', error.message);
      return false;
    }
  }

  /**
   * Pulisce tutti i lock scaduti (utility per manutenzione)
   */
  async cleanupExpiredLocks() {
    try {
      if (!redisManager.isAvailable()) {
        return 0;
      }

      const redis = redisManager.getClient();
      const pattern = `${this.lockPrefix}*`;
      const keys = await redis.keys(pattern);
      
      if (keys.length === 0) {
        return 0;
      }

      // I lock con TTL si puliscono automaticamente
      // Questo metodo è per monitoring
      console.log(`🧹 Found ${keys.length} message locks`);
      return keys.length;

    } catch (error) {
      console.error('❌ Error during lock cleanup:', error.message);
      return 0;
    }
  }

  /**
   * Genera chiave di lock univoca per il messaggio
   */
  generateLockKey(campaignId, contactId, sequenceIndex) {
    return `${this.lockPrefix}${campaignId}:${contactId}:${sequenceIndex}`;
  }

  /**
   * Esegue operazione con lock automatico
   * @param {string} campaignId 
   * @param {string} contactId 
   * @param {number} sequenceIndex 
   * @param {Function} operation - Funzione da eseguire con lock
   * @returns {Promise<any>} Risultato dell'operazione o null se non può acquisire lock
   */
  async withLock(campaignId, contactId, sequenceIndex, operation) {
    const lockKey = await this.acquireLock(campaignId, contactId, sequenceIndex);
    
    if (!lockKey) {
      console.log(`⏭️ Skipping operation - message already being processed`);
      return null;
    }

    try {
      // Esegui operazione con lock attivo
      const result = await operation();
      return result;

    } finally {
      // Rilascia sempre il lock
      await this.releaseLock(lockKey);
    }
  }
}

// Singleton instance
const messageLockingService = new MessageLockingService();

export default messageLockingService; 