/**
 * Redis Configuration - Centralizzata e Pulita
 * Gestisce connessione, pooling e fallback graceful
 */

import Redis from 'ioredis';

class RedisManager {
  constructor() {
    this.redis = null;
    this.isConnected = false;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  /**
   * Inizializza connessione Redis
   */
  async initialize() {
    try {
      const redisConfig = this.getRedisConfig();
      
      this.redis = new Redis(redisConfig);
      
      // Event listeners per monitoring
      this.redis.on('connect', () => {
        this.isConnected = true;
        this.retryCount = 0;
        console.log('✅ Redis connesso successfully');
      });

      this.redis.on('error', (error) => {
        this.isConnected = false;
        console.error('❌ Redis error:', error.message);
      });

      this.redis.on('close', () => {
        this.isConnected = false;
        console.warn('⚠️ Redis connection closed');
      });

      // Test connessione
      await this.redis.ping();
      console.log('🔧 Redis configuration validated');
      
      return this.redis;

    } catch (error) {
      console.error('❌ Failed to initialize Redis:', error.message);
      
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`🔄 Retry Redis connection (${this.retryCount}/${this.maxRetries})`);
        await this.sleep(2000 * this.retryCount); // Exponential backoff
        return this.initialize();
      }
      
      console.warn('⚠️ Redis not available - running without caching');
      return null;
    }
  }

  /**
   * Ottieni configurazione Redis da ENV
   */
  getRedisConfig() {
    // Priorità: REDIS_URL -> host/port separati
    if (process.env.REDIS_URL) {
      return {
        url: process.env.REDIS_URL,
        retryDelayOnFailover: 100,
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      };
    }

    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB) || 0,
      family: parseInt(process.env.REDIS_FAMILY) || 4,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    };
  }

  /**
   * Verifica se Redis è disponibile
   */
  isAvailable() {
    return this.redis !== null && this.isConnected;
  }

  /**
   * Ottieni istanza Redis
   */
  getClient() {
    if (!this.isAvailable()) {
      throw new Error('Redis not available');
    }
    return this.redis;
  }

  /**
   * Graceful shutdown
   */
  async disconnect() {
    if (this.redis) {
      await this.redis.quit();
      console.log('✅ Redis disconnected gracefully');
    }
  }

  /**
   * Utility sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
const redisManager = new RedisManager();

export default redisManager; 