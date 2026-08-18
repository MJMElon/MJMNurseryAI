#!/usr/bin/env python3
"""The office's 3rd Culling record, transcribed from 3rd_Culling.pdf.

Page order preserved so a row here can be checked against the same line on
paper. Dates are DD/MM/YYYY on the sheet and become ISO here.

    python3 import_3rd_culling.py            # SQL VALUES rows
    python3 import_3rd_culling.py --summary  # cross-check against the paper
"""

# (date, plot, batch_no, culled_qty)
ROWS = [
    # ── page 1 ──
    ('17/12/2025', 'B8',    225, 20),
    ('17/12/2025', 'B8',    224, 211),
    ('17/12/2025', 'B8',    227, 14),
    ('11/02/2026', 'B2',    225, 340),
    ('16/03/2026', 'B9',    231, 28),
    ('16/03/2026', 'B9',    233, 255),
    ('22/03/2026', 'B7',    226, 130),
    ('22/03/2026', 'B7',    227, 326),
    ('31/03/2026', 'B4-R',  226, 15),
    ('31/03/2026', 'B4-R',  225, 6),
    ('31/03/2026', 'B4-R',  231, 54),
    ('31/03/2026', 'B4-R',  233, 70),
    ('31/03/2026', 'B4-R',  227, 119),
    ('13/04/2026', 'B5',    226, 119),
    ('13/04/2026', 'B5',    231, 757),
    ('06/05/2026', 'B12',   228, 1369),
    ('07/05/2026', 'B10',   232, 432),
    ('07/05/2026', 'B10',   232, 68),
    ('07/05/2026', 'B10',   233, 991),
    ('01/06/2026', 'B1',    234, 8),
    ('01/06/2026', 'B1',    237, 36),
    ('08/06/2026', 'B13',   232, 130),
    ('08/06/2026', 'B14',   234, 170),
    ('08/06/2026', 'B13-R', 229, 148),
    ('08/06/2026', 'B13-R', 232, 134),
    ('08/06/2026', 'B13',   232, 18),
    ('12/06/2026', 'B11',   228, 178),
    ('12/06/2026', 'B11',   229, 2884),
    ('13/06/2026', 'B13',   232, 243),
    ('13/06/2026', 'B13',   224, 13),
    ('13/06/2026', 'B13',   225, 5),
    ('20/06/2026', 'B14',   234, 122),
    ('04/07/2026', 'B6',    232, 6),
    ('04/07/2026', 'B6',    233, 35),
    ('04/07/2026', 'B6',    234, 24),
    ('04/07/2026', 'B6',    238, 32),
    ('04/07/2026', 'B6',    240, 367),
    ('19/07/2026', 'B3',    240, 520),
    ('18/03/2026', 'U10',   222, 77),
    ('18/03/2026', 'U10',   226, 252),
    ('18/03/2026', 'U9',    230, 65),
    ('18/03/2026', 'U9',    231, 316),
    ('25/03/2026', 'U1',    230, 200),
    # ── page 2 ──
    ('25/03/2026', 'U2',    229, 29),
    ('25/03/2026', 'U2',    230, 15),
    ('25/03/2026', 'U16',   230, 31),
    ('07/04/2026', 'U12-R', 230, 315),
    ('07/04/2026', 'U12-R', 226, 388),
    ('07/04/2026', 'U12-R', 231, 84),
    ('07/04/2026', 'U12-R', 227, 540),
    ('07/04/2026', 'U12-R', 228, 50),
    ('18/04/2026', 'U3',    228, 49),
    ('18/04/2026', 'U3',    227, 789),
    ('26/04/2026', 'U18',   225, 107),
    ('26/04/2026', 'U18',   226, 768),
    ('28/04/2026', 'U16',   234, 248),
    ('07/05/2026', 'U8',    233, 80),
    ('07/05/2026', 'U8',    234, 282),
    ('17/05/2026', 'U12',   236, 474),
    ('17/05/2026', 'U12',   237, 1),
    ('01/06/2026', 'U11',   234, 652),
    ('01/06/2026', 'U11',   235, 22),
    ('14/06/2026', 'U13',   235, 593),
    ('21/06/2026', 'U5',    237, 277),
    ('22/06/2026', 'U14',   237, 588),
    ('05/02/2026', 'N20',   225, 141),
    ('13/02/2026', 'N18',   224, 427),
    ('15/03/2026', 'N2',    230, 951),
    ('19/03/2026', 'N19',   224, 268),
    ('19/03/2026', 'N19',   225, 520),
    ('25/03/2026', 'N1',    229, 899),
    ('25/03/2026', 'N1',    230, 729),
    ('30/03/2026', 'N1',    225, 131),
    ('30/03/2026', 'N1',    224, 64),
    ('30/03/2026', 'N1',    230, 146),
    ('29/04/2026', 'N10',   235, 115),
    ('29/04/2026', 'N10',   236, 374),
    ('29/04/2026', 'N9',    235, 569),
    ('02/05/2026', 'N5',    232, 462),
    ('09/05/2026', 'N6',    233, 323),
    ('01/06/2026', 'N11',   235, 77),
    ('01/06/2026', 'N11',   237, 181),
    ('01/06/2026', 'N11',   238, 109),
    ('30/06/2026', 'N4',    238, 396),
]


def iso(d):
    dd, mm, yyyy = d.split('/')
    return f'{yyyy}-{mm}-{dd}'


def values_sql():
    out = []
    for i, (d, plot, batch, qty) in enumerate(ROWS, start=1):
        out.append(f"  ({i}, DATE '{iso(d)}', '{plot}', {batch}, {qty})")
    return ',\n'.join(out)


if __name__ == '__main__':
    import collections, sys
    if '--summary' in sys.argv:
        print(f'rows          : {len(ROWS)}')
        print(f'total culled  : {sum(r[3] for r in ROWS):,}')
        print(f'batches       : {len(set(r[2] for r in ROWS))} '
              f'({min(r[2] for r in ROWS)}–{max(r[2] for r in ROWS)})')
        print(f'date range    : {min(iso(r[0]) for r in ROWS)} → {max(iso(r[0]) for r in ROWS)}')
        pre = collections.Counter(r[1][0] for r in ROWS)
        print('by nursery    :', dict(pre))
        print(f'plots         : {len(set(r[1] for r in ROWS))}')
        print(f'"-R" plots    :', sorted({r[1] for r in ROWS if r[1].endswith('-R')}))
        # The same batch+plot on more than one line — these have to be summed
        # into one record, since the report holds one figure per plot.
        dup = collections.Counter((r[1], r[2]) for r in ROWS)
        rep = {k: v for k, v in dup.items() if v > 1}
        print(f'batch+plot appearing more than once ({len(rep)}):')
        for (plot, batch), n in sorted(rep.items()):
            lines = [r for r in ROWS if r[1] == plot and r[2] == batch]
            tot   = sum(r[3] for r in lines)
            print(f'   {plot:6} batch {batch}  {n} lines  '
                  f'{" + ".join(str(r[3]) for r in lines)} = {tot}')
    else:
        print(values_sql())
