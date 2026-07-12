import { chromium } from 'playwright';
import { createReadStream } from 'fs';
import path from 'path';

const PDF_PATH = 'C:\\Users\\dachn\\Dropbox\\My PC (DESKTOP-ACSQURB)\\Desktop\\HAMMAN LLC\\Attorney Representation and ejectment notice ltr (w.exh and ros)_05-30-26_Doi_FINAL.pdf';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', m => console.log('CONSOLE:', m.type(), m.text()));

// Step 1: load upload page
await page.goto('http://localhost:3000/upload', { waitUntil: 'networkidle', timeout: 15000 });
await page.screenshot({ path: '/tmp/fp_1_upload.png', fullPage: true });
console.log('STEP1 title:', await page.title());
console.log('STEP1 url:', page.url());

// Check templates loaded
const templateOptions = await page.$$('select.fp-select option');
const optionTexts = await Promise.all(templateOptions.map(o => o.innerText()));
console.log('TEMPLATES:', optionTexts.join(' | '));

// Step 2: drop PDF into source docs zone
const sourceInput = await page.$('input[type=file]');
if (sourceInput) {
  await sourceInput.setInputFiles(PDF_PATH);
  console.log('FILE dropped via input');
} else {
  console.log('WARNING: no file input found');
}
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/fp_2_file_dropped.png', fullPage: true });

// Step 3: select 2nd circuit template
await page.selectOption('select.fp-select', 'hawaii_ros_2nd_circuit');
console.log('STEP3 selected template');
await page.screenshot({ path: '/tmp/fp_3_template_selected.png', fullPage: true });

// Step 4: click Extract & Fill
await page.click('button.fp-btn:not([disabled])');
console.log('STEP4 clicked Extract & Fill');

// Wait for progress and navigation (up to 60s for Claude extraction)
try {
  await page.waitForURL('**/review/**', { timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/fp_4_review.png', fullPage: true });
  console.log('STEP4 navigated to:', page.url());
} catch (e) {
  await page.screenshot({ path: '/tmp/fp_4_error.png', fullPage: true });
  console.log('STEP4 ERROR - still at:', page.url());
  const errEl = await page.$('[style*="rgba(239"]');
  if (errEl) console.log('ERROR TEXT:', await errEl.innerText());
}

// Step 5: check review page content
const fieldItems = await page.$$eval('[data-field-id], .field-row, [class*="field"]', els => els.length);
console.log('STEP5 field elements:', fieldItems);

const pageText = await page.textContent('body');
const hasGreen = pageText.includes('green') || pageText.includes('✓');
const hasRed = pageText.includes('red') || pageText.includes('Missing');
console.log('STEP5 has green/confirmed:', hasGreen, '| has red/missing:', hasRed);

await browser.close();
console.log('DONE');
