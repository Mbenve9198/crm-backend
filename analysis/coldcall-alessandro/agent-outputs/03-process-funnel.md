# Processo reale e funnel — Alessandro Totti (Cold Call - Vicini Clienti)

**Corpus:** 118 answered >30s, 113 transcript. **Campione analizzato:** bundle short (20) + mid (25) + long (25), ~55 call uniche dopo dedup overlap (~5 ID condivisi tra mid/long). Outcome CRM: 112 `callback` — inutile come funnel stage senza rilabel testuale.

---

## 1. Executive take

Ale non vende in prima chiamata: **esegue un motore di accesso al decisore** mascherato da pitch recensioni. Lo script dominante è sempre lo stesso — Maps → cliente vicino → numero recensioni → permesso — ma il **70%+ delle call corte (<60s) muore al gatekeeper** con outcome operativo “nome titolare + orario richiamo”, etichettato CRM come `callback` identico a una call da 6 minuti con trial proposto.

Il funnel reale ha **due binari paralleli**:
- **Binario A (dominante):** cold → gatekeeper → estrazione DM → richiamo schedulato.
- **Binario B (raro, call >120s):** cold → DM in linea → discovery recensioni → reframe “non siamo social” → prova 2 settimane → richiamo con socio/titolare.

Il collo di bottiglia #1 non è l’interesse al prodotto ma **chi risponde al telefono** (staff, cucina, coniuge non-DM). Il #2 è **stagionalità/ferie** che sposta tutto a settembre–ottobre senza qualificare interesse reale.

L’outcome CRM `callback` oggi misura quasi solo **“Ale ha ottenuto un motivo per richiamare”**, non la qualità del lead. Senza rilabel testuale il funnel appare piatto al 95% conversione finale.

---

## 2. Talk track de-facto (step 1..N con varianti A/B osservate)

### Step 1 — Apertura / identificazione interlocutore

**Script standard (cold, ~80% prime call):**
> «Buongiorno, sono Alessandro [di Menu Chat / Menu Chat]. Guarda, vi chiamavo perché ho visto [il vostro ristorante/pizzeria] qui su Google Maps…»

**Variante B — Follow-up/recall:** riparte da appuntamento concordato, spesso senza ripetere l’hook Maps.
- «Ci siamo sentiti oggi a mezzogiorno, dovevamo risentirci verso le 3» — `6a6b56b0` / Gaia A Mare
- «Sono Alessandro di Menu Chat di ieri sera» — `6a745112` / Ristorante tito

**Variante C — Cerca decisore per nome:** salta il pitch, va dritto al gatekeeper.
- «Devo sentirmi col titolare… ieri ho parlato con un ragazzo, mi ha detto di richiamare» — `6a74501f` / I Molisani (51s)

**Evidenza:** `6a732da6` Mestolo — «Piacere, sono Alessandro. Guarda, io vi chiamavo perché ho visto ora il vostro ristorante qui su Google Maps»

---

### Step 2 — Hook geografico “Vicini Clienti”

**Script fisso:**
> «Vedo che siete [molto/abbastanza] vicini a [Nome Cliente], con cui stiamo lavorando. Non so se lo conosci, [Nome].»

- Se il lead dice **no**: normalizza («di tutti i ristoranti che ci sono a Roma…») e **passa subito al numero** — `6a6c6fa8` Sementi la Pizza
- Se il lead **corregge la geografia**: Ale ammette distanza/incertezza e continua comunque — `6a7201d5` Il Vicolo; oppure la call degenera — `6a71f8e1` Bel Vedere

**Evidenza:** `6a720a12` I Molisani — «vicini a Osteria al Riposto… 606 recensioni nuove»

---

### Step 3 — Prova sociale numerica

**Script fisso (cifre variabili, mai le stesse due call):**
> «Lavoriamo con loro da [X mesi] e gli abbiamo portato [N] recensioni nuove, ovviamente vere / di persone che sono passate nel locale.»

