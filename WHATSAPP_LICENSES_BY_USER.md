# 🔑 Sistema Licenze WhatsApp per Utente

## 📋 Panoramica

Il sistema di sequenze WhatsApp ora supporta **licenze diverse per ogni utente**. Questo permette di:

- ✅ Usare licenze separate per account diversi
- ✅ Gestire più numeri WhatsApp con licenze specifiche
- ✅ Controllare i costi e le funzionalità per utente
- ✅ Isolare i problemi di licenza per account

## 👥 Configurazione Utenti

### Marco Benvenuti (marco@menuchat.com)
- **Licenza**: Utilizza la licenza esistente configurata in `OPENWA_LICENSE_KEY`
- **Comportamento**: Usa la licenza che già funziona nel sistema
- **Log**: `🔑 Marco Benvenuti: usando licenza esistente`

### Federico Desantis (federico@menuchat.com)  
- **Licenza**: `8D57EE58-7B694EBC-A77FFA52-66B053E3`
- **Comportamento**: Licenza dedicata per le sue sessioni WhatsApp
- **Log**: `🔑 Federico Desantis: usando licenza specifica`

### Altri Utenti
- **Licenza**: Fallback alla licenza di default (`OPENWA_LICENSE_KEY`)
- **Comportamento**: Compatibilità con eventuali nuovi utenti
- **Log**: `🔑 Utente email@esempio.com: usando licenza di default`

## ⚙️ Come Funziona

### 1. Creazione Sessione
Quando un utente crea una sessione WhatsApp:

```javascript
// Nel controller
const userId = req.user._id; // ID dell'utente autenticato

// Nel servizio WhatsApp
const user = await User.findById(owner);
let licenseKey = process.env.OPENWA_LICENSE_KEY; // Default

if (user.email === 'marco@menuchat.com') {
  licenseKey = process.env.OPENWA_LICENSE_KEY; // Licenza esistente
} else if (user.email === 'federico@menuchat.com') {
  licenseKey = '8D57EE58-7B694EBC-A77FFA52-66B053E3'; // Licenza Federico
}
```

### 2. Configurazione OpenWA
La licenza viene passata alla configurazione di OpenWA:

```javascript
const config = {
  sessionId,
  // ... altre configurazioni
  ...(licenseKey && { 
    licenseKey: licenseKey 
  })
};
```

### 3. Verifica nei Log
Nei log del server puoi verificare quale licenza è stata applicata:

```
👤 Utente trovato: Federico Desantis (federico@menuchat.com)
🔑 Federico Desantis: usando licenza specifica
🎯 Licenza selezionata per Federico: 8D57EE58...
✅ Sessione creata: federico-wa - Licenza: Licenza specifica utente
```

## 🧪 Test e Verifica

### 1. Test con Marco
1. Accedi con `marco@menuchat.com`
2. Crea una sessione WhatsApp  
3. Verifica nei log: `🔑 Marco Benvenuti: usando licenza esistente`
4. La sessione dovrebbe funzionare come prima

### 2. Test con Federico
1. Accedi con `federico@menuchat.com`
2. Crea una sessione WhatsApp
3. Verifica nei log: `🔑 Federico Desantis: usando licenza specifica`
4. La sessione dovrebbe usare la nuova licenza

### 3. Controllo Licenza Attiva
Nei log di OpenWA dovresti vedere:
```
✅ OpenWA License Key loaded: 8D57EE58...
🚀 Sessione pronta con licenza attiva
```

## 🔧 Manutenzione

### Aggiungere Nuovo Utente con Licenza Specifica

Per aggiungere un nuovo utente con licenza dedicata, modifica il file `services/whatsappService.js`:

```javascript
if (user.email === 'marco@menuchat.com') {
  licenseKey = process.env.OPENWA_LICENSE_KEY;
  console.log('🔑 Marco Benvenuti: usando licenza esistente');
} else if (user.email === 'federico@menuchat.com') {
  licenseKey = '8D57EE58-7B694EBC-A77FFA52-66B053E3';
  console.log('🔑 Federico Desantis: usando licenza specifica');
} else if (user.email === 'nuovo@utente.com') {
  licenseKey = 'NUOVA-LICENZA-QUI';
  console.log('🔑 Nuovo Utente: usando licenza dedicata');
}
```

### Gestione Licenze Scadute

Se una licenza scade:
1. **Marco**: aggiorna `OPENWA_LICENSE_KEY` nelle variabili d'ambiente
2. **Federico**: aggiorna la licenza hard-coded nel codice
3. **Riavvia** il server per applicare le modifiche

## 🚨 Troubleshooting

### ❌ "License key invalid" per Federico
- Verifica che la licenza `8D57EE58-7B694EBC-A77FFA52-66B053E3` sia valida
- Controlla che non sia scaduta
- Verifica nei log che sia stata applicata correttamente

### ❌ Marco usa licenza sbagliata
- Verifica che `OPENWA_LICENSE_KEY` sia configurata
- Controlla che l'email sia esattamente `marco@menuchat.com`
- Riavvia il server se necessario

### ❌ Utente non riconosciuto
- Verifica che l'utente esista nel database
- Controlla i log per `❌ Errore nel recupero dati utente`
- L'utente userà la licenza di fallback

## 📊 Monitoraggio

### Log da Controllare

```bash
# Creazione sessione con licenza corretta
👤 Utente trovato: Federico Desantis (federico@menuchat.com)
🔑 Federico Desantis: usando licenza specifica
✅ Sessione creata: federico-wa - Licenza: Licenza specifica utente

# Fallback in caso di errore
⚠️ Utente non trovato per ID: xxx, usando licenza di default
🔄 Fallback: usando licenza di default
```

### Monitoraggio Sessioni Attive

```bash
# Comando per vedere le sessioni attive
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/api/whatsapp-sessions
```

## 🎯 Vantaggi

1. **Isolamento**: Problemi con una licenza non affettano altri utenti
2. **Scalabilità**: Facile aggiungere nuovi utenti con licenze dedicate  
3. **Controllo Costi**: Ogni account può avere il proprio piano
4. **Debugging**: Log chiari per identificare quale licenza viene usata
5. **Fallback**: Sistema robusto con licenza di default per compatibilità

---

**✅ Sistema implementato e attivo!** 

Le sessioni create da Marco useranno la licenza esistente, mentre quelle di Federico useranno la nuova licenza `38E12BAB-83DE4201-9C8473A6-D094A67B`. 