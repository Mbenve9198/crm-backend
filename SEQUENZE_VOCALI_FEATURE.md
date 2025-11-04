# 🎤 Messaggi Vocali nelle Sequenze WhatsApp - Documentazione Completa

## 📋 Panoramica

Il sistema di sequenze WhatsApp ora supporta **messaggi vocali (note vocali PTT)** come allegati per ogni messaggio della sequenza. Questo permette di creare campagne più coinvolgenti e personalizzate, con vocali che arrivano come se fossero registrati al momento.

## 🎯 Funzionalità

### ✅ Cosa è Possibile Fare

1. **Aggiungere vocali alle sequenze** - Ogni messaggio della sequenza può avere un vocale allegato
2. **Registrazione diretta** - Upload di file audio registrati (browser, app, ecc.)
3. **Formati multipli** - Supporto MP3, OGG, OPUS, WAV, M4A, AAC, WebM
4. **Invio automatico PTT** - I vocali vengono inviati come note vocali WhatsApp (Push-To-Talk)
5. **Gestione completa** - Upload, sostituzione, eliminazione vocali per ogni sequenza

### 🔧 Specifiche Tecniche

- **Dimensione massima**: 10 MB per file
- **Durata consigliata**: 30 secondi - 2 minuti (per best practices marketing)
- **Formati supportati**: 
  - MP3 (audio/mpeg)
  - OGG/OPUS (audio/ogg, audio/opus)
  - WAV (audio/wav)
  - M4A/AAC (audio/mp4, audio/aac)
  - WebM (audio/webm)
