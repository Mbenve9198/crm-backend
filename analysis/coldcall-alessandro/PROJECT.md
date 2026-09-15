# Cold Call Analysis — Alessandro Totti

## Obiettivo
Analisi qualitativa solida delle cold call di Alessandro sulla lista **Cold Call - Vicini Clienti**: cosa funziona, cosa no, cosa testare/migliorare, più insight operativi.

## Dataset
- Agente: Alessandro Totti
- Lista: `Cold Call - Vicini Clienti`
- Filtro: durata > 30s, esclusi no-answer/busy/failed/canceled
- N = 118 chiamate (113 con trascrizione)
- Outcome CRM quasi inutili come KPI: ~112/118 etichettati `callback` → i segnali di successo vanno inferiti dal testo (interesse, next step concreto, trial, owner engagement, ecc.)
- `callAnalysis` DB: presente ma quasi vuoto → non affidarsi ad esso

## File
- `corpus-manifest.json` — totali, strata, stats
- `index.json` — metadata di tutte le 118
- `bundle-long.md` — top 25 per durata
- `bundle-mid.md` — 25 call 60–150s
- `bundle-short.md` — 20 call 30–60s
- `bundle-all-transcripts.md` — corpus completo
- `transcripts/<callId>.md` — singole call

## Orchestrazione
1. Wave A — analisi parallele (Composer + Grok) su lenti distinte
2. Wave B — critic / experiments che legge Wave A
3. Sintesi finale orchestratore → `REPORT-FINALE.md`
