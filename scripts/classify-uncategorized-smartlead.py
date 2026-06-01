#!/usr/bin/env python3
"""Classifica risposte Smartlead uncategorized e confronta positive vs CRM."""
import json
import re
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from html import unescape

import requests
from pymongo import MongoClient

try:
    import anthropic
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "anthropic", "-q"])
    import anthropic

CLASSIFICATION_PROMPT = """Sei un esperto analista di cold email outbound per ristorazione italiana.
Classifica ogni risposta in UNA categoria:
- INTERESTED: segnale positivo esplicito (domanda, telefono nel corpo, richiesta info/call/demo)
- NEUTRAL: ambigua, breve, stagionale, reindirizzamento senza interesse chiaro
- NOT_INTERESTED: rifiuto esplicito, attività chiusa/venduta definitivamente
- DO_NOT_CONTACT: stop contatti, unsubscribe, GDPR, "no" secco
- OUT_OF_OFFICE: autoresponder, prenotazioni bot, fuori ufficio, bounce

Regole: nel dubbio INTERESTED vs NEUTRAL → NEUTRAL. Telefono in firma NON conta.
Rispondi SOLO JSON array, un oggetto per risposta, stesso ordine:
[{"id":1,"category":"INTERESTED|NEUTRAL|NOT_INTERESTED|DO_NOT_CONTACT|OUT_OF_OFFICE","reason":"max 80 char"}]"""


def load_env():
    text = open("/Users/user/Documents/menuchat/crm-backend/.env.rtf").read()
    return {
        "smartlead": re.search(r'SMARTLEAD_API_KEY="([^"]+)"', text).group(1),
        "mongo": re.search(r'MONGODB_URI="([^"]+)"', text).group(1),
        "anthropic": re.search(r'ANTHROPIC_API_KEY="([^"]+)"', text).group(1),
    }


