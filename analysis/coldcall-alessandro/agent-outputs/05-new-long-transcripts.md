# Addendum — 4 call lunghe appena trascritte

**Data recovery:** 2026-08-11  
**Call:** le 4 answered >30s della lista Vicini Clienti **senza transcript** (tutte con recording).  
**Metodo:** download Twilio MP3 → Gemini 2.5 Flash → salvataggio su Mongo (`transcript` + `callAnalysis`).

| callId | Contatto | Durata | DM | Score | Esito testuale reale |
|--------|----------|--------|----|-------|----------------------|
| `6a73338777f0ed625a0f35a5` | Osteria Trattoria dal Falabràch | 871s | Marco | 4 | **Trial path** + WhatsApp materials + recall **lunedì** (dopo socio) |
| `6a73633d77f0ed625a0f4f83` | Il Conte Brillo Centocelle | 694s | Vincenzo | 4 | **Trial 2 sett. a settembre** + brochure/QR via WhatsApp |
| `6a71bcc577f0ed625a0ef38e` | Tyler Ponte Milvio | 679s | Paolo | **5** | **Trial accettato** (25€+IVA QR) post-ferie 24/08; spedizione a casa |
| `6a75a99f77f0ed625a0f8607` | Pizzeria Verace in borgo (Tushlanda / Sonny) | 651s | Sonny | 4 | **Trial accettato** (25€+IVA QR); supera obiezione prezzo + “di persona” |

> Outcome CRM di tutte e quattro: ancora `callback`. Conferma FM12: il labeling nasconde **S7/S8**.

---

## Cosa cambia rispetto al report precedente

1. **Le call più lunghe senza transcript non erano “gap neutri”: erano tra le migliori del corpus.**  
   Prima sottostimavamo S7/S8 perché le top-duration mancanti erano proprio i trial close.
2. **Pattern trial operativo emergente (ricorrente 4/4):**  
   prova 2 settimane + **costo setup QR 25€+IVA** + invio brochure/QR su **WhatsApp** + piano annuale verbalizzato **990–1290€**.  
   La prova è “del servizio”; i QR hanno un micro-commitment economico.
3. **Ancora “Vicini Clienti” forte quando riconosciuta:**  
   Falabràch conosce l’Ostu; Tyler conosce Impact Food → engagement immediato del DM.
4. **Gestione obiezioni di alto livello (non echo-close):**  
   - Falabràch: “siamo piccoli / non vogliamo più coperti” → reframe *massimizzare fatturato sul giro attuale, non volume*.  
   - Conte Brillo: “comprate recensioni? / TheFork?” → no-fake + complementarità Maps.  
   - Verace: prezzo + “parliamone di persona” → trial low-risk a distanza (Firenze).  
   - Tyler: ferie → spedizione a casa + start post-riapertura.
5. **Canale post-call = WhatsApp**, non solo recall telefonico. Cambia la taxonomy next-step (livello alto).
6. **Stima S7 precedente (~7–8% su ~55) va rivista al rialzo** sul corpus answered: almeno **+4 trial-path** sulle long prima invisibili. Ordine di grandezza aggiornato: **~10–15%** impegno qualificato / trial path sul set answered>30s con transcript (117/118), ancora lontano dal 95% `callback`.

---

## Citazioni chiave

**Falabràch — reframe qualità/coperti**
> Lead: «abbiamo un locale che fa 30-35… non si fatica molto a riempirlo»  
> Ale: «non è portarvi 400.000 persone… massimizzare le recensioni… gestibile»  
> Close: «ti tengo la prova fino a lunedì… ti mando tutto su WhatsApp»

**Conte Brillo — trial settembre**
> «Sentiamoci a fine mese allora. Aspetto il WhatsApp intanto.»  
> Obiezioni su autenticità recensioni e TheFork gestite prima del close.

**Tyler / Paolo — trial post-ferie (score 5)**
> Interesse esplicito recensioni/rating Google+TripAdvisor.  
> Accetta 25€+IVA, menù via WhatsApp, start dopo 24/08.

**Verace / Sonny — prezzo → trial**
> «Dipende dal prezzo» → prova 2 sett. con 25€ QR.  
> «Mi piace parlare di persona» → pivot Firenze / prova a distanza accettata.

---

## Implicazioni operative (aggiornamento a `04`)

| Priorità | Azione |
|----------|--------|
| Alta | Label CRM dedicato: `cb-trial-offered` / `cb-trial-accepted` / `cb-whatsapp-sent` — queste 4 call oggi sono indistinguibili da un gatekeeper soft |
| Alta | Industrializzare il **trial pack**: script 25€ QR + WhatsApp send + data start (anche post-ferie) |
| Alta | Coaching: usare Falabràch/Tyler come gold standard **accanto a** Spritzzeria (non solo Spritzzeria) |
| Media | Verbalizzare range annuale (990–1290) **dopo** discovery/trial — qui funziona; non in cold short |
| Media | Reframe “locali piccoli / siamo pieni” = massimizzare sul giro attuale (anti-FM6 no-pain) |
| QA | Ri-trascrivere anche long **troncate** (La Differenza, Gaia) con stesso pipeline MP3 |

---

## Limiti

- ASR/diarizzazione Gemini: possibili swap SALES/LEAD e nomi (es. brand locale).  
- Non verificato se i trial sono poi partiti operativamente (solo esito in-call).  
- Fedele ristorante 37s resta senza recording → non trascritta.

STATUS: COMPLETE  
NewlyTranscribed: 4
