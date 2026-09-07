#!/usr/bin/env python3
"""
estrai_isps.py
==============

Estrae dalla "Ship Pre-Arrival Security Information Form" (modulo ISPS,
SOLAS XI-2/9 - Reg. CE 725/2004) la tabella con gli ultimi 10 approdi
della nave e genera un file .txt pronto per l'inserimento nei tool del
sistema PMIS della Capitaneria di Porto.

Formato riga di output:
    UNLOCODE:data_di_arrivo:data_di_partenza:security_level:port_facility

Uso:
    python3 estrai_isps.py input.pdf [-o output.txt] [--dpi 300]

Come funziona:
    1. Il modulo ISPS è quasi sempre una scansione (PDF raster, senza
       testo selezionabile) -> si esegue l'OCR con Tesseract.
    2. La pagina viene "rasterizzata" ad alta risoluzione (default 300
       DPI) per massimizzare la qualità dell'OCR.
    3. Le parole riconosciute (con relative coordinate) vengono
       raggruppate in righe di tabella.
    4. Si individua la sezione "List the last ten calls at port
       facilities" e si interpretano le righe successive con
       espressioni regolari (2 date, UNLOCODE, port facility, security
       level), indipendentemente da eventuali imperfezioni di
       spaziatura introdotte dall'OCR.

Note:
    - Se il PDF ha già un livello testo (non scansionato), lo script lo
      usa direttamente senza bisogno di OCR.
    - Il modulo è a formato fisso: se in futuro il layout del modulo
      cambia sensibilmente, potrebbe essere necessario adattare le
      espressioni regolari in `RIGA_REGEX_HELPERS` più sotto.
"""

import argparse
import csv
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

_TESSERACT_DISPONIBILE = shutil.which("tesseract") is not None


# ----------------------------------------------------------------------
# Costanti / pattern di riconoscimento
# ----------------------------------------------------------------------

MAX_RIGHE_TABELLA = 10

# Ancora che indica l'inizio della tabella "ultimi 10 approdi"
ANCORA_INIZIO = re.compile(r"last\s+ten\s+calls", re.IGNORECASE)

# Ancora che indica la fine della tabella (prima domanda successiva)
ANCORA_FINE = re.compile(r"did the ship take any special", re.IGNORECASE)

DATE_REGEX = re.compile(r"\b(\d{2}/\d{2}/\d{4})\b")
# UN/LOCODE: 5 caratteri alfanumerici maiuscoli (2 lettere paese + 3 loc.)
UNLOCODE_REGEX = re.compile(r"\b([A-Z]{2}[A-Z0-9]{3})\b")
SL_REGEX = re.compile(r"SL\s*=?\s*(\d)", re.IGNORECASE)
# Codice port facility: token numerico "isolato" (non parte di una data)
FACILITY_REGEX = re.compile(r"(?<!/)(?<!\d)(\d{3,5})(?!\d)(?!/)")


def rasterizza_pagina(pdf_path: Path, pagina: int, dpi: int, out_dir: Path) -> Path:
    """Converte una pagina del PDF in immagine PNG con pdftoppm."""
    prefisso = out_dir / f"pagina_{pagina}"
    subprocess.run(
        [
            "pdftoppm", "-png", "-r", str(dpi),
            "-f", str(pagina), "-l", str(pagina),
            str(pdf_path), str(prefisso),
        ],
        check=True,
        capture_output=True,
    )
    candidati = sorted(out_dir.glob(f"pagina_{pagina}*.png"))
    if not candidati:
        raise RuntimeError(f"Rasterizzazione fallita per pagina {pagina}")
    return candidati[0]


