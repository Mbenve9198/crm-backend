#!/usr/bin/env python3
"""
Trova lead rank checker / smartlead senza attività da 90+ giorni
e li assegna a Sonia (dry-run di default).
"""
import os
import re
import sys
from datetime import datetime, timedelta, timezone

try:
    from pymongo import MongoClient
    from bson import ObjectId
except ImportError:
    print("Installing pymongo...")
    os.system(f"{sys.executable} -m pip install pymongo -q")
    from pymongo import MongoClient
    from bson import ObjectId

SOURCES = ["inbound_rank_checker", "smartlead_outbound"]
EXCLUDED_STATUSES = {
    "won",
    "lost before free trial",
    "lost after free trial",
    "do_not_contact",
    "bad_data",
    "non_qualificato",
}
SONIA_EMAIL = "sonia@menuchat.it"
LIMIT = 50
STALE_DAYS = 90


def load_mongodb_uri():
    uri = os.environ.get("MONGODB_URI")
    if uri:
        return uri
    rtf_path = os.path.join(os.path.dirname(__file__), "..", ".env.rtf")
    if os.path.exists(rtf_path):
        text = open(rtf_path).read()
        m = re.search(r'MONGODB_URI="([^"]+)"', text)
        if m:
            return m.group(1)
    raise RuntimeError("MONGODB_URI non trovata")


def activity_match_expr():
    """Replica leadWorkRulesService: esclude reactivation, rispetta reactivatedAt."""
    return {
        "$expr": {
            "$and": [
                {"$eq": ["$contact", "$$contactId"]},
                {"$ne": ["$data.kind", "reactivation"]},
                {
                    "$or": [
                        {"$eq": ["$$reactivatedAt", None]},
                        {"$gte": ["$createdAt", "$$reactivatedAt"]},
                    ]
                },
            ]
        }
    }


def build_pipeline(owner_priority_unassigned=True):
    cutoff = datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)

    pipeline = [
        {
            "$match": {
                "source": {"$in": SOURCES},
                "status": {"$nin": list(EXCLUDED_STATUSES)},
            }
        },
        {
            "$lookup": {
                "from": "activities",
                "let": {"contactId": "$_id", "reactivatedAt": "$reactivatedAt"},
                "pipeline": [
                    {"$match": activity_match_expr()},
                    {"$sort": {"createdAt": -1}},
                    {
                        "$group": {
                            "_id": "$contact",
                            "lastActivityAt": {"$first": "$createdAt"},
                            "activitiesCount": {"$sum": 1},
                        }
                    },
                ],
                "as": "activityStats",
            }
        },
        {"$addFields": {"activityStats": {"$arrayElemAt": ["$activityStats", 0]}}},
        {
            "$addFields": {
                "lastActivityAt": "$activityStats.lastActivityAt",
                "activitiesCount": {"$ifNull": ["$activityStats.activitiesCount", 0]},
            }
        },
        {
            "$addFields": {
                "effectiveLastTouch": {
                    "$ifNull": ["$lastActivityAt", "$createdAt"]
                }
            }
        },
        {"$match": {"effectiveLastTouch": {"$lt": cutoff}}},
        {
            "$lookup": {
                "from": "users",
                "localField": "owner",
                "foreignField": "_id",
                "as": "ownerUser",
            }
        },
        {
            "$addFields": {
                "ownerEmail": {"$arrayElemAt": ["$ownerUser.email", 0]},
                "isUnassigned": {"$eq": ["$owner", None]},
            }
        },
        {
            "$sort": {
                "isUnassigned": -1 if owner_priority_unassigned else 1,
                "effectiveLastTouch": 1,
                "createdAt": 1,
            }
        },
    ]
    return pipeline, cutoff


def main():
    execute = "--execute" in sys.argv
    client = MongoClient(load_mongodb_uri())
    # Atlas URI senza path → dati CRM in db "test"
    db = client["test"]

    sonia = db.users.find_one({"email": SONIA_EMAIL})
    if not sonia:
        print(f"❌ Utente {SONIA_EMAIL} non trovato")
        sys.exit(1)

    sonia_id = sonia["_id"]
    pipeline, cutoff = build_pipeline()

    # Count total eligible
    count_pipeline = pipeline + [{"$count": "total"}]
    total = list(db.contacts.aggregate(count_pipeline))
    total_eligible = total[0]["total"] if total else 0

    # Breakdown by source
    by_source = list(
        db.contacts.aggregate(pipeline + [{"$group": {"_id": "$source", "n": {"$sum": 1}}}])
    )

    # Breakdown by owner (top 10)
    by_owner = list(
        db.contacts.aggregate(
            pipeline
            + [
                {
                    "$group": {
                        "_id": {"$ifNull": ["$ownerEmail", "unassigned"]},
                        "n": {"$sum": 1},
                    }
                },
                {"$sort": {"n": -1}},
                {"$limit": 10},
            ]
        )
    )

    # Sample preview
    preview = list(
        db.contacts.aggregate(
            pipeline
            + [
                {"$limit": LIMIT},
                {
                    "$project": {
                        "name": 1,
                        "email": 1,
                        "source": 1,
                        "status": 1,
                        "ownerEmail": 1,
                        "activitiesCount": 1,
                        "effectiveLastTouch": 1,
                    }
                },
            ]
        )
    )

    print("=" * 60)
    print("ANALISI LEAD STALE (rank checker + smartlead, 90+ giorni)")
    print("=" * 60)
    print(f"Cutoff attività: {cutoff.isoformat()} ({STALE_DAYS} giorni fa)")
    print(f"Lead idonei totali: {total_eligible}")
    print("\nPer source:")
    for row in by_source:
        print(f"  - {row['_id']}: {row['n']}")
    print("\nPer owner (top 10):")
    for row in by_owner:
        print(f"  - {row['_id']}: {row['n']}")

    print(f"\nPreview primi {len(preview)} candidati (ordine: unassigned first, più vecchi first):")
    for i, c in enumerate(preview, 1):
        touch = c.get("effectiveLastTouch")
        touch_s = touch.strftime("%Y-%m-%d") if touch else "?"
        print(
            f"  {i:2}. {c.get('name','?')[:40]:40} | {c.get('source','?'):22} | "
            f"{c.get('status','?'):18} | owner={c.get('ownerEmail') or '—':28} | "
            f"acts={c.get('activitiesCount',0)} | last={touch_s}"
        )

    if not execute:
        print("\n⚠️  DRY-RUN: nessuna modifica. Usa --execute per assegnare.")
        return

    if not preview:
        print("\n❌ Nessun lead da assegnare")
        return

    ids = [c["_id"] for c in preview]
    now = datetime.now(timezone.utc)

    result = db.contacts.update_many(
        {"_id": {"$in": ids}},
        {"$set": {"owner": sonia_id, "lastModifiedBy": sonia_id, "updatedAt": now}},
    )

    print(f"\n✅ Assegnati {result.modified_count} lead a {SONIA_EMAIL}")
    print(f"   ID Sonia: {sonia_id}")

    # Verify
    verify = db.contacts.count_documents({"owner": sonia_id})
    print(f"   Totale lead di Sonia ora: {verify}")


if __name__ == "__main__":
    main()
