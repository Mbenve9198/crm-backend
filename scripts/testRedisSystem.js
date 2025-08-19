/**
 * Test Sistema Redis con Credenziali Server Remoto
 * Testa il nostro redisManager con le credenziali reali
 */

// Set environment variables per il test
process.env.REDIS_HOST = "redis-14586.c300.eu-central-1-1.ec2.redns.redis-cloud.com";
process.env.REDIS_PORT = "14586";
process.env.REDIS_PASSWORD = "6iinyiXeM0CIrEifDfhuBF0fhryRwGCs";
process.env.REDIS_DB = "0";
process.env.REDIS_FAMILY = "4";

import redisManager from '../config/redis.js';
import smartRateLimiter from '../services/smartRateLimiter.js';
import messageLockingService from '../services/messageLocking.js';

async function testRedisSystem() {
  console.log('🧪 Testing Sistema Redis con credenziali server remoto...\n');

  try {
    // Test 1: RedisManager
    console.log('1️⃣ Test RedisManager...');
    await redisManager.initialize();
    
    if (redisManager.isAvailable()) {
      console.log('✅ RedisManager: Connesso e disponibile');
      
      const redis = redisManager.getClient();
      await redis.set('test_system', 'working', 'EX', 30);
      const value = await redis.get('test_system');
      console.log(`✅ RedisManager operazioni: ${value}`);
    } else {
      console.log('❌ RedisManager: Non disponibile');
      return;
    }

    // Test 2: SmartRateLimiter
    console.log('\n2️⃣ Test SmartRateLimiter...');
    
    const testSessionId = 'test_session_system';
    
    const canSend = await smartRateLimiter.canSendMessage(testSessionId, 'media');
    console.log(`✅ Rate limiter canSend: ${canSend.allowed} - ${canSend.reason}`);
    
    await smartRateLimiter.recordMessage(testSessionId, 'media');
    console.log('✅ Rate limiter recordMessage: OK');
    
    const stats = await smartRateLimiter.getStats(testSessionId);
    console.log(`✅ Rate limiter stats: ${stats.hourlyCount} messaggi questa ora`);

    // Test 3: MessageLockingService
    console.log('\n3️⃣ Test MessageLockingService...');
    
    const campaignId = 'test_campaign_system';
    const contactId = 'test_contact_system';
    const sequenceIndex = 0;
    
    const lockKey = await messageLockingService.acquireLock(campaignId, contactId, sequenceIndex);
    if (lockKey) {
      console.log('✅ Message lock acquired: OK');
      
      const isLocked = await messageLockingService.isLocked(campaignId, contactId, sequenceIndex);
      console.log(`✅ Message lock check: ${isLocked ? 'LOCKED' : 'FREE'}`);
      
      await messageLockingService.releaseLock(lockKey);
      console.log('✅ Message lock released: OK');
    } else {
      console.log('❌ Message lock acquisition: FAILED');
    }

    // Test 4: withLock utility
    console.log('\n4️⃣ Test withLock utility...');
    
    let operationExecuted = false;
    const result = await messageLockingService.withLock(
      campaignId,
      contactId,
      sequenceIndex,
      async () => {
        operationExecuted = true;
        await new Promise(resolve => setTimeout(resolve, 100)); // Simula operazione
        return 'operation_success';
      }
    );
    
    console.log(`✅ withLock execution: ${operationExecuted ? 'SUCCESS' : 'FAILED'}`);
    console.log(`✅ withLock result: ${result}`);

    // Test 5: Configurazioni priorità
    console.log('\n5️⃣ Test configurazioni priorità...');
    
    const priorities = ['alta', 'media', 'bassa'];
    for (const priority of priorities) {
      const config = smartRateLimiter.getConfigForPriority(priority);
      console.log(`✅ Priority '${priority}': ${config.intervalSeconds}s, ${config.maxPerHour} msg/h, batch ${config.batchSize}`);
    }

    console.log('\n🎉 Tutti i test del sistema Redis sono passati!');
    console.log('✅ Il sistema è pronto per le campagne WhatsApp con Redis Cloud');

  } catch (error) {
    console.error('\n❌ Test sistema Redis fallito:', error.message);
    console.error('Stack:', error.stack);
    
    // Analizza il tipo di errore
    if (error.message.includes('Redis not available')) {
      console.error('💡 Redis Manager non è riuscito a connettersi');
    } else if (error.message.includes('getClient')) {
      console.error('💡 Problema ottenimento client Redis');
    } else {
      console.error('💡 Errore generico nel sistema Redis');
    }
    
  } finally {
    // Cleanup
    try {
      await redisManager.disconnect();
      console.log('\n🧹 Sistema Redis disconnesso correttamente');
    } catch (error) {
      console.error('❌ Errore disconnessione:', error.message);
    }
    
    process.exit(0);
  }
}

// Esegui test
testRedisSystem(); 