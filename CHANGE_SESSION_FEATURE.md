# 🔄 Feature: Cambio Sessione WhatsApp per Campagne in Corso

## Panoramica

Questa feature permette di **cambiare il numero WhatsApp** (sessione OpenWA) utilizzato da una campagna **anche mentre è in esecuzione**, senza interrompere il flusso di messaggi o perdere dati.

## 🎯 Caso d'Uso

**Scenario:** Hai una campagna in corso che sta inviando messaggi da un numero WhatsApp A, ma vuoi passare al numero WhatsApp B perché:
- Il numero A ha raggiunto il limite giornaliero
- Vuoi distribuire il carico su più numeri
- Il numero A ha problemi tecnici
- Vuoi testare la performance di un altro numero

**Soluzione:** Usa l'endpoint `/api/whatsapp-campaigns/:id/change-session` per cambiare la sessione **senza fermare la campagna**.

---

## 📡 API Endpoint

### **PUT** `/api/whatsapp-campaigns/:id/change-session`

Cambia la sessione WhatsApp di una campagna esistente.

#### Autenticazione
Richiede Bearer token JWT nell'header `Authorization`.

#### Path Parameters
- `id` (string, required): ID MongoDB della campagna

#### Request Body
```json
{
  "newWhatsappSessionId": "la-mia-nuova-sessione"
}
```

#### Response (Success - 200)
```json
{
  "success": true,
  "data": {
    // Oggetto campagna completo aggiornato
    "whatsappSessionId": "la-mia-nuova-sessione",
    "whatsappNumber": "+39 123 456 7890",
    // ... altri campi campagna
  },
  "message": "Sessione cambiata con successo. I messaggi rimanenti verranno inviati tramite +39 123 456 7890",
  "changes": {
    "oldSessionId": "vecchia-sessione",
    "oldNumber": "+39 098 765 4321",
    "newSessionId": "la-mia-nuova-sessione",
    "newNumber": "+39 123 456 7890",
    "campaignStatus": "running",
    "pendingMessages": 1234,
    "sentMessages": 566
  }
}
```

#### Response (Error - 400)
```json
{
  "success": false,
  "message": "La nuova sessione WhatsApp deve essere connessa e attiva",
  "details": {
    "sessionStatus": "disconnected",
    "sessionNumber": "+39 123 456 7890"
  }
}
```

#### Response (Error - 404)
```json
{
  "success": false,
  "message": "Campagna non trovata"
}
```

---

## 🔒 Validazioni

L'endpoint effettua le seguenti validazioni:

1. ✅ **Campagna esistente**: Verifica che la campagna esista e appartenga all'utente
2. ✅ **Nuova sessione valida**: Verifica che `newWhatsappSessionId` sia fornito
3. ✅ **Proprietà sessione**: Verifica che la nuova sessione appartenga all'utente
4. ✅ **Sessione attiva**: Verifica che la nuova sessione sia connessa (`status: 'connected'` o `'authenticated'`)
5. ✅ **Sessione diversa**: Verifica che la nuova sessione sia diversa da quella attuale

Se qualsiasi validazione fallisce, l'endpoint restituisce un errore 400 o 404.

---

## ✨ Funzionamento Tecnico

### Cosa succede quando cambi la sessione:

1. **Messaggi già inviati** (`sent`, `delivered`, `read`):
   - ✅ Restano immutati
   - ✅ Le statistiche rimangono corrette
   - ✅ I message ID WhatsApp restano validi

2. **Messaggi pending** (non ancora inviati):
   - 🔄 Verranno inviati dalla **nuova sessione**
   - 🔄 Il numero mittente sarà quello della nuova sessione
   - 🔄 I follow-up programmati useranno la nuova sessione

3. **Follow-up già programmati**:
   - ✅ Continuano a funzionare normalmente
   - 🔄 Verranno inviati dalla nuova sessione quando scatta il timer

4. **Statistiche della campagna**:
   - ✅ Le statistiche della campagna restano corrette
   - ℹ️ Le statistiche della vecchia sessione restano invariate
   - 📈 Le statistiche della nuova sessione inizieranno ad aggiornarsi

5. **Stato della campagna**:
   - ✅ Lo stato (`running`, `paused`, etc.) rimane invariato
   - ✅ La campagna continua senza interruzioni

### Perché è sicuro?

