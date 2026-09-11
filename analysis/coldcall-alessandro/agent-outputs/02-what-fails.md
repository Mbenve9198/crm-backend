# Cosa non funziona — Failure modes Cold Call Alessandro

**Campione:** 113 transcript (lista "Cold Call - Vicini Clienti", durata >30s). Outcome CRM **non** usato come prova di successo (`callback` ≈112/118). Inferenza solo da testo.

**Priorità lettura:** short 30–60s (n=20) → mid 60–150s (n=25) → long top25 dove durata ≠ trazione.

---

## 1. Executive take

- Lo **stratum short (30–60s)** è quasi interamente fallimento di connessione/permesso: gatekeeper, titolare assente, “siamo in servizio”, refusal duro — non “call incomplete di successo”.
- Il **script Maps→vicino→N recensioni** viene scaricato in monologo prima del permesso; quando il lead chiede “che cosa fai?” o “di cosa si tratta?”, il pitch arriva troppo tardi o troppo lungo e la call muore.
- Il hook **“vicini clienti” fallisce spesso** (“non lo conosco”, geografia sbagliata) e Ale **non ricalibra**: ripete lo stesso blocco numerico → irritazione o disimpegno.
- Contro **“non mi interessa”**, la risposta standard è un’eco retorica (“quindi non ti interesserebbe aumentare le recensioni?”) che **non sblocca** e accelera la chiusura.
- I **callback soft** (orario vago, “ti richiamo se…”, chase ripetuto dello stesso titolare) gonfiano durata e CRM senza next step esigibile.
- **Durata lunga ≠ progresso**: call 2–7 minuti finiscono in hard no, targeting sbagliato (circolo privato), saturazione (“pane esaurito”), o stack già presente (QR/mail/agenzia).
- Il labeling CRM **`callback` su refusal espliciti** rende il funnell cieco: Gusto 19, Alfonso, L’Ancora, Omar, Concordia sono tutti `callback`.
- Timing lista **luglio–agosto + ferie** genera stall strutturali (settembre/ottobre) mascherati da “follow-up pianificato”.

---

## 2. Failure modes catalog

### FM1 — Muro gatekeeper / non-DM (a: connessione/permesso)

**Definizione:** Chi risponde non decide; blocca pitch, rinvia al titolare, a volte rifiuta nome/info. La call diventa intelligence debole o chiusura.

**Frequenza:** **Alto** — dominante nello short (≈12–14/20); ricorrente nel mid (I Molisani, Zio Cesare, Scarlett, Concordia gate, Pizza Regina, New Bahia mid, Osteria Galleria, Pretorio mid). Stima corpus: **~35–45/113** con almeno un blocco non-DM chiaro.

**Esempi:**
| callId | Contatto | Citazione |
|--------|----------|-----------|
| `6a6b75e1cc281ca904ecd8d7` | Pizza Pazza (58s) | «Guardi, non sono tenuta a dirle tutte ste cose, la ringrazio.» |
| `6a75d84877f0ed625a0f9115` | Vini e Vecchi Sapori (54s) | «Ah, ma per queste cose devi parlare con il titolare.» |
| `6a732da677f0ed625a0f31f4` | Mestolo (59s) | «No, guardi, io non sono il titolare, non mi interessa… la devo lasciare.» |

**Categoria:** (a) connessione/permesso.

---

### FM2 — Interruzione servizio / “sto lavorando” (a)

**Definizione:** Lead in sala/cucina taglia entro ~40–60s; a volte concede orario, a volte chiude ostile. Il pitch Maps+vicino consuma la finestra di ascolto.

**Frequenza:** **Alto** nello short; **medio** nel corpus (~9–15/113 con busy esplicito; molti gatekeeper sovrapposti).

