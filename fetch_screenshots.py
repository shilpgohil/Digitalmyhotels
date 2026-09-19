import os
import re
import time
import requests
from playwright.sync_api import sync_playwright

urls_data = [
    (1,  "https://www.awesomescreenshot.com/image/63596770?key=3a434d4c18e7d0cfa825035cddf9dffe", "All screens Common Button Styling: Height 42px, Padding-Left 20px, Padding-right 20px"),
    (2,  "https://www.awesomescreenshot.com/image/63616341?key=ec132bc456c99a339c9b1fcd00dab88e", "Limit 10 india okay but Australia: Up to 15 digits, Germany: Up to 13 digits or 15 total, Austria: Up to 13, Sweden: Up to 13"),
    (3,  "https://www.awesomescreenshot.com/image/63616654?key=f1e9c66282af179ac98b8594e3a10103", "if No GST Applicable (Not showing GST all system)"),
    (4,  "https://www.awesomescreenshot.com/image/63616644?key=d749988f95947d8cc4bbc74636b4bc78", "Notices we are reload page then system show please check"),
    (5,  "https://www.awesomescreenshot.com/image/63616725?key=b4d544d39d13301ac88053699de137c7", "Rooms select is wrong as per our discussion"),
    (6,  "https://www.awesomescreenshot.com/image/63616904?key=c0ffbc8b72714125ba41a538a11e9e4f", "Not Show Detail"),
    (7,  "https://www.awesomescreenshot.com/image/63616967?key=3422cf03c710c54a2e21901e12abfe7d", "First letter Capital and button height match"),
    (8,  "https://www.awesomescreenshot.com/image/63632151?key=d67cc0d4d29a70252272c984beaa127c", "Error: Aadhar Card number must be at most 12 characters"),
    (9,  "https://www.awesomescreenshot.com/image/63632718?key=f838bba5eab92a648b6549b123266a65", "Bottom Error: Aadhar Card number must be at most 12 characters"),
    (10, "https://www.awesomescreenshot.com/image/63634175?key=ebe16d6ae676d74da793e2233dbd0820", "Tool tip show"),
    (11, "https://www.awesomescreenshot.com/image/63634348?key=fe10726cd10dbfd47cb38e4ce5e4df2b", "I have update but not update detail Button height match background color, Common Cancel button BG: #d1d1d1"),
    (12, "https://www.awesomescreenshot.com/image/63635032?key=5a5f9f3eb76052125839b5    ee695910fa", "P Capital in Price"),
    (13, "https://www.awesomescreenshot.com/image/63635916?key=b3c31c94054ff97bade26017d48fbe39", "Red Color and Noticed when I add room type show, Not reflect in room add we show without update"),
    (14, "https://www.awesomescreenshot.com/image/63639568?key=ca9bab03b34a93bdcab80810e96be8b2", "All Items Center"),
    (15, "https://www.awesomescreenshot.com/image/63639638?key=834fd668fde70099dcdf70c9737b19af", "Time missing in Cancelled / No-show"),
    (16, "https://www.awesomescreenshot.com/image/63639890?key=dbdc55d79f1b094bf14a2ecda2a2948c", "All model: Match styling cancel button, Reason Message Display in room list"),
    (17, "https://www.awesomescreenshot.com/image/63639929?key=b70a15713ea8873bd1088e4682d70e71", "Reason Message Display"),
    (18, "https://www.awesomescreenshot.com/image/63639989?key=b43fb2ccb7fb9ac141e461381676ef7d", "Increase fontsize close button"),
    (19, "https://www.awesomescreenshot.com/image/63640070?key=f476532bf8a89c666f597e916412cf16", "Cancel button styling and Capital first letter"),
    (20, "https://www.awesomescreenshot.com/image/63640240?key=9edcb0c136620ed7a565a18cb245f906", "Common changes for header and close button in the model"),
    (21, "https://www.awesomescreenshot.com/image/63651511?key=ea4ccff3768cb295f3f4a6c6f6c74df9", "Staff CSV export data not correct"),
    (22, "https://www.awesomescreenshot.com/image/63651695?key=f3ab7270ec6ece5562c36ab0fbd72de9", "Today's Attendance not export full detail"),
    (23, "https://www.awesomescreenshot.com/image/63654848?key=f03a41861dd5d1aeb49c003b0873fd9c", "Final invoice not proper"),
    (24, "https://www.awesomescreenshot.com/image/63655204?key=8663a6c8c014844bb1ed1ffbe0ec9646", "Missing the hotel detail in Print"),
    (25, "https://www.awesomescreenshot.com/image/63655360?key=84c6c96f0ade841d379783574775427d", "Added Foreign guest but not show in here"),
    (26, "https://www.awesomescreenshot.com/image/63656055?key=c402cd50d6bac9098e2f7575474cbb77", "dot missing in admin notification"),
    (27, "https://www.awesomescreenshot.com/image/63657201?key=6bb3ba117f8d855d786ae7b3a4f3b4a9", "Change the color same as checkout time discount why is here"),
]

