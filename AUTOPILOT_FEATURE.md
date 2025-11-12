# 🤖 Autopilot Campaign Feature

## Panoramica

Il sistema **Autopilot** per campagne WhatsApp automatizza completamente la generazione dei messaggi utilizzando:
- **Serper API** per trovare i competitor del ristorante su Google Maps
- **Claude AI (Anthropic)** per generare messaggi personalizzati basati sui dati dei competitor

## Come Funziona

### 1. Creazione Campagna Autopilot

```javascript
POST /api/whatsapp-campaigns

{
  "name": "Campagna Autopilot Test",
  "mode": "autopilot",  // ← IMPORTANTE
  "whatsappSessionId": "session-id",
  "targetList": "ristoranti-firenze",
  "autopilotConfig": {
    "claudeSettings": {
      "tone": "professionale e amichevole",
      "maxLength": 280,
      "focusPoint": "visibilità su Google",
      "cta": "chiedere se sono interessati a migliorare"
    },
    "searchKeyword": "ristorante italiano",
    "useContactKeyword": true,
    "requiredContactFields": {
      "nameField": "properties.restaurant_name",
      "latField": "properties.latitude",
      "lngField": "properties.longitude",
      "keywordField": "properties.keyword"
    },
    "saveAnalysisToContact": true
  },
  "timing": {
    "schedule": {
      "startTime": "09:00",
      "endTime": "19:00",
      "timezone": "Europe/Rome",
      "daysOfWeek": ["monday", "tuesday", "wednesday", "thursday", "friday"]
    }
  },
  "priority": "media"
}
```

### 2. Processo di Invio

Per ogni contatto, il sistema:

1. **Estrae dati dal contatto**:
   - Nome ristorante
   - Coordinate GPS (lat/lng)
   - Keyword di ricerca (es. "ristorante italiano", "pizzeria")

2. **Chiama Serper API**:
   - Cerca su Google Maps con keyword e coordinate
   - Trova i TOP 3 competitor con più recensioni
   - Calcola ranking del ristorante

3. **Genera messaggio con Claude**:
   - Usa i dati dei competitor
   - Crea un messaggio personalizzato
   - Valida lunghezza e qualità

4. **Invia via WhatsApp**:
   - Invia il messaggio generato
   - Salva dati di analisi nel database
   - Registra attività nel CRM

### 3. Esempio di Messaggio Generato

```
Ciao Marco, ho notato che La Taverna del Ghiottone ha 450 recensioni 
in più su Google rispetto al tuo ristorante. Questo significa che quando 
qualcuno cerca "ristorante italiano" a Firenze, loro appaiono primi. 
Ti va di capire come migliorare la tua visibilità e attirare più clienti?
```

## Requisiti per i Contatti

I contatti devono avere questi campi nelle `properties`:

```javascript
{
  "restaurant_name": "Ristorante Da Mario",
  "latitude": 43.7696,
  "longitude": 11.2558,
  "keyword": "ristorante toscano",  // opzionale
  "city": "Firenze"  // opzionale ma consigliato
}
```

## Configurazione

### Variabili d'Ambiente Richieste

```bash
# Claude AI (Anthropic)
ANTHROPIC_API_KEY=sk-ant-api03-xxx

# Serper API (Google Maps Search)
SERPER_API_KEY=your-serper-api-key
```

### Costi Stimati

- **Serper API**: ~$0.02 per ricerca
- **Claude API**: ~$0.015 per messaggio (model: claude-3-5-sonnet)

**Esempio**: Per 100 contatti = ~$3.50

## API Endpoints

### Crea Campagna Autopilot

```
POST /api/whatsapp-campaigns
```

**Body Parameters**:
- `mode` (string): "autopilot"
- `autopilotConfig` (object): Configurazione autopilot
- Altri parametri standard campagna

**Response**:
```json
{
  "success": true,
  "data": {
    "_id": "campaign-id",
    "name": "Campagna Autopilot",
    "mode": "autopilot",
    "status": "draft",
    ...
  },
  "message": "Campagna autopilot creata. I messaggi verranno generati con AI al momento dell'invio."
}
```

### Avvia Campagna

```
POST /api/whatsapp-campaigns/:id/start
```

