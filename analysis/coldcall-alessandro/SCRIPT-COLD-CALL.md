# Script Cold Call — Lista «Vicini Clienti»

**Per:** Alessandro Totti / team outbound  
**Prodotto:** Menu Chat — recensioni Google vere via menù digitale / QR + WhatsApp  
**Fonte:** analisi corpus answered >30s (N=118) + recovery 4 long trial-path  
**Versione:** 1.1 — 2026-08-11 (post-critique enablement)  

Questo non è uno script da leggere a monologo. È un **albero decisionale con linee pronunciabili**.  
Regola madre: **permesso prima dei numeri; trial solo col DM; mai echo-close; next-step sempre outbound (Ale richiama).**

---

## 0. Pre-call (60–90 secondi, obbligatorio)

Apri Maps del lead. Compila mentalmente / su nota:

| Campo | Esempio | Se manca |
|-------|---------|----------|
| Nome locale esatto | come su Maps | non chiamare a caso |
| N recensioni + media | 669 · 4.1 | — |
| **Cliente ancora** (vicino) | nome + N recensioni + mesi | scegli ancora riconoscibile zona, non “il più vicino matematico” |
| Menù (cartaceo / QR / rotto) | da foto/profilo | chiedi in discovery |
| Segnali no-fit | circolo privato, vendita locale, saturazione nota | skip o priorità bassa |

**Ancora geografica — qualità > prossimità:** preferisci cliente che il lead può conoscere (nome noto zona, ≥ poche centinaia di recensioni, distanza credibile). Se l’ancora è debole, preparati al pivot §3.2.

---

## 1. Mappa della chiamata (cosa stai cercando di ottenere)

```
                    ┌─ BUSY ──────────► recall con fascia + messaggio
                    │
Risposta ──► GATE? ─┼─ NON-DM ────────► pack 4/4 (nome+ora+msg+contatto)
                    │
                    └─ DM / influente ─► permesso → discovery → value → trial pack
                                              │
                                              ├─ soft no → 1 perché → exit o 1 reframe
                                              └─ hard no → exit pulito (no echo)
```

**Esiti validi (uno solo per call):**

1. `cb-trial-accepted` / `cb-trial-offered` + WhatsApp  
2. `cb-dm-interested` + giorno/ora col DM  
3. `cb-gate-msg` / `cb-gatekeeper` (pack 4/4)  
4. `cb-defer-season-qualified` (ferie + interesse + chi + settimana)  
5. `no-hard` / `no-hostile` / `no-fit` / `no-gate-info`  
6. `chase-cap` (stesso DM non trovato ≥3 touch)

Vietato chiudere su «ti richiamo se…» / «prova un paio di volte» / «settembre» senza nome+settimana.

---

## 2. Apertura (primi 15–20 secondi)

### 2.1 Script standard (cold)

> «Buongiorno, [Nome locale]? Sono Alessandro di Menu Chat.  
> Guarda, vi chiamo da Google Maps perché lavoriamo con locali della vostra zona sulle **recensioni Google**.  
> **Due domande al volo, trenta secondi — va bene?**»

**Stop. Ascolta.**

| Risposta | Azione |
|----------|--------|
| Sì / dimmi / ok | → §3 Hook (vicino + cifre) |
| Sto lavorando / siamo pieni / non ora | → §4.1 Busy (zero pitch) |
| Non sono il titolare / passi X | → §4.2 Gatekeeper |
| Chi siete? / Di cosa si tratta? | Una frase: «Aiutiamo i ristoranti ad avere più recensioni vere su Maps. Due domande veloci?» → se sì §3; se no §4.1/4.2 |
| Non mi interessa (subito) | → §6.1 Hard no (non pitchare) |

### 2.2 Vietato in apertura

- Monologo «vicini a X, in Y mesi Z recensioni…» **prima** del permesso  
- «Gratis!» come prima parola  
- Chiedere email / listino  
- Continuare a parlare sopra «sto lavorando»

