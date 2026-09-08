#!/usr/bin/env python3
"""
Crea "Ultimi-10-approdi-ISPS.html": tutta l'app in un unico file da salvare
sul PC (o su OneDrive) e aprire con un doppio clic, senza server e senza
installare nulla.

Nel file unico finisce dentro anche pdf.js, compreso il suo "worker": viene
caricato nel thread principale, perche' i browser non permettono di avviare un
worker da un file aperto con doppio clic (protocollo file://).

Il riconoscimento del testo delle scansioni (Tesseract, 13 MB) non viene
incluso: se accanto al file c'e' la cartella vendor/ viene usata quella,
altrimenti l'app lo scarica al momento dalla copia pubblica su internet.

Uso:
    python3 strumenti/crea_file_unico.py
"""

import re
import sys
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
USCITA = RADICE / "Ultimi-10-approdi-ISPS.html"

# Ordine di inclusione: pdf.js, il suo worker, i dati, i moduli dell'app.
SCRIPT_INCLUSI = [
    "vendor/pdfjs/pdf.min.js",
    "vendor/pdfjs/pdf.worker.min.js",
    "dati/porti.js",
    "js/database-porti.js",
    "js/estrattore.js",
    "js/correzioni.js",
    "js/app.js",
]

AVVISO_FILE_UNICO = """
/* Versione a file unico: pdf.js gira nel thread principale, perche' con il
   protocollo file:// i browser non consentono di avviare un worker. La riga
   sotto serve solo a soddisfare il controllo di pdf.js: il lavoro lo svolge
   il worker incluso qui sopra, che si registra come globalThis.pdfjsWorker. */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'incluso-nel-file';
"""


def leggi(percorso_relativo: str) -> str:
    return (RADICE / percorso_relativo).read_text(encoding="utf-8")


def script_inline(percorso_relativo: str) -> str:
    sorgente = leggi(percorso_relativo)
    # in un <script> inline la sequenza </script> chiuderebbe il blocco
    sorgente = sorgente.replace("</script", "<\\/script")
    return (
        f"<!-- {percorso_relativo} -->\n<script>\n{sorgente}\n</script>"
    )


def main() -> int:
    pagina = leggi("index.html")

    # foglio di stile incorporato
    pagina = pagina.replace(
        '<link rel="stylesheet" href="css/stile.css">',
        "<style>\n" + leggi("css/stile.css") + "\n</style>",
    )

    # icona come immagine incorporata, manifest inutile in un file unico
    icona = leggi("icona.svg").replace("\n", "")
    pagina = pagina.replace(
        '<link rel="manifest" href="manifest.webmanifest">', ""
    )
    pagina = pagina.replace(
        '<link rel="icon" href="icona.svg" type="image/svg+xml">',
        '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,'
        + icona.replace('"', "'").replace("#", "%23")
        + '">',
    )
    pagina = pagina.replace('<link rel="apple-touch-icon" href="icona-180.png">', "")

    # qui dentro non c'e' nulla da scaricare in anticipo: tutto e' gia' incluso
    pagina = re.sub(
        r'\s*<!-- I pezzi grossi[^>]*-->'
        r'(\s*<link rel="(?:preload|prefetch)" href="[^"]+" as="script">)+',
        "",
        pagina,
    )

    # il comando per l'uso senza rete ha senso solo nella versione a cartella
    pagina = re.sub(
        r'\s*<div class="griglia-opzioni" id="zonaOffline">.*?</div>\s*</div>',
        "",
        pagina,
        flags=re.DOTALL,
    )

    # tutti gli script diventano inline, in coda alla pagina
    blocco_script = "\n".join(script_inline(p) for p in SCRIPT_INCLUSI)
    blocco_script = blocco_script.replace(
        "<!-- js/database-porti.js -->",
        "<script>" + AVVISO_FILE_UNICO + "</script>\n<!-- js/database-porti.js -->",
    )
    inizio = pagina.index('<script src="js/database-porti.js"></script>')
    fine = pagina.index("</body>")
    pagina = pagina[:inizio] + blocco_script + "\n\n" + pagina[fine:]

    if "zonaOffline" in pagina or 'src="' in pagina.split("<style>")[0]:
        print("Attenzione: nella pagina restano riferimenti a file esterni.", file=sys.stderr)

    USCITA.write_text(pagina, encoding="utf-8")
    print(f"scritto {USCITA.relative_to(RADICE)} ({USCITA.stat().st_size / 1024 / 1024:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
