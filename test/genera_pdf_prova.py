#!/usr/bin/env python3
"""
Crea i PDF di prova usati dai test automatici: riproducono il modulo
"Ship Pre-Arrival Security Information Form" (Reg. CE 725/2004) con la
tabella degli ultimi dieci approdi.

Vengono generati:
    test/pdf/modulo_pulito.pdf        dati corretti
    test/pdf/modulo_con_errori.pdf    con gli errori tipici da correggere
    test/pdf/modulo_ordine_inverso.pdf  righe dal piu' vecchio al piu' recente
    test/pdf/modulo_scansione.pdf     scansione finta (immagine storta e sporca)
    test/pdf/scansione.png            la stessa pagina come immagine, per l'OCR

Uso:
    python3 test/genera_pdf_prova.py

Dipendenze (solo per rigenerare i PDF di prova): reportlab, pillow, pypdfium2
"""

import io
import random
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

CARTELLA = Path(__file__).resolve().parent / "pdf"

STILE_TITOLO = ParagraphStyle("titolo", fontName="Helvetica-Bold", fontSize=10, leading=12)
STILE_TESTO = ParagraphStyle("testo", fontName="Helvetica", fontSize=8, leading=10)
STILE_CELLA = ParagraphStyle("cella", fontName="Helvetica", fontSize=7.5, leading=9)

# arrivo, partenza, porto, paese, unlocode, port facility, security level
APPRODI_PULITI = [
    ("28/08/2026", "30/08/2026", "Valletta", "Malta", "MTMLA", "MTMLA-0002", "1"),
    ("24/08/2026", "26/08/2026", "Piraeus", "Greece", "GRPIR", "GRPIR-0011", "1"),
    ("18/08/2026", "20/08/2026", "Ambarli", "Turkey", "TRAMB", "TRAMB-0005", "1"),
    ("12/08/2026", "14/08/2026", "Constanta", "Romania", "ROCND", "ROCND-0003", "2"),
    ("06/08/2026", "08/08/2026", "Odesa", "Ukraine", "UAODS", "UAODS-0001", "2"),
    ("30/07/2026", "01/08/2026", "Alexandria", "Egypt", "EGALY", "EGALY-0004", "1"),
    ("24/07/2026", "26/07/2026", "Port Said", "Egypt", "EGPSD", "EGPSD-0007", "1"),
    ("18/07/2026", "20/07/2026", "Genova", "Italy", "ITGOA", "ITGOA-0021", "1"),
    ("10/07/2026", "12/07/2026", "Barcelona", "Spain", "ESBCN", "ESBCN-0009", "1"),
    ("02/07/2026", "05/07/2026", "Algeciras", "Spain", "ESALG", "ESALG-0012", "1"),
]

# Gli stessi approdi, scritti come capita di trovarli sui moduli veri:
#  1 codice con la I letta come 1
#  2 nome del porto in italiano e codice mancante
#  3 codice della citta' (Istanbul) al posto di quello del porto (Ambarli)
#  4 anno sbagliato (2025 invece di 2026)
#  5 codice con la O letta come 0
#  6 data in formato americano (mese/giorno)
#  7 codice port facility scritto con lo spazio
#  8 livello di sicurezza non compilato
#  9 nome del porto con un errore di battitura e codice assente
# 10 arrivo e partenza invertiti
APPRODI_CON_ERRORI = [
    ("28/08/2026", "30/08/2026", "Valletta", "Malta", "MTM1A", "MTMLA-0002", "1"),
    ("24/08/2026", "26/08/2026", "Pireo", "Grecia", "", "GRPIR-0011", "1"),
    ("18/08/2026", "20/08/2026", "Ambarli", "Turkey", "TRIST", "TRAMB-0005", "1"),
    ("12/08/2025", "14/08/2025", "Constanta", "Romania", "ROCND", "ROCND-0003", "2"),
    ("06/08/2026", "08/08/2026", "Odesa", "Ukraine", "UA0DS", "UAODS-0001", "2"),
    ("07/30/2026", "01/08/2026", "Alexandria", "Egypt", "EGALY", "EGALY-0004", "1"),
    ("24/07/2026", "26/07/2026", "Port Said", "Egypt", "EGPSD", "EGPSD 0007", "1"),
    ("18/07/2026", "20/07/2026", "Genova", "Italy", "ITGOA", "ITGOA-0021", ""),
    ("10/07/2026", "12/07/2026", "Barcelonna", "Spain", "", "ESBCN-0009", "1"),
    ("05/07/2026", "02/07/2026", "Algeciras", "Spain", "ESALG", "ESALG-0012", "1"),
]