### 2.3 Follow-up / recall (se già parlato)

> «Ciao [Nome], Alessandro di Menu Chat — ci eravamo sentiti [quando] e ci eravamo detti di risentirci [verso ora / oggi]. Hai due minuti?»

Se non c’è contesto: non inventare; riparti da permesso corto.

---

## 3. Hook «Vicini Clienti» (solo dopo permesso)

### 3.1 Script

> «Perfetto. Vi chiamo perché siete vicini a **[Cliente ancora]**, con cui lavoriamo.  
> Da [periodo] gli abbiamo portato **[N] recensioni nuove**, vere — persone passate nel locale.  
> Voi su Maps siete a circa **[N lead] recensioni**, media **[X]**.  
> State già facendo qualcosa di concreto per le recensioni, o lasciate al naturale?»

### 3.2 Se l’ancora muore («non lo conosco» / «è lontano»)

**Non** ripitchare lo stesso blocco numerico.

> «Ci sta, zona piena di locali. A prescindere dal nome:  
> **voi** sulle recensioni Maps state già facendo qualcosa, o al naturale?»

Se corregge la geografia:

> «Hai ragione sulla zona — mi aggiorno. Restano due domande veloci sulle vostre recensioni?»

### 3.3 Se conosce l’ancora

> «Ottimo. Proprio per quello vi ho cercati. Due domande pratiche e poi ti dico se ha senso una prova.»

---

## 4. Rami non-DM

### 4.1 Busy / in servizio

> «Hai ragione, non ti rubo un secondo.  
> **Quando richiamo il titolare — o te?** Meglio mattina prima delle 11 o dopo le 15?  
> Lascia solo il nome: Alessandro di Menu Chat, recensioni Google come [Cliente ancora].»

Se dicono «prova un paio di volte» / orario vago:

> «Meglio fisso: **domani 10:30** o **giovedì 16?** Così non vi disturbo a caso.»

Chiudi. CRM: `cb-gate-msg` / `cb-gatekeeper` o `cb-dm-logistics`.

### 4.2 Gatekeeper pack (4/4 obbligatori)

1. **Nome** del decisore  
2. **Fascia** (±30 min), non «dopo»  
3. **Messaggio** da lasciare  
4. **Canale migliore** (cell / altro locale / orario fisso)

> «Capito, non sei tu che decidi. Come si chiama chi gestisce queste cose?  
> …  
> Meglio che lo richiami **domani 10:30** o **giovedì 16:00**?  
> Puoi dirgli che ha chiamato Alessandro di Menu Chat, per le recensioni Google — stesso tipo di lavoro che facciamo con [Cliente ancora]?  
> C’è un cellulare o un altro modo per trovarlo più facilmente?»

Se rifiuta info (ostile):

> «Ok, non ti disturbo. Buona giornata.»  
CRM: `no-gate-info`. Max 2 chase totali sul contatto.

**Non proporre trial al gatekeeper.**

---

## 5. Path DM — Discovery → Value → Trial

Obiettivo: capire stack e pain **prima** del meccanismo QR/WhatsApp.

### 5.1 Domande (max 3; una alla volta)

**Q1 (obbligatoria):**  
> «State già facendo qualcosa per le recensioni?»

**Q2 (in base a Q1):**  
- Se nulla: «Quante ne entrano più o meno al mese, a occhio?»  
- Se agenzia/social: «Loro vi seguono anche su Maps/recensioni, o solo contenuti?»  
- Se QR/mail già presenti: «Vi sta portando quante recensioni al mese, grosso modo?»

**Q3 (capacità):**  
> «Più o meno quanti coperti fate a settimana in questo periodo?»

**Nome / ruolo (dopo Q1 o Q2, se ancora anonimi):**  
> «Scusa, stiamo parlando da un minuto e non te l’ho chiesto: **come ti chiami?** … Sei titolare, socio, o gestisci tu queste cose?»

