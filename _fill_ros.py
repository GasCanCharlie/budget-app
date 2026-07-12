"""Update the user's reference ROS PDF:
  - Page 1 service date/time fixed to 5/20/2026 @ 1:00 PM (was 5/19 @ 3:15)
  - Page 2: blank all AcroForm fields below the attorney row
  - Preserve the user's manual layout edits (Acknowledgment header moved down,
    date/time overlay at the bottom).
"""
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, BooleanObject

SRC = r'C:\Users\dachn\budget-app\_user_ref.pdf'
OUT = r'C:\Users\dachn\budget-app\ROS_Pelzer_2CCV-26-0000069.pdf'

# Page-1 corrections only (preserves all other prior fills).
updates = {
    'First date': '5/20/2026',
    'Time':       '1:00 PM',

    # Blank everything below the Attorney row on page 2.
    'Date 2':      '',
    'server name': '',
    'Notary date': '',
    'Blank HI':    '',
    'Expire date': '',
}

reader = PdfReader(SRC)
writer = PdfWriter(clone_from=reader)

if '/AcroForm' in writer._root_object:
    writer._root_object['/AcroForm'][NameObject('/NeedAppearances')] = BooleanObject(True)

for page in writer.pages:
    writer.update_page_form_field_values(page, updates, auto_regenerate=True)

with open(OUT, 'wb') as f:
    writer.write(f)

print('Wrote:', OUT)

# Verify
verify = PdfReader(OUT)
fields = verify.get_fields() or {}
for k in updates:
    print(f'  {k!r:15s} = {fields.get(k, {}).get("/V", "<missing>")!r}')
