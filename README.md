# MenuChatCRM Backend

Backend completo per **MenuChatCRM** - Sistema di gestione contatti con importazione CSV e proprietà dinamiche.

## 🚀 Caratteristiche Principali

- ✅ **CRUD completo** per contatti con ownership
- ✅ **Sistema utenti completo** con autenticazione JWT
- ✅ **Ruoli e permessi** (admin, manager, agent, viewer)
- ✅ **Ownership contatti** con assegnazione dinamica
- ✅ **Gestione liste dinamiche** 
- ✅ **Importazione CSV** con mappatura colonne personalizzabile
- ✅ **Proprietà dinamiche** sui contatti (chiave/valore)
- ✅ **Trasferimento ownership** tra utenti
- ✅ **Validazione** email e telefono
- ✅ **Paginazione** e ricerca avanzata
- ✅ **API REST** completamente documentate
- ✅ **Integrazione Twilio completa** (chiamate con numero verificato)

## 📋 Prerequisiti

- **Node.js** >= 16.0.0
- **MongoDB** locale o cloud (MongoDB Atlas)
- **npm** o **yarn**

## 🛠️ Installazione

1. **Clona e installa dipendenze:**
```bash
cd backend
npm install
```

2. **Configura le variabili d'ambiente:**
Crea un file `.env` nella root del backend:
```bash
# Porta del server
PORT=3000

# Ambiente
NODE_ENV=development

# MongoDB (modifica se necessario)
MONGODB_URI=mongodb://localhost:27017/menuchatcrm

# Frontend URL per CORS (opzionale)
FRONTEND_URL=http://localhost:3001
```

3. **Avvia MongoDB:**
- **MongoDB locale:** `mongod`
- **MongoDB Cloud:** Configura l'URI nel file `.env`

4. **Avvia il server:**
```bash
# Sviluppo (con nodemon)
npm run dev

# Produzione
npm start

# Test configurazione Twilio (opzionale)
npm run test-twilio
```

Il server sarà disponibile su: `http://localhost:3000`

## 📚 Documentazione API

### Endpoints Principali

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| `GET` | `/` | Informazioni API |
| `GET` | `/health` | Health check |
| `GET` | `/api-docs` | Documentazione completa |

### Autenticazione e Utenti

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Registrazione nuovo utente |
| `POST` | `/api/auth/login` | Login utente |
| `POST` | `/api/auth/logout` | Logout utente |
| `GET` | `/api/auth/me` | Profilo utente corrente |
| `PUT` | `/api/auth/me` | Aggiorna profilo |
| `PUT` | `/api/auth/change-password` | Cambia password |

### Gestione Utenti (Admin/Manager)

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| `GET` | `/api/users` | Lista utenti con filtri |
| `GET` | `/api/users/:id` | Dettagli utente |
| `PUT` | `/api/users/:id` | Aggiorna utente |
| `DELETE` | `/api/users/:id` | Elimina utente (admin) |
| `POST` | `/api/users/:fromId/transfer-contacts/:toId` | Trasferisce ownership |
| `GET` | `/api/users/stats` | Statistiche utenti |
| `GET` | `/api/users/for-assignment` | Lista per assegnazione |

### Gestione Contatti

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| `POST` | `/api/contacts` | Crea nuovo contatto |
| `GET` | `/api/contacts` | Lista contatti (con filtri) |
| `GET` | `/api/contacts/:id` | Ottieni contatto per ID |
| `PUT` | `/api/contacts/:id` | Aggiorna contatto |
| `DELETE` | `/api/contacts/:id` | Elimina contatto |
| `GET` | `/api/contacts/stats` | Statistiche contatti |

### Gestione Liste

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| `POST` | `/api/contacts/lists/:listName/contacts/:id` | Aggiungi a lista |
| `DELETE` | `/api/contacts/lists/:listName/contacts/:id` | Rimuovi da lista |

