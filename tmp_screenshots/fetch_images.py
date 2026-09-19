import sys
import os
import re
import time
import json
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')

from playwright.sync_api import sync_playwright

tmp_dir = r"C:\Users\BAPS\Documents\space\management\tmp_screenshots"
os.makedirs(tmp_dir, exist_ok=True)

images = [
    {"n": 1,  "id": "63596770", "key": "3a434d4c18e7d0cfa825035cddf9dffe",  "complaint": "All screens Common Button Styling: Height 42px and Padding-Left: 20px, Padding-right: 20px"},
    {"n": 2,  "id": "63616341", "key": "ec132bc456c99a339c9b1fcd00dab88e",  "complaint": "Limit 10 india okay but Australia: Up to 15 digits, Germany: Up to 13 digits or 15 total, Austria: Up to 13 digits, Sweden: Up to 13 digits"},
    {"n": 3,  "id": "63616654", "key": "f1e9c66282af179ac98b8594e3a10103",  "complaint": "if No GST Applicable (Not showing GST all system)"},
    {"n": 4,  "id": "63616644", "key": "d749988f95947d8cc4bbc74636b4bc78",  "complaint": "Notices we are reload page then system show please check"},
    {"n": 5,  "id": "63616725", "key": "b4d544d39d13301ac88053699de137c7",  "complaint": "Rooms select is wrong as per our discussion"},
    {"n": 6,  "id": "63616904", "key": "c0ffbc8b72714125ba41a538a11e9e4f",  "complaint": "Not Show Detail"},
    {"n": 7,  "id": "63616967", "key": "3422cf03c710c54a2e21901e12abfe7d",  "complaint": "First letter Capital and button height match"},
    {"n": 8,  "id": "63632151", "key": "d67cc0d4d29a70252272c984beaa127c",  "complaint": "Error: Aadhar Card number must be at most 12 characters"},
    {"n": 9,  "id": "63632718", "key": "f838bba5eab92a648b6549b123266a65",  "complaint": "Bottom Error: Aadhar Card number must be at most 12 characters"},
    {"n": 10, "id": "63634175", "key": "ebe16d6ae676d74da793e2233dbd0820",  "complaint": "Tool tip show"},
    {"n": 11, "id": "63634348", "key": "fe10726cd10dbfd47cb38e4ce5e4df2b",  "complaint": "I have update but not update detail Button height match background color, Common Cancel button BG: #d1d1d1"},
    {"n": 12, "id": "63635032", "key": "5a5f9f3eb76052125839b5ee695910fa",  "complaint": "P Capital in Price"},
    {"n": 13, "id": "63635916", "key": "b3c31c94054ff97bade26017d48fbe39",  "complaint": "Red Color and Noticed when I add room type show, Not reflect in room add we show without update"},
    {"n": 14, "id": "63639568", "key": "ca9bab03b34a93bdcab80810e96be8b2",  "complaint": "All Items Center"},
    {"n": 15, "id": "63639638", "key": "834fd668fde70099dcdf70c9737b19af",  "complaint": "Time missing in Cancelled / No-show"},
    {"n": 16, "id": "63639890", "key": "dbdc55d79f1b094bf14a2ecda2a2948c",  "complaint": "All model: Match styling cancel button, Reason Message Display in room list"},
    {"n": 17, "id": "63639929", "key": "b70a15713ea8873bd1088e4682d70e71",  "complaint": "Reason Message Display"},
    {"n": 18, "id": "63639989", "key": "b43fb2ccb7fb9ac141e461381676ef7d",  "complaint": "Increase fontsize close button"},
    {"n": 19, "id": "63640070", "key": "f476532bf8a89c666f597e916412cf16",  "complaint": "Cancel button styling and Capital first letter"},
    {"n": 20, "id": "63640240", "key": "9edcb0c136620ed7a565a18cb245f906",  "complaint": "Common changes for header and close button in the model"},
    {"n": 21, "id": "63651511", "key": "ea4ccff3768cb295f3f4a6c6f6c74df9",  "complaint": "Staff CSV export data not correct"},
    {"n": 22, "id": "63651695", "key": "f3ab7270ec6ece5562c36ab0fbd72de9",  "complaint": "Today's Attendance not export full detail"},
    {"n": 23, "id": "63654848", "key": "f03a41861dd5d1aeb49c003b0873fd9c",  "complaint": "Final invoice not proper"},
    {"n": 24, "id": "63655204", "key": "8663a6c8c014844bb1ed1ffbe0ec9646",  "complaint": "Missing the hotel detail in Print"},
    {"n": 25, "id": "63655360", "key": "84c6c96f0ade841d379783574775427d",  "complaint": "This is profile already added now we added foreign, Added Foreign guest (passport/visa details) but not show in here"},
    {"n": 26, "id": "63656055", "key": "c402cd50d6bac9098e2f7575474cbb77",  "complaint": "dot missing in admin notification"},
    {"n": 27, "id": "63657201", "key": "6bb3ba117f8d855d786af59e82760aa5",  "complaint": "Change the color same as checkout time discount why is here"},
]

