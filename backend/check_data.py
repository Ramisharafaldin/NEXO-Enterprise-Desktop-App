import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import database as db

projs = db.list_projects()
print('Projects count:', len(projs))
for p in projs:
    ws = db.get_workspace(p['id'])
    items = ws.get('items', [])
    print(f"Project {p['id']} ({p.get('name')}): {len(items)} items")
    for item in items:
        periods = item.get('periods')
        if not periods:
            print(f"  MISSING PERIODS for item {item.get('code')}")
        else:
            for p_idx, per in enumerate(periods):
                if 'actual' not in per or 'date' not in per:
                    print(f"  MALFORMED period in {item.get('code')}: {per}")

print('Check completed successfully.')