def tabella_approdi(approdi):
    intestazione = [
        Paragraph("<b>No.</b>", STILE_CELLA),
        Paragraph("<b>Date from<br/>(dd/mm/yyyy)</b>", STILE_CELLA),
        Paragraph("<b>Date to<br/>(dd/mm/yyyy)</b>", STILE_CELLA),
        Paragraph("<b>Port</b>", STILE_CELLA),
        Paragraph("<b>Country</b>", STILE_CELLA),
        Paragraph("<b>UN/LOCODE<br/>(if available)</b>", STILE_CELLA),
        Paragraph("<b>Port facility</b>", STILE_CELLA),
        Paragraph("<b>Security Level</b>", STILE_CELLA),
    ]
    righe = [intestazione]
    for numero, approdo in enumerate(approdi, start=1):
        arrivo, partenza, porto, paese, unlocode, facility, livello = approdo
        righe.append([
            Paragraph(str(numero), STILE_CELLA),
            Paragraph(arrivo, STILE_CELLA),
            Paragraph(partenza, STILE_CELLA),
            Paragraph(porto, STILE_CELLA),
            Paragraph(paese, STILE_CELLA),
            Paragraph(unlocode, STILE_CELLA),
            Paragraph(facility, STILE_CELLA),
            Paragraph("SL = %s" % livello, STILE_CELLA),
        ])
    tabella = Table(
        righe,
        colWidths=[8 * mm, 20 * mm, 20 * mm, 28 * mm, 22 * mm, 22 * mm, 33 * mm, 20 * mm],
        hAlign="LEFT",
    )
    tabella.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]))
    return tabella


def blocco_intestazione_nave(eta):
    dati = [
        ["IMO number", "9123456", "Name of ship", "MOTONAVE PROVA"],
        ["Port of registry", "Catania", "Flag State", "Italy"],
        ["Type of ship", "General cargo", "Call Sign", "IBPR2"],
        ["Port of arrival", "Catania", "Port facility of arrival", "ITCTA-0001"],
        ["Expected date and time of arrival of the ship in port (ETA)", eta,
         "Primary purpose of call", "Cargo operations"],
    ]
    tabella = Table(
        [[Paragraph(cella, STILE_CELLA) for cella in riga] for riga in dati],
        colWidths=[45 * mm, 40 * mm, 45 * mm, 43 * mm],
        hAlign="LEFT",
    )
    tabella.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return tabella


