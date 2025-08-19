/**
 * Test Redis Remote Connection
 * Testa la connessione al server Redis remoto
 */

import Redis from 'ioredis';

async function testRedisRemote() {
  console.log('🧪 Testing Redis Remote Connection...\n');

  // Configurazione Redis remota
  const redisConfig = {
    host: "redis-14586.c300.eu-central-1-1.ec2.redns.redis-cloud.com",
    port: 14586,
    password: "6iinyiXeM0CIrEifDfhuBF0fhryRwGCs",
    db: 0,
    family: 4,
    retryDelayOnFailover: 100,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    connectTimeout: 10000,
    commandTimeout: 5000
  };

  console.log('📡 Tentativo connessione a Redis Cloud...');
  console.log(`Host: ${redisConfig.host}`);
  console.log(`Port: ${redisConfig.port}`);
  console.log(`DB: ${redisConfig.db}`);

  let redis = null;

  try {
    // Crea istanza Redis
    redis = new Redis(redisConfig);

    // Event listeners per debugging
    redis.on('connect', () => {
      console.log('🔗 Redis: Connessione stabilita');
    });

    redis.on('ready', () => {
      console.log('✅ Redis: Pronto per operazioni');
    });

    redis.on('error', (error) => {
      console.error('❌ Redis Error:', error.message);
    });

    redis.on('close', () => {
      console.log('🔌 Redis: Connessione chiusa');
    });

    redis.on('reconnecting', () => {
      console.log('🔄 Redis: Tentativo riconnessione...');
    });

    // Test connessione con timeout
    console.log('\n1️⃣ Test PING...');
    const pingResult = await redis.ping();
    console.log(`✅ PING Response: ${pingResult}`);

    // Test operazioni base
    console.log('\n2️⃣ Test operazioni base...');
    
    // SET
    await redis.set('test_key', 'test_value', 'EX', 30);
    console.log('✅ SET operation: OK');

    // GET
    const value = await redis.get('test_key');
    console.log(`✅ GET operation: ${value}`);

    // EXISTS
    const exists = await redis.exists('test_key');
    console.log(`✅ EXISTS operation: ${exists}`);

    // DEL
    const deleted = await redis.del('test_key');
    console.log(`✅ DEL operation: ${deleted}`);

    // Test rate limiting simulation
    console.log('\n3️⃣ Test rate limiting keys...');
    
    const testSessionId = 'test_session_remote';
    const hour = `2024-1-1-10`;
    const rateLimitKey = `rate_limit:${testSessionId}:hour:${hour}`;
    
    await redis.incr(rateLimitKey);
    await redis.expire(rateLimitKey, 3600);
    const count = await redis.get(rateLimitKey);
    console.log(`✅ Rate limit counter: ${count}`);

    // Test message locking simulation
    console.log('\n4️⃣ Test message locking...');
    
    const lockKey = 'msg_lock:test_campaign:test_contact:0';
    const lockValue = `${Date.now()}_${Math.random()}`;
    
    const lockResult = await redis.set(lockKey, lockValue, 'EX', 300, 'NX');
    console.log(`✅ Lock acquired: ${lockResult === 'OK' ? 'YES' : 'NO'}`);
    
    if (lockResult === 'OK') {
      const released = await redis.del(lockKey);
      console.log(`✅ Lock released: ${released === 1 ? 'YES' : 'NO'}`);
    }

    // Test performance
    console.log('\n5️⃣ Test performance...');
    
    const startTime = Date.now();
    const promises = [];
    
    for (let i = 0; i < 10; i++) {
      promises.push(redis.set(`perf_test_${i}`, `value_${i}`, 'EX', 60));
    }
    
    await Promise.all(promises);
    const endTime = Date.now();
    
    console.log(`✅ Performance: 10 operations in ${endTime - startTime}ms`);

    // Cleanup
    const keys = await redis.keys('perf_test_*');
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`✅ Cleanup: ${keys.length} keys deleted`);
    }

    console.log('\n🎉 Tutti i test Redis remoti sono passati!');
    console.log('✅ Redis Cloud è completamente funzionante');

  } catch (error) {
    console.error('\n❌ Test Redis remoto fallito:', error.message);
    console.error('Stack trace:', error.stack);
    
    if (error.message.includes('ENOTFOUND')) {
      console.error('🌐 Errore DNS: Impossibile risolvere l\'hostname Redis');
    } else if (error.message.includes('ECONNREFUSED')) {
      console.error('🔌 Connessione rifiutata: Verifica host/porta');
    } else if (error.message.includes('NOAUTH')) {
      console.error('🔐 Errore autenticazione: Verifica password Redis');
    } else if (error.message.includes('timeout')) {
      console.error('⏰ Timeout connessione: Redis potrebbe essere lento');
    }
    
  } finally {
    // Cleanup
    if (redis) {
      try {
        await redis.quit();
        console.log('\n🧹 Connessione Redis chiusa correttamente');
      } catch (error) {
        console.error('❌ Errore chiusura Redis:', error.message);
      }
    }
    
    process.exit(0);
  }
}

// Esegui test
testRedisRemote(); 