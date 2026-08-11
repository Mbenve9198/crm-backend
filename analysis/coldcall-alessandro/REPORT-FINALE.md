# Report finale — Cold call Alessandro Totti

**Lista:** Cold Call - Vicini Clienti  
**Filtro:** chiamate con risposta, durata > 30s (N=118; **117 con transcript** dopo recovery)  
**Periodo corpus:** 29 luglio – 7 agosto 2026  
**Metodo:** corpus esportato da Mongo → 3 analisi parallele (Composer/Grok) su *cosa funziona / cosa fallisce / processo-funnel* → piano esperimenti → sintesi orchestratore → **recovery trascrizione 4 long call**  

**Fonti dettagliate:** `agent-outputs/01-what-works.md`, `02-what-fails.md`, `03-process-funnel.md`, `04-experiments-improvements.md`, **`05-new-long-transcripts.md`**

---

## Verdetto in 30 secondi

Ale è bravo a **aprire e creare un motivo per richiamare**. Quando arriva al DM in una call lunga, **sa anche chiudere sul trial** — ma il CRM non lo vede.

Il CRM dice `callback` nel **~95%** dei casi. Sul testo, l’impegno qualificato / trial path è nell’ordine del **~10–15%** del set answered>30s (prima stimato 7–8%: le 4 long senza transcript erano proprio trial). La metrica attuale nasconde due cose: il collo **gatekeeper** *e* i **win nascosti**.

**Gold standard da replicare (aggiornato):** non solo Spritzzeria Roma (`6a72ffc3`), ma anche **Tyler Ponte Milvio** (Paolo, 679s, score 5 — trial 25€ QR post-ferie), **Falabràch** (Marco, 871s — reframe “siamo piccoli”), **Conte Brillo**, **Verace/Sonny**.

---

## 1. Cosa funziona (da tenere e industrializzare)

### Pattern solidi (ricorrenti nel corpus)

1. **Apertura “ricercata”** — conferma locale + Maps + presentazione breve. Tiene in linea anche chi non è il titolare.
2. **Triade Vicini Clienti** — cliente vicino → N recensioni specifiche → permesso («due domande al volo»). Quando il lead conosce (o accetta) l’ancora geografica, l’engagement è alto.
3. **Discovery killer question** — «State già facendo qualcosa per le recensioni?» Apre stack reale (nulla / agenzia / QR / media bassa) senza monologo.
4. **Reframe complementarità** — «Non facciamo social, solo 50–100 recensioni vere/mese». Funziona **se** arriva prima del no definitivo (Spritzzeria, Meloncini).
5. **Close con nome + giorno/ora** — proxy di successo ripetibile. «Mi segno il numero» / «ti faccio sapere» **non** contano.
6. **Trial pack (nuovo, 4/4 sulle long recovery)** — prova 2 settimane + **25€+IVA per QR** + invio materiali su **WhatsApp** + range annuale **990–1290€** verbalizzato dopo discovery. Micro-commitment economico > “gratis” nudo.
7. **Reframe “siamo piccoli / non vogliamo più gente”** — massimizzare recensioni/fatturato sul giro attuale, non volume (Falabràch). Anti-pattern rispetto al pitch “più clienti” su locali saturi.
8. **Recall con contesto + WhatsApp** — il canale post-call forte non è solo il telefono.
9. **Rispetto del servizio / ferie** — busy → fascia; ferie → start post-riapertura (anche spedizione QR a casa, Tyler).

### Cosa *non* è un successo (anche se sembra)

- Nome titolare + orario **senza** messaggio di valore da lasciare → intelligence, non pipeline.
- Deferral «settembre/ottobre» **senza** interesse esplicito → stall mascherato.
- Call lunghe (3–7 min) con hard no ripetuto (Concordia 420s, Omar 179s) → durata ≠ qualità.

---

## 2. Cosa non funziona (dove si perde il deal)

### Colli di bottiglia

| Priorità | Problema | Evidenza |
|----------|----------|----------|
| #1 | **Gatekeeper / non-DM** | ~65–75% short+mid non arriva a DM in linea; molte short 30–60s muoiono qui |
| #2 | **Monologo numeri prima del permesso** | Lead chiede «che cosa fai?» dopo il pitch → hard no (Gusto 19) o ostilità (L’Ancora) |
| #3 | **Echo-close su «non mi interessa»** | «Quindi non ti interesserebbe aumentare le recensioni?» → secondo no, peggio |
| #4 | **Hook «vicino» morto senza pivot** | «Non lo conosco» / geografia sbagliata → ripitch numerico → credibilità bruciata |
| #5 | **CRM `callback` monolitico** | Refusal, chase vuoti e trial offer hanno la stessa label → funnel cieco |