Range osservato nel campione: 105–3221 recensioni; durata cliente 2 mesi–2 anni. La cifra è **sempre specifica**, mai arrotondata generica.

**Evidenza:** `6a75b0c8` Raices — «2077 nuove recensioni… due anni»; `6a72ffc3` Spritzzeria — «588 recensioni in 6 mesi»

---

### Step 4 — Permesso / interest check (bivio critico)

**Variante A — Domanda diretta:**
> «È qualcosa che ti può interessare, migliorare [recensioni/Maps]?»

**Variante B — Permesso discovery (più efficace nelle call lunghe):**
> «Ti faccio due domande al volo per capire se possiamo aiutarvi» / «nel pratico»

**Variante C — Dato Maps del lead come pivot:**
> «Vedo che avete [N] recensioni / media [X] / profilo nuovo… state già facendo qualcosa per curare le recensioni?»

Quando **manca** il passaggio permesso/discovery, la call tende a chiudersi <60s — `6a73469b` Gusto 19 («Che cosa fai?» → «Non mi interessa» → fine).

**Evidenza:** `6a6b63b9` Puro Caso — «Potrei farti due domande sull'argomento?»; `6a72ffc3` Spritzzeria — «due domande al volo»

---

### Step 5 — Gestione gatekeeper (script di default se non-DM)

Ale **non insiste sul pitch** con staff; pivot immediato:
1. «Parlo col titolare?»
2. «Quando lo trovo?»
3. «Come si chiama?»
4. «A che ora richiamo?»

**Evidenza:** `6a732da6` — lead «non sono il titolare» → Ale «quando lo posso trovare?» → «Ciro, verso le 6:30»; `6a75d848` Vini e Vecchi Sapori — «Mazzanti Mario, torna il 27»

---

### Step 6 — Discovery (solo se DM o gatekeeper collaborativo + tempo)

Sequenza tipica:
1. «Cosa fate oggi su Google per le recensioni?»
2. Età locale / profilo Maps nuovo?
3. Coperti settimanali (periodo estivo)
4. Eventuale: «Avete menù digitale / QR?»

**Frame qualifica:** «Non lavoriamo con tutti / abbiamo criteri» — usato per resistere a richieste listino via mail — `6a6b63b9` Puro Caso

**Evidenza:** `6a6b63b9` — «Su Google nulla, chiediamo ai clienti più fidati»; `6a75b0c8` — «clienti stranieri lasciano recensioni… lavoriamo con agenzia marketing»

---

### Step 7 — Spiegazione prodotto (quando arriva)

**Meccanismo pitchato:**
- Menù digitale / QR code come **strumento di raccolta recensioni** (non come fine del menù)
- Reminder ai clienti post-visita → recensioni vere su Maps
- Output: **50–100 recensioni/mese** (talvolta 30–50 o fino a 150)
- **Non** social, post, stories — solo recensioni
- Obiettivo finale: visibilità Maps → più clienti → fatturato

**Evidenza:** `6a6c68c2` Polisportiva — «menù digitale… scopo… raccolta recensioni»; `6a7201d5` Il Vicolo — «50 alle 100 recensioni vere in più al mese»

---

### Step 8 — Reframe obiezioni ricorrenti

| Obiezione | Risposta de-facto di Ale |
|-----------|--------------------------|
| «Abbiamo già agenzia/social» | «Perfetto, noi non facciamo post, solo recensioni vere» — `6a72ffc3` |
| «Quanto costa?» | «Prima capisco se possiamo aiutarvi, servizi personalizzati» — `6a71b324` Mister Pachino |
| «Mandate listino/mail» | «Lavoriamo solo tramite chiamata» / «prima due domande» — `6a72f9c2` Pretorio, `6a6b63b9` |
| «Gratis mi fa caponare la pelle» | Riformula in «prova del servizio per vedere risultati» — `6a6b5f84` La Piccola Canadese |
| Ferie / chiusura | Accetta slittamento: «ci sentiamo a settembre/ottobre» — `6a6cb200` Mava', `6a749fc5` Tempio del Panino |
| Vendita attività | Ripositiona recensioni come leva per trattativa — `6a730f11` Su Nuraghe |

