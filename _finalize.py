"""Final Pelzer ROS v10:
 - Docs served drawn at exact underline baselines for clean alignment
 - 3-line attorney block, correct bar IDs
 - Officer name = 'Chad T. Hamman, Process Server', no officer date
 - All notary + acknowledgment fields blank
 - Acknowledgment header stays in moved-down position
 - Flattened, non-editable
"""
import os
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, BooleanObject
import fitz

BASE = r'C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\ROS'
SRC  = os.path.join(BASE, 'Pelzer_ROS_v3.pdf')
TMP  = os.path.join(BASE, '_v10_pre_flatten.pdf')
OUT  = os.path.join(BASE, 'Pelzer_ROS_v10.pdf')

# ---- 1. Fill form fields (docs fields left BLANK — drawn manually after bake) ----
updates = {
    'First Document': '',
    'Rest Document':  '',
    'Date 2':         '',
    'Atty name address': (
        "Anne E. Lopez 7609, Julie H. China 6256, Danica L. Patel 10678, Alyssa-Marie Y. Kau 11135\r"
        "Deputy Attorneys General, Department of the Attorney General, State of Hawai'i\r"
        "465 South King St., Ste 300, Honolulu, Hawai'i 96813  -  Telephone: (808) 587-2992"
    ),
}
reader = PdfReader(SRC)
writer = PdfWriter(clone_from=reader)
if '/AcroForm' in writer._root_object:
    writer._root_object['/AcroForm'][NameObject('/NeedAppearances')] = BooleanObject(True)
for page in writer.pages:
    writer.update_page_form_field_values(page, updates, auto_regenerate=True)
with open(TMP, 'wb') as f:
    writer.write(f)

# ---- 2. Bake form fields into static page content ----
doc = fitz.open(TMP)
doc.bake(annots=False, widgets=True)

# ---- 3. Draw the 4 doc lines on page 1 at exact underline baselines ----
# Underlines in pymupdf top-down y: 306.1, 318.6, 330.6, 342.6, 354.6, 366.6 (12pt apart)
# Baseline sits 1pt above the underline so descenders just touch it.
docs = [
    (165, 306.1 - 1.5, "1. Defendant State of Hawai'i's Answer to Plaintiff 'Ohana Kimokeo's Complaint"),
    ( 46, 318.6 - 1.5, "2. Defendant State of Hawai'i's Cross-Claim Against Brendan Charles Pelzer, et al."),
    ( 46, 330.6 - 1.5, "3. Pelzer Summons"),
    ( 46, 342.6 - 1.5, "4. Order Regarding Interim Site Protection"),
]
page1 = doc[0]
for x, y, txt in docs:
    page1.insert_text((x, y), txt, fontname='helv', fontsize=10, color=(0, 0, 0))

doc.save(OUT, garbage=4, deflate=True)
doc.close()
os.remove(TMP)
print('Wrote (flat, non-editable):', OUT)
