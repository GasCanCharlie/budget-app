import fitz, os, tempfile
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, BooleanObject

BASE  = r"C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\ROS\_Tools"
BLANK = os.path.join(BASE, "_Templates", "2nd_Circuit_Blank_RG-AC-508.pdf")

reader = PdfReader(BLANK)
writer = PdfWriter(clone_from=reader)
if "/AcroForm" in writer._root_object:
    writer._root_object["/AcroForm"][NameObject("/NeedAppearances")] = BooleanObject(True)
tmp = tempfile.mktemp(suffix=".pdf")
with open(tmp, "wb") as f:
    writer.write(f)

doc = fitz.open(tmp)
doc.bake(annots=False, widgets=True)
page2 = doc[1]

print("=== Text on page 2 (y > 480) ===")
for b in page2.get_text("blocks"):
    x0, y0, x1, y1, text, bno, btype = b
    if y0 > 480:
        print("  y0=%.1f  text=%r" % (y0, text[:70]))

print()
print("=== Lines/rects on page 2 (y > 480) ===")
for d in page2.get_drawings():
    r = d.get("rect")
    if r and r.y0 > 480:
        w = d.get("width", 0)
        print("  y0=%.1f y1=%.1f w=%.1f  x0=%.1f x1=%.1f" % (r.y0, r.y1, w, r.x0, r.x1))

doc.close()
os.remove(tmp)