Opzionale se media bassa:  
> «Vedo media [X] — vi interessa più alzare il voto, il volume, o entrambi?»

Se tira fuori TripAdvisor / rating multipli (pattern Tyler):  
> «Ok — noi partiamo da Google Maps, che è dove cerca la gente; il resto di solito sale di conseguenza.»

### 5.2 Value pitch (60–90 secondi, dopo discovery)

Adatta; non scaricare tutto se non serve.

> «In pratica facciamo una cosa sola: **più recensioni vere su Google Maps**.  
> Prendiamo il vostro menù, vi facciamo il menù digitale / QR da mettere a posto a sedere.  
> Quando il cliente scansiona, gli si apre **WhatsApp**: riceve il menù e, al momento giusto, la richiesta di recensione.  
> Su cinque a tavola, di solito una o due lasciano la recensione da soli: noi via WhatsApp la chiediamo a **tutti**, al momento giusto.  
> Non compriamo recensioni — massimizziamo quelle dei clienti che avete già.  
> Nei locali simili vediamo ordine di grandezza **50–100 recensioni vere al mese**, in base alle scansioni.  
> Non facciamo i social: se avete già un’agenzia, di solito **ci affianchiamo**.»

### 5.3 Trial pack (close alto — solo DM / influente)

Usare **dopo** che c’è curiosità o obiezione gestita, non in seconda frase.

> «Quello che vi consiglio è la **prova di due settimane**: montiamo i QR, guardiamo i numeri insieme, senza impegno sul piano annuale.  
> Per creare e spedirvi circa 50 QR c’è solo il costo di setup **25€ + IVA**.  
> Il piano annuale, se dopo la prova ha senso, di solito sta tra **990 e 1290€** in base a risultati/scansioni.  
> Ti mando ora su WhatsApp brochure + esempio QR / bozza menù.  
> Partiamo da **[data]** — ti va?»

**Varianti timing:**

| Situazione | Linea |
|------------|--------|
| Aperti ora | «Te li spedisco questa settimana, partiamo appena arrivano.» |
| Ferie / chiusura | «Te li mando a casa / li teniamo pronti; **start dal [data riapertura]**.» |
| Deve parlare col socio | «Ti mando tutto su WhatsApp oggi; **richiamo io [giorno]** dopo che ne hai parlato con [Nome]. Ti tengo la prova fino ad allora.» |
| «Ti richiamo io» (anti-Gourmoso) | «Perfetto che ne parli — resto io sul pezzo: ti mando WA oggi e **richiamo io [A] o [B]**. Così non resta in sospeso.» |
| Rifiuta WA / «solo chiamata» | → §6.20: settimana + nome, recall voce outbound |

**WhatsApp close (obbligatorio se trial e accettano WA):**  
> «Mi passi il cell su cui ti scrivo adesso? Scrivo “Alessandro Menu Chat” così mi salvi.»

CRM: `cb-trial-offered` o `cb-trial-accepted` + `cb-whatsapp-sent` + `recallAt` / `startDate`.

---

## 6. Playbook obiezioni

### Regole d’oro

1. **Ack → Distingui → Una mossa → Avanza o esci.**  
2. Mai ripetere la value prop rifiutata (echo-close).  
3. Una sola ripresa dopo un no; al secondo no → exit.  
4. Se il lead è ostile o no-fit → rispetto, chiusura corta.

---

### 6.1 «Non mi interessa» / «Non ci interessa»

**Vietato:** «Quindi non ti interesserebbe aumentare le recensioni?»

> «Ok, chiaro. Solo per non richiamarti a caso: è perché **avete già qualcosa**, perché **non è priorità ora**, o altro?»

| Motivo | Mossa |
|--------|--------|
| Già qualcosa | → 6.3 (una frase). Se coperti su Maps → exit. |
| Non priorità / ferie | → 6.7 con qualifica. |
| No generico / ostile | «Perfetto, non ti disturbo. Buona giornata.» → `no-hard` |
| No-fit (circolo, vendita, ecc.) | → 6.11 |

