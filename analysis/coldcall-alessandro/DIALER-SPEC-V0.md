# Power Dialer Cold Call — Spec v0

## Obiettivo
Pagina CRM dedicata per chiamare in serie i lead della lista **Cold Call - Vicini Clienti**, con scheda visibilità e script già riempito sotto gli occhi.

## Schermata (`/dialer`)

Tre colonne:
1. **Coda** — lista contatti da chiamare, next/skip
2. **Contatto attivo** — nome + scheda Maps (keyword, rank, competitor, cliente vicino, hook)
3. **Script live** — apertura, hook, busy, gate, trial, obiezioni

In basso/flottante: Chiama (Twilio click-to-call già esistente) + esito.

## Flusso utente
1. Apre Dialer → lista default «Cold Call - Vicini Clienti»
2. Coda = `da contattare` con telefono (agent: solo i suoi)
3. Auto-seleziona il primo
4. Vede scheda + script filled
5. Chiama → esito → passa al prossimo (o Skip)

## API

### `GET /api/dialer/queue`
Auth: `agent | manager | admin`. Query: `list`, `status` (default `da contattare`), `limit` (50), `offset`, `owner`.  
Risposta snella: identity + `cardSummary` + `hasVisibilityCard` / `scriptReady` (no full `properties`).

### `GET /api/dialer/contacts/:id/script`
Script strutturato (template + slot), non monologo AI on-demand.  
Fonte: `properties.visibilityCard` + fallback `cliente_vicino` / `dist_m`.

### `PUT /api/dialer/contacts/:id/visibility-card`
Persistenza: `contact.properties.visibilityCard` + `visibilityCardGeneratedAt` (richiede `canModifyContact`).

## Fuori scope v0
- Generazione batch schede in questa PR (resta job/script)
- Nuovi outcome CRM `cb-trial-*` (usiamo outcome esistenti + note)
- Softphone in-browser
