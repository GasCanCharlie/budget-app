"""
Chops Handy Works LLC ROS — both docs served 5/22/2026
  1. Order Regarding Interim Site Protection
  2. Answer and Cross-Claim (long title spans lines 2-5)
304 Front Street, Lahaina HI 96761 — Brendan Charles Pelzer, Registered Agent
"""
import os
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, BooleanObject
import fitz

CASE = {
    'case_number': '2CCV-26-0000069',
    'case_name': (
        "ʻOHANA KIMOKEO, Plaintiff, vs. STATE OF HAWAIʻI; "
        "BRIAN ACASON, et al., Defendants."
    ),
    'party_served':  "CHOP'S HANDY WORKS LLC",
    'service_date':  '5/22/2026',
    'service_time':  '9:45 AM',
    'address_line1': '304 Front Street',
    'address_line2': 'Lahaina, HI 96761',
    'manner':        'business',
    'business_name': "CHOP'S HANDY WORKS LLC",
    'person_served': 'Brendan Charles Pelzer',
    'position':      'Registered Agent',
    'attorney_block': (
        "Anne E. Lopez #7609, Julie H. China #6256, Danica L. Patel #10678, Alyssa-Marie Y. Kau #11135\r"
        "Deputy Attorneys General, Dept. of the Attorney General, State of Hawai'i\r"
        "465 South King Street, Suite 300, Honolulu, HI 96813  -  Telephone: (808) 587-2992"
    ),
    'output_folder': r'C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\ROS\Cases\2CCV-26-0000069_OhanaKimokeo\Chops_2CCV-26-0000069',
    'output_name':   'Chops_ROS2_FINAL.pdf',
    'ack_header_y':  None,
}

# Doc lines drawn manually at underline y-coords (6 rows available: 306.1-366.6).
# 3 numbered documents; Answer and Cross-Claim listed separately for maximum clarity.
DOC_LINES = [
    (165, "1. Order Regarding Interim Site Protection (Dkt. 45)"),
    (46,  "2. State of Hawai'i's Answer to Complaint"),
    (46,  "3. State of Hawai'i's Cross-Claim Against Acason, Pelzer, and Chop's Handy Works LLC"),
]

BASE  = r'C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\ROS\_Tools'
BLANK = os.path.join(BASE, '_Templates', '2nd_Circuit_Blank_RG-AC-508.pdf')

def sanitize(s):
    return (s.replace('ʻ', "'").replace('’', "'").replace('‘', "'")
             .replace('“', '"').replace('”', '"')
             .replace('–', '-').replace('—', '-')
             .replace(' ', ' '))

MANNER_MAP = {
    'personal':     ('Check1', {'person': 'manner_name'}),
    'substitute_a': ('Check2', {'cohabitant': 'manner_name'}),
    'substitute_b': ('Check3', {'substitute': 'manner_name'}),
    'business':     ('Check4', {
        'business_or_corp': 'business_name',
        'service_proxy':    'person_served',
        'title':            'position',
    }),
    'garnishment':  ('Check5', {
        'name_of_garnishee':     'garnishee_name',
        'name_for_garn_proxy_1': 'person_served',
    }),
    'not_found':    ('Check6', {'name_of_party_2': 'manner_name'}),
}