### Failure modes da memorizzare (catalogo completo in `02`)

- FM1 Gatekeeper muro · FM2 Busy/servizio · FM3 Hard no · FM4 Hook geografico morto  
- FM5 Ferie/deferral vuoto · FM6 Already-have / saturazione · FM7 Echo-close  
- FM8 Callback soft senza messaggio · FM10 Monologo su no ripetuto · FM11 ICP sbagliato · FM12 False positive durata/label

### Worst call (da usare in coaching, non da imitare)

Concordia 420s (ICP sbagliato + insistenza), Belvedere (geografia + ostilità), L’Ancora 41s (pitch su «sto lavorando»), Omar (no-pain), Gusto 19 (echo-close), Pizza Pazza (gate ostile).

---

## 3. Come funziona davvero il processo di Ale

**Non è una vendita in prima call.** È un **motore di accesso al decisore** con pitch recensioni.

```
Connect → Hook Maps/Vicino → (spesso) Gatekeeper → Nome DM + ora
                ↓
         (raro) DM in linea → Discovery → Reframe → Trial/recall caldo
```

**Stime sul campione letto (~55 call), non verità assoluta sul 100%:**

| Stage | Cosa misura | Ordine di grandezza |
|-------|-------------|---------------------|
| Hook erogato | Maps + vicino | ~90%+ |
| Permesso | «due domande» / interesse | ~2/3 degli engaged |
| DM path | DM in linea **o** nome+ora | ~70% (molto è solo gatekeeper) |
| Discovery | ≥1 domanda su pratica recensioni | ~1/3 del DM path |
| Impegno qualificato (S7) | interesse + next step col DM / trial | **~10–15%** (era ~7–8%; +4 trial-path dalle long recovery) |
| Trial setup (S8) | prova accettata / QR in spedizione | **presente** (Tyler, Verace, Falabràch path, Conte Brillo sett.) |

**Value prop ricostruita dal pitch di Ale:** Menu Chat = recensioni Google vere via menù digitale/QR + WhatsApp, 50–100/mese, prova 2 settimane (setup QR ~25€+IVA) → piano annuale tipicamente 990–1290€, complementare ad agenzie/TheFork, vendita voce + follow-up WhatsApp.

---

## 4. Cosa migliorare / testare (priorità orchestratore)

### Da fare da domani (quick wins)

1. **Permesso entro 20s, prima dei numeri**  
   > «…lavoriamo con locali della zona sulle recensioni Google. Due domande al volo, 30 secondi — va bene?»
2. **Se «sto lavorando» → zero pitch**, solo fascia oraria + nome.
3. **Gatekeeper pack 4/4:** nome DM + fascia + messaggio da lasciare («Alessandro Menu Chat, recensioni come [Cliente]») + eventuale cell/altro locale.
4. **Ban echo-close:** dopo hard no, una sola «perché» (già qualcosa / non priorità / altro) poi exit pulito → log `no-hard`.
5. **Hook morto:** non ripitchare i numeri; pivot a «voi sulle recensioni Maps state già facendo qualcosa?»
6. **Close choice:** «martedì 10:30 o giovedì 16?» — vietati soft close.

### Esperimenti A/B da far girare (primi)

| Test | Variante B | Metrica | Campione |
|------|------------|---------|----------|
| E1 Permesso early | permesso prima dei numeri | % permesso <25s; % hang-up ostile <60s | 80 call |
| E2 Gate message | pack 4/4 vs solo nome+ora | % 2° touch con DM che “si aspettava” | 60 gate |
| E3 Pivot hook-fail | discovery sul profilo lead | % → durata>90s + discovery | 40 hook-fail |
| E4 No echo | QW4 vs eco attuale | % hard-no con motivo; ostilità | 30 hard-no |
| E7 Ancora geografica | solo clienti <2km + nome riconoscibile + ≥500 rec | % «lo conosco» | 100 dial |

Dettaglio script, ICE, coaching 2 settimane: `04-experiments-improvements.md`.

### Coaching (2 settimane) — focus

- Sett.1: fermare perdite (busy, echo, gate pack)  
- Sett.2: alzare qualità (pivot hook, discovery, reframe+trial, close)  
- Scorecard binaria per call; target ≥80% righe verdi su 40 call

---

## 5. Altri punti utili (oltre script)

### Misurazione CRM (obbligatoria se volete migliorare)

Sostituire/affiancare `callback` con label tipo:

`cb-gatekeeper` · `cb-gate-msg` · `cb-defer-season` · `cb-dm-discovery` · `cb-dm-interested` · `cb-trial-offered` · `cb-trial-accepted` · `no-hard` · `no-hostile` · `no-fit` · `chase-cap`