results = []

def extract_s3_url(content):
    # Look for awesomescreenshot S3 URL
    match = re.search(r'https://awesomescreenshot\.s3\.amazonaws\.com/image/[^\s"\'<>]+\.png[^\s"\'<>]*', content)
    if match:
        return match.group(0)
    return None

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    
    for img in images:
        url = f"https://www.awesomescreenshot.com/image/{img['id']}?key={img['key']}"
        print(f"Fetching [{img['n']}] {img['id']}...", flush=True)
        
        try:
            page = context.new_page()
            
            # Track network requests for S3 image URLs
            s3_urls_found = []
            def on_response(response):
                if 'awesomescreenshot.s3' in response.url:
                    s3_urls_found.append(response.url)
            page.on("response", on_response)
            
            page.goto(url, wait_until="networkidle", timeout=30000)
            
            # Wait for the image to load
            try:
                page.wait_for_selector('img[src*="s3.amazonaws.com"]', timeout=15000)
            except:
                pass
            
            content = page.content()
            s3_url = extract_s3_url(content)
            
            if not s3_url and s3_urls_found:
                s3_url = s3_urls_found[0]
            
            page.close()
            
            if s3_url:
                print(f"  Found S3: {s3_url.split('?')[0]}", flush=True)
                # Download the image
                out_path = os.path.join(tmp_dir, f"img{img['n']}.png")
                if not os.path.exists(out_path) or os.path.getsize(out_path) < 1000:
                    try:
                        # Use clean base URL (strip query params for readability, but we need signed URL)
                        req = urllib.request.Request(s3_url, headers={"User-Agent": "Mozilla/5.0"})
                        with urllib.request.urlopen(req, timeout=15) as resp:
                            with open(out_path, 'wb') as f:
                                f.write(resp.read())
                        print(f"  Downloaded to img{img['n']}.png ({os.path.getsize(out_path)} bytes)", flush=True)
                    except Exception as e:
                        print(f"  Download error: {e}", flush=True)
                results.append({"n": img['n'], "id": img['id'], "s3_url": s3_url, "downloaded": os.path.exists(out_path)})
            else:
                print(f"  No S3 URL found", flush=True)
                results.append({"n": img['n'], "id": img['id'], "s3_url": None, "downloaded": False})
                
        except Exception as e:
            print(f"  Error: {e}", flush=True)
            results.append({"n": img['n'], "id": img['id'], "s3_url": None, "downloaded": False, "error": str(e)})
    
    browser.close()

# Save results
with open(os.path.join(tmp_dir, "results.json"), "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2)

print("\n=== SUMMARY ===", flush=True)
for r in results:
    status = "OK" if r.get("downloaded") else ("S3" if r.get("s3_url") else "FAIL")
    print(f"[{r['n']}] {status}: {r.get('s3_url', 'N/A')[:80] if r.get('s3_url') else 'no url'}", flush=True)