def costruisci_modulo(percorso, approdi, eta="03/09/2026"):
    documento = SimpleDocTemplate(
        str(percorso),
        pagesize=A4,
        leftMargin=12 * mm, rightMargin=12 * mm,
        topMargin=12 * mm, bottomMargin=12 * mm,
        title="Ship Pre-Arrival Security Information Form",
    )
    contenuto = [
        Paragraph("SHIP PRE-ARRIVAL SECURITY INFORMATION FORM", STILE_TITOLO),
        Paragraph(
            "FOR ALL SHIPS PRIOR TO ENTRY INTO THE PORT OF AN EU MEMBER STATE "
            "(1974 International Convention for the Safety of Life at Sea (SOLAS) "
            "REGULATION 9 of Chapter XI-2 AND ARTICLE 6(3) OF REGULATION (EC) No 725/2004)",
            STILE_TESTO,
        ),
        Spacer(1, 4 * mm),
        Paragraph("<b>Particulars of the ship and contact details</b>", STILE_TESTO),
        blocco_intestazione_nave(eta),
        Spacer(1, 4 * mm),
        Paragraph(
            "<b>Information required by SOLAS regulation 9.2.1 of Chapter XI-2</b>",
            STILE_TESTO,
        ),
        Paragraph(
            "Does the ship have a valid International Ship Security Certificate (ISSC)? YES &nbsp;&nbsp; "
            "Security Level at which the ship is currently operating? Security Level 1",
            STILE_TESTO,
        ),
        Spacer(1, 3 * mm),
        Paragraph(
            "List the last ten calls at port facilities in chronological order "
            "(most recent call first):",
            STILE_TESTO,
        ),
        Spacer(1, 2 * mm),
        tabella_approdi(approdi),
        Spacer(1, 4 * mm),
        Paragraph(
            "Did the ship take any special or additional security measures, beyond "
            "those in the approved SSP? NO",
            STILE_TESTO,
        ),
        Paragraph(
            "If the answer is YES, indicate below the special or additional security "
            "measures taken by the ship.",
            STILE_TESTO,
        ),
        Spacer(1, 3 * mm),
        Paragraph(
            "List the ship-to-ship activities, in chronological order (most recent first), "
            "which were carried out during the last ten calls at port facilities listed above.",
            STILE_TESTO,
        ),
        Spacer(1, 2 * mm),
        Table(
            [[Paragraph(c, STILE_CELLA) for c in ["No.", "Date from (dd/mm/yyyy)",
                                                  "Date to (dd/mm/yyyy)",
                                                  "Location or Longitude and Latitude",
                                                  "Ship-to-ship activity"]],
             [Paragraph(c, STILE_CELLA) for c in ["1", "20/08/2026", "20/08/2026",
                                                  "36 12 N 015 20 E", "Bunkering"]]],
            colWidths=[10 * mm, 30 * mm, 30 * mm, 55 * mm, 45 * mm],
            hAlign="LEFT",
            style=TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black)]),
        ),
        Spacer(1, 3 * mm),
        Paragraph("General description of the cargo aboard the ship: steel coils.", STILE_TESTO),
    ]
    documento.build(contenuto)
    print("  scritto", percorso.relative_to(CARTELLA.parent.parent))


def crea_scansione(pdf_origine, pdf_scansione, png_scansione):
    """Trasforma la prima pagina in una finta scansione: immagine in scala di
    grigi, leggermente ruotata, con rumore e bordi sporchi."""
    import pypdfium2 as pdfium
    from PIL import Image, ImageFilter

    documento = pdfium.PdfDocument(str(pdf_origine))
    immagine = documento[0].render(scale=200 / 72).to_pil().convert("L")

    immagine = immagine.rotate(-0.45, resample=Image.BICUBIC, expand=False, fillcolor=255)
    immagine = immagine.filter(ImageFilter.GaussianBlur(radius=0.4))

    casuale = random.Random(20260907)
    pixel = immagine.load()
    larghezza, altezza = immagine.size
    for _ in range(int(larghezza * altezza * 0.02)):
        x = casuale.randrange(larghezza)
        y = casuale.randrange(altezza)
        valore = pixel[x, y]
        pixel[x, y] = max(0, min(255, valore + casuale.randint(-45, 45)))

    memoria = io.BytesIO()
    immagine.save(memoria, format="JPEG", quality=60)
    immagine = Image.open(memoria).convert("L")

    immagine.save(png_scansione)
    immagine.convert("RGB").save(pdf_scansione, format="PDF", resolution=200.0)
    print("  scritto", pdf_scansione.relative_to(CARTELLA.parent.parent))
    print("  scritto", png_scansione.relative_to(CARTELLA.parent.parent))


def main():
    CARTELLA.mkdir(parents=True, exist_ok=True)
    print("Generazione PDF di prova")
    costruisci_modulo(CARTELLA / "modulo_pulito.pdf", APPRODI_PULITI)
    costruisci_modulo(CARTELLA / "modulo_con_errori.pdf", APPRODI_CON_ERRORI)
    costruisci_modulo(CARTELLA / "modulo_ordine_inverso.pdf", list(reversed(APPRODI_PULITI)))
    crea_scansione(
        CARTELLA / "modulo_pulito.pdf",
        CARTELLA / "modulo_scansione.pdf",
        CARTELLA / "scansione.png",
    )


if __name__ == "__main__":
    main()
