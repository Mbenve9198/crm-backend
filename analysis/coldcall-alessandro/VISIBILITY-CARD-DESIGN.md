# Scheda visibilità cold call — design + test

## Obiettivo
Per ogni lead cold call: scheda operativa usata nello script, con:
- keyword di ricerca locale (settore)
- posizione Maps su quella keyword
- competitor davanti (nome, rating, volume recensioni)
- rating + volume recensioni del lead
- review velocity (rec/mese recenti)

## Pipeline (v1 testata)

```
Contact (CRM)
  → Claude: keyword (+ alt)
  → SerpAPI Maps place (place_id)
  → SerpAPI Maps search(keyword @ lat/lng)
  → SerpAPI Maps reviews newest (paginate)
  → Scheda MD/JSON + hook cold call
```

**Nota Serper:** `SERPER_API_KEY` presente ma account **senza crediti** (`Not enough credits`).  
Per il test usiamo **SerpAPI** (già usato in `agentToolsService.js`). Stesso disegno è portabile a Serper Maps/Reviews quando ricaricato.

## Script test
`scripts/test-visibility-card.js`

```bash
node scripts/test-visibility-card.js --n=3
```

Output: `analysis/coldcall-alessandro/visibility-cards-test/`

## Risultato test (3 contatti non chiamati)

| Contatto | Keyword Claude | Rank | Rating | Rec | Vel/mese | Ahead |
|----------|----------------|------|--------|-----|----------|-------|
| Perú Pisco (Livorno) | ristorante peruviano Livorno | **#2** | 4.3 | 35 | ~1 | La Cusqueña #1 |
| Da Vinci Bisteccheria (Latina) | bisteccheria Latina | fail (0 risultati) | 4.6 | 533 | ~1.3 | — |
| Tacos kings (San Lorenzo) | ristorante tex-mex San Lorenzo Roma | **#1** | 4.8 | 320 | ~1.3 | — |

### Cosa funziona
- Keyword Claude sensate (settore + zona)
- Place resolve via `place_id` import
- Ranking + competitor davanti (caso Perú: hook pronto)
- Velocity indicativa da reviews newest paginate

### Gap da chiudere prima del rollout
1. **Fallback keyword** se Maps torna 0 risultati → riprovare `alt_keywords` / keyword più ampia / zoom diverso  
2. **Velocity più robusta**: più pagine reviews o stima vs totale; oggi ~28 newest → indicativa  
3. **Verifica cliente vicino** (re-geo lead vs anchor) — step separato, ancora da fare  
4. Persistenza su `contact.properties` o collection dedicata `visibilityCards`  
5. Serper credits se si vuole unificare provider

## Costo stimato per lead (SerpAPI)
- 1× place + 1× rank + ~3× reviews pages ≈ **~5 credit** / lead  
- + 1 Claude call keyword  
Per ~1100 non chiamati: ordine ~5.5k SerpAPI calls (batch + cache place_id).

## Prossimi step consigliati
1. Fix fallback keyword su fail ranking  
2. Allargare test a 15–20 lead (QA qualità hook)  
3. Decidere schema salvataggio CRM  
4. Integrare scheda nello script cold call (hook Maps al posto/oltre Vicini Clienti)