Il sistema è progettato in modo che:
- La `messageQueue` (coda messaggi) è **indipendente** dalla sessione
- Ogni invio legge dinamicamente il campo `whatsappSessionId` dalla campagna
- Non ci sono riferimenti "hard-coded" alla sessione nei messaggi
- Il `whatsappService` usa la sessione in modo dinamico per ogni invio

---

## 📝 Esempi d'Uso

### Esempio 1: cURL

```bash
# Cambia la sessione di una campagna in corso
curl -X PUT "http://localhost:3000/api/whatsapp-campaigns/64f5a1b2c3d4e5f6a7b8c9d0/change-session" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "newWhatsappSessionId": "nuova-sessione-whatsapp"
  }'
```

### Esempio 2: JavaScript (Frontend)

```javascript
async function changeCampaignSession(campaignId, newSessionId) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/whatsapp-campaigns/${campaignId}/change-session`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          newWhatsappSessionId: newSessionId
        })
      }
    );

    const data = await response.json();

    if (data.success) {
      console.log('✅ Sessione cambiata!');
      console.log(`Da: ${data.changes.oldNumber}`);
      console.log(`A:  ${data.changes.newNumber}`);
      console.log(`Messaggi pending: ${data.changes.pendingMessages}`);
    } else {
      console.error('❌ Errore:', data.message);
    }

    return data;
  } catch (error) {
    console.error('❌ Errore rete:', error);
    throw error;
  }
}

// Utilizzo
changeCampaignSession(
  '64f5a1b2c3d4e5f6a7b8c9d0',  // Campaign ID
  'sessione-numero-2'           // New Session ID
);
```

### Esempio 3: Node.js (Backend-to-Backend)

```javascript
import axios from 'axios';

