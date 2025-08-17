import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Script di test per verificare il fix di node-persist
 */

console.log('🧪 Test Fix node-persist per OpenWA...');

// Test 1: Verifica variabili d'ambiente
console.log('\n1️⃣ Test variabili d\'ambiente:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('OPENWA_SESSION_DATA_PATH:', process.env.OPENWA_SESSION_DATA_PATH);
console.log('NODE_PERSIST_DIR:', process.env.NODE_PERSIST_DIR);

// Test 2: Simula il comportamento di node-persist
console.log('\n2️⃣ Test creazione directory .node-persist:');

const testPaths = [
  '.node-persist',
  './node-persist',
  path.join(process.cwd(), '.node-persist')
];

for (const testPath of testPaths) {
  try {
    console.log(`🔍 Test: ${testPath}`);
    
    // Simula quello che fa node-persist
    if (fs.existsSync(testPath)) {
      console.log(`  ✅ Directory già esistente: ${testPath}`);
    } else {
      console.log(`  📁 Tentativo creazione: ${testPath}`);
      fs.mkdirSync(testPath, { recursive: true });
      console.log(`  ✅ Directory creata: ${testPath}`);
      
      // Cleanup
      fs.rmSync(testPath, { recursive: true, force: true });
      console.log(`  🧹 Directory rimossa: ${testPath}`);
    }
  } catch (error) {
    console.log(`  ❌ Errore: ${error.message}`);
  }
}

// Test 3: Test percorso di storage configurato
console.log('\n3️⃣ Test percorso storage configurato:');
const configuredPath = process.env.OPENWA_SESSION_DATA_PATH;
if (configuredPath) {
  try {
    console.log(`📁 Percorso configurato: ${configuredPath}`);
    
    if (!fs.existsSync(configuredPath)) {
      fs.mkdirSync(configuredPath, { recursive: true });
      console.log('  ✅ Directory storage creata');
    }
    
    const nodePersistDir = path.join(configuredPath, 'node-persist');
    if (!fs.existsSync(nodePersistDir)) {
      fs.mkdirSync(nodePersistDir, { recursive: true });
      console.log('  ✅ Directory node-persist creata');
    }
    
    // Test scrittura
    const testFile = path.join(nodePersistDir, 'test.txt');
    fs.writeFileSync(testFile, 'Test file');
    const content = fs.readFileSync(testFile, 'utf8');
    fs.unlinkSync(testFile);
    
    console.log('  ✅ Test scrittura/lettura: OK');
    
  } catch (error) {
    console.log(`  ❌ Errore test storage: ${error.message}`);
  }
} else {
  console.log('  ⚠️ OPENWA_SESSION_DATA_PATH non configurato');
}

// Test 4: Informazioni di sistema
console.log('\n4️⃣ Informazioni sistema:');
console.log('OS tmpdir:', os.tmpdir());
console.log('Current working directory:', process.cwd());
console.log('User:', process.getuid ? process.getuid() : 'N/A');
console.log('Platform:', process.platform);

// Test 5: Test permessi
console.log('\n5️⃣ Test permessi directory temporanea:');
const tmpTestDir = path.join(os.tmpdir(), 'wa-test-' + Date.now());
try {
  fs.mkdirSync(tmpTestDir, { recursive: true });
  fs.mkdirSync(path.join(tmpTestDir, 'node-persist'), { recursive: true });
  
  const testFile = path.join(tmpTestDir, 'test-permissions.txt');
  fs.writeFileSync(testFile, 'Test permessi');
  fs.readFileSync(testFile, 'utf8');
  
  console.log('  ✅ Permessi directory temporanea: OK');
  
  // Cleanup
  fs.rmSync(tmpTestDir, { recursive: true, force: true });
  
} catch (error) {
  console.log(`  ❌ Errore permessi: ${error.message}`);
}

console.log('\n🎯 Test completato!');

// Test 6: Simula import OpenWA
console.log('\n6️⃣ Test configurazione pre-import OpenWA:');
try {
  // Simula il setup che dovrebbe essere fatto prima dell'import OpenWA
  const isProduction = process.env.NODE_ENV === 'production';
  const storagePath = isProduction 
    ? path.join(os.tmpdir(), 'wa-storage')
    : path.join(process.cwd(), 'wa-storage');

  process.env.OPENWA_SESSION_DATA_PATH = storagePath;
  process.env.NODE_PERSIST_DIR = path.join(storagePath, 'node-persist');

  // Crea le directory
  fs.mkdirSync(storagePath, { recursive: true });
  fs.mkdirSync(path.join(storagePath, 'node-persist'), { recursive: true });
  
  console.log('  ✅ Setup pre-import simulato con successo');
  console.log(`  📁 Storage path: ${storagePath}`);
  console.log(`  📁 Node persist dir: ${process.env.NODE_PERSIST_DIR}`);
  
} catch (error) {
  console.log(`  ❌ Errore setup pre-import: ${error.message}`);
}

console.log('\n🚀 Tutti i test completati!'); 