**Esempi:**
| callId | Contatto | Citazione |
|--------|----------|-----------|
| `6a75d4cd77f0ed625a0f8f22` | L’Ancora (41s) | «Signori, io sto lavorando, non c’ho tempo da ascoltare le sue storie.» |
| `6a75b31777f0ed625a0f8b40` | Loco’S Street Food (55s) | «…sono in servizio. Chiamami per le 3:00… siamo pieni.» |
| `6a71f8e177f0ed625a0f0662` | Belvedere (128s) | «mi chiamano ogni 5 minuti per le cazzate… chiamatemi in un secondo momento perché sto lavorando.» |

**Categoria:** (a).

---

### FM3 — Hard no / zero interesse dopo il pitch (b: interesse)

**Definizione:** Rifiuto esplicito ripetuto; nessun discovery, nessun next step. Outcome spesso ancora `callback`.

**Frequenza:** **Medio** — **13/113** con “non mi interessa / non ci interessa” esplicito nel lead; cluster short+mid.

**Esempi:**
| callId | Contatto | Citazione |
|--------|----------|-----------|
| `6a73469b77f0ed625a0f4416` | Gusto 19 (49s) | «Ah, non mi interessa.» → «Non mi interessano, grazie.» |
| `6a71f10477f0ed625a0f009e` | Alfonso Cous cous (44s) | «Non mi interessa, la ringrazio.» |
| `6a73083c77f0ed625a0f2419` | Sferico Polpetteria (112s) | «non mi interessa le recensioni, sono sincero… ce n’hanno già tanti dei clienti.» |

**Categoria:** (b).

---

### FM4 — Hook “vicino” morto o geografia falsa (c: qualifica / scripting)

**Definizione:** Il riferimento locale non è riconosciuto, è lontano, o è sbagliato; Ale insiste sul blocco numeri invece di pivotare. Brucia credibilità prima del valore.

**Frequenza:** **Medio-alto** — “non lo conosco” in **~12/113** lead; fallimenti geografici evidenti in mid/long (Belvedere, Il Vicolo recall, Tito 244s “un po’ distante”).

**Esempi:**
| callId | Contatto | Citazione |
|--------|----------|-----------|
| `6a71f8e177f0ed625a0f0662` | Belvedere (128s) | Lead: «No, non c’è il ristorante Al Giardino qua.» / «Siamo a Casamola.» |
| `6a735dae77f0ed625a0f4ba6` | Trattoria Il Vicolo recall (115s) | «Stai facendo confusione, sicuro.» → «No, no, no, grazie, andiamo, ci difendiamo così.» |
| `6a6c6fa8cc281ca904ecf027` | Sementi la Pizza (52s) | Lead non conosce Impact Food; Ale continua comunque «3.221 recensioni…» fino a drop linea. |

**Categoria:** (c) + (e) quando la call si allunga a giustificare il hook.

---

### FM5 — Stall ferie / stagione (c + d)

**Definizione:** Titolare in ferie, chiusura locale, “richiamate a settembre/ottobre”. Spesso etichettato come progresso; in testo è deferral senza commitment sul valore.

**Frequenza:** **Medio** — **~16/113** menzionano ferie/settembre; concentrato luglio–agosto.

**Esempi:**
| callId | Contatto | Citazione |
|--------|----------|-----------|
| `6a6b75e1cc281ca904ecd8d7` | Pizza Pazza (58s) | «la ragazza gli deve richiamare a settembre perché il titolare sta in ferie» |
| `6a7301ee77f0ed625a0f20f9` | Pizza Dai Cinque (50s) | «devi richiamare a settembre perché al momento sta in ferie» |
| `6a72f9c277f0ed625a0f19b6` | Pretorio Café (136s, outcome voicemail) | «il proprietario adesso è in ferie. O ci risentiamo a settembre» |

**Categoria:** (c) timing/qualifica; (d) next-step vuoto se non c’è impegno reale.

---

### FM6 — “Abbiamo già” / saturazione / no pain (b + c)

**Definizione:** Stack esistente (agenzia, Italia Online, QR, TAP, tessere Google, mail/SMS) oppure locale già pieno. Ale differenzia tardi o ripitcha “evoluzione” senza gap accettato → rifiuto.

