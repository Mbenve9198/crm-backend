# Funnel cold call — numeri precisi (solo evidenza transcript)

**Scope:** Alessandro Totti × lista `Cold Call - Vicini Clienti`  
**Snapshot DB:** 2026-08-11  
**Regola:** gli stage “trial offerto / accettato” usano **solo** il testo del transcript. L’outcome CRM (`free-trial-sold`, `callback`, ecc.) **non** conta come prova.

---

## Definizioni operative (ferme)

| Stage | Definizione | Cosa NON conta |
|-------|-------------|----------------|
| **Call** | Record in `calls` con `initiatedBy` = Alessandro e `contact.lists` ⊇ Vicini Clienti | — |
| **Answered >30s** | `duration > 30` **e** outcome/status ∉ {no-answer, busy, failed, canceled} | Call 8s “free-trial-sold” CRM |
| **Con transcript** | Answered >30s con `transcript` non vuoto (>50 char) | — |
| **Trial offerto** | Nel dialogo compare offerta esplicita di prova (es. «prova gratuita di due settimane» / «provare il servizio… due settimane») | Accenno generico a “prova” senza offerta |
| **Trial accettato** | Il **lead** accetta di partire con la prova **oppure** completa logistica di avvio (spedizione QR / dati fattura / indirizzo) in modo non ambiguo | «Valutiamo», «ne parlo col socio», «ti faccio ricontattare», solo WA materials |

---

## 1. Funnel volume (CRM hard — 100% misurabile)

| # | Stage | N | CR vs stage prec. | CR vs call totali |
|---|--------|--:|------------------:|------------------:|
| A | Contatti in lista | **1.313** | — | — |
| B | Contatti chiamati (≥1 call) | **161** | 12,3% di A | — |
| C | Call totali | **256** | — | 100% |
| D | Answered >30s | **122** | **47,7%** di C | 47,7% |
| E | Contatti unici in D | **85** | 52,8% di B | — |
| F | D con transcript | **119** | 97,5% di D | 46,5% |

### Bucket durata su D (answered >30s)

| Bucket | N | % di D |
|--------|--:|------:|
| 31–60s | 25 | 20,5% |
| 61–90s | 35 | 28,7% |
| 91–180s | 42 | 34,4% |
| ≥181s | 20 | 16,4% |

### Outcome CRM su D (non usare come successo)

| Outcome | N |
|---------|--:|
| callback | 115 |
| voicemail | 3 |
| not-logged | 2 |
| null | 2 |
| free-trial-sold | **0** su D |

> L’unico `free-trial-sold` CRM sulla lista è **Ali Fast Food** (8s, no transcript, status `bad_data`) → **escluso** da ogni CR qualità.

---

## 2. Funnel trial (solo transcript — classificazione call-by-call)

Universo: **F = 119** answered >30s con transcript.

### 2.1 Trial offerto = **8** call / **8** contatti unici

| Contatto | callId | Durata | Esito classificato | Citazione guida |
|----------|--------|------:|--------------------|-----------------|
| Tyler Ponte Milvio | `6a71bcc5…` | 679 | **ACCETTATO** | Lead: «Sì… assolutamente» a «provare il servizio»; poi indirizzo casa per QR + fattura 25€ |
| Pizzeria Verace in borgo | `6a75a99f…` | 651 | **ACCETTATO** | Lead: «Certo» a curiosità prova; «Ok» a spedizione QR; fornisce cell, P.IVA, ragione sociale, email fattura |
| Osteria Falabràch | `6a733387…` | 871 | Offerto, **non** accettato | Lead: «valutiamolo… confrontarmi con lui»; «lo valuto con il collega» |
| Il Conte Brillo Centocelle | `6a73633d…` | 694 | Offerto, **non** accettato | Lead: «Valutiamo bene, vediamo pure i costi» |
| Spritzzeria Roma | `6a72ffc3…` | 348 | Offerto, **non** accettato | Lead: «riferisco agli altri soci… ti faccio ricontattare» |
| Il Tempio del Panino | `6a749fc5…` | 320 | Offerto, **non** accettato | Lead: se ne occupa già il figlio di un socio |
| Corner 52 | `6a6a214e…` | 130 | Offerto a non-DM, **non** accettato | Gate: titolare in ferie, richiamo 23 agosto (Ivan) |
| Ristorante La Perla Nera | `6a6a16c5…` | 72 | Offerto a non-DM, **non** accettato | Gate: parlare col titolare Rosa |

### 2.2 Trial accettato = **2** call / **2** contatti unici

1. **Tyler Ponte Milvio** (Paolo) — accettazione verbale + logistica QR a casa, start post 24/08  
2. **Pizzeria Verace in borgo** (Sonny / Tushlanda) — accettazione operativa con dati fatturazione e spedizione QR  

**Falabràch escluso** (valutazione con socio, non ok alla partenza).

---

## 3. Conversion rate (cifre chiuse)

### Su call / answered

| Metrica | Calcolo | CR |
|---------|---------|---:|
| Answer rate (>30s) | 122 / 256 | **47,7%** |
| Transcript coverage su answered | 119 / 122 | **97,5%** |
| Trial offerto / answered con tx | 8 / 119 | **6,7%** |
| Trial accettato / answered con tx | 2 / 119 | **1,7%** |
| Trial accettato / answered tutti | 2 / 122 | **1,6%** |
| Trial accettato / call totali | 2 / 256 | **0,8%** |
| Accept rate su offerte | 2 / 8 | **25%** |

### Su contatti unici

| Metrica | Calcolo | CR |
|---------|---------|---:|
| Contatti answered / chiamati | 85 / 161 | **52,8%** |
| Trial offerto / contatti answered* | 8 / 85 | **9,4%** |
| Trial accettato / contatti answered | 2 / 85 | **2,4%** |
| Trial accettato / contatti chiamati | 2 / 161 | **1,2%** |

\*Le 8 offerte sono su contatti in answered; denominatore answered unici = 85.

---

## 4. Schema riassuntivo

```
Lista 1313
  └─ chiamati 161 (12,3%)
       └─ 256 call
            └─ 122 answered >30s          = 47,7% call
                 └─ 119 con transcript    = 97,5% answered
                      └─ 8 trial offerto  = 6,7% answered-tx
                           └─ 2 accettato = 1,7% answered-tx
                                            = 25% delle offerte
                                            = 0,8% delle call
```

---

## 5. Note di precisione / limiti

1. **Nessun altro accept** trovato nel corpus transcript oltre Tyler e Verace, con i criteri sopra.  
2. Alcuni transcript hanno diarizzazione invertita (Corner 52, Perla Nera): l’offerta resta attribuibile ad Ale, l’accept no.  
3. Status contatto post-call (`interessato`, `qr code inviato`) **non** è usato per la CR trial; Verace ha `qr code inviato` coerente con accept, Falabràch `interessato` nonostante non-accept.  
4. Non è verificato in questo file se i 2 accept hanno poi pagato i 25€ o attivato la prova (solo esito **in-call**).

---

*File di riferimento per dashboard/report; supersede stime qualitative 7–15% S7 e conteggi trial-path larghi precedenti.*