# Fix URL 12 - had spaces in key
urls_data[11] = (12, "https://www.awesomescreenshot.com/image/63635032?key=5a5f9f3eb76052125839b5ee695910fa", "P Capital in Price")
# Fix URL 27 - use the correct key from user input
urls_data[26] = (27, "https://www.awesomescreenshot.com/image/63657201?key=6bb3ba117f8d855d786af59e82760aa5", "Change the color same as checkout time discount why is here")

out_dir = "screenshots_fetched"
os.makedirs(out_dir, exist_ok=True)

results = {}

def get_s3_url_from_page(page, url):
    """Navigate to page and extract the S3 image URL"""
    try:
        page.goto(url, wait_until="networkidle", timeout=30000)
        time.sleep(2)
        
        # Try to find img tag with s3 URL
        s3_urls = page.evaluate("""
            () => {
                const imgs = document.querySelectorAll('img');
                const s3 = [];
                for (const img of imgs) {
                    if (img.src && img.src.includes('awesomescreenshot.s3')) {
                        s3.push(img.src);
                    }
                    if (img.src && img.src.includes('s3.amazonaws.com')) {
                        s3.push(img.src);
                    }
                }
                return s3;
            }
        """)
        
        if s3_urls:
            return s3_urls[0]
        
        # Try meta og:image
        og_image = page.evaluate("""
            () => {
                const meta = document.querySelector('meta[property="og:image"]');
                return meta ? meta.content : null;
            }
        """)
        if og_image and ('s3' in og_image or 'amazonaws' in og_image):
            return og_image
        
        # Try to find any image URL in page source
        content = page.content()
        # Look for awesomescreenshot s3 patterns
        patterns = [
            r'https://[^"\']+awesomescreenshot\.s3[^"\']+\.(png|jpg|jpeg|webp)',
            r'https://[^"\']+s3\.amazonaws\.com[^"\']+awesomescreenshot[^"\']+',
            r'https://[^"\']+s3[^"\']+awesomescreenshot[^"\']+\.(png|jpg|jpeg)',
        ]
        for pattern in patterns:
            matches = re.findall(pattern, content)
            if matches:
                if isinstance(matches[0], tuple):
                    # reconstruct from findall with groups
                    full = re.search(pattern, content)
                    if full:
                        return full.group(0)
                else:
                    return matches[0]
        
        # broader search
        all_imgs = re.findall(r'https://[^\s"\'<>]+\.(png|jpg|jpeg|webp)', content)
        for img_url_parts in all_imgs:
            pass
        
        full_img_matches = re.findall(r'(https://[^\s"\'<>]+\.(png|jpg|jpeg|webp))', content)
        for match in full_img_matches:
            if 'screenshot' in match[0].lower() or 's3' in match[0].lower():
                return match[0]
        
        return None
    except Exception as e:
        return f"ERROR: {e}"


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 1280, "height": 800},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    page = context.new_page()
    
    for num, url, description in urls_data:
        print(f"\n--- Processing {num}: {url} ---")
        s3_url = get_s3_url_from_page(page, url)
        print(f"  S3 URL: {s3_url}")
        
        img_path = None
        if s3_url and not s3_url.startswith("ERROR"):
            try:
                resp = requests.get(s3_url, timeout=30, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                })
                if resp.status_code == 200:
                    ext = s3_url.split('.')[-1].split('?')[0]
                    if ext not in ['png', 'jpg', 'jpeg', 'webp']:
                        ext = 'png'
                    img_path = os.path.join(out_dir, f"screenshot_{num:02d}.{ext}")
                    with open(img_path, 'wb') as f:
                        f.write(resp.content)
                    print(f"  Saved to: {img_path} ({len(resp.content)} bytes)")
                else:
                    print(f"  HTTP {resp.status_code} when downloading image")
            except Exception as e:
                print(f"  Download error: {e}")
        
        results[num] = {
            "url": url,
            "description": description,
            "s3_url": s3_url,
            "img_path": img_path
        }
    
    browser.close()

# Summary
print("\n\n=== RESULTS SUMMARY ===")
for num in sorted(results.keys()):
    r = results[num]
    status = "✓ Downloaded" if r['img_path'] else "✗ Failed"
    print(f"{num:2d}. {status}: {r['img_path'] or r['s3_url']}")
