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
    {"n": 1,  "id": "63596770", "key": "3a434d4c18e7d0cfa825035cddf9dffe"},
    {"n": 2,  "id": "63616341", "key": "ec132bc456c99a339c9b1fcd00dab88e"},
    {"n": 3,  "id": "63616654", "key": "f1e9c66282af179ac98b8594e3a10103"},
    {"n": 4,  "id": "63616644", "key": "d749988f95947d8cc4bbc74636b4bc78"},
    {"n": 5,  "id": "63616725", "key": "b4d544d39d13301ac88053699de137c7"},
    {"n": 6,  "id": "63616904", "key": "c0ffbc8b72714125ba41a538a11e9e4f"},
    {"n": 7,  "id": "63616967", "key": "3422cf03c710c54a2e21901e12abfe7d"},
    {"n": 8,  "id": "63632151", "key": "d67cc0d4d29a70252272c984beaa127c"},
    {"n": 9,  "id": "63632718", "key": "f838bba5eab92a648b6549b123266a65"},
    {"n": 10, "id": "63634175", "key": "ebe16d6ae676d74da793e2233dbd0820"},
    {"n": 11, "id": "63634348", "key": "fe10726cd10dbfd47cb38e4ce5e4df2b"},
    {"n": 12, "id": "63635032", "key": "5a5f9f3eb76052125839b5ee695910fa"},
    {"n": 13, "id": "63635916", "key": "b3c31c94054ff97bade26017d48fbe39"},
    {"n": 14, "id": "63639568", "key": "ca9bab03b34a93bdcab80810e96be8b2"},
    {"n": 15, "id": "63639638", "key": "834fd668fde70099dcdf70c9737b19af"},
    {"n": 16, "id": "63639890", "key": "dbdc55d79f1b094bf14a2ecda2a2948c"},
    {"n": 17, "id": "63639929", "key": "b70a15713ea8873bd1088e4682d70e71"},
    {"n": 18, "id": "63639989", "key": "b43fb2ccb7fb9ac141e461381676ef7d"},
    {"n": 19, "id": "63640070", "key": "f476532bf8a89c666f597e916412cf16"},
    {"n": 20, "id": "63640240", "key": "9edcb0c136620ed7a565a18cb245f906"},
    {"n": 21, "id": "63651511", "key": "ea4ccff3768cb295f3f4a6c6f6c74df9"},
    {"n": 22, "id": "63651695", "key": "f3ab7270ec6ece5562c36ab0fbd72de9"},
    {"n": 23, "id": "63654848", "key": "f03a41861dd5d1aeb49c003b0873fd9c"},
    {"n": 24, "id": "63655204", "key": "8663a6c8c014844bb1ed1ffbe0ec9646"},
    {"n": 25, "id": "63655360", "key": "84c6c96f0ade841d379783574775427d"},
    {"n": 26, "id": "63656055", "key": "c402cd50d6bac9098e2f7575474cbb77"},
    {"n": 27, "id": "63657201", "key": "6bb3ba117f8d855d786af59e82760aa5"},
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    
    for img in images:
        out_path = os.path.join(tmp_dir, f"img{img['n']}.png")
        if os.path.exists(out_path) and os.path.getsize(out_path) > 10000:
            print(f"[{img['n']}] Already downloaded, skipping", flush=True)
            continue
            
        url = f"https://www.awesomescreenshot.com/image/{img['id']}?key={img['key']}"
        print(f"Fetching [{img['n']}] {img['id']}...", flush=True)
        
        try:
            page = context.new_page()
            
            # Intercept S3 image response and download its bytes directly
            signed_url = [None]
            img_bytes = [None]
            
            def on_response(response):
                if 'awesomescreenshot.s3' in response.url and '.png' in response.url:
                    signed_url[0] = response.url
                    try:
                        img_bytes[0] = response.body()
                        print(f"  Intercepted {len(img_bytes[0])} bytes from network", flush=True)
                    except Exception as e:
                        print(f"  Could not get body: {e}", flush=True)
            
            page.on("response", on_response)
            page.goto(url, wait_until="networkidle", timeout=30000)
            
            # Wait for image
            try:
                page.wait_for_selector('img[src*="s3.amazonaws.com"]', timeout=15000)
            except:
                pass
            time.sleep(1)
            
            page.close()
            
            if img_bytes[0] and len(img_bytes[0]) > 5000:
                with open(out_path, 'wb') as f:
                    f.write(img_bytes[0])
                print(f"  Saved {len(img_bytes[0])} bytes to img{img['n']}.png", flush=True)
            elif signed_url[0]:
                # Try downloading directly with signed URL
                print(f"  S3 URL: {signed_url[0][:80]}...", flush=True)
                req = urllib.request.Request(signed_url[0], headers={
                    "User-Agent": "Mozilla/5.0",
                    "Referer": "https://www.awesomescreenshot.com/"
                })
                with urllib.request.urlopen(req, timeout=20) as resp:
                    data = resp.read()
                with open(out_path, 'wb') as f:
                    f.write(data)
                print(f"  Downloaded {len(data)} bytes to img{img['n']}.png", flush=True)
            else:
                print(f"  No S3 image intercepted", flush=True)
                
        except Exception as e:
            print(f"  Error: {e}", flush=True)
    
    browser.close()

print("\n=== FINAL FILES ===", flush=True)
for img in images:
    p = os.path.join(tmp_dir, f"img{img['n']}.png")
    if os.path.exists(p):
        size = os.path.getsize(p)
        print(f"img{img['n']}.png - {size} bytes", flush=True)
    else:
        print(f"img{img['n']}.png - MISSING", flush=True)
