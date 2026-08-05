import asyncio
import sys
import json
import re
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright
from playwright_stealth import Stealth

# Enforce UTF-8 stdout to prevent UnicodeEncodeError on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

async def scrape_chordify(query):
    result_data = {"success": False, "error": None, "data": None}
    
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=False,
                args=[
                    '--window-position=-32000,-32000',
                    '--disable-blink-features=AutomationControlled'
                ]
            )
            
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            page = await context.new_page()
            
            # Apply stealth
            stealth = Stealth()
            await stealth.apply_stealth_async(page)
            
            # Search directly on Chordify
            search_url = f"https://chordify.net/search/{query.replace(' ', '%20')}"
            await page.goto(search_url, wait_until='domcontentloaded')
            
            # Wait for search results
            try:
                await page.wait_for_selector('a[href^="/chords/"]', timeout=10000)
            except Exception:
                pass
                
            # Find the first chordify link
            html = await page.content()
            soup = BeautifulSoup(html, 'html.parser')
            links = soup.find_all('a', href=re.compile(r'^/chords/'))
            
            chordify_url = None
            for link in links:
                href = link.get('href', '')
                if '/chords/' in href:
                    chordify_url = href
                    break
            
            if not chordify_url:
                result_data["error"] = "Could not find chordify link in search results."
                print(json.dumps(result_data))
                await browser.close()
                return

            # Ensure it's absolute for fallback
            chordify_url = 'https://chordify.net' + href
            
            # Navigate to the Chordify page naturally by clicking
            try:
                # Find the element and click it
                link_element = await page.query_selector(f'a[href="{href}"]')
                if link_element:
                    await link_element.click()
                else:
                    await page.goto(chordify_url, wait_until='domcontentloaded', timeout=60000)
            except Exception:
                await page.goto(chordify_url, wait_until='domcontentloaded', timeout=60000)
            
            try:
                await page.wait_for_selector('div.chord', timeout=15000)
            except Exception:
                await page.wait_for_timeout(5000) # Fallback wait
            
            page_html = await page.content()
            page_soup = BeautifulSoup(page_html, 'html.parser')
            
            # Get BPM
            bpm = 83 # Default fallback
            bpm_match = re.search(r'"derivedBpm":\s*(\d+)', page_html)
            if bpm_match:
                bpm = int(bpm_match.group(1))
                
            seconds_per_beat = 60.0 / bpm
            
            # Extract Chords
            chord_elements = page_soup.find_all('div', class_=re.compile(r'\bchord\b'))
            main_container = page_soup.find('div', class_=re.compile(r'chords-scroll'))
            
            if main_container:
                chord_elements = main_container.find_all('div', class_=re.compile(r'(?<!\w)chord(?!\w)'))
                
            if not chord_elements:
                result_data["error"] = "Could not find chord containers on the page."
                print(json.dumps(result_data))
                await browser.close()
                return
                
            chord_changes = []
            
            for i, el in enumerate(chord_elements):
                label = el.find('span', class_='chord-label')
                chord_text = ""
                if label:
                    chord_text = label.get_text(strip=True)
                else:
                    chord_text = el.get_text(strip=True)
                    
                if not chord_text:
                    chord_text = "N.C."
                    
                if 'nolabel' in el.get('class', []):
                    pass # Continuation of the previous chord
                else:
                    time_sec = i * seconds_per_beat
                    chord_changes.append({
                        "beat": i + 1,
                        "time_sec": round(time_sec, 2),
                        "chord": chord_text
                    })
                    
            result_data["success"] = True
            result_data["data"] = {
                "bpm": bpm,
                "url": chordify_url,
                "chords": chord_changes
            }
            
            print(json.dumps(result_data))
            await browser.close()
            
    except Exception as e:
        result_data["error"] = str(e)
        print(json.dumps(result_data))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        query = sys.argv[1]
        asyncio.run(scrape_chordify(query))
    else:
        print(json.dumps({"success": False, "error": "No query provided"}))
