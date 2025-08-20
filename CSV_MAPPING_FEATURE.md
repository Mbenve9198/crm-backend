# Mappatura CSV con Proprietà Dinamiche

## Panoramica

La funzionalità di importazione CSV è stata migliorata per mostrare automaticamente tutte le proprietà dinamiche già esistenti nel database durante la fase di mappatura. Questo permette agli utenti di mappare facilmente le colonne del CSV alle proprietà che hanno già creato in precedenza.

## Problema Risolto

**Prima**: Durante la mappatura CSV, gli utenti vedevano solo esempi generici come `properties.company` e dovevano ricordare o indovinare i nomi delle proprietà dinamiche esistenti.

**Ora**: Il sistema mostra automaticamente tutte le proprietà dinamiche già presenti nel database, rendendo la mappatura più semplice e accurata.

## Funzionalità Implementate

### 1. Recupero Automatico delle Proprietà Esistenti

Durante l'analisi del CSV (fase `analyze`), il sistema:
- Recupera tutte le proprietà dinamiche esistenti dal database
- Le include nelle opzioni di mappatura
- Fornisce descrizioni chiare per distinguere proprietà esistenti da nuove

### 2. Nuovo Endpoint per Opzioni di Mappatura

**Endpoint**: `GET /api/contacts/csv-mapping-options`

Restituisce una struttura completa con:
- Campi fissi del modello Contact
- Proprietà dinamiche esistenti
- Opzioni speciali (ignore, etc.)
- Istruzioni per creare nuove proprietà

**Esempio di risposta**:
```json
{
  "success": true,
  "data": {
    "fixed": [
      {
        "key": "name",
        "label": "Nome",
        "description": "Campo nome del contatto (obbligatorio)",
        "required": true
      },
      {
        "key": "email",
        "label": "Email",
        "description": "Campo email (opzionale ma unico se fornito)",
        "required": false
      }
    ],
    "existingProperties": [
      {
        "key": "properties.company",
        "label": "company",
        "description": "Proprietà esistente: company",
        "type": "existing"
      },
      {
        "key": "properties.position",
        "label": "position",
        "description": "Proprietà esistente: position",
        "type": "existing"
      }
    ],
    "special": [
      {
        "key": "ignore",
        "label": "Ignora colonna",
        "description": "Ignora questa colonna durante l'importazione",
        "type": "ignore"
      }
    ]
  }
}
```

### 3. Analisi CSV Migliorata

La funzione `analyzeCsvFile` ora:
- Recupera automaticamente le proprietà dinamiche esistenti
- Include queste proprietà nelle `mappingInstructions`
- Fornisce informazioni dettagliate sulla disponibilità delle proprietà

**Struttura della risposta migliorata**:
```json
{
  "success": true,
  "data": {
    "headers": ["Nome", "Email", "Azienda", "Posizione"],
    "sampleRows": [...],
    "availableFields": {
      "fixed": ["name", "email", "phone", "lists"],
      "existingProperties": ["company", "position", "industry", "budget"],
      "newProperties": "Puoi creare nuove proprietà dinamiche..."
    },
    "mappingInstructions": {
      "name": "Campo nome del contatto (obbligatorio)",
      "email": "Campo email (opzionale ma unico se fornito)",
      "properties.company": "Proprietà esistente: company",
      "properties.position": "Proprietà esistente: position",
      "properties.newField": "Esempio: crea proprietà personalizzata"
    },
    "dynamicPropertiesInfo": {
      "existing": ["company", "position", "industry", "budget"],
      "count": 4,
      "usage": "Usa 'properties.nomeProp' per mappare alle proprietà esistenti o crearne di nuove"
    }
  }
}
```

## Flusso di Utilizzo

### 1. Analisi CSV
```bash
POST /api/contacts/import-csv?phase=analyze
Content-Type: multipart/form-data
Body: csvFile (file)
```

### 2. Risposta con Proprietà Esistenti
Il sistema restituisce:
- Colonne del CSV
- Righe di esempio
- **Tutte le proprietà dinamiche esistenti** nel database
- Istruzioni complete per la mappatura

### 3. Mappatura da Parte dell'Utente
L'utente può ora:
- Vedere tutte le proprietà già create
- Mapparle facilmente alle colonne CSV
- Creare nuove proprietà se necessario