def strip_html(html):
    if not html:
        return ""
    t = re.sub(r"<style[^>]*>.*?</style>", " ", html, flags=re.I | re.S)
    t = re.sub(r"<script[^>]*>.*?</script>", " ", t, flags=re.I | re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    t = unescape(t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def clean_reply(text):
    t = strip_html(text)
    t = re.sub(r"(?m)^>.*$", " ", t)
    t = re.sub(r"(?i)(invia da iphone|sent from my iphone|get outlook for).*", " ", t)
    t = re.sub(r"(?i)(cordiali saluti|distinti saluti|un saluto).*?(tel\.|mobile\.|cell\.|$)", " ", t, flags=re.S)
    return re.sub(r"\s+", " ", t).strip()[:2000]


def normalize(text):
    lower = text.lower().strip()
    lower = re.sub(r"\bnn\b", "non", lower)
    lower = re.sub(r"\bn\b(?=\s+(sono|siamo|ci|mi|è|ho|abbiamo))", "non", lower)
    return lower


def quick_classify(text):
    n = normalize(text)
    if not n:
        return "OUT_OF_OFFICE", "Risposta vuota"

    ooo = [
        "fuori ufficio", "out of office", "risposta automatica", "automatic reply",
        "grazie per averci contattato", "la risponderemo al più presto",
        "la risponderemo al piu presto", "provvederemo a rispondervi",
        "per prenotazioni chiediamo", "non vengono accettate prenotazioni tramite",
        "thanks for contacting us", "we will reply as soon as possible",
        "mailer-daemon", "undeliverable", "autoresponder",
        "riapriremo", "chiusi per ferie", "orari di apertura",
        "verrà disattivato", "verra disattivato", "nuovo indirizzo email",
    ]
    for p in ooo:
        if p in n:
            return "OUT_OF_OFFICE", "Autoresponder / bot / OOO"

    if re.match(r"^no+\b", n) and len(n) < 50:
        return "DO_NOT_CONTACT", "Rifiuto secco"

    dnc = [
        "non contattatemi", "non scrivetemi", "unsubscribe", "rimuovetemi",
        "cancellate i miei dati", "vi diffidiamo", "basta email", "gdpr",
    ]
    for p in dnc:
        if p in n:
            return "DO_NOT_CONTACT", "Richiesta stop"

    neg = [
        "non ci interessa", "non mi interessa", "non siamo interessati",
        "non sono interessat", "no mi interessa", "non ci serve",
        "abbiamo già un fornitore", "abbiamo gia un fornitore",
        "è stato venduto", "e stato venduto", "abbiamo venduto",
        "non sono più il proprietario", "non sono piu il proprietario",
        "abbiamo chiuso definitivamente", "cessata attività", "cessata attivita",
        "non fa per noi", "grazie ma non siamo interessati",
    ]
    for p in neg:
        if p in n:
            return "NOT_INTERESTED", "Rifiuto esplicito"

    pos = [
        "mi interessa", "sono interessat", "ci interessa", "siamo interessati",
        "quanto costa", "qual è il prezzo", "come funziona", "vorrei sapere",
        "mandami info", "mandatemi info", "dimmi di più", "parliamone",
        "chiamami", "chiamatemi", "chiamateci", "contattatemi al",
        "sentiamoci", "fissiamo", "appuntamento", "prova gratuita",
        "whatsapp", "puoi contattarmi", "può contattarmi",
    ]
    for p in pos:
        if p in n:
            return "INTERESTED", "Interesse esplicito"

    if len(n) < 30:
        return "NEUTRAL", "Risposta breve"

    return None, None


def fetch_uncategorized(api_key, days=30):
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    window = [start.strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ")]

    all_items = []
    offset = 0
    while True:
        payload = {
            "offset": offset,
            "limit": 20,
            "filters": {"emailStatus": "Replied", "replyTimeBetween": window},
            "sortBy": "REPLY_TIME_DESC",
        }
        r = requests.post(
            f"https://server.smartlead.ai/api/v1/master-inbox/inbox-replies?api_key={api_key}&fetch_message_history=false",
            json=payload,
            timeout=60,
        )
        r.raise_for_status()
        batch = r.json().get("data") or []
        if not batch:
            break
        all_items.extend(batch)
        if len(batch) < 20:
            break
        offset += 20
        time.sleep(0.2)

    by_email = {}
    for item in all_items:
        if item.get("lead_category_id") is not None:
            continue
        email = (item.get("lead_email") or "").lower().strip()
        if not email:
            continue
        prev = by_email.get(email)
        if not prev or (item.get("last_reply_time") or "") > (prev.get("last_reply_time") or ""):
            by_email[email] = item
    return list(by_email.values()), start, end


def fetch_reply_text(api_key, campaign_id, lead_id):
    r = requests.get(
        f"https://server.smartlead.ai/api/v1/campaigns/{campaign_id}/leads/{lead_id}/message-history?api_key={api_key}",
        timeout=30,
    )
    if r.status_code != 200:
        return ""
    history = r.json().get("history") or r.json() if isinstance(r.json(), list) else r.json().get("history", [])
    if isinstance(r.json(), list):
        history = r.json()
    replies = [m for m in history if m.get("type") == "REPLY"]
    if not replies:
        return ""
    return clean_reply(replies[-1].get("email_body") or "")


def ai_classify_batch(client, batch):
    lines = []
    for i, row in enumerate(batch, 1):
        preview = row["reply_text"][:800].replace('"', "'")
        lines.append(f'{i}. [{row["email"]}] {row["name"]}\n"{preview}"')

    prompt = CLASSIFICATION_PROMPT + "\n\nRISPOSTE:\n\n" + "\n\n".join(lines)
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1200,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.M).strip()
    results = json.loads(raw)
    out = {}
    for item in results:
        out[int(item["id"])] = item["category"]
    return out


def main():
    env = load_env()
    db = MongoClient(env["mongo"])["test"]
    client = anthropic.Anthropic(api_key=env["anthropic"])

    uncat, start, end = fetch_uncategorized(env["smartlead"])
    print(f"Recupero testi per {len(uncat)} risposte uncategorized...")

    rows = []
    for i, item in enumerate(uncat):
        text = fetch_reply_text(
            env["smartlead"],
            item.get("email_campaign_id"),
            item.get("email_lead_id"),
        )
        rows.append({
            "email": (item.get("lead_email") or "").lower().strip(),
            "name": " ".join(filter(None, [item.get("lead_first_name"), item.get("lead_last_name")])).strip(),
            "campaign": item.get("email_campaign_name"),
            "last_reply_time": item.get("last_reply_time"),
            "lead_id": item.get("email_lead_id"),
            "reply_text": text or "(testo non disponibile)",
        })
        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{len(uncat)} testi recuperati")
        time.sleep(0.15)

    # quick classify
    needs_ai = []
    for row in rows:
        cat, reason = quick_classify(row["reply_text"])
        if cat:
            row["category"] = cat
            row["reason"] = reason
            row["method"] = "rules"
        else:
            needs_ai.append(row)

    print(f"Classificazione rapida: {len(rows)-len(needs_ai)} | da AI: {len(needs_ai)}")

    for i in range(0, len(needs_ai), 8):
        batch = needs_ai[i : i + 8]
        try:
            mapping = ai_classify_batch(client, batch)
            for j, row in enumerate(batch, 1):
                row["category"] = mapping.get(j, "NEUTRAL")
                row["reason"] = "Classificazione AI"
                row["method"] = "ai"
        except Exception as e:
            print(f"⚠️ batch AI fallito: {e}")
            for row in batch:
                row["category"] = "NEUTRAL"
                row["reason"] = "Fallback NEUTRAL"
                row["method"] = "fallback"
        time.sleep(0.3)

    counts = Counter(r["category"] for r in rows)
    positive = [r for r in rows if r["category"] == "INTERESTED"]
    negative = [r for r in rows if r["category"] in ("NOT_INTERESTED", "DO_NOT_CONTACT")]

    pos_in = []
    pos_missing = []
    for r in positive:
        c = db.contacts.find_one({"email": r["email"]}, {"name": 1, "source": 1, "status": 1})
        r["in_crm"] = bool(c)
        r["crm"] = c
        (pos_in if c else pos_missing).append(r)

    print("\n" + "=" * 70)
    print(f"UNCATEGORIZED ANALIZZATE | {start.date()} → {end.date()}")
    print("=" * 70)
    print(f"Totale uncategorized: {len(rows)}")
    print("\nClassificazione testo:")
    for cat, n in counts.most_common():
        print(f"  - {cat}: {n}")

    print(f"\n--- POSITIVE (INTERESTED) ---")
    print(f"Totale positive: {len(positive)}")
    print(f"  ✅ Nel CRM: {len(pos_in)}")
    print(f"  ❌ NON nel CRM: {len(pos_missing)}")

    if pos_missing:
        print("\n  Positive mancanti dal CRM:")
        for r in sorted(pos_missing, key=lambda x: x["last_reply_time"] or "", reverse=True):
            print(f"    • {r['email']}")
            print(f"      {r['name'][:50]} | {r['campaign'][:40]} | {str(r['last_reply_time'])[:10]}")
            print(f"      Testo: {r['reply_text'][:160]}...")
            print(f"      Motivo: {r['reason']}")
            print()

    if pos_in:
        print("  Positive già nel CRM:")
        for r in pos_in:
            c = r["crm"]
            print(f"    • {r['email']} | {c.get('status')} | source={c.get('source')}")

    print(f"\n--- NEGATIVE (NOT_INTERESTED + DO_NOT_CONTACT): {len(negative)} ---")

    out = {
        "summary": {
            "uncategorized": len(rows),
            "positive": len(positive),
            "positive_missing_crm": len(pos_missing),
            "counts": dict(counts),
        },
        "positive_missing": pos_missing,
        "all_rows": rows,
    }
    path = "/Users/user/Documents/menuchat/crm-backend/scripts/uncategorized-classification.json"
    with open(path, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\n📄 Report: {path}")


if __name__ == "__main__":
    main()
