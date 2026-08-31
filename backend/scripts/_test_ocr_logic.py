"""Test the improved Aadhar address extraction logic."""
import re

sample_text = """
\u092d\u093e\u0930\u0924 \u0938\u0930\u0915\u093e\u0930
GOVERNMENT OF INDIA
Aadhaar
Cristiano Ronaldo
Male
Patna, Bihar, India
9876 5432 1098
\u0906\u092a\u0915\u093e \u0906\u0927\u093e\u0930 YOUR AADHAAR
"""

# Noise from a real OCR scan — garbled lines that the old parser was picking up
noisy_text = """
URE WER
GOVERNMENT OF INDIA
Aadhaar
Cristiano Ronaldo
Male
Patna, Bihar, India
9876 5432 1098
4 Ey = Aadhaar
"""

AADHAR = re.compile(r'\b\d{4}\s?\d{4}\s?\d{4}\b')
GENDER = re.compile(r'\b(Male|Female|MALE|FEMALE|M|F)\b')

for label, text in [("Clean OCR", sample_text), ("Noisy OCR", noisy_text)]:
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    aadhar_idx = next((i for i, l in enumerate(lines) if AADHAR.search(l)), -1)
    gender_idx = next((i for i, l in enumerate(lines) if GENDER.search(l)), -1)

    print(f"\n=== {label} ===")
    print(f"  Aadhar  line {aadhar_idx}: {lines[aadhar_idx] if aadhar_idx >= 0 else 'NOT FOUND'}")
    print(f"  Gender  line {gender_idx}: {lines[gender_idx] if gender_idx >= 0 else 'NOT FOUND'}")

    if gender_idx >= 0 and aadhar_idx > gender_idx + 1:
        addr_cands = []
        for l in lines[gender_idx + 1: aadhar_idx]:
            word_chars = len(re.sub(r'[^A-Za-z0-9,. ]', '', l))
            ratio = word_chars / len(l) if l else 0
            if (len(l) >= 3 and ratio >= 0.5
                    and not re.match(r'^(GOVERNMENT\s+OF\s+INDIA|YOUR\s+AADHAAR|AADHAAR)$', l, re.I)):
                addr_cands.append(l)
        result = ", ".join(addr_cands)
        print(f"  Address: {result!r}  {'✅ CORRECT' if 'Patna' in result else '❌ WRONG'}")
    else:
        print("  Address: (extraction conditions not met)")