### 4. Importazione
```bash
POST /api/contacts/import-csv?phase=import
Content-Type: multipart/form-data
Body: 
  - csvFile (file)
  - mapping (JSON object)
  - duplicateStrategy (string)
```

## Esempi di Mappatura

### Scenario: CSV con Dati Aziendali

**Colonne CSV**: "Nome Completo", "Email", "Azienda", "Ruolo", "Budget"

**Proprietà Esistenti nel DB**: `company`, `position`, `budget`, `source`, `notes`

**Mappatura Suggerita**:
```json
{
  "Nome Completo": "name",
  "Email": "email",
  "Azienda": "properties.company",     // ← Proprietà esistente!
  "Ruolo": "properties.position",      // ← Proprietà esistente!
  "Budget": "properties.budget"        // ← Proprietà esistente!
}
```

### Scenario: Mix di Proprietà Esistenti e Nuove

**Colonne CSV**: "Nome", "Email", "Azienda", "Settore", "Telefono Ufficio"

**Proprietà Esistenti**: `company`, `industry`

**Mappatura**:
```json
{
  "Nome": "name",
  "Email": "email",
  "Azienda": "properties.company",           // ← Esistente
  "Settore": "properties.industry",          // ← Esistente  
  "Telefono Ufficio": "properties.officePhone" // ← Nuova proprietà
}
```

## Benefici

### Per gli Utenti
- **Visibilità completa**: Vedono tutte le proprietà già create
- **Mappatura più facile**: Non devono ricordare o indovinare i nomi
- **Consistenza**: Usano sempre gli stessi nomi per le stesse proprietà
- **Errori ridotti**: Meno probabilità di creare duplicati involontari

### Per il Sistema
- **Normalizzazione dei dati**: Proprietà coerenti tra importazioni
- **Migliore organizzazione**: Proprietà raggruppate logicamente
- **Facilità di ricerca**: Proprietà standardizzate sono più facili da cercare

## Test e Debug

### Script di Test
```bash
npm run test-csv-mapping
```

Questo script:
- Crea contatti di esempio con proprietà dinamiche
- Testa il recupero delle proprietà
- Simula il flusso completo di mappatura

### Endpoint di Debug
```bash
GET /api/contacts/csv-mapping-options
```

Utile per:
- Verificare le proprietà disponibili
- Controllare la struttura delle opzioni
- Debug dell'interfaccia frontend

### Verifica Manuale
1. Crea alcuni contatti con proprietà dinamiche
2. Prova l'upload di un CSV
3. Verifica che le proprietà esistenti appaiano nella mappatura

## Configurazione Frontend

Il frontend dovrebbe:

1. **Chiamare l'endpoint di analisi** per ottenere le opzioni
2. **Organizzare le opzioni** in categorie:
   - Campi obbligatori (name)
   - Campi opzionali (email, phone, lists)
   - Proprietà esistenti (raggruppate)
   - Opzione ignora

3. **Mostrare chiaramente** la differenza tra:
   - Proprietà esistenti: "📋 company (esistente)"
   - Nuove proprietà: "✨ properties.newField (nuova)"

4. **Suggerire mappature automatiche** basate sui nomi delle colonne

## Compatibilità

- ✅ **Retrocompatibile**: Funziona con tutti i CSV esistenti
- ✅ **Non breaking**: Le API esistenti continuano a funzionare
- ✅ **Performance**: Nessun impatto significativo sulle prestazioni
- ✅ **Sicurezza**: Nessun cambiamento ai permessi o alla sicurezza

## Note Tecniche

### Database Query
La query per recuperare le proprietà dinamiche:
```javascript
const propertyKeys = await Contact.aggregate([
  { $match: { properties: { $exists: true, $ne: null } } },
  { $project: { properties: { $objectToArray: '$properties' } } },
  { $unwind: '$properties' },
  { $group: { _id: '$properties.k' } },
  { $sort: { _id: 1 } }
]);
```

### Performance
- Query ottimizzata con aggregation pipeline
- Cache non necessaria (proprietà cambiano raramente)
- Overhead minimo durante l'analisi CSV

### Estensibilità
- Facile aggiungere metadata alle proprietà (tipo, descrizione, etc.)
- Possibile implementare categorie di proprietà
- Supporto futuro per proprietà obbligatorie/opzionali 