async function changeCampaignWhatsAppNumber(campaignId, newSessionId, authToken) {
  try {
    const response = await axios.put(
      `http://localhost:3000/api/whatsapp-campaigns/${campaignId}/change-session`,
      {
        newWhatsappSessionId: newSessionId
      },
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Cambio sessione completato');
    console.log('Vecchio numero:', response.data.changes.oldNumber);
    console.log('Nuovo numero:', response.data.changes.newNumber);
    console.log('Status campagna:', response.data.changes.campaignStatus);

    return response.data;
  } catch (error) {
    if (error.response) {
      console.error('❌ Errore API:', error.response.data.message);
    } else {
      console.error('❌ Errore:', error.message);
    }
    throw error;
  }
}
```

---

## 🎨 Interfaccia Frontend (Suggerimento)

Se vuoi creare un'interfaccia frontend per questa feature, ecco un esempio in React:

```jsx
import React, { useState } from 'react';

function CampaignSessionChanger({ campaign, sessions, onSessionChanged }) {
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChangeSession = async () => {
    if (!selectedSessionId) {
      setError('Seleziona una sessione');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/whatsapp-campaigns/${campaign._id}/change-session`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            newWhatsappSessionId: selectedSessionId
          })
        }
      );

      const data = await response.json();

      if (data.success) {
        alert(`✅ Sessione cambiata!\nDa: ${data.changes.oldNumber}\nA: ${data.changes.newNumber}`);
        onSessionChanged?.(data.data);
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Errore di rete. Riprova.');
    } finally {
      setLoading(false);
    }
  };

  // Filtra solo sessioni attive e diverse da quella corrente
  const availableSessions = sessions.filter(
    s => s.isActive && s.sessionId !== campaign.whatsappSessionId
  );

  return (
    <div className="session-changer">
      <h3>🔄 Cambia Numero WhatsApp</h3>
      
      <div className="current-session">
        <strong>Numero attuale:</strong> {campaign.whatsappNumber}
      </div>

      <select
        value={selectedSessionId}
        onChange={(e) => setSelectedSessionId(e.target.value)}
        disabled={loading}
      >
        <option value="">-- Seleziona nuova sessione --</option>
        {availableSessions.map(session => (
          <option key={session.sessionId} value={session.sessionId}>
            {session.name} ({session.phoneNumber})
          </option>
        ))}
      </select>

      <button onClick={handleChangeSession} disabled={loading || !selectedSessionId}>
        {loading ? 'Cambio in corso...' : 'Cambia Sessione'}
      </button>

      {error && <div className="error">{error}</div>}
    </div>
  );
}

export default CampaignSessionChanger;
```

---

## ⚠️ Note Importanti

### 1. Sessione Disconnessa
Se la nuova sessione si disconnette durante l'invio, i messaggi falliranno. Assicurati che la sessione sia stabile prima di effettuare il cambio.

### 2. Rate Limiting
Il rate limiting è calcolato **per sessione**. Cambiando sessione, resetti il contatore del rate limiting.

### 3. Follow-up
I follow-up già programmati verranno inviati dalla nuova sessione quando scatterà il loro timer.

### 4. Statistiche
Le statistiche della vecchia sessione (es. `stats.messagesSent`) non vengono aggiornate retroattivamente. Solo i nuovi messaggi incrementeranno le statistiche della nuova sessione.

### 5. Rollback
Non è previsto un rollback automatico. Se vuoi tornare alla sessione precedente, devi chiamare nuovamente l'endpoint con l'ID della vecchia sessione.

---

## 🧪 Testing

### Test Manuale

1. **Setup:**
   - Crea almeno 2 sessioni WhatsApp connesse
   - Crea una campagna con la prima sessione
   - Avvia la campagna

2. **Test cambio sessione:**
   ```bash
   curl -X PUT "http://localhost:3000/api/whatsapp-campaigns/CAMPAIGN_ID/change-session" \
     -H "Authorization: Bearer TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"newWhatsappSessionId": "SESSION_2_ID"}'
   ```

3. **Verifica:**
   - ✅ La risposta conferma il cambio
   - ✅ I messaggi successivi usano la nuova sessione
   - ✅ Le statistiche della campagna sono corrette
   - ✅ I follow-up funzionano

### Test Errori

```bash
# Test con sessione non esistente
curl -X PUT "http://localhost:3000/api/whatsapp-campaigns/CAMPAIGN_ID/change-session" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newWhatsappSessionId": "sessione-inesistente"}'

# Test con sessione disconnessa
curl -X PUT "http://localhost:3000/api/whatsapp-campaigns/CAMPAIGN_ID/change-session" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newWhatsappSessionId": "sessione-disconnessa"}'

# Test senza newWhatsappSessionId
curl -X PUT "http://localhost:3000/api/whatsapp-campaigns/CAMPAIGN_ID/change-session" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## 📊 Logging

Il sistema logga automaticamente ogni cambio di sessione:

```
🔄 Richiesta cambio sessione per campagna 64f5a1b2c3d4e5f6a7b8c9d0
📊 Campagna attuale: status=running, sessionId=vecchia-sessione
✅ Sessione cambiata con successo per campagna "Campagna Test"
   Da: vecchia-sessione (+39 098 765 4321)
   A:  nuova-sessione (+39 123 456 7890)
   Messaggi pending: 1234
```

---

## 🛠️ Troubleshooting

### Problema: "La nuova sessione WhatsApp deve essere connessa e attiva"

**Causa:** La sessione di destinazione è disconnessa.

**Soluzione:**
1. Verifica lo stato della sessione: `GET /api/whatsapp-sessions/:id`
2. Riconnetti la sessione se necessario
3. Riprova il cambio

### Problema: "Nuova sessione WhatsApp non trovata o non autorizzata"

**Causa:** L'ID sessione è errato o la sessione appartiene a un altro utente.

**Soluzione:**
1. Lista le tue sessioni: `GET /api/whatsapp-sessions`
2. Verifica l'ID corretto
3. Assicurati di avere i permessi sulla sessione

### Problema: I messaggi continuano a fallire dopo il cambio

**Causa:** La nuova sessione potrebbe avere problemi di connessione.

**Soluzione:**
1. Controlla lo stato reale della sessione nel monitor
2. Verifica i log del `whatsappService`
3. Se necessario, cambia nuovamente a una sessione funzionante

---

## 🎉 Conclusione

Questa feature ti permette di gestire in modo flessibile le tue campagne WhatsApp, cambiando il numero mittente **senza interrompere il flusso di messaggi**. 

È particolarmente utile per:
- 📊 Bilanciare il carico su più numeri
- 🔄 Gestire limiti giornalieri di WhatsApp
- 🛠️ Risolvere problemi tecnici in tempo reale
- 🧪 Testare la performance di diversi numeri

**Supporto:** Per domande o problemi, contatta il team di sviluppo.