**Frequenza:** **Medio** — **~8–12/113** chiari (Gallodoro, Donna, Omar, Marcolino, Sementi mid, Mr. Crunch, Davvero, Concordia long).

**Esempi:**
| callId | Contatto | Citazione |
|--------|----------|-----------|
| `6a75a44977f0ed625a0f8169` | Gallodoro (235s) | «Abbiamo già chi cura queste cose… abbiamo comprato delle tessere Google… non siamo interessati» |
| `6a74a3e777f0ed625a0f71b6` | Il panino da Omar (179s) | «pane esaurito… si manda già via tanta gente… proprio non mi interessa» |
| `6a730e2677f0ed625a0f288a` | Ristorante Donna (113s) | «siamo già con Italia Online… ci siamo già moltiplicati… per il momento va bene così» |

**Categoria:** (b)/(c).

---

### FM7 — Echo-close sull’obiezione (b + d)

**Definizione:** Dopo un no chiaro, Ale riformula la stessa value prop come domanda chiusa (“quindi non ti interesserebbe…?”). Non esplora motivo; spinge al secondo no.

**Frequenza:** **Medio** — pattern ripetuto su hard-no short e mid (Gusto 19, Alfonso, Sferico, Vicolo, Mister Pachino).

**Esempi:**
| callId | Contatto | Citazione |
|--------|----------|-----------|
| `6a73469b77f0ed625a0f4416` | Gusto 19 | Dopo «non mi interessa»: «quindi non ti interesserebbe moltiplicare le recensioni…?» → «No.» |
| `6a71f10477f0ed625a0f009e` | Alfonso | «Ok, quindi non ti interesserebbe aumentare le recensioni ora?» → «No, Alfonso.» |
| `6a73083c77f0ed625a0f2419` | Sferico | monologo “triplo della visibilità” → «non ti interesserebbe incrementare i clienti?» → «No… va benissimo così.» |

**Categoria:** (b)/(d).

---

### FM8 — Callback vuoto / chase loop (d: close/next-step)

**Definizione:** Orario vago (“prova un paio di volte”), “ti richiamo se…”, stesso DM non trovato in più touch, nessun micro-impegno sul contenuto. CRM = callback; pipeline = idle.

**Frequenza:** **Alto** come esito operativo dello short; New Bahia compare **3 volte** nello short+mid (51s, 34s, 118s) ancora senza Filippo.

**Esempi:**
| callId | Contatto | Citazione |
|--------|----------|-----------|
| `6a75a61177f0ed625a0f82e6` | New Bahia (51s) | «lui è molto fugace… prova un paio di volte» |
| `6a75cf8b77f0ed625a0f8cdf` | New Bahia (34s) | «aveva detto di richiamare. Però adesso non c’è ancora Filippo.» |
| `6a749e2277f0ed625a0f6ffb` | Gourmoso (123s) | «Ne parlo con mio padre… e **la richiamo se** per lei va bene.» (controllo passa al lead) |

**Categoria:** (d).

---

### FM9 — Contatto/nome sbagliato / confusione identità (a)

**Definizione:** Ale chiede di una persona che non esiste o confonde gestori; brucia trust sul recall.

**Frequenza:** **Basso-medio** ma ad alto danno quando avviene su follow-up.

**Esempi:**
| callId | Contatto | Citazione |
|--------|----------|-----------|
| `6a730e2677f0ed625a0f288a` | Ristorante Donna (113s) | «non c’è nessun Francesco qua» (Marco aveva dato nome errato / mal registrato) |
| `6a6c68c2cc281ca904ece882` | Concordia (420s) | «Andrea Capolongo è il **vecchio** gestore… noi siamo i nuovi gestori» |
| `6a75fe3577f0ed625a0f97f5` | Sushi House (45s) | chase Razal senza orario: «lui non so quando viene… quando vuole venire» |

**Categoria:** (a).

---

### FM10 — Monologo pitch / nessuna discovery (b + e)

**Definizione:** Sales parla 3–10× il lead; nessuna domanda su pain/coperti/processo attuale prima del pitch. Durata alta o media senza trazione.

