/**
 * Smart Rate Limiter - Gestione Intelligente del Rate Limiting
 * Previene ban WhatsApp con timing automatico basato su priorità
 */

import redisManager from '../config/redis.js';

class SmartRateLimiter {
  constructor() {
    this.counterPrefix = 'rate_limit:';
    this.configPrefix = 'rate_config:';
    
    // Configurazioni per priorità (secondi tra messaggi)
    this.priorityConfigs = {
      alta: {
        intervalSeconds: 60,    // 1 minuto tra messaggi
        maxPerHour: 30,         // Max 30 messaggi/ora
        maxPerDay: 240,         // Max 240 messaggi/giorno
        batchSize: 2            // Max 2 messaggi per ciclo
      },
      media: {
        intervalSeconds: 120,   // 2 minuti tra messaggi
        maxPerHour: 25,         // Max 25 messaggi/ora
        maxPerDay: 200,         // Max 200 messaggi/giorno
        batchSize: 2            // Max 2 messaggi per ciclo
      },
      bassa: {
        intervalSeconds: 180,   // 3 minuti tra messaggi
        maxPerHour: 15,         // Max 15 messaggi/ora
        maxPerDay: 120,         // Max 120 messaggi/giorno
        batchSize: 1            // Max 1 messaggio per ciclo
      }
    };

    // Override con environment variables se disponibili
    this.loadConfigFromEnv();
  }

  /**
   * Carica configurazione da variabili ambiente
   */
  loadConfigFromEnv() {
    const envMaxPerHour = parseInt(process.env.RATE_LIMITER_MAX_PER_HOUR);
    const envMinInterval = parseInt(process.env.RATE_LIMITER_MIN_INTERVAL);
    const envMaxPerDay = parseInt(process.env.RATE_LIMITER_MAX_PER_DAY);

    if (envMaxPerHour && envMinInterval) {
      console.log('🔧 Using custom rate limits from environment');
      
      // Applica override a tutte le priorità
      Object.keys(this.priorityConfigs).forEach(priority => {
        this.priorityConfigs[priority].maxPerHour = envMaxPerHour;
        this.priorityConfigs[priority].intervalSeconds = envMinInterval;
        if (envMaxPerDay) {
          this.priorityConfigs[priority].maxPerDay = envMaxPerDay;
        }
      });
    }
  }

  /**
   * Verifica se è possibile inviare un messaggio
   * @param {string} sessionId - ID sessione WhatsApp
   * @param {string} priority - Priorità campagna (alta/media/bassa)
   * @returns {Promise<Object>} { allowed: boolean, waitTime: number, reason: string }
   */
  async canSendMessage(sessionId, priority = 'media') {
    try {
      const config = this.priorityConfigs[priority] || this.priorityConfigs.media;
      
      // Verifica limiti orari e giornalieri
      const hourlyCount = await this.getHourlyCount(sessionId);
      const dailyCount = await this.getDailyCount(sessionId);
      const lastMessageTime = await this.getLastMessageTime(sessionId);

      // Check limite orario
      if (hourlyCount >= config.maxPerHour) {
        return {
          allowed: false,
          waitTime: this.getTimeUntilNextHour(),
          reason: `Limite orario raggiunto (${hourlyCount}/${config.maxPerHour})`
        };
      }

      // Check limite giornaliero
      if (dailyCount >= config.maxPerDay) {
        return {
          allowed: false,
          waitTime: this.getTimeUntilNextDay(),
          reason: `Limite giornaliero raggiunto (${dailyCount}/${config.maxPerDay})`
        };
      }

      // Check intervallo minimo
      if (lastMessageTime) {
        const timeSinceLastMessage = Date.now() - lastMessageTime;
        const requiredInterval = config.intervalSeconds * 1000;
        
        if (timeSinceLastMessage < requiredInterval) {
          const waitTime = requiredInterval - timeSinceLastMessage;
          return {
            allowed: false,
            waitTime,
            reason: `Intervallo minimo non rispettato (attendi ${Math.ceil(waitTime/1000)}s)`
          };
        }
      }

      return {
        allowed: true,
        waitTime: 0,
        reason: 'OK'
      };

    } catch (error) {
      console.error('❌ Error checking rate limit:', error.message);
      
      // In caso di errore, assumiamo permesso ma con cautela
      return {
        allowed: true,
        waitTime: 60000, // Attendi 1 minuto per sicurezza
        reason: 'Error - proceeding with caution'
      };
    }
  }

