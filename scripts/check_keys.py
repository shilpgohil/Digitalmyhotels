import json, sys
sys.stdout.reconfigure(encoding='utf-8')
with open(r'frontend/src/i18n/messages/en.json', 'r', encoding='utf-8') as f:
    en = json.load(f)
with open(r'frontend/src/i18n/messages/hi.json', 'r', encoding='utf-8') as f:
    hi = json.load(f)

def count_all(d):
    total = 0
    for k, v in d.items():
        if isinstance(v, dict):
            total += count_all(v)
        else:
            total += 1
    return total

en_c = count_all(en)
hi_c = count_all(hi)
print(f'en.json: {en_c} keys')
print(f'hi.json: {hi_c} keys')
parity = 'PASS' if en_c == hi_c else 'FAIL - MISMATCH'
print(f'Parity: {parity}')