**Frequenza:** **Medio** — ~10+ call con ratio sales/lead >3 e durata >90s (Tito 244s ratio≈13.7, Mava’ 133s, Su Nuraghe, Mr. Crunch, ecc.).

**Esempi:**
| callId | Contatto | Citazione / segnale |
|--------|----------|---------------------|
| `6a73618277f0ed625a0f4e83` | Ristorante tito (244s) | Apertura lunga Maps+Nonna Katia+444 recensioni+media 3.9; lead quasi assente → monologo. |
| `6a730b5777f0ed625a0f25cf` | Mr. Crunch (112s) | Lead: «non mi serve… c’ho 4.8… le chiedo coi QR»; Ale continua pitch “evoluzione” fino a «Pronto? Pronto?» (lead drop). |
| `6a6cb200cc281ca904ecfe83` | Mava’ (133s) | Pitch lungo → «per ora no… si va in ferie» → ottobre soft. |

**Categoria:** (b)/(e).

---

### FM11 — Targeting / fit prodotto errato (c)

**Definizione:** Locale fuori ICP (circolo privato, vendita del locale, già saturi) ma Ale forza fit sul menù digitale/recensioni.

**Frequenza:** **Basso** come conteggio, **alto** come costo tempo (call lunghe).

**Esempi:**
| callId | Contatto | Citazione |
|--------|----------|-----------|
| `6a6c68c2cc281ca904ece882` | Concordia (420s) | «ristorante dentro un circolo privato… mani legate» → dopo 7 min: «non mi interessa propriamente» / «adesso ti direi di no» |
| `6a71fb5677f0ed625a0f0840` | Gaia A Mare follow-up (124s) | «forse lo vendiamo… c’è già una trattativa… 80%» |

**Categoria:** (c).

---

### FM12 — False positive di durata / labeling (e)

**Definizione:** Call lunga o `callback`/`voicemail` che nel testo è refusal, deferral vuoto, o conversazione senza advance reale.

**Frequenza:** **Alto** sul labeling (112/118 `callback`); **medio** sulle long inutili (Concordia 420s, Omar 179s, Gallodoro 235s, Mister Pachino 135s, Belvedere 128s, Pretorio 136s “voicemail” ma non è voicemail).

**Esempi:** vedi §5–6.

**Categoria:** (e).

---

## 3. Pattern di drop-off temporale

### 0–30s
- Saluto + “sono Alessandro” + Maps + nome cliente vicino.
- Lead già in difesa (“di cosa si tratta?”, “chi sei?”, “sono in servizio”).
- Se audio scarso o nome sbagliato → confusione immediata (Sushi House, New Bahia).

### 30–60s — **zona di morte primaria (short stratum)**
- Completamento del blocco “N recensioni vere” → lead taglia:
  - **busy/hostile** (L’Ancora ~33s),
  - **hard no** (Gusto 19 ~36s, Alfonso ~34s),
  - **non-DM** (Mestolo, Vini e Vecchi Sapori, Pizza Dai Cinque).
- Quasi nessun discovery entro 60s nelle short fallite: il permesso “due domande” arriva dopo il monologo o non arriva.

### 60–90s
- Gatekeeper collaborativo: nome + orario (forma “positiva” di FM1) **oppure**
- Lead arriva al “che cosa fate?” / “non mi interessa” dopo il pitch (Sferico ~46s start of no, poi loop fino ~112s).
- Hook geografico fallito inizia a costare (Belvedere: correzione zona → irritazione).

### 90–150s+
- Due esiti tipici di fallimento:
  1. **Hard no ragionato** (Omar, Gallodoro, Donna, Mister Pachino, Sementi mid) — Ale continua a ripitchare.
  2. **Deferral stagionale / “mi richiami”** senza trial o criterio (Pretorio, Corner 52, Mava’, Gourmoso).
- Oltre ~3–7 min: false positive estremi (Concordia 420s) — Ale nega i segnali di no-fit (“se stiamo parlando da 6 minuti l’argomento ti interessa”) contro il testo del lead.

