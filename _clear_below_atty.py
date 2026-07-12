"""Clear ALL fields below the attorney row on page 2 of Pelzer_ROS_v2.pdf."""
import os
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, BooleanObject

SRC = r'C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\ROS\Pelzer_ROS_v2.pdf'
OUT = r'C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\ROS\Pelzer_ROS_v3.pdf'

# Every form field below the Attorney row — wipe them all.
to_clear = {
    'Date 2':      '',  # officer date
    'server name': '',  # Sheriff/Police Officer name
    'Notary date': '',  # subscribed and sworn date
    'Blank HI':    '',  # IN ___, HAWAI'I
    'Expire date': '',  # commission expiration
}

reader = PdfReader(SRC)
writer = PdfWriter(clone_from=reader)

if '/AcroForm' in writer._root_object:
    writer._root_object['/AcroForm'][NameObject('/NeedAppearances')] = BooleanObject(True)

for page in writer.pages:
    writer.update_page_form_field_values(page, to_clear, auto_regenerate=True)

# Try writing in place; fall back to versioned filename if locked.
target = SRC
try:
    with open(target, 'wb') as f:
        writer.write(f)
except PermissionError:
    target = OUT
    with open(target, 'wb') as f:
        writer.write(f)

print('Wrote:', target)

v = PdfReader(target).get_fields() or {}
print('Officer/notary fields:')
for k in to_clear:
    print(f'  {k!r:15s} = {v.get(k, {}).get("/V", "<missing>")!r}')