---

### Step 9 — Close / next step (quasi mai trial in prima call)

**Close dominante (~60% campione):** richiamo con **nome + fascia oraria** (gatekeeper path).

**Close secondario (~15%):** richiamo con **DM in linea** o transfer — `6a7201d5` «parliamo con Antonio tra mezz'ora»; `6a749836` transfer Sofitel → Pablo marketing.

**Close avanzato (~5–8%):** **prova gratuita 2 settimane** + richiamo con altro socio/DM — `6a72ffc3` «prova gratuita di due settimane… richiamo lunedì con Tiziano»; `6a6a214e` Corner 52 offre trial ma finisce su recall 23 agosto con Ivan.

**Hard exit (~10%):** rifiuto secco o chiusura ostile — `6a73469b` Gusto 19; `6a71f8e1` Bel Vedere.

---

## 3. Funnel stages proposti (nome + definizione operativa testuale)

| # | Stage | Definizione operativa (segnali nel transcript) |
|---|-------|------------------------------------------------|
| S0 | **Connect** | Chiamata answered, durata >30s, almeno uno scambio lead↔sales |
| S1 | **Hook erogato** | Maps + nome cliente vicino + numero recensioni enunciato |
| S2 | **Engagement** | Lead non chiude nei primi 45s; pone domanda («che cosa fate?») o concede ascolto oltre sì/no |
| S3 | **Permesso** | Ale chiede esplicitamente interesse o «due domande al volo» e ottiene assenso (anche debole) |
| S4 | **DM path** | DM in linea **oppure** nome decisore + finestra richiamo concordata |
| S5 | **Discovery** | ≥1 domanda su pratica recensioni attuale, coperti, profilo Maps, stack esistente |
| S6 | **Offerta esplicita** | Meccanismo prodotto (QR/menù digitale) **o** prova 2 settimane **o** range 50–100 rec/mese verbalizzato al DM |
| S7 | **Impegno qualificato** | DM esprime interesse esplorativo+ e fissa next step con lui/lei (non solo gatekeeper generico) **oppure** accetta trial |
| S8 | **Trial / setup** | Accordo verbale prova gratuita con condizioni temporali — **quasi assente nel campione** |

**Nota:** S4 con solo gatekeeper (nome+ora) è l’“outcome mediano” del corpus, non S7.

---

## 4. Stima conversione stage→stage sul campione

Stime su **N≈55 call uniche** lette (short+mid+long deduplicati). Non proiezione sul corpus intero.

| Da → A | N stimato passaggio | % grezza sullo stage precedente |
|--------|---------------------|----------------------------------|
| S0 → S1 Hook erogato | ~51/55 | **~93%** |
| S1 → S2 Engagement | ~42/51 | **~82%** |
| S2 → S3 Permesso | ~28/42 | **~67%** |
| S3 → S4 DM path | ~38/55* | **~69%** del totale; molti saltano S3 e vanno diretti a gatekeeper pivot |
| S4 → S5 Discovery | ~14/38 | **~37%** |
| S5 → S6 Offerta esplicita | ~10/14 | **~71%** |
| S6 → S7 Impegno qualificato | ~4/10 | **~40%** |
| S7 → S8 Trial/setup | ~1/4 | **~25%** |

\*S4 è alto perché il gatekeeper pivot è **parallelo** a S2–S3, non sequenziale stretto: molte call corte raggiungono S4 senza S3.