---

### 6.2 «Sto lavorando» / «Siamo in servizio» / «Siamo pieni di sala»

→ §4.1. **Zero** pitch Maps.

---

### 6.3 «Abbiamo già agenzia / social / web / Italia Online»

> «Ottimo — di solito lavoriamo proprio con chi ha già i social a posto.  
> **Noi non facciamo post: solo recensioni vere su Maps, 50–100/mese.**  
> Vi fa senso affiancarlo, o siete già coperti anche sulle recensioni?»

- Se «anche recensioni ok» → «Perfetto, allora non vi serve. Buona giornata.» `no-hard`  
- Se «solo social» → discovery breve → trial pack  
- Se «non voglio cambiare / dare fastidio a X» → §6.19  

---

### 6.4 «Abbiamo già QR / tessere Google / mail-SMS recensioni»

> «Bene — quante recensioni al mese vi sta portando, più o meno?»

- Se numeri solidi e soddisfatti → exit pulito.  
- Se «pochi / non funziona» →  
  > «Il pezzo diverso è WhatsApp al momento giusto + copertura di tutti i posti a sedere. Ha senso una prova di due settimane sui numeri?»

Non forzare su stack maturo e soddisfatto (pattern Marcolino).

---

### 6.5 «Comprate le recensioni?» / «Sono false?»

> «No. Google ti chiude l’account se compri.  
> Noi massimizziamo le recensioni dei clienti **che entrano già** nel locale — vere, tracciabili dal passaggio.»

Poi una frase meccanismo QR→WhatsApp. Non fare sermon.

---

### 6.6 «Siamo pieni / non ci servono clienti / pane esaurito»

**Non** rispondere «vi porto il triplo della visibilità» se il pain è assente.

> «Capito — allora non vi servo per portare più gente.  
> L’unico caso in cui ha senso è se vi interessa **rafforzare la reputazione Maps** sullo stesso flusso. Vi interessa quello, o chiudiamo qui?»

- Se no → exit. `no-hard` / no-pain  
- Se sì reputazione → pitch corto + trial  

---

### 6.7 «Siamo piccoli / non vogliamo più coperti / qualità»

(Gold: Falabràch)

> «Perfetto, allora non è portarvi file fuori dalla porta.  
> L’obiettivo è **massimizzare le recensioni e il fatturato sul giro che fate già**, restando gestibili.  
> Per locali da 30–40 coperti ha senso proprio la prova di due settimane, così vedete i numeri senza stravolgere il servizio.»

---

### 6.8 «Quanto costa?»

> «Ordine di grandezza: piano annuale tipicamente **990–1290€**, se dopo la prova ha senso.  
> Prima però facciamo la prova due settimane: setup QR **25€ + IVA**, senza impegno annuale.  
> Ti torno utile in due domande veloci, o preferisci chiudere qui sul prezzo?»

- Se accetta le due domande → discovery breve → trial pack.  
- Se vuole solo il numero e chiude → exit. `no-hard` — non monologo (anti Mister Pachino).

---

### 6.9 «Mandami una mail / un listino»

> «Lavoriamo meglio a voce + WhatsApp, così ti mando brochure e un QR di esempio e ci sentiamo 10 minuti.  
> Prima due domande veloci — non lavoriamo con tutti. Ok?»

Se insiste mail senza call: prendi mail ma **fissa comunque** giorno/ora recall outbound. Soft mail-only = debole.

---

### 6.10 «Preferisco di persona»

> «Noi siamo a Firenze, quindi in zona non passo questa settimana.  
> Possiamo far partire la prova a distanza: ti spedisco i QR, montiamo il menù, e restiamo su WhatsApp per qualsiasi cosa. Ti va?»

---

### 6.11 «Ferie / chiusi / settembre»

