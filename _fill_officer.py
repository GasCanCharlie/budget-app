"""Add officer Date + name to Pelzer_ROS_v2.pdf — leave everything else."""
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, BooleanObject

PATH = r'C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\ROS\Pelzer_ROS_v2.pdf'

updates = {
    'Date 2':      'May 20, 2026',
    'server name': 'Chad T. Hamman, Process Server',
}

reader = PdfReader(PATH)
writer = PdfWriter(clone_from=reader)

if '/AcroForm' in writer._root_object:
    writer._root_object['/AcroForm'][NameObject('/NeedAppearances')] = BooleanObject(True)

for page in writer.pages:
    writer.update_page_form_field_values(page, updates, auto_regenerate=True)

target = PATH
try:
    with open(target, 'wb') as f:
        writer.write(f)
except PermissionError:
    target = PATH.replace('_v2', '_v3')
    with open(target, 'wb') as f:
        writer.write(f)

print('Wrote:', target)
v = PdfReader(target).get_fields() or {}
for k in ['Date 2', 'server name', 'Notary date', 'Blank HI', 'Expire date']:
    print(f'  {k!r:15s} = {v.get(k, {}).get("/V", "<missing>")!r}')
