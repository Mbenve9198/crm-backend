# Fix Errore EACCES: permission denied, mkdir '.node-persist' su Railway

## Problema

Quando si tenta di creare una sessione WhatsApp, si verifica l'errore:

```
Error: EACCES: permission denied, mkdir '.node-persist'
```

Questo errore è causato dal fatto che la libreria `@open-wa/wa-automate` utilizza `node-persist` per salvare i dati di sessione, ma in ambiente Railway non ha i permessi per creare directory nella directory corrente.

## Soluzione Implementata

### 1. Configurazione Storage Path Automatica

Il servizio `whatsappService.js` ora configura automaticamente il percorso di storage:

- **Produzione (Railway)**: Usa `/tmp/wa-storage` (directory temporanea con permessi di scrittura)
- **Sviluppo**: Usa `./wa-storage` nella directory del progetto

### 2. Variabili d'Ambiente Richieste

Aggiungi queste variabili al tuo progetto Railway:

```bash
NODE_ENV=production
OPENWA_HEADLESS=true
OPENWA_BROWSER_REVISION=737027
```

### 3. Script di Fix Automatico

È stato creato lo script `scripts/fixNodePersistPermissions.js` che:

- Crea automaticamente le directory necessarie
- Verifica i permessi
- Configura node-persist appropriatamente
- Fornisce fallback in caso di errori

### 4. Configurazione OpenWA Ottimizzata

Le configurazioni OpenWA ora includono:

```javascript
{
  sessionDataPath: process.env.OPENWA_SESSION_DATA_PATH,
  disableSpins: true,
  killProcessOnBrowserClose: true,
  headless: true,
  cacheEnabled: false
}
```

## Test della Soluzione

### 1. Test Locale

```bash
# Testa lo script di fix
npm run fix-node-persist

# Avvia il server
NODE_ENV=production npm start
```

### 2. Deploy su Railway

1. **Configura le variabili d'ambiente**:
   ```
   NODE_ENV=production
   OPENWA_HEADLESS=true
   OPENWA_BROWSER_REVISION=737027
   MONGODB_URI=<your_mongodb_uri>
   JWT_SECRET=<your_jwt_secret>
   ```

2. **Deploy il codice**:
   ```bash
   git add .
   git commit -m "Fix EACCES node-persist error for Railway"
   git push
   ```

3. **Verifica i log**:
   - Cerca nel log: "📁 Directory storage WhatsApp creata"
   - Verifica che non ci siano più errori EACCES

## Troubleshooting

### Se l'errore persiste:

1. **Controlla i log Railway** per messaggi di debug:
   ```
   📁 Directory storage WhatsApp creata: /tmp/wa-storage
   🔧 node-persist configurato per OpenWA
   ```

2. **Esegui manualmente il fix**:
   ```bash
   npm run fix-node-persist
   ```

3. **Verifica le variabili d'ambiente**:
   ```bash
   echo $NODE_ENV
   echo $OPENWA_SESSION_DATA_PATH
   ```

### Fallback Automatico

Se tutto fallisce, il sistema usa automaticamente:
```
/tmp/wa-fallback-[timestamp]
```

## File Modificati

- `services/whatsappService.js` - Configurazione storage path automatica
- `scripts/fixNodePersistPermissions.js` - Script di fix permessi
- `server.js` - Integrazione fix all'avvio
- `env.example` - Nuove variabili d'ambiente
- `package.json` - Nuovo script npm

## Note Importanti

1. **Directory Temporanea**: Railway usa `/tmp` che viene pulita ad ogni restart
2. **Sessioni Persistenti**: Per sessioni persistenti, considera l'uso di un database esterno
3. **Sicurezza**: Le directory create hanno permessi appropriati per l'ambiente cloud
4. **Performance**: La configurazione è ottimizzata per ambienti headless

## Supporto

Se hai ancora problemi:

1. Verifica che `NODE_ENV=production` sia impostato
2. Controlla i log per errori di filesystem
3. Testa in locale con le stesse variabili d'ambiente

## Changelog

- **v1.0.0**: Implementazione fix EACCES node-persist
- **v1.0.1**: Aggiunto fallback automatico
- **v1.0.2**: Ottimizzazioni per Railway deployment 