---

## 4. Obiezioni tipiche e perché le risposte attuali non sbloccano

| Obiezione (testo) | Risposta tipica Ale | Perché non sblocca (evidenza) |
|-------------------|---------------------|-------------------------------|
| «Non mi interessa» | Echo: «quindi non ti interesserebbe aumentare le recensioni?» | Ripete la value prop rifiutata; lead conferma no (Gusto 19, Alfonso, Sferico). Nessuna domanda sul *perché*. |
| «Sto lavorando / siamo pieni» | Accetta recall **oppure** continua pitch “al volo” | Su L’Ancora/Belvedere il pitch già in corso è percepito come “storie/cazzate”; il recall soft non trasferisce valore. |
| «Devi parlare col titolare» | Chiede nome + orario | Spesso ok tatticamente, ma: (1) gate rifiuta info (Pizza Pazza); (2) orario vago → chase (New Bahia); (3) nessun messaggio da lasciare al DM → callback vuoto. |
| «Non conosco [cliente vicino]» | «Ci sta / stessa zona» + ripitch numeri | Non ripristina credibilità; su Belvedere/Vicolo la geografia sbagliata attiva ostilità. |
| «Abbiamo già chi se ne occupa / QR / Italia Online» | «Noi non facciamo social, solo recensioni» / «evoluzione» | Arriva dopo il no; lead fedele al fornitore (Sementi: «non mi va di fa cose che a lui potrebbe dar fastidio»; Marcolino: «non ho intenzione di cambiare»). |
| «Siamo pieni / non servono clienti» | Visibilità ×3 / più clienti da Maps | Pain assente (Omar, Sferico, Davvero «mi basta così»); pitch acquisizione è anti-fit. |
| «Ferie / settembre» | «Ok, richiamo a settembre» | Chiude la call senza criterio di riapertura o sponsor interno; Pretorio: mail rifiutata («lavoriamo solo tramite chiamata») → stall ancora più lungo. |
| «Quanto costa?» (raro) | «Dipende, prima due domande» | Mister Pachino: lead voleva filtro prezzo; Ale rifiuta → «momentaneamente non ci interessa» ripetuto. |
| Circolo / vincoli / vendita locale | Forza fit menù digitale / “recensioni aiutano la vendita” | Concordia: lead ripete no-fit; Gaia: trattativa 80% — ripitch inutile. |

---

## 5. Falsi positivi

### Durata lunga, zero progresso
| callId | Contatto | Durata | Perché non è progresso |
|--------|----------|--------|-------------------------|
| `6a6c68c2cc281ca904ece882` | Concordia | 420s | ICP sbagliato + no esplicito ripetuto; Ale insiste su settembre |
| `6a75a44977f0ed625a0f8169` | Gallodoro | 235s | «non siamo interessati» + tessere Google; Ale continua a chiedere dettagli |
| `6a74a3e777f0ed625a0f71b6` | Omar | 179s | Saturazione totale; «No. No, no, no, no, non ci interessa.» |
| `6a71b32477f0ed625a0eecaa` | Mister Pachino | 135s | «momentaneamente non ci interessa» ×3; nessun next step |
| `6a71f8e177f0ed625a0f0662` | Belvedere | 128s | Ostilità + hang-up; Ale chiude con «Porca…» |
| `6a73618277f0ed625a0f4e83` | Tito | 244s | Monologo sales; transcript lead quasi vuoto |

### `callback` (o `voicemail`) che non è progresso
- **Hard no loggati callback:** Gusto 19, Alfonso, L’Ancora, Sferico, Vicolo Stretto, Omar, Gallodoro, Concordia.
- **Pretorio** `6a72f9c2…` outcome **voicemail** ma è conversazione live → deferral settembre + rifiuto canale mail.
- **Chase New Bahia** (3 call) tutte `callback` senza mai Filippo.
- **Gourmoso:** “ti richiamo io se…” — controllo perso; non è meeting booked.
- **Gaia A Mare 124s:** follow-up su locale in vendita — courtesy callback, non pipeline.