- **Tipo WhatsApp**: I vocali vengono inviati come messaggi PTT (come se fossero registrati nell'app)

## 🏗️ Architettura

### Schema Database (MongoDB)

```javascript
// whatsappCampaignSchema
messageSequences: [{
  id: String,
  messageTemplate: String,
  delayMinutes: Number,
  condition: 'no_response' | 'always',
  isActive: Boolean,
  
  // 🎤 NUOVO: Supporto allegato audio
  attachment: {
    type: {
      type: String,
      enum: ['voice', 'image', 'video', 'document']
    },
    filename: String,
    url: String,
    size: Number,
    duration: Number  // Durata in secondi (opzionale)
  }
}]

// messageQueue (viene popolato quando la sequenza è programmata)
messageQueue: [{
  contactId: ObjectId,
  phoneNumber: String,
  compiledMessage: String,
  sequenceIndex: Number,
  
  // 🎤 NUOVO: Allegato copiato dalla sequenza
  attachment: {
    type: 'voice',
    filename: String,
    url: String,
    size: Number,
    duration: Number
  }
}]
```

### API Endpoints

#### 1. Upload Audio per Sequenza

```http
POST /api/whatsapp-campaigns/:campaignId/sequences/:sequenceId/audio
Content-Type: multipart/form-data
Authorization: Bearer TOKEN

Body:
- audio: File (required)
- duration: Number (optional, secondi)

Response 200:
{
  "success": true,
  "data": {
    "attachment": {
      "type": "voice",
      "filename": "vocale-promo.mp3",
      "url": "/uploads/whatsapp/audio-1234567890-xxx.mp3",
      "size": 245678,
      "duration": 45
    },
    "sequenceId": "seq_1"
  },
  "message": "Audio caricato con successo per la sequenza"
}
```

#### 2. Elimina Audio da Sequenza

```http
DELETE /api/whatsapp-campaigns/:campaignId/sequences/:sequenceId/audio
Authorization: Bearer TOKEN

Response 200:
{
  "success": true,
  "message": "Audio rimosso dalla sequenza"
}
```

### Flusso di Funzionamento

```
1. CREAZIONE CAMPAGNA
   ↓
2. AGGIUNTA SEQUENZE
   ↓
3. UPLOAD VOCALE PER SEQUENZA
   - POST /campaigns/:id/sequences/:seqId/audio
   - File salvato in /uploads/whatsapp/
   - Attachment aggiunto alla sequenza
   ↓
4. AVVIO CAMPAGNA
   ↓
5. INVIO MESSAGGIO PRINCIPALE
   ↓
6. PROGRAMMAZIONE FOLLOW-UP
   - scheduleFollowUps() copia l'attachment dalla sequenza al messageQueue
   ↓
7. INVIO FOLLOW-UP (al momento programmato)
   - sendSmartCampaignMessage() rileva attachment nel messageData
   - Chiama sendMessage() con attachment tipo 'voice'
   - sendMessage() usa client.sendPtt() per inviare come vocale
   ↓
8. MESSAGGIO VOCALE CONSEGNATO
   - Il destinatario riceve un messaggio vocale PTT
   - Appare come una nota vocale registrata
```

## 📚 Esempi d'Uso

### Esempio 1: Campagna Vendite con Vocali

```javascript
// 1. Crea campagna
POST /api/whatsapp-campaigns
{
  "name": "Promo Estate 2024",
  "whatsappSessionId": "sessione-1",
  "targetList": "prospect",
  "messageTemplate": "Ciao {nome}! 👋",
  "messageSequences": [
    {
      "id": "seq_1",
      "messageTemplate": "Ecco la nostra offerta speciale!",
      "delayMinutes": 1440, // 24 ore
      "condition": "no_response",
      "isActive": true
    }
  ],
  "timing": {
    "schedule": {
      "startTime": "09:00",
      "endTime": "18:00"
    }
  }
}

// 2. Upload vocale per sequenza
POST /api/whatsapp-campaigns/CAMPAIGN_ID/sequences/seq_1/audio
Content-Type: multipart/form-data

{
  audio: [FILE],
  duration: 35
}

// 3. Avvia campagna
POST /api/whatsapp-campaigns/CAMPAIGN_ID/start

// Risultato:
// - Messaggio principale inviato: "Ciao Marco! 👋"
// - Dopo 24 ore (se nessuna risposta): 
//   VOCALE + "Ecco la nostra offerta speciale!"
```

### Esempio 2: Sequenza Multi-Step con Vocali

```javascript
{
  "name": "Nurturing Leads",
  "messageSequences": [
    {
      "id": "seq_1",
      "messageTemplate": "Ti ho inviato un messaggio vocale importante!",
      "delayMinutes": 60, // 1 ora
      "condition": "no_response"
      // 🎤 Upload vocale di presentazione aziendale (30s)
    },
    {
      "id": "seq_2",
      "messageTemplate": "Ecco la demo del prodotto:",
      "delayMinutes": 2880, // 48 ore
      "condition": "no_response"
      // 🎤 Upload vocale demo prodotto (90s)
    },
    {
      "id": "seq_3",
      "messageTemplate": "Ultima chance! Offerta scade oggi",
      "delayMinutes": 4320, // 72 ore
      "condition": "always"
      // 🎤 Upload vocale urgente sconto (20s)
    }
  ]
}
```

## 🔧 Implementazione Frontend (Guida)

### Componente React - Registrazione Audio

```typescript
// SequenceAudioRecorder.tsx
import { useState, useRef } from 'react';

export function SequenceAudioRecorder({ 
  campaignId, 
  sequenceId, 
  onUploadSuccess 
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(blob);
      };
      
      recorder.start();
      mediaRecorder.current = recorder;
      setIsRecording(true);
    } catch (error) {
      console.error('Errore accesso microfono:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  };

  const uploadAudio = async () => {
    if (!audioBlob) return;

    const formData = new FormData();
    formData.append('audio', audioBlob, 'vocale.webm');
    
    // Calcola durata (opzionale, richiede HTML5 Audio API)
    const audio = new Audio(URL.createObjectURL(audioBlob));
    audio.addEventListener('loadedmetadata', async () => {
      formData.append('duration', Math.round(audio.duration).toString());
      
      const response = await fetch(
        `/api/whatsapp-campaigns/${campaignId}/sequences/${sequenceId}/audio`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        }
      );
      
      const data = await response.json();
      if (data.success) {
        onUploadSuccess(data.data.attachment);
      }
    });
  };

  return (
    <div className="audio-recorder">
      <button 
        onClick={isRecording ? stopRecording : startRecording}
        className={isRecording ? 'recording' : ''}
      >
        {isRecording ? '⏹ Stop' : '🎤 Registra'}
      </button>
      
      {audioBlob && (
        <>
          <audio controls src={URL.createObjectURL(audioBlob)} />
          <button onClick={uploadAudio}>📤 Carica</button>
        </>
      )}
    </div>
  );
}
```

### Upload File Esistente

```typescript
// SequenceAudioUploader.tsx
export function SequenceAudioUploader({ campaignId, sequenceId }) {
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Valida tipo file
    const allowedTypes = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4'];
    if (!allowedTypes.includes(file.type)) {
      alert('Formato non supportato. Usa MP3, OGG, WAV o M4A');
      return;
    }

    // Valida dimensione (10 MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('File troppo grande. Massimo 10 MB');
      return;
    }

    const formData = new FormData();
    formData.append('audio', file);

    try {
      const response = await fetch(
        `/api/whatsapp-campaigns/${campaignId}/sequences/${sequenceId}/audio`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        }
      );

      const data = await response.json();
      if (data.success) {
        console.log('✅ Audio caricato:', data.data.attachment);
      }
    } catch (error) {
      console.error('❌ Errore upload:', error);
    }
  };

  return (
    <input 
      type="file" 
      accept="audio/mpeg,audio/ogg,audio/wav,audio/mp4,audio/webm"
      onChange={handleFileUpload}
    />
  );
}
```

## 📱 Best Practices

### 1. Durata Ottimale dei Vocali

- **Introduzione**: 15-20 secondi
- **Presentazione prodotto**: 30-45 secondi
- **Demo/Tutorial**: 60-90 secondi
- **Offerta urgente**: 20-30 secondi

❌ **Evita** vocali > 2 minuti (troppo lunghi per messaggi automatici)

### 2. Qualità Audio

- **Bitrate**: 64-128 kbps (ottimale per voce)
- **Sample rate**: 16-44.1 kHz
- **Mono/Stereo**: Preferisci mono per voce
- **Rumore di fondo**: Registra in ambiente silenzioso

### 3. Contenuto dei Vocali

✅ **Buone pratiche:**
- Tono amichevole e conversazionale
- Messaggio chiaro e conciso
- Call-to-action specifica
- Personalizzazione (menziona il contesto)

❌ **Evita:**
- Script troppo formali
- Informazioni troppo tecniche
- Parlare troppo veloce
- Audio di bassa qualità

### 4. Timing e Sequencing

```
Messaggio 1 (principale): Solo testo
  ↓ 24 ore (se no risposta)
Messaggio 2: Testo + Vocale introduttivo (20s)
  ↓ 48 ore (se no risposta)
Messaggio 3: Testo + Vocale offerta (30s)
  ↓ 72 ore (sempre)
Messaggio 4: Solo testo (follow-up finale)
```

## 🔒 Sicurezza e Privacy

### Validazioni Implementate

- ✅ **Autenticazione**: Richiede token Bearer valido
- ✅ **Ownership**: Solo proprietario campagna può caricare
- ✅ **Tipo file**: Solo formati audio permessi
- ✅ **Dimensione**: Max 10 MB
- ✅ **Stato campagna**: Solo draft/scheduled modificabili

### Storage

- File salvati in: `/uploads/whatsapp/`
- Naming: `audio-{timestamp}-{random}.{ext}`
- Eliminazione: File fisico rimosso quando audio viene cancellato

## 🐛 Troubleshooting

### Problema: "File audio non inviato"

**Soluzione:**
- Verifica che la sessione WhatsApp sia connessa
- Controlla formato file (deve essere audio/*)
- Verifica dimensione < 10 MB
- Controlla path file URL corretto

### Problema: "Vocale non appare come PTT"

**Soluzione:**
- Assicurati che attachment.type sia 'voice' (non 'audio')
- Verifica che sendPtt() venga chiamato (non sendFile())

### Problema: "Audio non trovato nel follow-up"

**Soluzione:**
- Verifica che l'attachment sia stato salvato nella sequenza
- Controlla che scheduleFollowUps() copi correttamente l'attachment
- Verifica logs: `🎤 Allegato voice aggiunto al follow-up`

## 📊 Monitoraggio e Statistiche

### Log da Controllare

```bash
# Upload audio
🎤 Audio caricato per sequenza seq_1: vocale-promo.mp3 (234.56 KB)

# Programmazione follow-up
🎤 Allegato voice aggiunto al follow-up 1

# Invio messaggio
🎤 Invio allegato voice per sequenza 1
🎤 Messaggio vocale inviato (35s)
```

### Metriche Consigliate

- Tasso di ascolto (difficile misurare con WhatsApp)
- Tasso di risposta post-vocale vs post-testo
- Tempo medio alla prima risposta
- Conversioni per tipo di messaggio

## 🚀 Roadmap Futura

### Funzionalità Pianificate

- [ ] **Text-to-Speech**: Generazione vocali automatici da testo
- [ ] **Variabili nei vocali**: Personalizzazione nome utente nel vocale
- [ ] **A/B Testing**: Test vocale vs testo
- [ ] **Analytics avanzate**: Tracking riproduzione vocali
- [ ] **Libreria vocali**: Template vocali riutilizzabili
- [ ] **Conversione automatica**: Normalizzazione formati audio

## 📞 Supporto

Per problemi o domande:
- Consulta questa documentazione
- Verifica i log del server
- Controlla la documentazione OpenWA: https://docs.openwa.dev

## 🎉 Conclusione

Il supporto per i vocali nelle sequenze WhatsApp trasforma le campagne da semplici messaggi testuali a esperienze più personali e coinvolgenti. Usa questa funzionalità strategicamente per:

- **Aumentare engagement**: I vocali catturano più attenzione
- **Personalizzare comunicazione**: La voce umana crea connessione
- **Differenziarsi**: Pochi competitor usano vocali automatici
- **Migliorare conversioni**: Messaggi più persuasivi

Buone campagne! 🎤📱✨