def main():
    os.makedirs(CASE['output_folder'], exist_ok=True)
    tmp = os.path.join(CASE['output_folder'], '_pre_flatten.pdf')
    out = os.path.join(CASE['output_folder'], CASE['output_name'])

    updates = {
        'Circuit':           'SECOND',
        'Case number':       sanitize(CASE['case_number']),
        'Case name':         '',
        'First Document':    '',
        'Rest Document':     '',
        'Name of party':     sanitize(CASE['party_served']),
        'First date':        CASE['service_date'],
        'Time':              CASE['service_time'],
        'Address 1':         sanitize(CASE['address_line1']),
        'Address 2':         sanitize(CASE['address_line2']),
        'Atty name address': sanitize(CASE['attorney_block']),
        'Date 2':            '',
        'Notary date':       '',
        'Blank HI':          '',
        'Expire date':       '',
        'server name':       'Chad T. Hamman, Process Server',
    }

    check_field, field_map = MANNER_MAP[CASE['manner']]
    updates[check_field] = '/On'
    for form_field, case_key in field_map.items():
        updates[form_field] = sanitize(CASE[case_key])

    reader = PdfReader(BLANK)
    writer = PdfWriter(clone_from=reader)
    if '/AcroForm' in writer._root_object:
        writer._root_object['/AcroForm'][NameObject('/NeedAppearances')] = BooleanObject(True)
    for page in writer.pages:
        writer.update_page_form_field_values(page, updates, auto_regenerate=True)
    with open(tmp, 'wb') as f:
        writer.write(f)

    doc = fitz.open(tmp)
    doc.bake(annots=False, widgets=True)
    for page in doc:
        for annot in list(page.annots()):
            if annot.type[0] == 19:
                page.delete_annot(annot)

    FORM_BORDER_COLOR = (0.132, 0.119, 0.123)
    for drawing in doc[0].get_drawings():
        fill = drawing.get('fill')
        if fill and len(fill) == 3 and fill[0] > 0.9 and fill[1] > 0.9 and fill[2] < 0.2:
            r = drawing['rect']
            doc[0].draw_rect(fitz.Rect(r.x0 - 3, r.y0 - 3, r.x1 + 3, r.y1 + 3),
                             color=(1, 1, 1), fill=(1, 1, 1), width=0)
    for r in doc[0].search_for("Reset"):
        doc[0].draw_rect(fitz.Rect(r.x0 - 8, r.y0 - 8, r.x1 + 8, r.y1 + 8),
                         color=(1, 1, 1), fill=(1, 1, 1), width=0)
    doc[0].draw_line(fitz.Point(22.5, 773.0), fitz.Point(589.5, 773.0),
                     color=FORM_BORDER_COLOR, width=2.0)

    case_name_rects = [
        (fitz.Rect(40, 181, 422, 285),  10, 'helv'),
        (fitz.Rect(36, 184, 419, 288),  12, 'hebo'),
    ]
    for page_idx, (rect, fs, font) in enumerate(case_name_rects):
        doc[page_idx].insert_textbox(rect, sanitize(CASE['case_name']),
                                     fontname=font, fontsize=fs,
                                     align=fitz.TEXT_ALIGN_LEFT)

    underlines_y = [306.1, 318.6, 330.6, 342.6, 354.6, 366.6]
    page1 = doc[0]
    for i, (x, txt) in enumerate(DOC_LINES):
        y = underlines_y[i] - 1.5
        page1.insert_text((x, y), sanitize(txt), fontname='helv', fontsize=10, color=(0, 0, 0))

    if CASE['manner'] == 'business':
        font_obj = fitz.Font('helv')
        bname = sanitize(CASE['business_name'])
        if font_obj.text_length(bname, fontsize=10) > 220:
            hits = doc[0].search_for(bname[:20])
            if not hits:
                hits = [fitz.Rect(349, 579, 582, 596)]
            doc[0].draw_rect(fitz.Rect(349, 579, 582, 612),
                             color=(1, 1, 1), fill=(1, 1, 1), width=0)
            words = bname.split()
            line1, line2 = '', ''
            for w in words:
                candidate = (line1 + ' ' + w).strip()
                if font_obj.text_length(candidate, fontsize=10) <= 220:
                    line1 = candidate
                else:
                    line2 = (line2 + ' ' + w).strip()
            doc[0].insert_text((355, 591), line1, fontname='helv', fontsize=10, color=(0, 0, 0))
            if line2:
                doc[0].insert_text((355, 605), line2, fontname='helv', fontsize=9, color=(0, 0, 0))

    page2 = doc[1]
    officer_hits = page2.search_for("Chad T. Hamman, Process Server")
    for r in officer_hits:
        if 360 < r.y0 < 410:
            page2.add_redact_annot(fitz.Rect(r.x0 - 6, r.y0 - 2, r.x1 + 6, r.y1 + 2),
                                   fill=(1, 1, 1))
            page2.apply_redactions()
            page2.insert_text((r.x0, r.y1 + 6), "Chad T. Hamman, Process Server",
                              fontname='helv', fontsize=10, color=(0, 0, 0))

    ack_y = CASE.get('ack_header_y')
    if ack_y is not None:
        page2 = doc[1]
        for r in page2.search_for("ACKNOWLEDGMENT OF SERVICE"):
            if 480 < r.y0 < 560:
                page2.add_redact_annot(fitz.Rect(r.x0 - 5, r.y0 - 4, r.x1 + 5, r.y1 + 8),
                                       fill=(1, 1, 1))
        page2.apply_redactions()
        page2.insert_text((213.1, ack_y), "ACKNOWLEDGMENT OF SERVICE",
                          fontname='tibo', fontsize=11, color=(0, 0, 0))
        page2.draw_line(fitz.Point(213.1, ack_y + 4.55), fitz.Point(397.9, ack_y + 4.55),
                        color=(0, 0, 0), width=0.5)

    doc.save(out, garbage=4, deflate=True)
    doc.close()
    os.remove(tmp)
    print('Wrote (flat, non-editable):', out)

    doc = fitz.open(out)
    for i, page in enumerate(doc, 1):
        pix = page.get_pixmap(dpi=200)
        jpg = out.replace('.pdf', f'_Page_{i}.jpg')
        pix.save(jpg, jpg_quality=92)
        print('  preview:', jpg)
    doc.close()

if __name__ == '__main__':
    main()
