#!/usr/bin/env python3
"""
gui_isps.py
===========

Interfaccia grafica per estrarre dal modulo ISPS PDF gli ultimi 10
approdi e generare il file .txt per il sistema PMIS.

Flusso:
    1. Pulsante "Carica PDF..." -> selezioni il modulo ISPS.
    2. L'app esegue l'estrazione (OCR se necessario) e mostra
       un'ANTEPRIMA delle 10 righe in una tabella.
    3. Pulsante "Salva .txt..." -> scegli dove salvare il file
       nel formato: UNLOCODE:arrivo:partenza:sl:port_facility

Questo file è pensato per essere compilato in un .exe standalone con
PyInstaller (vedi istruzioni in fondo a questo file / nel README).

Dipendenze Python:  pdfplumber
Dipendenze di sistema:  tesseract-ocr, poppler-utils (pdftoppm)
"""

import csv
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import traceback
from pathlib import Path

import tkinter as tk
from tkinter import ttk, filedialog, messagebox

try:
    import pdfplumber
except ImportError:
    pdfplumber = None


# ----------------------------------------------------------------------
# Logica di estrazione (identica a estrai_isps.py)
# ----------------------------------------------------------------------

MAX_RIGHE_TABELLA = 10
ANCORA_INIZIO = re.compile(r"last\s+ten\s+calls", re.IGNORECASE)
ANCORA_FINE = re.compile(r"did the ship take any special", re.IGNORECASE)
DATE_REGEX = re.compile(r"\b(\d{2}/\d{2}/\d{4})\b")
UNLOCODE_REGEX = re.compile(r"\b([A-Z]{2}[A-Z0-9]{3})\b")
SL_REGEX = re.compile(r"SL\s*=?\s*(\d)", re.IGNORECASE)
FACILITY_REGEX = re.compile(r"(?<!/)(?<!\d)(\d{3,5})(?!\d)(?!/)")

