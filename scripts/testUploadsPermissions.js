import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Script per testare i permessi della directory uploads
 * Utile per diagnosticare problemi di upload su Railway
 */

const isProduction = process.env.NODE_ENV === 'production';

// Definisce la directory uploads usando la stessa logica del server
const uploadsDir = isProduction 
  ? path.join(os.tmpdir(), 'uploads')
  : './uploads';

console.log('🔍 Test permessi directory uploads');
console.log('================================');
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Directory uploads: ${uploadsDir}`);
console.log(`Absolute path: ${path.resolve(uploadsDir)}`);
console.log('');

// Test 1: Verifica esistenza directory
console.log('📁 Test 1: Verifica esistenza directory');
try {
  const exists = fs.existsSync(uploadsDir);
  console.log(`✅ Directory exists: ${exists}`);
  
  if (!exists) {
    console.log('📁 Tentativo di creazione directory...');
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✅ Directory creata con successo');
  }
} catch (error) {
  console.error(`❌ Errore creazione directory: ${error.message}`);
  process.exit(1);
}

// Test 2: Verifica permessi di scrittura
console.log('\n✍️  Test 2: Verifica permessi di scrittura');
const testFilePath = path.join(uploadsDir, 'test-permissions.txt');
try {
  fs.writeFileSync(testFilePath, 'Test file for permissions check');
  console.log('✅ Scrittura file test: OK');
  
  // Test 3: Verifica lettura file
  console.log('\n📖 Test 3: Verifica permessi di lettura');
  const content = fs.readFileSync(testFilePath, 'utf8');
  console.log(`✅ Lettura file test: OK (content: "${content}")`);
  
  // Test 4: Verifica cancellazione file
  console.log('\n🗑️  Test 4: Verifica permessi di cancellazione');
  fs.unlinkSync(testFilePath);
  console.log('✅ Cancellazione file test: OK');
  
} catch (error) {
  console.error(`❌ Errore test permessi: ${error.message}`);
  console.error(`❌ Codice errore: ${error.code}`);
  
  if (error.code === 'EACCES') {
    console.error('❌ PROBLEMA: Permessi di accesso negati');
    console.error('💡 SOLUZIONE: Il processo non ha i permessi necessari per scrivere nella directory');
    console.error('💡 Su Railway: Assicurarsi che la directory sia in /tmp o modificare il Dockerfile');
  }
  
  process.exit(1);
}

// Test 5: Informazioni sulla directory
console.log('\n📊 Test 5: Informazioni sulla directory');
try {
  const stats = fs.statSync(uploadsDir);
  console.log(`✅ Directory creata: ${stats.birthtime}`);
  console.log(`✅ Ultima modifica: ${stats.mtime}`);
  console.log(`✅ Permessi: ${stats.mode.toString(8)}`);
  
  // Su sistemi Unix, verifica i permessi specifici
  if (process.platform !== 'win32') {
    const canRead = !!(stats.mode & parseInt('400', 8));
    const canWrite = !!(stats.mode & parseInt('200', 8));
    const canExecute = !!(stats.mode & parseInt('100', 8));
    
    console.log(`✅ Può leggere: ${canRead}`);
    console.log(`✅ Può scrivere: ${canWrite}`);
    console.log(`✅ Può eseguire: ${canExecute}`);
  }
} catch (error) {
  console.error(`❌ Errore verifica stats: ${error.message}`);
}

console.log('\n🎉 Test completati con successo!');
console.log('✅ La directory uploads è configurata correttamente');
console.log(`📁 Path: ${path.resolve(uploadsDir)}`); 