  /**
   * Registra l'invio di un messaggio
   * @param {string} sessionId 
   * @param {string} priority 
   */
  async recordMessage(sessionId, priority = 'media') {
    try {
      const now = Date.now();
      const config = this.priorityConfigs[priority] || this.priorityConfigs.media;

      if (!redisManager.isAvailable()) {
        console.warn('⚠️ Redis not available - rate limiting disabled');
        return;
      }

      const redis = redisManager.getClient();
      
      // Aggiorna contatori
      await Promise.all([
        this.incrementHourlyCount(sessionId, redis),
        this.incrementDailyCount(sessionId, redis),
        this.setLastMessageTime(sessionId, now, redis)
      ]);

      console.log(`📊 Rate limit recorded for ${sessionId} (priority: ${priority})`);

    } catch (error) {
      console.error('❌ Error recording message:', error.message);
    }
  }

  /**
   * Ottieni configurazione per priorità
   * @param {string} priority 
   * @returns {Object}
   */
  getConfigForPriority(priority) {
    return this.priorityConfigs[priority] || this.priorityConfigs.media;
  }

  /**
   * Ottieni statistiche rate limiting per sessione
   * @param {string} sessionId 
   * @returns {Promise<Object>}
   */
  async getStats(sessionId) {
    try {
      const [hourlyCount, dailyCount, lastMessageTime] = await Promise.all([
        this.getHourlyCount(sessionId),
        this.getDailyCount(sessionId),
        this.getLastMessageTime(sessionId)
      ]);

      return {
        hourlyCount,
        dailyCount,
        lastMessageTime,
        lastMessageAgo: lastMessageTime ? Date.now() - lastMessageTime : null
      };

    } catch (error) {
      console.error('❌ Error getting rate limit stats:', error.message);
      return {
        hourlyCount: 0,
        dailyCount: 0,
        lastMessageTime: null,
        lastMessageAgo: null
      };
    }
  }

  // ===== METODI PRIVATI REDIS =====

  async getHourlyCount(sessionId) {
    if (!redisManager.isAvailable()) return 0;
    
    const redis = redisManager.getClient();
    const key = `${this.counterPrefix}${sessionId}:hour:${this.getCurrentHour()}`;
    const count = await redis.get(key);
    return parseInt(count) || 0;
  }

  async getDailyCount(sessionId) {
    if (!redisManager.isAvailable()) return 0;
    
    const redis = redisManager.getClient();
    const key = `${this.counterPrefix}${sessionId}:day:${this.getCurrentDay()}`;
    const count = await redis.get(key);
    return parseInt(count) || 0;
  }

  async getLastMessageTime(sessionId) {
    if (!redisManager.isAvailable()) return null;
    
    const redis = redisManager.getClient();
    const key = `${this.counterPrefix}${sessionId}:last`;
    const timestamp = await redis.get(key);
    return timestamp ? parseInt(timestamp) : null;
  }

  async incrementHourlyCount(sessionId, redis) {
    const key = `${this.counterPrefix}${sessionId}:hour:${this.getCurrentHour()}`;
    await redis.incr(key);
    await redis.expire(key, 3600); // Scade dopo 1 ora
  }

  async incrementDailyCount(sessionId, redis) {
    const key = `${this.counterPrefix}${sessionId}:day:${this.getCurrentDay()}`;
    await redis.incr(key);
    await redis.expire(key, 86400); // Scade dopo 24 ore
  }

  async setLastMessageTime(sessionId, timestamp, redis) {
    const key = `${this.counterPrefix}${sessionId}:last`;
    await redis.set(key, timestamp, 'EX', 86400); // Scade dopo 24 ore
  }

  // ===== UTILITY METODI =====

  getCurrentHour() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
  }

  getCurrentDay() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  }

  getTimeUntilNextHour() {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    return nextHour.getTime() - now.getTime();
  }

  getTimeUntilNextDay() {
    const now = new Date();
    const nextDay = new Date(now);
    nextDay.setDate(now.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);
    return nextDay.getTime() - now.getTime();
  }
}

// Singleton instance
const smartRateLimiter = new SmartRateLimiter();

export default smartRateLimiter; 