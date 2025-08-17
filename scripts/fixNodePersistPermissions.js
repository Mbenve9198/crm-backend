import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Script per configurare node-persist e risolvere problemi di permessi
 * Utile per Railway e altri ambienti cloud
 */

async function fixNodePersistPermissions() {
  console.log('🔧 Fix permessi node-persist per OpenWA...');
  
  try {
    // Determina il percorso appropriato per l'ambiente
    let storagePath;
    
    if (process.env.NODE_ENV === 'production') {
      // In produzione, usa la directory temporanea del sistema
      storagePath = process.env.OPENWA_STORAGE_PATH || path.join(os.tmpdir(), 'wa-storage');
      console.log(`📁 Ambiente produzione: utilizzo ${storagePath}`);
    } else {
      // In sviluppo, usa la directory del progetto
      storagePath = process.env.OPENWA_STORAGE_PATH || path.join(process.cwd(), 'wa-storage');
      console.log(`📁 Ambiente sviluppo: utilizzo ${storagePath}`);
    }

    // Crea le directory necessarie
    const directories = [
      storagePath,
      path.join(storagePath, 'node-persist'),
      path.join(storagePath, 'sessions'),
      path.join(storagePath, 'wa-sessions')
    ];

    for (const dir of directories) {
      try {
        await fs.mkdir(dir, { recursive: true });
        console.log(`✅ Directory creata: ${dir}`);
        
        // Verifica i permessi
        const stats = await fs.stat(dir);
        console.log(`📊 Permessi ${dir}: ${stats.mode.toString(8)}`);
        
      } catch (error) {
        if (error.code === 'EEXIST') {
          console.log(`✅ Directory già esistente: ${dir}`);
        } else {
          console.warn(`⚠️ Avviso per ${dir}: ${error.message}`);
        }
      }
    }

    // Crea un file di test per verificare i permessi di scrittura
    const testFile = path.join(storagePath, 'test-permissions.txt');
    try {
      await fs.writeFile(testFile, 'Test permessi node-persist');
      await fs.readFile(testFile, 'utf8');
      await fs.unlink(testFile);
      console.log('✅ Test permessi di scrittura: OK');
    } catch (error) {
      console.error('❌ Test permessi di scrittura fallito:', error.message);
      throw error;
    }

    // Imposta la variabile d'ambiente
    process.env.OPENWA_SESSION_DATA_PATH = storagePath;
    console.log(`✅ OPENWA_SESSION_DATA_PATH impostato: ${storagePath}`);

    // Crea un file di configurazione per node-persist
    const persistConfig = {
      dir: path.join(storagePath, 'node-persist'),
      stringify: JSON.stringify,
      parse: JSON.parse,
      encoding: 'utf8',
      logging: false,
      ttl: false,
      forgiveParseErrors: true
    };

    const configFile = path.join(storagePath, 'node-persist-config.json');
    await fs.writeFile(configFile, JSON.stringify(persistConfig, null, 2));
    console.log(`✅ Configurazione node-persist salvata: ${configFile}`);

    console.log('🎉 Fix permessi node-persist completato con successo!');
    
    return {
      success: true,
      storagePath,
      config: persistConfig
    };

  } catch (error) {
    console.error('❌ Errore durante il fix permessi:', error);
    
    // Fallback: usa directory temporanea di sistema
    const fallbackPath = path.join(os.tmpdir(), 'wa-fallback-' + Date.now());
    try {
      await fs.mkdir(fallbackPath, { recursive: true });
      process.env.OPENWA_SESSION_DATA_PATH = fallbackPath;
      console.log(`🔄 Fallback attivato: ${fallbackPath}`);
      
      return {
        success: false,
        error: error.message,
        fallbackPath
      };
    } catch (fallbackError) {
      console.error('❌ Anche il fallback è fallito:', fallbackError);
      throw fallbackError;
    }
  }
}

// Esegui se chiamato direttamente
if (import.meta.url === `file://${process.argv[1]}`) {
  fixNodePersistPermissions()
    .then(result => {
      console.log('🎯 Risultato:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Errore fatale:', error);
      process.exit(1);
    });
}

export default fixNodePersistPermissions; 