> «Ok. **Che settimana** ripartite e **chi** deve esserci in linea?  
> Prima di chiudere: sulle recensioni siete scoperti o già a posto?  
> Se ha senso, vi preparo i materiali su WhatsApp ora e partiamo a [settimana].»

- Con interesse → `cb-defer-season-qualified` + WhatsApp  
- Senza interesse → `cb-defer-season` (non gonfiare come win)

---

### 6.12 «Devo parlarne col socio / titolare»

> «Giusto. Ti mando oggi su WhatsApp brochure + esempio, così glielo inoltri.  
> **Richiamo io [giorno/fascia]** — chiedo di te e di [Nome socio]?  
> Ti tengo aperta la prova fino ad allora.»

Mai accettare «ti richiamo io se…» senza fissare A/B outbound (→ 6.18).

---

### 6.13 «TheFork / abbiamo già prenotazioni online»

> «TheFork è un canale a parte, spesso costoso.  
> Noi lavoriamo sulla **visibilità organica Maps**, che resta il primo posto dove la gente cerca dove mangiare.  
> Di solito è complementare, non sostitutivo. Ha senso una prova due settimane in parallelo?»

---

### 6.14 «Non lo conosco [cliente vicino]»

→ §3.2. Mai ripitch numeri.

---

### 6.15 Geography fail / «mi chiamate tutti» / ostilità

> «Hai ragione, ti lascio lavorare. Buona giornata.»  
`no-hostile`. Non “porca…” in chiusura. Non richiamare entro 30 giorni.

---

### 6.16 ICP no-fit (circolo, vincoli, locale in vendita)

> «Allora forse non è il momento giusto / non siamo il tool giusto. Non ti disturbo. Buona giornata.»  
`no-fit`. Non “se parliamo da 6 minuti ti interessa”.

---

### 6.17 «Chiama Google?» / confusione brand

> «No — Menu Chat. Siamo un’azienda che aiuta i ristoranti sulle recensioni Maps, non Google.»

---

### 6.18 «Ti richiamo io» / «prova un paio di volte» (FM8)

> «Meglio se resto io sul pezzo: mi segno **[giorno/fascia]** e chiedo di [DM].  
> “Prova un paio di volte” non funziona mai — **mattina prima delle 11 o dopo le 15?**»

CRM: `cb-dm-interested` / `cb-gate-msg` con `recallAt` esigibile — mai controllo al lead.

---

### 6.19 Fedeltà fornitore / «non voglio cambiare» / «non dare fastidio a X»

> «Non ti chiedo di sostituire nessuno.  
> Noi ci affianchiamo: loro social/web, noi solo recensioni Maps.  
> Se sulle recensioni siete già a posto e contenti, chiudiamo qui. Altrimenti ha senso una prova due settimane in parallelo?»

- Soddisfatti sullo stack recensioni → exit. `no-hard`  
- Solo fedeltà generica senza copertura Maps → trial pack corto  

---

### 6.20 «Solo chiamata» / rifiuta WhatsApp e mail (Pretorio)

> «Ok, restiamo in voce.  
> **Che settimana** e **chi** deve esserci? Mi segno [giorno/fascia] e richiamo io — senza mail.»

Se ferie + solo voce: `cb-defer-season-qualified` solo con nome + settimana; altrimenti `cb-defer-season`.

---

### 6.21 «Momentaneamente non ci interessa»

Come 6.1 — **una** domanda sul perché, zero pitch lungo. Se resta no → exit. `no-hard`.

---

## 7. Close — taxonomy (dal più debole al più forte)

| Livello | Cosa ottieni | Linea tipo |
|---------|--------------|------------|
| 1–2 Soft | vietato accettare | — |
| 4 Gate | nome+ora+msg | §4.2 |
| 5 DM logistics | «Domani 11, chiedo di Marco» | choice close |
| 7 Discovery | risposte stack | annota |
| 8 Interesse + recall DM | «Lunedì pranzo con Tiziano» | Spritzzeria |
| 9–10 Trial | WhatsApp + 25€ + start date | §5.3 |

