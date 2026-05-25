import csv
import time
from playwright.sync_api import sync_playwright

def scrape_sebi():
    url = "https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=13"
    filename = "sebi_advisers.csv"
    
    print(f"Starting scraper for SEBI Investment Advisers...", flush=True)
    
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
            )
            context = browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36")
            page = context.new_page()
        except Exception as e:
            print(f"Failed to launch browser: {e}")
            print("Try running: playwright install chromium")
            return
        
        try:
            page.goto(url, wait_until="networkidle")
            
            with open(filename, 'w', newline='', encoding='utf-8') as f:
                fieldnames = [
                    "Name", "Registration No.", "E-mail", "Telephone", "Fax No.", 
                    "Address", "Contact Person", "Correspondence Address", "Validity"
                ]
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                
                page_num = 1
                total_records = 0
                
                while True:
                    print(f"Scraping page {page_num}...", flush=True)
                    
                    # Wait for record containers
                    page.wait_for_selector(".card-table-left", timeout=20000)
                    
                    record_containers = page.locator(".card-table-left").all()
                    print(f"Found {len(record_containers)} records on this page.", flush=True)
                    
                    for container in record_containers:
                        try:
                            record = {}
                            
                            # Map fields
                            fields_map = {
                                "Name": "Name",
                                "Registration No.": "Registration No.",
                                "E-mail": "E-mail",
                                "Telephone": "Telephone",
                                "Fax No.": "Fax No.",
                                "Address": "Address",
                                "Contact Person": "Contact Person",
                                "Correspondence Address": "Correspondence Address",
                                "Validity": "Validity"
                            }
                            
                            for csv_field, web_field in fields_map.items():
                                # Use exact text match for the title span to avoid "Address" matching "Correspondence Address"
                                locator = container.locator(f".card-view:has(.title span:text-is('{web_field}')) .value")
                                if locator.count() > 0:
                                    record[csv_field] = locator.first.inner_text(timeout=2000).strip()
                                else:
                                    record[csv_field] = ""
                            
                            if not record["Name"]:
                                continue
                                
                            writer.writerow(record)
                            total_records += 1
                        except Exception as e:
                            print(f"Error processing record: {e}", flush=True)
                            continue
                    
                    print(f"Total records scraped so far: {total_records}", flush=True)
                    
                    # Check for Next button - based on SEBI's custom pagination
                    next_button = page.locator('a[title="Next"]').first
                    if next_button.count() > 0 and next_button.is_visible():
                        print("Clicking Next...", flush=True)
                        # Get current record names to ensure we actually moved to a new page
                        first_record_before = record_containers[0].locator(".card-view:has(.title span:text-is('Name')) .value").first.inner_text() if record_containers else ""
                        
                        # Use a more reliable click
                        next_button.scroll_into_view_if_needed()
                        next_button.click()
                        
                        # Wait for the first record to change, indicating the page has refreshed
                        try:
                            # Wait for some indication of change
                            page.wait_for_function(
                                f"""(oldName) => {{
                                    const firstVal = document.querySelector('.card-table-left .value');
                                    return firstVal && firstVal.innerText !== oldName;
                                }}""",
                                first_record_before,
                                timeout=15000
                            )
                        except:
                            print("Page refresh wait timed out, continuing...", flush=True)
                            time.sleep(5)
                            
                        page_num += 1
                    else:
                        print("No more pages found or Next button disabled.", flush=True)
                        break
                        
            print(f"Scraping complete. Successfully saved {total_records} records to {filename}.", flush=True)
            
        except Exception as e:
            print(f"An error occurred: {e}", flush=True)
        finally:
            browser.close()

if __name__ == "__main__":
    scrape_sebi()