### Importazione CSV

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| `POST` | `/api/contacts/import-csv?phase=analyze` | Analizza CSV |
| `POST` | `/api/contacts/import-csv?phase=import` | Importa CSV |

## 👥 Ruoli e Permessi

### Gerarchia Ruoli
1. **Admin**: Accesso completo al sistema
2. **Manager**: Gestione utenti e contatti di tutti
3. **Agent**: Gestione dei propri contatti
4. **Viewer**: Solo lettura

### Permessi per Ruolo

#### 🔑 Admin
- ✅ Tutti i permessi di Manager
- ✅ Eliminazione utenti
- ✅ Reset password utenti
- ✅ Attivazione/disattivazione account
- ✅ Modifica ruoli utenti

#### 👨‍💼 Manager  
- ✅ Tutti i permessi di Agent
- ✅ Visualizzazione tutti i contatti
- ✅ Assegnazione contatti ad altri utenti
- ✅ Trasferimento ownership contatti
- ✅ Gestione utenti (creazione, modifica)
- ✅ Statistiche sistema

#### 👨‍💻 Agent
- ✅ CRUD sui propri contatti
- ✅ Importazione CSV
- ✅ Gestione liste sui propri contatti
- ✅ Visualizzazione utenti per assegnazione

#### 👀 Viewer
- ✅ Solo lettura contatti (limitato ai propri se assegnati)

## 💡 Esempi d'Uso

### 1. Registrazione e Login

```bash
# Registrazione nuovo agent
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Mario",
    "lastName": "Rossi", 
    "email": "mario.rossi@email.com",
    "password": "password123",
    "role": "agent",
    "department": "Vendite"
  }'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "mario.rossi@email.com",
    "password": "password123"
  }'
```

### 2. Creare un Contatto

```bash
curl -X POST http://localhost:3000/api/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mario Rossi",
    "email": "mario.rossi@email.com",
    "phone": "+39 123 456 7890",
    "lists": ["clienti", "newsletter"],
    "properties": {
      "company": "Acme Corp",
      "notes": "Cliente VIP"
    }
  }'
```

### 2. Filtrare Contatti per Lista

```bash
curl "http://localhost:3000/api/contacts?list=clienti&page=1&limit=10"
```

### 3. Ricerca Contatti

```bash
curl "http://localhost:3000/api/contacts?search=mario" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 4. Gestione Utenti (Manager/Admin)

```bash
# Lista utenti con filtri
curl "http://localhost:3000/api/users?role=agent&department=Vendite" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Trasferisce contatti da un utente a un altro
curl -X POST http://localhost:3000/api/users/FROM_USER_ID/transfer-contacts/TO_USER_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Assegna contatto a utente specifico (durante creazione)
curl -X POST http://localhost:3000/api/contacts \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Cliente Importante",
    "email": "cliente@email.com",
    "owner": "USER_ID_ASSEGNATARIO"
  }'
```

### 5. Importazione CSV con Ownership

```bash
# I contatti importati vengono automaticamente assegnati all'utente che importa
curl -X POST http://localhost:3000/api/contacts/import-csv?phase=import \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "csvFile=@contatti.csv" \
  -F 'mapping={"Nome":"name","Email":"email","Azienda":"properties.company"}'
```

## 📋 Importazione CSV

L'importazione CSV funziona in **2 fasi**:

### Fase 1: Analisi
```bash
curl -X POST http://localhost:3000/api/contacts/import-csv?phase=analyze \
  -F "csvFile=@contatti.csv"
```

**Risposta:**
```json
{
  "success": true,
  "data": {
    "headers": ["Nome", "Email", "Telefono", "Azienda"],
    "sampleRows": [...],
    "availableFields": {
      "existing": ["name", "email", "phone", "lists"],
      "properties": "Formato: properties.nomeProprietà"
    }
  }
}
```

### Fase 2: Importazione
```bash
curl -X POST http://localhost:3000/api/contacts/import-csv?phase=import \
  -F "csvFile=@contatti.csv" \
  -F 'mapping={"Nome":"name","Email":"email","Telefono":"phone","Azienda":"properties.company"}' \
  -F "duplicateStrategy=skip"
