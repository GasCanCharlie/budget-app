"""
ROS filler — Preston Davis, 2CCV-26-0000165
Basin/eDG vs. Preston Davis and Erin Davis
Served: 5/25/2026, 2:30 PM, personal service
"""
import os
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, BooleanObject
import fitz

CASE = {
    'case_number': '2CCV-26-0000165',
    'case_name': (
        "KIRILL BASIN, individually, and eDESIGN GROUP INC., "
        "a Hawai'i Corporation, Plaintiffs, vs. "
        "PRESTON DAVIS and ERIN DAVIS, Defendants."
    ),
    'docs': [
        "Order Granting Ex Parte Motion for Temporary Restraining Order and Order to Show Cause",
        "Verified Complaint for Damages and Injunctive Relief",
        "Authorization of Corporate Plaintiff eDESIGN GROUP INC. to Maintain Action",
    ],
    'party_served':  'Preston Davis',
    'service_date':  '5/25/2026',
    'service_time':  '2:30 PM',
    'address_line1': '592 Haawina Street',
    'address_line2': 'Paia, HI 96779',
    'manner':        'personal',
    'manner_name':   'Preston Davis',
    'attorney_block': (
        "KIRILL BASIN\r"
        "Plaintiff Pro Se\r"
        "375 Huku Li'i Place, Suite 108, Kihei, HI 96753  -  Telephone: (973) 652-7088"
    ),
    'output_folder': r'C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\ROS\Cases\2CCV-26-0000165_BasinvDavis\Preston_2CCV-26-0000165',
    'output_name':   'Preston_ROS_FINAL.pdf',
    'ack_style':     'lower',      # 'standard' = original y≈520 | 'lower' = y=510
}

BASE  = r'C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\ROS\_Tools'
BLANK = os.path.join(BASE, '_Templates', '2nd_Circuit_Blank_RG-AC-508.pdf')

def sanitize(s):
    return (s.replace('ʻ', "'").replace('ʻ', "'")
             .replace('’', "'").replace('‘', "'")
             .replace('“', '"').replace('”', '"')
             .replace('–', '-').replace('—', '-')
             .replace(' ', ' '))

