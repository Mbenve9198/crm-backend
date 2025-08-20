# Fix Errore Upload CSV su Railway

## Problema
Quando si tenta di caricare un file CSV per l'importazione dei contatti, si verifica l'errore:
```
Error: EACCES: permission denied, open 'uploads/csv-import-XXXXX.csv'
```

## Causa
Il problema è dovuto ai permessi del filesystem su Railway. La cartella `uploads` viene creata nella directory di lavoro dell'applicazione, che potrebbe non avere i permessi di scrittura necessari su alcuni servizi di hosting.

## Soluzione Implementata

### 1. Modifica del Server (server.js)
- **Prima**: La cartella uploads veniva creata con il percorso relativo `./uploads`
- **Ora**: In produzione, utilizza la directory temporanea del sistema operativo `/tmp/uploads`

```javascript
// In produzione usa la directory temporanea per evitare problemi di permessi
const uploadsDir = isProduction 
  ? path.join(os.tmpdir(), 'uploads')
  : './uploads';
```

### 2. Aggiornamento Configurazione Multer (routes/contactRoutes.js)
- Aggiornata la configurazione di Multer per utilizzare la variabile d'ambiente `UPLOADS_DIR`
- La directory viene ora configurata dinamicamente in base all'ambiente

### 3. Aggiornamento Dockerfile
- Aggiunta creazione esplicita della directory `/tmp/uploads`
- Impostati i permessi corretti (777) e ownership (node:node)

```dockerfile
# Create uploads directory in tmp for CSV uploads (production)
RUN mkdir -p /tmp/uploads
RUN chmod -R 777 /tmp/uploads
RUN chown -R node:node /tmp/uploads
```

### 4. Gestione Errori Migliorata
- Aggiunta gestione specifica per errori `EACCES` nei controller
- Messaggi di errore più descrittivi per facilitare il debugging

### 5. Strumenti di Debug

#### Script di Test
Nuovo script per testare i permessi della directory uploads:
```bash
npm run test-uploads
```

#### Endpoint di Debug
Nuovo endpoint per verificare lo stato della directory uploads:
```
GET /debug/uploads
```

Restituisce informazioni dettagliate su:
- Path della directory uploads
- Esistenza della directory
- Permessi di lettura/scrittura/cancellazione
- Informazioni sui permessi del filesystem

## Come Testare la Correzione

### 1. Localmente
```bash
# Test permessi uploads
npm run test-uploads

# Avvia il server in modalità development
npm run dev

# Verifica endpoint debug
curl http://localhost:3000/debug/uploads
```

### 2. Su Railway
```bash
# Dopo il deploy, verifica l'endpoint debug
curl https://YOUR-RAILWAY-URL/debug/uploads

# Test upload CSV tramite frontend
```

## Ambienti

### Development (NODE_ENV !== 'production')
- Directory uploads: `./uploads` (relativa alla directory del progetto)
- Comportamento invariato per lo sviluppo locale

### Production (NODE_ENV === 'production')
- Directory uploads: `/tmp/uploads` (directory temporanea del sistema)
- Risolve i problemi di permessi su Railway e altre piattaforme di hosting

## Note Importanti

1. **File Temporanei**: I file CSV vengono eliminati automaticamente dopo l'elaborazione
2. **Sicurezza**: I file vengono salvati in una directory temporanea e non persistono tra i restart
3. **Performance**: Nessun impatto sulle performance, solo cambio di directory
4. **Compatibilità**: Retrocompatibile con tutte le funzionalità esistenti

## Debugging

Se si verificano ancora problemi di upload:

1. Controllare l'endpoint `/debug/uploads` per verificare lo stato della directory
2. Eseguire lo script `npm run test-uploads` localmente
3. Verificare i log del server per errori specifici
4. Controllare che la variabile `NODE_ENV` sia impostata correttamente su Railway

## Variabili d'Ambiente

- `NODE_ENV`: Determina quale directory utilizzare (production vs development)
- `UPLOADS_DIR`: Directory uploads configurata automaticamente dal server

## File Modificati

- `server.js`: Logica per determinare la directory uploads
- `routes/contactRoutes.js`: Configurazione Multer aggiornata
- `controllers/contactController.js`: Gestione errori migliorata
- `Dockerfile`: Creazione directory uploads in produzione
- `package.json`: Aggiunto script di test
- `scripts/testUploadsPermissions.js`: Nuovo script di test permessi 