def righe_da_ocr(img_path: Path, tolleranza_px: int = 15):
    """Esegue l'OCR sull'immagine (tramite il comando tesseract, in formato
    TSV) e restituisce una lista di righe di testo, ricostruite
    raggruppando le parole per coordinata verticale (top)."""
    with tempfile.TemporaryDirectory() as tmp:
        out_base = Path(tmp) / "ocr_out"
        subprocess.run(
            ["tesseract", str(img_path), str(out_base), "tsv"],
            check=True,
            capture_output=True,
        )
        tsv_path = out_base.with_suffix(".tsv")
        parole = []
        with open(tsv_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t")
            for r in reader:
                testo = (r.get("text") or "").strip()
                if not testo:
                    continue
                parole.append((int(r["top"]), int(r["left"]), testo))

    parole.sort(key=lambda t: (t[0], t[1]))

    righe = []
    riga_corrente = []
    top_corrente = None
    for top, left, testo in parole:
        if top_corrente is None or abs(top - top_corrente) <= tolleranza_px:
            riga_corrente.append((left, testo))
            if top_corrente is None:
                top_corrente = top
        else:
            righe.append(riga_corrente)
            riga_corrente = [(left, testo)]
            top_corrente = top
    if riga_corrente:
        righe.append(riga_corrente)

    testo_righe = []
    for riga in righe:
        riga.sort(key=lambda t: t[0])
        testo_righe.append(" ".join(t for _, t in riga))
    return testo_righe


def righe_da_testo_nativo(pdf_path: Path):
    """Se il PDF ha un layer di testo utilizzabile, estrae le righe con
    pdfplumber (nessun OCR necessario)."""
    testo_righe = []
    with pdfplumber.open(pdf_path) as pdf:
        for pagina in pdf.pages:
            testo = pagina.extract_text() or ""
            testo_righe.extend(testo.splitlines())
    return testo_righe


def pdf_ha_testo(pdf_path: Path) -> bool:
    if pdfplumber is None:
        return False
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for pagina in pdf.pages[:2]:
                if (pagina.extract_text() or "").strip():
                    return True
    except Exception:
        return False
    return False


def estrai_tutte_le_righe(pdf_path: Path, dpi: int):
    """Restituisce la lista di righe di testo dell'intero PDF, usando il
    layer di testo nativo se disponibile, altrimenti l'OCR."""
    if pdf_ha_testo(pdf_path):
        return righe_da_testo_nativo(pdf_path)

    if not _TESSERACT_DISPONIBILE:
        sys.exit(
            "Errore: il PDF sembra una scansione (nessun testo estraibile) "
            "ma il programma 'tesseract' non è installato.\n"
            "Installa con: sudo apt-get install tesseract-ocr"
        )

    with pdfplumber.open(pdf_path) as pdf:
        n_pagine = len(pdf.pages)

    tutte_le_righe = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        for num_pagina in range(1, n_pagine + 1):
            img_path = rasterizza_pagina(pdf_path, num_pagina, dpi, tmp_dir)
            tutte_le_righe.extend(righe_da_ocr(img_path))
    return tutte_le_righe


def estrai_tabella_approdi(righe):
    """Individua la tabella 'ultimi 10 approdi' e ne interpreta le righe.

    Ritorna una lista di dizionari:
        {"unlocode":..., "arrivo":..., "partenza":..., "sl":..., "facility":...}
    """
    idx_inizio = None
    for i, riga in enumerate(righe):
        if ANCORA_INIZIO.search(riga):
            idx_inizio = i
            break
    if idx_inizio is None:
        sys.exit(
            "Non ho trovato la sezione 'List the last ten calls at port "
            "facilities' nel PDF: verifica che il modulo sia quello atteso."
        )

    risultati = []
    for riga in righe[idx_inizio + 1:]:
        if ANCORA_FINE.search(riga):
            break
        if len(risultati) >= MAX_RIGHE_TABELLA:
            break

        date_trovate = DATE_REGEX.findall(riga)
        if len(date_trovate) < 2:
            continue  # riga non pertinente (es. intestazioni, righe vuote)

        unlocode_match = UNLOCODE_REGEX.search(riga)
        sl_match = SL_REGEX.search(riga)
        if not unlocode_match or not sl_match:
            continue

        # Il codice port facility è il numero "isolato" più vicino,
        # cercato nel testo che segue l'UNLOCODE
        dopo_unlocode = riga[unlocode_match.end():]
        facility_match = FACILITY_REGEX.search(dopo_unlocode)
        facility = facility_match.group(1) if facility_match else "0000"

        risultati.append({
            "unlocode": unlocode_match.group(1),
            "arrivo": date_trovate[0],
            "partenza": date_trovate[1],
            "sl": sl_match.group(1),
            "facility": facility,
        })

    return risultati


def scrivi_output(righe_dati, output_path: Path):
    with open(output_path, "w", encoding="utf-8") as f:
        for r in righe_dati:
            f.write(
                f"{r['unlocode']}:{r['arrivo']}:{r['partenza']}:{r['sl']}:{r['facility']}\n"
            )


def main():
    parser = argparse.ArgumentParser(
        description="Estrae gli ultimi 10 approdi dal modulo ISPS PDF e "
                    "genera il file .txt per il sistema PMIS."
    )
    parser.add_argument("pdf", type=Path, help="Percorso del modulo ISPS (.pdf)")
    parser.add_argument(
        "-o", "--output", type=Path, default=None,
        help="Percorso del file .txt di output (default: <nome_pdf>_pmis.txt)"
    )
    parser.add_argument(
        "--dpi", type=int, default=300,
        help="Risoluzione di rasterizzazione per l'OCR (default: 300)"
    )
    args = parser.parse_args()

    if not args.pdf.exists():
        sys.exit(f"File non trovato: {args.pdf}")

    output_path = args.output or args.pdf.with_name(args.pdf.stem + "_pmis.txt")

    righe = estrai_tutte_le_righe(args.pdf, args.dpi)
    dati = estrai_tabella_approdi(righe)

    if not dati:
        sys.exit("Nessuna riga valida trovata nella tabella degli approdi.")

    scrivi_output(dati, output_path)

    print(f"Estratte {len(dati)} righe -> {output_path}")
    for r in dati:
        print(f"  {r['unlocode']}:{r['arrivo']}:{r['partenza']}:{r['sl']}:{r['facility']}")


if __name__ == "__main__":
    main()