Campi post-call (30s): `dmName`, `recallAt`, `hookRecognized`, `nextStepLevel` (1–10).

**KPI settimanali minimi:** % permesso early, % gate 4/4, % discovery su DM path, % S7, echo-close rate, chase depth max 3.

### Lista & timing

- L’ancora «Vicini Clienti» funziona come **apertura**, non come predittore di chiusura.
- In luglio–agosto una fetta rilevante diventa deferral ferie: o accettate un funnel “intelligence” oppure spostate volume su fasce/locali aperti.
- Filtrare pre-dial ICP no-fit ovvi (circoli privati, saturazione evidente, stack Maps già maturo) riduce le long inutili.
- Dial preferibile fuori servizio di punta (es. 09:30–11:30 / 15:00–17:00) — da testare (E8).

### Qualità dati / tooling

- **5 call lunghe senza transcript** (tra cui Falabràch 871s, Conte Brillo 694s, Ponte Milvio 679s, Verace 651s) → gap serio sulle “migliori” per durata; ri-trascrivere.
- Molti transcript **troncati** sulle call lunghe → coaching cieco sulle top call.
- `callAnalysis` in DB è quasi vuoto (`objections: []`) → oggi non serve al feedback loop.
- Brand name in call a volte storpiato (ASR/fonetica): monitorare chiarezza «Menu Chat».

### Cosa *non* ottimizzare adesso

- Prezzo in cold: compare raro; prima sistemare permesso/gate/labeling.
- Allungare le call: le long fallite dimostrano che più minuti ≠ più deal.
- Aumentare volume dialing finché il CRM non distingue S7 da gatekeeper soft.

---

## 6. Giudizio orchestratore (qualità e gap)

**Cosa è solido**
- Convergenza delle 3 analisi indipendenti sullo stesso collo di bottiglia (gatekeeper + monologo pre-permesso + labeling).
- Pattern positivi ancorati a callId/citazioni, non a “best practice” generiche.
- Piano esperimenti falsificabile con metriche e campioni.

**Cosa resta debole / da non over-interpretare**
- Nessuna verifica post-call (quanti trial WhatsApp diventano setup/contratto).
- Stime % funnel ancora campionarie; le 4 long alzano S7/S8 ma non cancellano il collo gatekeeper sulle short.
- Stagionalità agosto distorce i next step.
- Outcome CRM inutilizzabile → i “win” (incluse queste 4) sono ancora etichettati `callback`.

**Decisione operativa consigliata**
1. Questa settimana: QW1–QW4 + rilabel CRM (`no-hard` / `cb-gatekeeper` / `cb-dm-*` / **`cb-trial-*` / `cb-whatsapp-sent`**).  
2. Industrializzare il **trial pack** visto sulle 4 long (25€ QR + WhatsApp + data start).  
3. Coaching: gold tape = Tyler + Falabràch + Spritzzeria; worst tape invariati.  
4. Poi: E1+E2 + volume lista.

---

## 7. Addendum recovery trascrizioni (2026-08-11)

Dettaglio in `agent-outputs/05-new-long-transcripts.md`.

| Contatto | Durata | Win testuale |
|----------|--------|--------------|
| Falabràch / Marco | 871s | Trial + WhatsApp + lunedì post-socio |
| Conte Brillo / Vincenzo | 694s | Trial settembre + WhatsApp |
| Tyler Ponte Milvio / Paolo | 679s | Trial accettato 25€ QR post-ferie (score 5) |
| Verace / Sonny | 651s | Trial accettato; supera prezzo + “di persona” |

**Lezione metodologica:** in outbound, le call lunghe *senza* transcript sono spesso i win — trascriverle prima di chiudere il giudizio sul close rate.

---

## Indice file

| File | Contenuto |
|------|-----------|
| `PROJECT.md` | Scope e orchestrazione |
| `corpus-manifest.json` | Totali, strata, stats |
| `index.json` | Metadata 118 call |
| `agent-outputs/01-what-works.md` | Pattern vincenti + top 8 |
| `agent-outputs/02-what-fails.md` | 12 failure modes + worst 8 |
| `agent-outputs/03-process-funnel.md` | Talk track reale + funnel S0–S8 |
| `agent-outputs/04-experiments-improvements.md` | Quick wins, A/B, coaching, CRM |
| `agent-outputs/05-new-long-transcripts.md` | Recovery 4 long + implicazioni |
| `REPORT-FINALE.md` | Questo documento |

> I transcript grezzi (`transcripts/`, `bundle-*.md`) restano in working tree per analisi locali; **non** vanno in git (PII / contenuti chiamata).