MANNER_MAP = {
    'personal':     ('Check1', {'person': 'manner_name'}),
    'substitute_a': ('Check2', {'cohabitant': 'manner_name'}),
    'substitute_b': ('Check3', {'substitute': 'manner_name'}),
    'business':     ('Check4', {'business_or_corp': 'business_name', 'service_proxy': 'person_served', 'title': 'position'}),
    'garnishment':  ('Check5', {'name_of_garnishee': 'garnishee_name', 'name_for_garn_proxy_1': 'person_served'}),
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
            doc[0].draw_rect(fitz.Rect(r.x0-3, r.y0-3, r.x1+3, r.y1+3), color=(1,1,1), fill=(1,1,1), width=0)
    for r in doc[0].search_for("Reset"):
        doc[0].draw_rect(fitz.Rect(r.x0-8, r.y0-8, r.x1+8, r.y1+8), color=(1,1,1), fill=(1,1,1), width=0)
    doc[0].draw_line(fitz.Point(22.5, 773.0), fitz.Point(589.5, 773.0), color=FORM_BORDER_COLOR, width=2.0)

    for page_idx, (rect, fs, font) in enumerate([
        (fitz.Rect(40, 181, 422, 285),  10, 'helv'),
        (fitz.Rect(36, 184, 419, 288),  12, 'hebo'),
    ]):
        doc[page_idx].insert_textbox(rect, sanitize(CASE['case_name']),
                                     fontname=font, fontsize=fs, align=fitz.TEXT_ALIGN_LEFT)

    underlines_y = [306.1, 318.6, 330.6, 342.6, 354.6]
    for i, txt in enumerate(CASE['docs']):
        x = 165 if i == 0 else 46
        doc[0].insert_text((x, underlines_y[i] - 1.5), sanitize(f'{i+1}. {txt}'),
                           fontname='helv', fontsize=10, color=(0,0,0))

    page2 = doc[1]
    for r in page2.search_for("Chad T. Hamman, Process Server"):
        if 360 < r.y0 < 410:
            page2.add_redact_annot(fitz.Rect(r.x0-6, r.y0-2, r.x1+6, r.y1+2), fill=(1,1,1))
            page2.apply_redactions()
            page2.insert_text((r.x0, r.y1+6), "Chad T. Hamman, Process Server",
                              fontname='helv', fontsize=10, color=(0,0,0))

    if CASE.get('ack_style', 'standard') == 'lower':
        FORM_COLOR = (0.132, 0.119, 0.123)
        # Redact old borders and content first, then draw new
        page2.add_redact_annot(fitz.Rect(20, 489, 592, 498), fill=(1,1,1))   # old notary bottom borders
        for r in page2.search_for("ACKNOWLEDGMENT OF SERVICE"):
            if 490 < r.y0 < 560:
                page2.add_redact_annot(fitz.Rect(r.x0-5, r.y0-4, r.x1+5, r.y1+10), fill=(1,1,1))
        page2.add_redact_annot(fitz.Rect(55, 550, 560, 598), fill=(1,1,1))   # sig line 1 + labels
        page2.add_redact_annot(fitz.Rect(55, 585, 560, 620), fill=(1,1,1))   # sig line 2
        page2.add_redact_annot(fitz.Rect(55, 622, 560, 656), fill=(1,1,1))   # sig line 3
        page2.apply_redactions()
        # Restore outer form box left/right borders in the redacted strip (y=489-498)
        page2.draw_line(fitz.Point(23.5, 487.0), fitz.Point(23.5, 500.0), color=FORM_COLOR, width=2.0)
        page2.draw_line(fitz.Point(588.5, 487.0), fitz.Point(588.5, 500.0), color=FORM_COLOR, width=2.0)
        # Redraw full-length vertical column dividers — top to new bottom
        page2.draw_line(fitz.Point(216.0, 403.9), fitz.Point(216.0, 572.0), color=FORM_COLOR, width=1.0)
        page2.draw_line(fitz.Point(432.0, 403.9), fitz.Point(432.0, 572.0), color=FORM_COLOR, width=1.0)
        # New notary section bottom double border — within outer form box bounds
        page2.draw_line(fitz.Point(22.5, 568.0), fitz.Point(589.5, 568.0), color=FORM_COLOR, width=2.5)
        page2.draw_line(fitz.Point(22.5, 571.2), fitz.Point(589.5, 571.2), color=FORM_COLOR, width=0.8)
        # Ack heading
        page2.insert_text((213.1, 600.0), "ACKNOWLEDGMENT OF SERVICE",
                          fontname='tibo', fontsize=11, color=(0,0,0))
        page2.draw_line(fitz.Point(213.1, 604.55), fitz.Point(397.9, 604.55), color=(0,0,0), width=0.5)
        # Sig lines and labels
        _ul = '__________________________________________________________________________________________'
        page2.insert_text((60.5, 632.0), _ul, fontname='helv', fontsize=10, color=(0,0,0))
        page2.insert_text((104.5, 644.0), '(signature of person served)', fontname='helv', fontsize=8, color=(0,0,0))
        page2.insert_text((351.2, 644.0), '(date)', fontname='helv', fontsize=8, color=(0,0,0))
        page2.insert_text((476.6, 644.0), '(time)', fontname='helv', fontsize=8, color=(0,0,0))
        page2.insert_text((60.5, 673.0), _ul, fontname='helv', fontsize=10, color=(0,0,0))
        page2.insert_text((60.5, 714.0), _ul, fontname='helv', fontsize=10, color=(0,0,0))

    doc.save(out, garbage=4, deflate=True)
    doc.close()
    os.remove(tmp)
    print('Wrote:', out)

    doc = fitz.open(out)
    for i, page in enumerate(doc, 1):
        pix = page.get_pixmap(dpi=200)
        jpg = out.replace('.pdf', f'_Page_{i}.jpg')
        pix.save(jpg, jpg_quality=92)
        print('  preview:', jpg)
    doc.close()

if __name__ == '__main__':
    main()