```

### Esempio di Mappatura

```json
{
  "Nome Completo": "name",
  "Email": "email", 
  "Telefono": "phone",
  "Liste": "lists",
  "Azienda": "properties.company",
  "Note": "properties.notes",
  "Data Nascita": "properties.birthDate",
  "Colonna Inutile": "ignore"
}
```

### Strategie Duplicati

- `skip`: Salta contatti con email esistente
- `update`: Aggiorna contatti esistenti

## 🗂️ Struttura del Progetto

```
backend/
├── server.js              # Server principale
├── package.json           # Dipendenze e script
├── models/
│   └── contactModel.js     # Schema MongoDB
├── controllers/
│   └── contactController.js # Logica business
├── routes/
│   └── contactRoutes.js    # Routes API
├── uploads/               # File CSV temporanei
└── README.md              # Questa documentazione
```

## 🔧 Modello Dati

### Schema Contact

```javascript
{
  name: String,           // Nome (obbligatorio)
  email: String,          // Email (obbligatorio, unico)
  phone: String,          // Telefono (opzionale)
  lists: [String],        // Array di liste
  properties: {           // Proprietà dinamiche
    company: String,
    notes: String,
    // ... qualsiasi chiave/valore
  },
  createdAt: Date,        // Automatico
  updatedAt: Date         // Automatico
}
```

### Indici Database

- `email`: unico
- `lists`: per ricerche per lista  
- `name`: per ricerche per nome
- `properties.company`: esempio proprietà dinamica

## 🚀 Preparazione Twilio

Il backend è preparato per integrazione futura con Twilio:

```bash
# Aggiungi al .env quando necessario
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token  
TWILIO_PHONE_NUMBER=your_number
```

## 🧪 Test delle API

Usa la documentazione integrata:
```bash
curl http://localhost:3000/api-docs
```

Oppure importa in Postman/Insomnia:
- Base URL: `http://localhost:3000`
- Tutti gli endpoint sotto `/api/contacts`

## 🔍 Health Check

```bash
curl http://localhost:3000/health
```

Mostra stato di:
- Server
- Database MongoDB
- Funzionalità disponibili

## ⚡ Performance

- **Paginazione** automatica (default: 10 contatti/pagina)
- **Indici** su campi principali
- **Validazione** lato server
- **Gestione errori** completa
- **Upload CSV** fino a 5MB

## 🛡️ Sicurezza

- Validazione input
- Sanitizzazione dati
- Gestione errori sicura
- CORS configurabile
- Rate limiting preparato (futuro)

## 📱 Frontend Ready

CORS configurato per:
- `http://localhost:3000`
- `http://localhost:3001` 
- `http://localhost:5173` (Vite)

Modifica `FRONTEND_URL` nel `.env` se necessario.

## 🐛 Troubleshooting

### MongoDB non si connette
```bash
# Verifica che MongoDB sia in esecuzione
mongod

# O controlla la stringa di connessione nel .env
MONGODB_URI=mongodb://localhost:27017/menuchatcrm
```

### Errore upload CSV
- Verifica che la cartella `uploads/` esista
- Controlla dimensione file (max 5MB)
- Assicurati che il file sia in formato CSV

### Port già in uso
```bash
# Cambia porta nel .env
PORT=3001
```

## 📈 Prossimi Sviluppi

- [ ] Autenticazione JWT
- [ ] Integrazione Twilio per dialing
- [ ] Rate limiting
- [ ] Audit log
- [ ] Export CSV
- [ ] API webhooks
- [ ] Dashboard analytics

---

**MenuChatCRM Backend v1.0.0** - Sistema completo per gestione contatti con importazione CSV dinamica! 🎯 