def _cartella_app() -> Path:
    """Cartella dell'eseguibile (utile quando compilato con PyInstaller
    --onefile: sys.executable punta all'exe, non al codice estratto)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def _trova_strumento(nome_base: str, sottocartella: str) -> str:
    """Cerca prima una copia 'portatile' inclusa accanto all'exe in
    engine/<sottocartella>/..., poi ripiega sul PATH di sistema.

    Layout atteso per la versione portatile (Windows):
        engine/tesseract/tesseract.exe
        engine/poppler/bin/pdftoppm.exe
    """
    nome_eseguibile = nome_base + (".exe" if sys.platform == "win32" else "")
    percorso_portatile = _cartella_app() / "engine" / sottocartella / nome_eseguibile
    if percorso_portatile.exists():
        return str(percorso_portatile)

    percorso_portatile_bin = _cartella_app() / "engine" / sottocartella / "bin" / nome_eseguibile
    if percorso_portatile_bin.exists():
        return str(percorso_portatile_bin)

    trovato_nel_path = shutil.which(nome_base)
    if trovato_nel_path:
        return trovato_nel_path

    return nome_base  # lascialo così: il fallimento verrà intercettato dal chiamante


TESSERACT_CMD = _trova_strumento("tesseract", "tesseract")
PDFTOPPM_CMD = _trova_strumento("pdftoppm", "poppler")

_TESSERACT_DISPONIBILE = Path(TESSERACT_CMD).exists() or shutil.which(TESSERACT_CMD) is not None
_PDFTOPPM_DISPONIBILE = Path(PDFTOPPM_CMD).exists() or shutil.which(PDFTOPPM_CMD) is not None


class ErroreEstrazione(Exception):
    pass


def rasterizza_pagina(pdf_path: Path, pagina: int, dpi: int, out_dir: Path) -> Path:
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
        raise ErroreEstrazione(f"Rasterizzazione fallita per pagina {pagina}")
    return candidati[0]


def righe_da_ocr(img_path: Path, tolleranza_px: int = 15):
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


def estrai_tutte_le_righe(pdf_path: Path, dpi: int = 300):
    if pdfplumber is None:
        raise ErroreEstrazione(
            "La libreria 'pdfplumber' non è installata.\nInstalla con: pip install pdfplumber"
        )

    if pdf_ha_testo(pdf_path):
        return righe_da_testo_nativo(pdf_path)

    if not _TESSERACT_DISPONIBILE:
        raise ErroreEstrazione(
            "Il PDF è una scansione ma il programma 'tesseract' non è "
            "installato o non è nel PATH di sistema.\n\n"
            "Scaricalo da: https://github.com/UB-Mannheim/tesseract/wiki"
        )
    if not _PDFTOPPM_DISPONIBILE:
        raise ErroreEstrazione(
            "Il PDF è una scansione ma il programma 'pdftoppm' (Poppler) "
            "non è installato o non è nel PATH di sistema.\n\n"
            "Scaricalo da: https://github.com/oschwartz10612/poppler-windows"
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
    idx_inizio = None
    for i, riga in enumerate(righe):
        if ANCORA_INIZIO.search(riga):
            idx_inizio = i
            break
    if idx_inizio is None:
        raise ErroreEstrazione(
            "Non ho trovato la sezione 'List the last ten calls at port "
            "facilities' nel PDF.\nVerifica che sia il modulo ISPS atteso."
        )

    risultati = []
    for riga in righe[idx_inizio + 1:]:
        if ANCORA_FINE.search(riga):
            break
        if len(risultati) >= MAX_RIGHE_TABELLA:
            break

        date_trovate = DATE_REGEX.findall(riga)
        if len(date_trovate) < 2:
            continue

        unlocode_match = UNLOCODE_REGEX.search(riga)
        sl_match = SL_REGEX.search(riga)
        if not unlocode_match or not sl_match:
            continue

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

    if not risultati:
        raise ErroreEstrazione("Nessuna riga valida trovata nella tabella degli approdi.")

    return risultati


def formatta_riga(r):
    return f"{r['unlocode']}:{r['arrivo']}:{r['partenza']}:{r['sl']}:{r['facility']}"


# ----------------------------------------------------------------------
# Interfaccia grafica
# ----------------------------------------------------------------------

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Estrattore ISPS -> PMIS (Capitaneria di Porto di Catania)")
        self.geometry("780x420")
        self.minsize(650, 380)

        self.dati_estratti = []
        self.pdf_path = None

        self._crea_widget()

    def _crea_widget(self):
        pad = {"padx": 10, "pady": 8}

        top = tk.Frame(self)
        top.pack(fill="x", **pad)

        self.btn_carica = tk.Button(
            top, text="1. Carica PDF...", command=self.on_carica_pdf,
            font=("Segoe UI", 11), width=18
        )
        self.btn_carica.pack(side="left")

        self.lbl_file = tk.Label(top, text="Nessun file selezionato", anchor="w")
        self.lbl_file.pack(side="left", padx=10, fill="x", expand=True)

        # Tabella anteprima
        cols = ("unlocode", "arrivo", "partenza", "sl", "facility")
        intestazioni = {
            "unlocode": "UNLOCODE",
            "arrivo": "Data arrivo",
            "partenza": "Data partenza",
            "sl": "Security Level",
            "facility": "Port facility",
        }
        self.tabella = ttk.Treeview(self, columns=cols, show="headings", height=10)
        for c in cols:
            self.tabella.heading(c, text=intestazioni[c])
            self.tabella.column(c, width=130, anchor="center")
        self.tabella.pack(fill="both", expand=True, padx=10, pady=(0, 8))

        bottom = tk.Frame(self)
        bottom.pack(fill="x", **pad)

        self.btn_salva = tk.Button(
            bottom, text="2. Salva .txt...", command=self.on_salva_txt,
            font=("Segoe UI", 11), width=18, state="disabled"
        )
        self.btn_salva.pack(side="left")

        self.lbl_stato = tk.Label(bottom, text="Pronto.", anchor="w", fg="#444")
        self.lbl_stato.pack(side="left", padx=10, fill="x", expand=True)

    def on_carica_pdf(self):
        path = filedialog.askopenfilename(
            title="Seleziona il modulo ISPS (PDF)",
            filetypes=[("File PDF", "*.pdf")],
        )
        if not path:
            return
        self.pdf_path = Path(path)
        self.lbl_file.config(text=self.pdf_path.name)
        self.btn_salva.config(state="disabled")
        self.tabella.delete(*self.tabella.get_children())
        self.dati_estratti = []

        self.btn_carica.config(state="disabled")
        self.lbl_stato.config(text="Elaborazione in corso (può richiedere qualche secondo)...")

        # Esegue l'estrazione in un thread separato per non bloccare la finestra
        threading.Thread(target=self._estrai_in_background, daemon=True).start()

    def _estrai_in_background(self):
        try:
            righe = estrai_tutte_le_righe(self.pdf_path)
            dati = estrai_tabella_approdi(righe)
            self.after(0, self._mostra_risultati, dati)
        except ErroreEstrazione as e:
            self.after(0, self._mostra_errore, str(e))
        except Exception:
            self.after(0, self._mostra_errore, "Errore imprevisto:\n" + traceback.format_exc())

    def _mostra_risultati(self, dati):
        self.dati_estratti = dati
        for r in dati:
            self.tabella.insert("", "end", values=(
                r["unlocode"], r["arrivo"], r["partenza"], r["sl"], r["facility"]
            ))
        self.btn_carica.config(state="normal")
        self.btn_salva.config(state="normal")
        self.lbl_stato.config(text=f"Estratte {len(dati)} righe. Controlla l'anteprima, poi salva il .txt.")

    def _mostra_errore(self, messaggio):
        self.btn_carica.config(state="normal")
        self.lbl_stato.config(text="Errore durante l'estrazione.")
        messagebox.showerror("Errore", messaggio)

    def on_salva_txt(self):
        if not self.dati_estratti:
            return
        nome_suggerito = (self.pdf_path.stem + "_pmis.txt") if self.pdf_path else "output_pmis.txt"
        path = filedialog.asksaveasfilename(
            title="Salva file per PMIS",
            defaultextension=".txt",
            initialfile=nome_suggerito,
            filetypes=[("File di testo", "*.txt")],
        )
        if not path:
            return
        with open(path, "w", encoding="utf-8") as f:
            for r in self.dati_estratti:
                f.write(formatta_riga(r) + "\n")
        self.lbl_stato.config(text=f"Salvato: {path}")
        messagebox.showinfo("Salvato", f"File salvato correttamente in:\n{path}")


def main():
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()

# ----------------------------------------------------------------------
# COME CREARE IL FILE .exe (da eseguire sul TUO PC Windows, con Python
# installato). Questo sandbox non può generare un .exe Windows.
#
#   1) pip install pyinstaller pdfplumber
#   2) pyinstaller --onefile --windowed --name EstrattoreISPS gui_isps.py
#   3) Il file EstrattoreISPS.exe sarà in dist\EstrattoreISPS.exe
#
# IMPORTANTE: sul PC dove userai l'exe devono essere installati anche
# Tesseract OCR e Poppler (pdftoppm), e le loro cartelle devono essere
# nel PATH di sistema (vedi README).
# ----------------------------------------------------------------------
