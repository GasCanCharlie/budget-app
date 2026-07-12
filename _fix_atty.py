"""Fix the attorney bar IDs on Pelzer_ROS.pdf."""
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, BooleanObject

SRC = r'C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\ROS\Pelzer_ROS.pdf'
PATH = r'C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\ROS\Pelzer_ROS_v2.pdf'

updates = {
    'Atty name address': (
        'Anne E. Lopez 7609, Julie H. China 6256, '
        'Danica L. Patel 10678, Alyssa-Marie Y. Kau 11135\r'
        'Deputy Attorneys General, Dept. of the Attorney General, State of Hawaii\r'
        '465 S. King St., Ste 300, Honolulu, HI 96813  -  (808) 587-2992'
    ),
}

reader = PdfReader(SRC)
writer = PdfWriter(clone_from=reader)

if '/AcroForm' in writer._root_object:
    writer._root_object['/AcroForm'][NameObject('/NeedAppearances')] = BooleanObject(True)

for page in writer.pages:
    writer.update_page_form_field_values(page, updates, auto_regenerate=True)

with open(PATH, 'wb') as f:
    writer.write(f)

# Verify
v = PdfReader(PATH).get_fields() or {}
print('Atty block:')
print(' ', v.get('Atty name address', {}).get('/V', '<missing>'))
print('Officer field still =', repr(v.get('server name', {}).get('/V', '')))
