const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  page.on('console', function(m) { console.log('CON:', m.type(), m.text().substring(0,120)); });

  // Step 1: upload page
  await page.goto('http://localhost:3000/upload', {waitUntil:'networkidle', timeout:15000});
  await page.screenshot({path:'C:/tmp/fp_1_upload.png', fullPage:true});
  var title = await page.title();
  console.log('S1 title:', title);
  var opts = await page.evaluate(function() {
    return Array.from(document.querySelectorAll('select option')).map(function(e){ return e.textContent; });
  });
  console.log('S1 templates:', opts.join(' | '));

  // Step 2: upload PDF
  var inputs = await page.$$('input[type=file]');
  console.log('S2 file inputs:', inputs.length);
  if (inputs.length > 0) {
    await inputs[0].setInputFiles('C:/Users/dachn/Dropbox/My PC (DESKTOP-ACSQURB)/Desktop/HAMMAN LLC/Attorney Representation and ejectment notice ltr (w.exh and ros)_05-30-26_Doi_FINAL.pdf');
    await page.waitForTimeout(800);
    await page.screenshot({path:'C:/tmp/fp_2_file.png', fullPage:true});
    console.log('S2 file set');
  }

  // Step 3: select 2nd circuit template
  await page.selectOption('select', 'hawaii_ros_2nd_circuit');
  await page.waitForTimeout(400);
  await page.screenshot({path:'C:/tmp/fp_3_template.png', fullPage:true});
  console.log('S3 template selected');

  // Step 4: click submit button
  var btns = await page.$$('button');
  for (var i = 0; i < btns.length; i++) {
    var txt = await btns[i].innerText();
    console.log('S4 btn[' + i + ']:', txt);
  }
  await btns[0].click();
  await page.waitForTimeout(800);
  await page.screenshot({path:'C:/tmp/fp_4_processing.png', fullPage:true});
  console.log('S4 clicked, url:', page.url());

  // Wait for /review navigation
  try {
    await page.waitForURL('**/review/**', {timeout:90000});
    await page.waitForTimeout(3000);
    await page.screenshot({path:'C:/tmp/fp_5_review.png', fullPage:true});
    console.log('S5 url:', page.url());
    var body = await page.evaluate(function(){ return document.body.innerText; });
    console.log('S5 body:', body.substring(0,600));
  } catch(e) {
    await page.screenshot({path:'C:/tmp/fp_5_err.png', fullPage:true});
    var url = page.url();
    var body2 = await page.evaluate(function(){ return document.body.innerText; });
    console.log('S5 TIMEOUT at:', url);
    console.log('S5 body:', body2.substring(0,600));
  }

  await browser.close();
  console.log('DONE');
})();
