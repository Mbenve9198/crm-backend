import twilio from 'twilio';
import dotenv from 'dotenv';

// Carica variabili d'ambiente
dotenv.config();

async function testTwilioConfiguration() {
  console.log('🧪 Test Configurazione Twilio con Numero Verificato');
  console.log('================================================');

  // Chiedi le credenziali all'utente
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => new Promise((resolve) => {
    rl.question(prompt, resolve);
  });

  try {
    console.log('\n📝 Inserisci le tue credenziali Twilio:');
    const accountSid = await question('Account SID: ');
    const authToken = await question('Auth Token: ');
    const phoneNumber = await question('Numero verificato (formato +393331234567): ');

    console.log('\n🔍 Verifico la configurazione...');

    // Crea client Twilio
    const client = twilio(accountSid, authToken);

    // Test 1: Verifica account
    console.log('\n1️⃣ Verifico l\'account...');
    const account = await client.api.accounts(accountSid).fetch();
    console.log(`✅ Account trovato: ${account.friendlyName}`);
    console.log(`   Status: ${account.status}`);

    // Test 2: Verifica numeri verificati
    console.log('\n2️⃣ Verifico i numeri verificati...');
    const verifiedNumbers = await client.outgoingCallerIds.list();
    console.log(`📞 Numeri verificati trovati: ${verifiedNumbers.length}`);
    
    const hasVerifiedNumber = verifiedNumbers.some(
      number => number.phoneNumber === phoneNumber
    );

    if (hasVerifiedNumber) {
      console.log(`✅ Il numero ${phoneNumber} è verificato e utilizzabile!`);
      
      const verifiedNum = verifiedNumbers.find(n => n.phoneNumber === phoneNumber);
      console.log(`   Friendly Name: ${verifiedNum.friendlyName}`);
      console.log(`   Data verifica: ${verifiedNum.dateCreated}`);
    } else {
      console.log(`❌ Il numero ${phoneNumber} NON è verificato.`);
      console.log('\n📋 Numeri verificati disponibili:');
      verifiedNumbers.forEach(num => {
        console.log(`   - ${num.phoneNumber} (${num.friendlyName})`);
      });
      console.log('\n💡 Per verificare il numero:');
      console.log('   1. Vai su https://console.twilio.com/us1/develop/phone-numbers/manage/verified');
      console.log('   2. Clicca "Add a new Caller ID"');
      console.log('   3. Inserisci il tuo numero e completa la verifica');
    }

    // Test 3: Verifica saldo (se disponibile)
    console.log('\n3️⃣ Verifico saldo account...');
    try {
      const balance = await client.balance.fetch();
      console.log(`💰 Saldo: ${balance.balance} ${balance.currency}`);
    } catch (error) {
      console.log(`⚠️  Impossibile ottenere saldo: ${error.message}`);
    }

    // Test 4: Suggerisci test chiamata (solo se numero verificato)
    if (hasVerifiedNumber) {
      console.log('\n4️⃣ Test chiamata (opzionale)');
      const testNumber = await question('Numero per test chiamata (INVIO per saltare): ');
      
      if (testNumber.trim()) {
        console.log('📞 Iniziando chiamata di test...');
        
        const call = await client.calls.create({
          from: phoneNumber,
          to: testNumber,
          twiml: `<Response>
                    <Say language="it" voice="alice">
                      Ciao! Questo è un test di configurazione Twilio per il CRM. 
                      La configurazione funziona correttamente. Arrivederci!
                    </Say>
                  </Response>`,
          timeout: 30
        });

        console.log(`✅ Chiamata iniziata con SID: ${call.sid}`);
        console.log(`   Status: ${call.status}`);
        console.log(`   Da: ${call.from}`);
        console.log(`   A: ${call.to}`);
      }
    }

    console.log('\n🎉 Test completato!');
    console.log('\n📋 Riepilogo configurazione:');
    console.log(`   Account SID: ${accountSid}`);
    console.log(`   Numero verificato: ${phoneNumber} ${hasVerifiedNumber ? '✅' : '❌'}`);
    console.log(`   Pronto per il CRM: ${hasVerifiedNumber ? 'SÌ' : 'NO'}`);

    if (hasVerifiedNumber) {
      console.log('\n🚀 La configurazione è pronta! Puoi usare queste credenziali nel CRM.');
      console.log('   1. Vai su /settings nel CRM');
      console.log('   2. Inserisci Account SID, Auth Token e numero verificato');
      console.log('   3. Clicca "Salva Configurazione" e poi "Verifica Configurazione"');
    }

  } catch (error) {
    console.error('\n❌ Errore durante il test:', error.message);
    
    if (error.code === 20003) {
      console.log('💡 Suggerimento: Verifica che Account SID e Auth Token siano corretti');
    } else if (error.code === 20404) {
      console.log('💡 Suggerimento: Verifica che l\'Account SID sia corretto');
    }
  } finally {
    rl.close();
  }
}

// Esegui il test
testTwilioConfiguration(); 