**Choice close default:**  
> «Meglio **[opzione A]** o **[opzione B]**?»

---

## 8. Script recall 2° touch

> «Ciao, Alessandro di Menu Chat — avevo lasciato messaggio con [Gate] / ci eravamo detti [fascia].  
> C’è [DM]? …  
> Confermi che [DM] è ancora chi decide su queste cose, o è cambiato qualcuno?  
> Ti richiamo due minuti sulle recensioni Maps, come [Cliente ancora] — ora va bene?»

Se nome sbagliato / gestore cambiato (FM9): aggiorna CRM, riparti da permesso corto col nuovo DM — non insistire sul nome morto.

Se DM non c’è al 3° tentativo → `chase-cap`, ferma chase o passa a altro canale solo se hai cell.

---

## 9. Checklist post-call (30 secondi)

- [ ] Label CRM corretto (non `callback` generico): `cb-gatekeeper` / `cb-gate-msg` / `cb-dm-*` / `cb-trial-*` / `cb-whatsapp-sent` / `no-*` / `chase-cap`  
- [ ] `dmName` verificato + `recallAt` / `startDate` (outbound Ale, non «mi richiama lui»)  
- [ ] `hookRecognized` yes/no/unknown  
- [ ] WhatsApp inviato? (brochure / QR esempio) — o ramo solo-voce documentato  
- [ ] Failure mode se fallita (FM1–FM12)  
- [ ] Self-score binario: permesso <25s? echo? gate 4/4? close ≥4?

---

## 10. Frasi vietate (anti-pattern corpus)

| Vietato | Perché (evidenza) |
|---------|-------------------|
| Echo «quindi non ti interesserebbe…?» | Gusto 19 / Alfonso / Sferico — secondo no |
| Pitch completo su «sto lavorando» | L’Ancora / Belvedere — ostilità |
| Ripitch numeri dopo «non lo conosco» | Belvedere / Sementi — credibilità |
| «Gratis» nudo in apertura | irritazione; preferisci prova + 25€ setup |
| «Se parliamo da N minuti ti interessa» | Concordia — pressa su no-fit |
| Trial al gatekeeper | spreco; non decide |
| Soft close senza giorno/nome | callback vuoto |
| Accettare «ti richiamo io se…» | Gourmoso — controllo perso (FM8) |
| Accettare «prova un paio di volte» | New Bahia — chase infinito |
| Rifiutare del tutto il filtro prezzo | Mister Pachino — loop no |

---

## 11. Scheda tascabile (da stampare)

```
1. Permesso 20s → 2. Vicino+cifre → 3. «State già facendo…?» (+ nome)
4. Pitch QR/WA + tavolata 60s → 5. Trial 2 sett + 25€ + WA (Ale richiama)
BUSY → solo fascia+msg | GATE → 4/4 | NO → 1 perché → exit
ANCORA MORTA → pivot discovery lead | PIENI → reputazione o exit
«TI RICHIAMO IO» → choice A/B outbound | PREZZO → 990–1290 + trial
MAI echo-close | MAI trial al gate | LABEL CRM vero
```

---

## 12. Gold tape / worst tape (studio)

**Ascoltare e imitare (struttura, non a pappagallo):**  
- Tyler Ponte Milvio — Paolo — trial post-ferie (score 5)  
- Falabràch — Marco — reframe locali piccoli  
- Spritzzeria Roma — Nicoletta/Tiziano — reframe social + recall DM  
- Conte Brillo — Vincenzo — obiezioni autenticità/TheFork  
- Verace — Sonny — prezzo + di persona  

**Ascoltare e non ripetere:**  
- Concordia 420s · Belvedere · L’Ancora · Omar · Gusto 19 · Pizza Pazza  

---

*Fine script v1.1 — allineato a `REPORT-FINALE.md`, `05-new-long-transcripts.md`, critique `06-script-critique.md`.*
