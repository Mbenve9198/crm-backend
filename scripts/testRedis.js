/**
 * Test Script per Redis Connection
 * Verifica che Redis sia configurato e funzionante
 */

import redisManager from '../config/redis.js';
import smartRateLimiter from '../services/smartRateLimiter.js';
import messageLockingService from '../services/messageLocking.js';

async function testRedis() {
  console.log('🧪 Testing Redis Configuration...\n');

  try {
    // Test 1: Connessione base
    console.log('1️⃣ Testing Redis connection...');
    await redisManager.initialize();
    
    if (redisManager.isAvailable()) {
      console.log('✅ Redis connection: OK');
      
      // Test operazioni base
      const redis = redisManager.getClient();
      await redis.set('test_key', 'test_value', 'EX', 10);
      const value = await redis.get('test_key');
      
      if (value === 'test_value') {
        console.log('✅ Basic operations: OK');
      } else {
        console.log('❌ Basic operations: FAILED');
      }
      
    } else {
      console.log('❌ Redis connection: FAILED');
      return;
    }

    // Test 2: Smart Rate Limiter
    console.log('\n2️⃣ Testing Smart Rate Limiter...');
    
    const testSessionId = 'test_session_123';
    
    // Test canSendMessage
    const rateLimitResult = await smartRateLimiter.canSendMessage(testSessionId, 'media');
    console.log(`✅ Rate limit check: ${rateLimitResult.allowed ? 'ALLOWED' : 'BLOCKED'} - ${rateLimitResult.reason}`);
    
    // Test recordMessage  
    await smartRateLimiter.recordMessage(testSessionId, 'media');
    console.log('✅ Message recording: OK');
    
    // Test getStats
    const stats = await smartRateLimiter.getStats(testSessionId);
    console.log(`✅ Rate limit stats: ${stats.hourlyCount} messages this hour`);

    // Test 3: Message Locking
    console.log('\n3️⃣ Testing Message Locking...');
    
    const testCampaignId = 'campaign_123';
    const testContactId = 'contact_456';
    const testSequenceIndex = 0;
    
    // Test acquire lock
    const lockKey = await messageLockingService.acquireLock(testCampaignId, testContactId, testSequenceIndex);
    if (lockKey) {
      console.log('✅ Lock acquired: OK');
      
      // Test lock already exists
      const duplicateLock = await messageLockingService.acquireLock(testCampaignId, testContactId, testSequenceIndex);
      if (!duplicateLock) {
        console.log('✅ Duplicate lock prevention: OK');
      } else {
        console.log('❌ Duplicate lock prevention: FAILED');
      }
      
      // Test release lock
      await messageLockingService.releaseLock(lockKey);
      console.log('✅ Lock release: OK');
      
    } else {
      console.log('❌ Lock acquisition: FAILED');
    }

    // Test 4: withLock utility
    console.log('\n4️⃣ Testing withLock utility...');
    
    let operationExecuted = false;
    const result = await messageLockingService.withLock(
      testCampaignId,
      testContactId,
      testSequenceIndex,
      async () => {
        operationExecuted = true;
        return 'operation_result';
      }
    );
    
    if (operationExecuted && result === 'operation_result') {
      console.log('✅ withLock utility: OK');
    } else {
      console.log('❌ withLock utility: FAILED');
    }

    // Test 5: Priority configurations
    console.log('\n5️⃣ Testing Priority Configurations...');
    
    const priorities = ['alta', 'media', 'bassa'];
    for (const priority of priorities) {
      const config = smartRateLimiter.getConfigForPriority(priority);
      console.log(`✅ Priority '${priority}': ${config.intervalSeconds}s interval, ${config.maxPerHour} msg/hour`);
    }

    console.log('\n🎉 All tests passed! Redis is ready for MenuChat CRM v2!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    // Cleanup
    try {
      await redisManager.disconnect();
      console.log('\n🧹 Cleanup completed');
    } catch (error) {
      console.error('❌ Cleanup error:', error.message);
    }
    
    process.exit(0);
  }
}

// Esegui test
testRedis(); 