La campagna partirà e genererà i messaggi dinamicamente per ogni contatto.

## Dati Salvati

Per ogni messaggio inviato, il sistema salva:

### Nel messaggio (messageQueue):
```javascript
autopilotData: {
  competitors: [
    {
      rank: 1,
      name: "La Taverna del Ghiottone",
      rating: 4.8,
      reviews: 520,
      address: "Via Roma 15, Firenze"
    },
    // ... altri competitor
  ],
  userRank: 5,
  userReviews: 70,
  userRating: 4.5,
  generatedByAI: true,
  aiModel: "claude-3-5-sonnet-20241022",
  generatedAt: "2025-11-12T...",
  messageValidation: {
    score: 95,
    issues: []
  }
}
```

### Nel contatto (se saveAnalysisToContact=true):
```javascript
properties: {
  ...
  serper_analyzed_at: "2025-11-12T...",
  serper_user_rank: 5,
  serper_top_competitor: "La Taverna del Ghiottone",
  serper_competitor_reviews: 520,
  serper_competitor_rating: 4.8
}
```

## Frontend Integration

### Componente per Creare Campagna Autopilot

Il frontend dovrà avere un toggle per selezionare mode:
- Standard (template manuale)
- Autopilot (generazione AI)

Quando `mode='autopilot'`, mostra form per configurare:
- Tono del messaggio
- Lunghezza massima
- Focus principale
- Call-to-action
- Keyword di ricerca

## Monitoring e Debug

### Log Console

```
🤖 Autopilot: Generazione messaggio per Ristorante Da Mario...
🔍 Ricerca competitor per Ristorante Da Mario con keyword "ristorante italiano"
✅ Trovati 3 competitor
✅ Messaggio generato da AI (score: 95/100)
💾 Dati analisi salvati nel contatto Ristorante Da Mario
📧 Smart message sent to Ristorante Da Mario (priority: media, sequence: 0)
```

### Visualizzare Dati Autopilot

Nel frontend, per ogni messaggio inviato in campagna autopilot, mostrare:
- Competitor trovati
- Ranking del ristorante
- Score di validazione del messaggio
- Messaggio generato

## Best Practices

1. **Test con Pochi Contatti**: Prima di lanciare su centinaia di contatti, testa con 5-10
2. **Verifica Coordinate**: Assicurati che i contatti abbiano lat/lng corrette
3. **Monitora Costi**: Serper + Claude costano ~$0.035 per messaggio
4. **Rate Limiting**: Usa `priority: 'bassa'` per evitare spam
5. **Timing**: Configura fasce orarie appropriate (9:00-19:00)

## Troubleshooting

### Errore: "Coordinate GPS mancanti"

```
❌ Errore autopilot per Ristorante XYZ:
Error: Contatto Ristorante XYZ senza coordinate GPS (richieste per autopilot)
```

**Soluzione**: Aggiungi `latitude` e `longitude` nelle properties del contatto.

### Errore: "Nessun competitor trovato"

```
⚠️ Nessun competitor trovato per Ristorante XYZ
```

**Possibili cause**:
- Coordinate GPS errate
- Keyword troppo specifica
- Area geografica remota senza competitor

**Soluzione**: Usa keyword più generica (es. "ristorante" invece di "ristorante vegano biologico")

### Messaggio Generato Troppo Lungo

```
⚠️ Messaggio generato ha problemi: Messaggio troppo lungo (max 350 caratteri)
```

**Soluzione**: Riduci `maxLength` in `claudeSettings` o regola il prompt di Claude.

## Limitazioni

- Richiede coordinate GPS accurate per ogni contatto
- Costi per API esterne (Serper + Claude)
- Velocità ridotta rispetto a template standard (3-5s per messaggio)
- Richiede connessione internet stabile

## Roadmap Future

- [ ] Cache competitor per città (riduce costi Serper)
- [ ] A/B testing automatico messaggi
- [ ] Varianti multiple per stesso contatto
- [ ] Analisi performance messaggi AI vs standard
- [ ] Integrazione con altri provider AI (GPT-4, Gemini)

---

**Documentato il**: 12 Novembre 2025  
**Versione**: 1.0.0