### Soft “win” da non confondere
Ottenere solo «nome titolare + orario» (molte short) è **intelligence**, non interesse. Senza messaggio/valore lasciato al DM, il recall riparte da zero (pattern Donna: Francesco inesistente; Concordia: Andrea sbagliato).

---

## 6. Worst 8 call

| callId | Contatto | Durata | Failure mode dominante | Citazione |
|--------|----------|--------|------------------------|-----------|
| `6a6c68c2cc281ca904ece882` | Polisportiva Bocciodromo La Concordia | 420s | FM11+FM10 targeting/monologo | «in questo momento non mi interessa propriamente… adesso ti direi di no» |
| `6a71f8e177f0ed625a0f0662` | Ristorante Pizzeria Belvedere | 128s | FM4+FM2 geografia + ostilità | «mi chiamano ogni 5 minuti per le cazzate» |
| `6a75d4cd77f0ed625a0f8f22` | Ristorante L’Ancora | 41s | FM2 chiusura ostile early | «non c’ho tempo da ascoltare le sue storie» |
| `6a74a3e777f0ed625a0f71b6` | Il panino da Omar | 179s | FM6 saturazione no-pain | «pane esaurito… proprio non mi interessa» |
| `6a6b75e1cc281ca904ecd8d7` | Pizza Pazza | 58s | FM1 gate ostile + FM5 ferie | «non sono tenuta a dirle tutte ste cose» |
| `6a73469b77f0ed625a0f4416` | Gusto 19 | 49s | FM3+FM7 hard no + echo | «Non mi interessano, grazie.» |
| `6a75a44977f0ed625a0f8169` | Gallodoro | 235s | FM6 already-have | «il mio titolare non è particolarmente interessato… tessere Google» |
| `6a71b32477f0ed625a0eecaa` | Mister Pachino | 135s | FM3 refusal loop | «momentaneamente non ci interessa» (ripetuto) |

---

## 7. Rischi sistemici

1. **Scripting rigido:** stessa sequenza Maps→vicino→cifra→“ti interessa?” anche su busy, gate, e hook fallito; poca adattività nei primi 30s.
2. **Lista “Vicini Clienti”:** prossimità geografica non implica familiarità del lead col cliente-ancora; quando l’ancora è debole, l’intera apertura collassa.
3. **Timing campagna (estate):** ferie e chiusure trasformano gran parte del dialing in deferral settembre; il volume “callback” sembra attività.
4. **CRM labeling:** `callback` default su refusal, gate, e chase → impossibile misurare win-rate reale senza rilettura transcript.
5. **`callAnalysis` DB vuoto** (`objections: []` ovunque) → nessun feedback loop automatico sulle obiezioni.
6. **Qualità anagrafica / note:** nomi DM errati o gestori cambiati (Donna/Francesco, Concordia/Andrea Capolongo) moltiplicano i touch inutili.
7. **Canale unico voce:** rifiuto mail (Pretorio) senza alternativa documentabile → dipendenza totale da richiamate a vuoto.
8. **ICP non filtrato pre-call:** circoli, locali saturi, stack QR già maturo entrano comunque nel dial — costo alto sulle long.

---

## 8. Limiti

- Analisi su **113/118** transcript; 5 call senza transcript escluse dal dettaglio testuale.
- Conteggio frequenze: mix di pattern matching su testo lead + lettura manuale short/mid + campionamento long fallite — non coding doppio cieco.
- Alcuni transcript hanno **ruoli invertiti/ASR errori** (es. Loco’S 46s, Corner 52): citazioni usate solo dove il senso è chiaro.
- Non si valuta follow-up *successivo* fuori corpus: un “callback” soft potrebbe convertire dopo; qui si giudica solo la call presente.
- Non si usano score DB (`salesScore: n/a`, callAnalysis vuoto).
- Nessun consiglio prescrittivo in questo file (solo diagnosi).

---

STATUS: COMPLETE  
ApproximateTranscriptsReviewed: 65