**Conversione end-to-end stimata sul campione:** S0 → S7 ≈ **7–8%** (4 call su ~55: es. Spritzzeria, Mava' soft, Puro Caso parziale, Corner 52 parziale).

**Confronto CRM:** outcome `callback` sul corpus = **95%** (112/118) → sovrastima ~12× rispetto a S7.

---

## 5. Dove si inceppa di più (1–2 colli di bottiglia con evidenza)

### Collo #1 — Gatekeeper / non-decisore (dominante)

**Meccanismo:** nelle call 30–60s Ale eroga hook+numero, il lead interrompe con «non sono il titolare / devi parlare con X / sono in sala». Ale esegue lo script nome+orario e chiude. CRM = `callback`.

**Evidenza:**
- `6a732da6` (59s) — «non sono il titolare, non mi interessa» → ottiene Ciro 18:30
- `6a6b75e1` (58s) — titolare in ferie, gatekeeper rifiuta nome
- `6a7301ee` (50s) — «non sono io che me ne occupo, richiami a settembre, Francesco»
- `6a69d412` (129s) — Alina: «devi parlare col titolare Luca, richiama all'una»

**Impatto stimato:** ~65–75% del campione short+mid non supera S4 con DM in linea.

---

### Collo #2 — Timing operativo / stagionalità (secondario ma sistemico)

**Meccanismo:** ferie, chiusura agosto, caos estivo → Ale accetta deferral ampio (settembre/ottobre) senza ancorare interesse al prodotto. Outcome CRM identico a recall caldo con trial.

**Evidenza:**
- `6a6cb200` Mava' — «per due mesi siamo fermi» → ottobre
- `6a749fc5` Tempio del Panino — chiusi agosto, figlio socio gestisce online
- `6a6b5f84` La Piccola Canadese — «caos totale… settembre, parla con Gabriele 349…»
- `6a72f9c2` Pretorio — proprietario in ferie → «richiamo a settembre»

**Impatto stimato:** ~20–30% delle call che superano S2 finiscono in deferral stagionale senza S5–S6.

---

## 6. Cosa sembra il prodotto/offerta dal modo in cui lo pitcha (ricostruzione value prop dal corpus)

**Chi:** Menu Chat / Menu Chat (stesso brand; nel corpus compaiono anche varianti fonetiche tipo «Menu Chat», «Menu Chat»).

**Cosa vende (come lo dice Ale):**
- Servizio per **aumentare recensioni vere su Google Maps** dei ristoranti
- Meccanismo: **menù digitale con QR code** usato come touchpoint post-visita per sollecitare recensioni (non come sostituto del menù cartaceo)
- Promessa quantitativa: **50–100 recensioni vere/mese** (range esteso 30–150 a seconda del lead)
- Prova sociale: clienti **geograficamente vicini** con numeri specifici di recensioni generate
- **Prova gratuita 14 giorni** → poi valutazione **piano annuale** (prezzo mai detto in cold; qualificazione prima)
- Posizionamento: **complementare** ad agenzie social/web esistenti; «noi non facciamo post»
- Canale: **solo telefono**, rifiuto mail/listino come primo step
- Qualificazione: criteri selettivi, domande su coperti, pratica attuale recensioni, età profilo Maps
- Outcome business promesso: più recensioni → più visibilità Maps → più clienti → più fatturato (talvolta: aiuta vendita attività in trattativa)

**Cosa NON è (dal corpus):** non è Google ufficiale (`6a7201d5` «chiama per conto di Google Maps?» → «No, Menu Chat»); non è gestione social; non è pubblicità generica.

---

## 7. Next-step taxonomy (tipi di "callback"/impegni osservati, dal più debole al più forte)

| Livello | Tipo | Descrizione operativa | Esempi callId |
|---------|------|----------------------|---------------|
| 1 | **Chiusura senza ancoraggio** | Fine call senza data/ora/nome; «ci sentiamo» generico | `6a71b324` (lascia numero, no recall) |
| 2 | **Deferral vago** | «Richiami settembre/ottobre» senza interesse esplicito | `6a71f8e1` Bel Vedere (ostile, no data); parte di `6a730f11` |
| 3 | **Deferral stagionale nominale** | Data stagione + referente identificato | `6a6b5f84` Gabriele settembre; `6a6cb200` ottobre Angelo |
| 4 | **Recall gatekeeper** | Nome DM + fascia oraria, pitch non completato con DM | `6a732da6` Ciro 18:30; `6a69d412` Luca 13:00 |
| 5 | **Recall DM concordato (logistica)** | Richiamo con DM previsto in linea, contesto pitch parziale | `6a7201d5` Antonio 30 min; `6a74501f` Ezio 17:30 |
| 6 | **Transfer / routing interno** | Istruzioni per raggiungere reparto/DM | `6a749836` Sofitel → Pablo marketing |
| 7 | **Discovery + interesse debole** | DM risponde a domande, nessun trial, no data forte | `6a6b63b9` Puro Caso (coperti, poi call finisce) |
| 8 | **Interesse esplicito + recall DM** | DM dice sì/curiosità + appuntamento con decisore | `6a72ffc3` lunedì con Tiziano; `6a75b0c8` dopo le 15:00 Santiago |
| 9 | **Trial proposto** | Prova 2 settimane verbalizzata, accettazione o passaggio a DM | `6a72ffc3` Spritzzeria; `6a6a214e` Corner 52 (poi defer) |
| 10 | **Trial/impegno operativo** | Accordo su avvio prova o setup — rarissimo nel campione | Nessun caso netto nel campione letto |

**Distribuzione osservata nel campione:** livelli 4–5 ≈ 50–60%; livello 3 ≈ 20%; livelli 8–9 ≈ 8–12%; livello 1 ≈ 10%.

---

## 8. Implicazioni per misurazione (come rilabelare outcome CRM utili)

L’outcome unico `callback` va **sostituito o affiancato** da tag testuali post-call (o NLP su transcript). Proposta minima:

| Label CRM proposta | Trigger testuale |
|--------------------|------------------|
| `cb-gatekeeper` | Nome DM + orario; interlocutore non-DM |
| `cb-defer-season` | Richiamo post-ferie/chiusura senza discovery DM |
| `cb-dm-logistics` | DM non disponibile ora, recall breve concordato |
| `cb-dm-discovery` | Discovery completata, interesse esplorativo |
| `cb-dm-interested` | DM esprime curiosità/«potrebbe interessarmi» |
| `cb-trial-offered` | Prova 2 settimane proposta |
| `cb-trial-accepted` | Accordo verbale prova |
| `cb-referral` | Transfer a altro reparto/contatto |
| `no-hard` | Rifiuto esplicito ripetuto |
| `no-hostile` | Chiusura aggressiva |
| `lost-timing` | «Non ora» senza recall ancorato |

**KPI funnel consigliati (da transcript, non da outcome attuale):**
1. % S1 hook erogato
2. % S4 DM path (gatekeeper vs DM in linea — sotto-tag)
3. % S5 discovery
4. % S6 offerta esplicita
5. % S7 impegno qualificato
6. Mediana touch per S7 (nel campione: 2+ call frequenti — `6a7455aa`/`6a745112`/`6a6b56b0`)

**Segmentazione lista:** la lista «Vicini Clienti» funziona come **apertura** (engagement S2 alto) ma non predice S7; la variabile predittiva nel campione è **DM in linea + tempo >120s**.

---

## 9. Limiti

- **Campione bilanciato per durata, non random:** sovrarappresenta call lunghe rispetto alla distribuzione reale (mediana corpus 92s).
- **Transcript troncati** su diverse call top-duration (`6a6b6740` La Differenza 733s, `6a6b56b0` Gaia A Mare 611s) — talk track step 7–9 su quelle call inferito parzialmente.
- **Stime % non validate** su tutti i 113 transcript; basate su ~55 call lette integralmente o in gran parte.
- **Outcome CRM e contactStatus** (es. `lost before free trial`, `qr code inviato`) non allineati al transcript della singola call analizzata — non usati per il funnel.
- **Nessuna visibilità** su esiti dei richiami: il corpus cattura il processo di Ale, non la conversione post-callback.
- **Bias stagionale:** bulk call luglio–agosto 2026 → deferral ferie sovrarappresentati.

---

STATUS: COMPLETE  
ApproximateTranscriptsReviewed: 55
