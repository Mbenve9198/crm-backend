# Piano miglioramenti + esperimenti — Cold Call Alessandro Totti

**Fonti:** `01-what-works.md`, `02-what-fails.md`, `03-process-funnel.md`, `corpus-manifest.json` (N=118 answered >30s, 113 transcript, lista "Cold Call - Vicini Clienti").  
**Validazione spot:** transcript `6a73469b` (Gusto 19 / FM7), `6a75d4cd` (L'Ancora / FM2), `6a6c6fa8` (Sementi / FM4), `6a732da6` (Mestolo / FM1+FM2), `6a72ffc3` (Spritzzeria / pattern vincente).  
**Outcome CRM attuale inutilizzabile:** `callback` ≈112/118 — le metriche sotto usano **proxy testuali** (stage S0–S8 da `03`) fino a nuovo labeling.

**Legenda ICE:** Impact 1–10 · Confidence 1–10 · Effort 1–10 (basso = più facile). Score = `(I×C)/E`.

---

## 1. Executive take — priorità top 5

| # | Priorità | Tipo | Failure mode / evidenza | ICE score (ord.) |
|---|----------|------|-------------------------|------------------|
| 1 | **Permesso entro 20s, prima del monologo numeri** | Quick win + A/B | Drop 30–60s (FM2/FM3); Gusto 19 `6a73469b` («Che cosa fai?» dopo pitch → hard no); funnel S2→S3 ~67% | Alto |
| 2 | **Gatekeeper: messaggio da lasciare al DM + nome+ora+motivo** | Quick win | FM1/FM8; Mestolo `6a732da6` ottiene Ciro 18:30 ma zero valore lasciato; New Bahia chase×3 | Alto |
| 3 | **Ban echo-close su «non mi interessa»** | Quick win + coaching | FM7: Gusto 19, Alfonso `6a71f104`, Sferico `6a73083c` | Alto |
| 4 | **Pivot hook «vicino» morto / geografia falsa** | Quick win + A/B | FM4: Belvedere `6a71f8e1`, Vicolo `6a735dae`, Sementi `6a6c6fa8` | Medio-alto |
| 5 | **Rilabel CRM outcome (schema §5)** | Strutturale | FM12; callback gonfia ~12× vs S7 (~7–8%) | Alto impatto, effort medio |

**Regola operativa da domani:** ogni call deve terminare con **un** esito esigibile tra: (a) DM in linea + discovery, (b) nome DM + fascia + **1 frase valore lasciata**, (c) `no-hard` loggato, (d) defer stagionale **con** interesse esplicito o sponsor. Vietato chiudere su «ti richiamo se…» / «prova un paio di volte» (Gourmoso `6a749e22`, New Bahia `6a75a611`).

---

## 2. Quick wins (questa settimana) — script pronti

Ogni item: ipotesi → linea → metrica → campione → rischio. ICE inline.

### QW1 — Apertura corta + permesso prima dei numeri (I9 C8 E2)

- **Ipotesi:** il monologo Maps→vicino→N recensioni brucia la finestra di ascolto (L'Ancora `6a75d4cd` 41s; pattern short stratum FM2).
- **Cambiamento (max ~15s):**  
  > «Buongiorno, sono Alessandro di Menu Chat. Vi chiamo da Maps perché lavoriamo con locali della vostra zona sulle recensioni Google. **Ho due domande al volo, 30 secondi — va bene?**»
- **Se sì:** allora vicino + cifra + discovery. **Se busy:** vai a QW2, non finire il pitch.
- **Metrica:** % call con permesso esplicito entro 25s (S3); % hang-up ostile <45s (baseline: L'Ancora-like).
- **Campione:** 40 call consecutive.
- **Rischio:** meno “wow” numerico in apertura; mitigare con cifra subito dopo il sì.

### QW2 — Interrupt busy: zero pitch, solo recall (I8 C9 E1)

- **Ipotesi:** continuare il blocco numeri su «sto lavorando» aumenta ostilità (FM2 Belvedere `6a71f8e1`, L'Ancora).
- **Linea:**  
  > «Hai ragione, non ti rubo tempo. **Quando richiamo il titolare / te?** Mattina prima delle 11 o dopo le 15?»  
  Opzionale: «Lascia solo il nome: Alessandro di Menu Chat, recensioni Maps.»
- **Metrica:** % busy → recall con **fascia oraria** (non «dopo»); % `no-hostile` su busy.
- **Campione:** tutti i busy della settimana (target ≥15).
- **Rischio:** meno intelligence immediata; accettabile vs hang-up.

### QW3 — Gatekeeper pack obbligatorio (I9 C8 E2)

- **Ipotesi:** nome+ora senza messaggio = callback vuoto (FM8; funnel livello 4 vs 8).
- **Checklist verbale (4 pezzi, non negoziabili):**  
  1. Nome DM  
  2. Fascia oraria (±30 min)  
  3. «Puoi dirgli che chiamo io, Alessandro di Menu Chat, per le recensioni Google come [Cliente vicino]?»  
  4. «C’è un cellulare/altro locale dove lo trovo meglio?» (pattern Simone→Alessandra `6a74a769`)
- **Metrica:** % gatekeeper call con 4/4 pezzi; % 2° touch che apre con «ti aspettava / mi ha detto».
- **Campione:** 30 gatekeeper call.
- **Rischio:** gate ostile (Pizza Pazza `6a6b75e1`) — se rifiuta info, logga `no-gate-info` e non chase>2.

### QW4 — Kill FM7: dopo hard no, una sola domanda “perché” poi exit (I8 C9 E1)

- **Ipotesi:** l’eco «quindi non ti interesserebbe…?» forza il secondo no (Gusto 19 transcript verificato).
- **Linea vietata:** qualsiasi riformulazione della value prop dopo «non mi interessa».
- **Linea nuova:**  
  > «Ok, chiaro. Solo per non disturbarti a caso: è perché avete già qualcosa, perché non è priorità ora, o altro?»  
  - Se risponde → 1 frase reframe se fit (agenzia→QW5) altrimenti: «Perfetto, non ti disturbo. Buona giornata.»  
  - Log CRM: `no-hard` + motivo.
- **Metrica:** 0 echo-close su hard-no; % hard-no con motivo catturato.
- **Campione:** tutti i hard-no della settimana (≥10).
- **Rischio:** nessuno operativo; solo perdita di “ultimo pitch” inutile.

### QW5 — Reframe «abbiamo già web/social» in 1 frase (prima del no) (I8 C8 E2)

- **Ipotesi:** il reframe funziona quando arriva **prima** della chiusura (Spritzzeria `6a72ffc3`, Meloncini `6a74a546`); tardi fallisce (Gallodoro `6a75a449`, FM6).
- **Linea:**  
  > «Ottimo — di solito lavoriamo proprio con chi ha già i social curati. **Noi non facciamo post: solo 50–100 recensioni vere/mese.** Vi fa senso affiancarlo, o siete già coperti anche su Maps?»
- **Metrica:** % «abbiamo già» → S5 discovery o `cb-dm-interested` vs `no-hard`.
- **Campione:** ≥12 obiezioni «già agenzia/QR/Italia Online».
- **Rischio:** su stack Maps maturo (tessere Google / mail-SMS Marcolino `6a748356`) non forzare — exit pulito.

### QW6 — Pivot «non lo conosco» senza ripitch numeri (I7 C8 E2)

- **Ipotesi:** ripetere N recensioni dopo hook morto brucia credibilità (FM4 Sementi `6a6c6fa8`, Belvedere).
- **Linea:**  
  > «Ci sta, zona piena di locali. **A prescindere dal nome:** voi sulle recensioni Maps state già facendo qualcosa, o lasciate al naturale?»  
  Se geografia corretta dal lead:  
  > «Hai ragione sulla zona — mi aggiorno. Restano due domande veloci sulle vostre recensioni?»
- **Metrica:** % «non lo conosco» → S3/S5 vs drop <60s; 0 ripetizioni del blocco numerico pre-permesso.
- **Campione:** ≥12 hook-fail.
- **Rischio:** meno prova sociale; compensare con dato **del lead** (N recensioni / media sul profilo).

### QW7 — Close: giorno+ora+nome DM (mai soft) (I8 C9 E1)

- **Ipotesi:** next step nominato è il segnale ripetibile più forte (`01` §7; Spritzzeria lunedì/Tiziano).
- **Linea anti-soft:**  
  > «Meglio **martedì 10:30** o **giovedì 16:00**? Chiedo di [Nome].»  
  Vietato accettare: «ti richiamo io se…», «prova un paio di volte», «settembre» senza giorno.
- **Per ferie (FM5):**  
  > «Ok settembre: **che settimana** e **chi** deve esserci? Segno [Nome] + [settimana]. Prima di chiudere: sulle recensioni siete scoperti o già ok?»
- **Metrica:** % close livello ≥5 nella taxonomy `03` §7; % livello 1–2.
- **Campione:** 50 call.
- **Rischio:** pressure percepita — tono collaborativo, due opzioni (choice close).

### QW8 — Trial solo post-valore; evita «gratis» nudo (I7 C7 E2)

- **Ipotesi:** trial dopo complementarità chiude (`6a72ffc3`); «gratis» isolato irrita (`6a6b5f84`).
- **Linea:**  
  > «Possiamo farvi **provare il servizio due settimane** e guardare i numeri insieme — senza impegno sul piano annuale. Ha senso sentirci [giorno] con [DM]?»
- **Metrica:** % S6→S7; 0 trial in prima frase di cold.
- **Campione:** call con DM in linea >90s (≥15).
- **Rischio:** over-offer su non-DM — non proporre trial al gatekeeper.

---

## 3. Esperimenti A/B — test falsificabili

Disegno: **A = script attuale (control)**, **B = variante**. Assegnazione: giorno alternato o coin flip pre-dial. Stop rule: campione minimo o p-hat chiaro su metrica primaria. Successo = B batte A sulla metrica primaria di ≥X pp (soglia sotto).

| ID | Ipotesi | Variante B (concreta) | Metrica primaria | Campione min | Soglia successo | ICE | Rischio |
|----|---------|----------------------|------------------|--------------|-----------------|-----|---------|
| **E1** | Permesso early ↑ S3 e ↓ hang-up 30–60s | B: QW1 (permesso prima dei numeri). A: Maps→vicino→cifra→interesse | % S3 entro 25s; % drop ostile <60s | 80 call (40/40) | S3 +15 pp **oppure** ostile −10 pp | 9/8/3 | Hook meno “ricercato” |
| **E2** | Messaggio gatekeeper ↑ recall caldi | B: QW3 pack 4 pezzi. A: solo nome+ora | % 2° touch con riconoscimento / DM in linea | 60 gatekeeper (30/30) | +20 pp DM-in-line al 2° touch | 9/7/3 | Gate rifiuta messaggio |
| **E3** | Pivot hook-fail ↑ engagement | B: QW6 (discovery Maps del lead). A: normalizza + ripitch N recensioni | % hook-fail → durata>90s **e** ≥1 risposta discovery | 40 hook-fail (20/20) | +25 pp | 8/8/2 | Perde ancora sociale |
| **E4** | No echo-close ↑ motivo + brand safety | B: QW4. A: eco attuale | % hard-no con motivo; score ostilità (0/1) | 30 hard-no | Motivo ≥50% in B; ostilità non ↑ | 8/9/1 | Nessuno |
| **E5** | Busy-first recall ↑ callback esigibili | B: QW2 immediato. A: «ti dico al volo» + pitch (come Mestolo mid-pitch) | % busy → fascia oraria; % no-hostile | 40 busy | Fascia +30 pp | 8/9/2 | Meno pitch same-call |
| **E6** | Reframe agenzia early ↑ S7 | B: QW5 alla prima menzione stack. A: pitch generico poi reframe | % «abbiamo già» → S5+ o trial offer | 30 obiezioni stack | +20 pp | 8/7/3 | Su no-pain saturi (Omar) non applica — escludere |
| **E7** | Ancora geografica “top of mind” vs lista auto | B: solo ancore **con** ≥500 recensioni **e** <2 km **e** nome riconoscibile zona. A: lista Vicini attuale | % «sì lo conosco»; % S2 | 100 dial (50/50) lista split | «lo conosco» +15 pp | 7/6/5 | Effort lista / tooling |
| **E8** | Fascia oraria dial (anti-servizio) | B: dial 09:30–11:30 e 15:00–17:00. A: mix attuale (pranzo/sera) | % FM2 busy; % S4 | 2 settimane mirror volume | Busy −15 pp | 7/6/4 | Meno slot; volume ↓ |
| **E9** | Prezzo filtro early (anti Mister Pachino) | B: su «quanto costa?»: «Piano annuale tipicamente [range banding se policy ok]; prima capisco se ha senso in 2 domande». A: rifiuto prezzo | % prezzo-ask → S5 vs `no-hard` | 20 prezzo-ask (raro — accumulo 3 sett.) | Hard-no post-prezzo −30 pp | 6/5/3 | Se range non approvato, testare solo «ordine di grandezza dopo discovery» |
| **E10** | No-pain: exit vs ripitch acquisizione | B: su «siamo pieni / pane esaurito» (Omar `6a74a3e7`): «Capito. Allora non vi servo per portare gente — chiudo qui, ok?» (opz. 1 frase reputazione). A: visibilità×3 | Tempo medio call; % `no-hard` pulito vs loop | 20 no-pain | Durata mediana −40%; 0 loop>2 min | 7/8/2 | Perde rare conversioni — accettabile |

**Criterio di kill globale:** se B peggiora S7 (impegno qualificato) di >5 pp a metà campione, stop e rollback.

---

## 4. Coaching plan 2 settimane per Ale

### Settimana 1 — Fermare le perdite (FM2, FM7, FM8)

| Sessione | Durata | Focus | Drill |
|----------|--------|-------|-------|
| **S1 Lun** | 45 min | Review worst: L'Ancora, Gusto 19, Belvedere | Role-play×10: lead dice «sto lavorando» → solo QW2. Pass = fascia in <10s. |
| **S2 Mar** | 30 min | FM7 kill | Role-play×10 hard-no. Se Ale eco-close → reset. Pass = exit o 1 «perché». |
| **S3 Mer** | 45 min | Gatekeeper pack | Role-play×15: staff rifiuta pitch. Checklist 4/4. Shadow 5 call live. |
| **S4 Gio** | 30 min | Call review | Ascolto 5 short del giorno; scorecard FM. |
| **S5 Ven** | 45 min | Retrospect E1/E4 mid-week | Aggiusta wording permesso se frizione. |

**Homework sett.1:** ogni sera 3 self-score su form: permesso<25s? echo? gate 4/4?

### Settimana 2 — Alzare qualità next step (FM4, FM5, path B funnel)

| Sessione | Durata | Focus | Drill |
|----------|--------|-------|-------|
| **S6 Lun** | 45 min | Hook-fail pivot (FM4) | Role-play «non lo conosco» + «siamo a [altra città]». Linea QW6. |
| **S7 Mar** | 45 min | Discovery produttiva | Domanda unica obbligatoria: «State già facendo qualcosa per le recensioni?» (`01` pattern). Poi 1 follow-up (agenzia/QR/coperti). |
| **S8 Mer** | 45 min | Reframe + trial timing | Replay Spritzzeria `6a72ffc3` vs Gallodoro `6a75a449`. Drill «abbiamo già» → complementarità → trial **dopo**. |
| **S9 Gio** | 30 min | Close choice + ferie qualificate | Due slot orari; settembre con settimana+nome+1 criterio interesse. |
| **S10 Ven** | 60 min | Certificazione | 8 call consecutive scorecard ≥80% regole QW1–7 → green light volume. |

**Scorecard coaching (binaria, 1 call = 1 riga):**

1. Permesso o busy-pivot entro 25s  
2. Nessun echo-close  
3. Se gate: 4/4 pack  
4. Se hook-fail: nessun ripitch numerico pre-discovery  
5. Close ≥ livello 4 taxonomy con giorno/fascia  
6. CRM label ≠ solo `callback` generico  

Target sett.2: **≥80% righe verdi** su 40 call.

---

## 5. CRM / misurazione — schema outcome + dashboard minima

### 5.1 Sostituire/affiancare `callback` monolitico

Usare label da `03` §8 (rinforzate):

| Label | Quando usarla | Non confondere con |
|-------|---------------|-------------------|
| `cb-gatekeeper` | Nome DM + fascia; non-DM in linea | Interesse prodotto |
| `cb-gate-msg` | Come sopra **+** messaggio valore lasciato (QW3) | Solo nome |
| `cb-defer-season` | Ferie/chiusura; recall mese | S7 |
| `cb-defer-season-qualified` | Ferie **+** interesse o discovery fatta | Defer vuoto |
| `cb-dm-logistics` | DM assente, recall breve | Meeting booked |
| `cb-dm-discovery` | ≥1 discovery answer da DM | Soft courtesy |
| `cb-dm-interested` | Curiosità esplicita + next step con DM | «mi segno il numero» |
| `cb-trial-offered` / `cb-trial-accepted` | Prova 2 sett. proposta / accettata | — |
| `cb-referral` | Transfer reparto/altro locale | — |
| `no-hard` | Rifiuto ripetuto | — |
| `no-hostile` | Chiusura aggressiva | — |
| `no-fit` | ICP sbagliato (circolo, vendita locale…) | — |
| `lost-timing` | Non ora, senza recall ancorato | — |
| `chase-cap` | Stesso DM non trovato ≥3 touch (New Bahia) | Callback infinito |

**Campi extra obbligatori post-call (30s):** `dmName`, `recallAt` (ISO o fascia), `anchorClient`, `hookRecognized` (yes/no/unknown), `failureMode` (FM1–FM12 o null), `nextStepLevel` (1–10).

### 5.2 Dashboard minima (settimanale)

| KPI | Definizione | Baseline corpus (ordine) | Target 2 sett. |
|-----|-------------|--------------------------|----------------|
| Connect rate | answered >30s / dial | n/a qui | — |
| % S3 permesso | permesso in transcript | ~67% di engaged | ≥75% engaged |
| % gate 4/4 | tra `cb-gatekeeper*` | ~0 misurato | ≥70% |
| % S5 discovery | su DM path | ~37% S4→S5 | ≥50% |
| % S7 | impegno qualificato | ~7–8% campione | ≥12% |
| % `no-hard` correttamente label | vs callback su refusal | oggi quasi 0 | 100% hard-no |
| Echo-close rate | FM7 detection | alto su hard-no | ≤5% |
| Chase depth | touch medi prima di `chase-cap` | New Bahia 3+ | max 3 |

**QA trascrizioni:** flaggare call **durata >180s senza transcript** o transcript troncato (La Differenza `6a6b6740` 733s, Gaia `6a6b56b0` 611s). Queue: ri-transcribe top 10 long/settimana — altrimenti coaching cieco sulle call migliori.

**Nota DB:** `callAnalysis.objections: []` ovunque nel corpus — fino a fix NLP, la scorecard umana post-call è la fonte di verità.

---

## 6. Lista & targeting — cosa cambiare su "Vicini Clienti"

| Cambio | Perché (evidenza) | Come testare |
|--------|-------------------|--------------|
| **Filtro ancora:** cliente ref. con brand riconoscibile + distanza stretta | FM4; «non lo conosco» ~12/113; Belvedere geografia falsa | E7 |
| **Escludere ICP no-fit pre-dial** | Circolo Concordia `6a6c68c2` 420s; vendita Gaia `6a71fb56` | Regola: no circoli privati / no «in vendita» noti |
| **Prioritizzare profili con pain Maps** | Hook problema vecchia gestione funziona meglio di solo vicino (`6a7201d5`) | Segmento: media ≤4.2 **o** <150 recensioni **o** spike review vecchia gestione |
| **Deprioritizzare saturati** | Omar, Sferico, Davvero — no pain acquisizione | Skip se note «sempre pieno» / review volume già altissimo senza gap |
| **Stagionalità lista** | FM5 ~16/113 ferie; luglio–agosto → defer settembre | Agosto: solo (a) DM noti da richiamare, (b) zone non in ferie, (c) richiami schedulati — riduci cold net-new |
| **Anagrafica DM** | FM9 Donna Francesco inesistente; Concordia Andrea Capolongo vecchio | Campo `dmNameVerified`; se lead corregge → overwrite immediato |
| **Cap chase** | New Bahia 3× short senza Filippo | Max 3 touch / 10 giorni poi `chase-cap` + canale alt. |

**Altri punti utili (processo / tooling / stagione / QA):**

1. **Dual-track esplicito in dialer:** tag UI «Path Gate» vs «Path DM» — metriche separate (funnel `03` binario A/B).  
2. **Template nota CRM pre-compilata** da checklist QW3 (copia-incolla 10s).  
3. **Policy canale:** oggi «solo chiamata» (Pretorio `6a72f9c2`) allunga stall ferie — testare WhatsApp **one-liner** post-gate *solo se* lead lo chiede, senza allegare listino.  
4. **QA ASR:** ruoli invertiti segnalati (Loco’S, Corner 52) — non usare callAnalysis auto per coaching finché vuoto/erratico.  
5. **5 call senza transcript** nel manifest (`no_transcript` stratum) — recovery prima di chiudere il loop di enablement sulle long.

---

## 7. Rischi e falsi positivi da evitare

| Falso positivo | Perché inganna | Come neutralizzarlo |
|----------------|----------------|---------------------|
| Durata lunga | Concordia 420s, Omar 179s, Tito 244s monologo = non-progress | KPI = stage S5–S7, non minuti |
| `callback` CRM | 95% vs ~8% S7 | Nuovo schema §5 |
| Solo «nome+ora» | Intelligence ≠ interesse (`03`) | Richiede `cb-gate-msg` o non conta come win |
| «Mi segno il numero» / inbound soft | Gourmoso controllo perso | Choice close con recall **outbound** Ale |
| Defer settembre | Attività mascherata (FM5) | Solo `cb-defer-season-qualified` in pipeline attiva |
| «Lo conosco» sull’ancora | Engagement ≠ fit | Serve S5 |
| Trial in apertura | Corner 52 ottiene nome ma defer (`6a6a214e`) | Trial post-discovery |
| Reframe «se parliamo da 6 minuti ti interessa» | Contro no-fit Concordia | Exit su `no-fit` |

**Rischi degli esperimenti stessi:** over-scripting (perdita naturalezza che funziona su Spritzzeria); volume ↓ con fasce orarie; lista troppo filtrata → dial starvation. Mitigazione: un test alla volta su ICE alto, holdout 50/50.

---

## 8. Backlog nice-to-have

- Libreria ancore per zona (top 3 clienti Menu Chat per quartiere) con cifra aggiornata mensile.  
- Auto-detect FM7/FM4 su transcript (regex «non ti interesserebbe» / «non lo conosco»).  
- Softphone prompt overlay: timer 25s «hai il permesso?».  
- Playbook obiezione prezzo banding approvato finance.  
- Sequenza multi-touch: gate → msg → DM recall → socio congiunto (pattern Tiziano).  
- A/B pain-first («vedo media 3.9 / poche review») vs vicino-first su segmento low-review.  
- Recupero transcript long troncati + listening club mensile sulle top S7.

---

## 9. Limiti

- Raccomandazioni derivate da analisi su ~50–65 transcript letti in profondità, non coding cieco su 113.  
- Nessun outcome post-call (trial reale / contratto) — successo = proxy in-call (S3–S7) fino a CRM nuovo.  
- Bias agosto/ferie: alcuni test (E8, targeting) vanno rivalidati in stagione piena.  
- Un solo agente / una lista: transferabilità ad altri SDR non provata.  
- Range prezzo (E9) dipende da policy commerciale non presente nel corpus.  
- Transcript mancanti/troncati limitano coaching sulle call più lunghe.

---

STATUS: COMPLETE
