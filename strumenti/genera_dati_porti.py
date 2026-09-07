#!/usr/bin/env python3
"""
Genera i file di dati usati dall'app per correggere automaticamente
UN/LOCODE, nomi dei porti e nomi dei paesi.

Sorgenti (scaricate dalla rete, servono solo a chi rigenera i dati:
l'app usa i .js gia' generati e non ha bisogno di rete):

  * elenco UN/LOCODE ......... https://github.com/datasets/un-locode
  * nomi dei paesi ISO 3166-1  https://github.com/umpirsky/country-list

Uso:
    python3 strumenti/genera_dati_porti.py

Produce:
    dati/porti.js         localita' con funzione "porto" (caricato subito)
    dati/porti-estesi.js  tutte le altre localita' (caricato solo se serve)
"""

import csv
import io
import json
import re
import sys
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

URL_LOCODE = "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv"
URL_PAESI_EN = "https://raw.githubusercontent.com/umpirsky/country-list/master/data/en/country.json"
URL_PAESI_IT = "https://raw.githubusercontent.com/umpirsky/country-list/master/data/it/country.json"

RADICE = Path(__file__).resolve().parent.parent
CARTELLA_DATI = RADICE / "dati"

# Localita' che nell'elenco UN/LOCODE non risultano classificate come
# porto (colonna "Function") ma che sui moduli ISPS compaiono di continuo:
# vanno tenute nell'indice principale, altrimenti l'app non le riconosce.
FORZA_PORTO = {
    "TRAMB",  # Ambarli (Istanbul)
    "IDTPP",  # Tanjung Priok (Jakarta)
    "CNSHA",  # Shanghai (in UN/LOCODE e' l'aeroporto, ma si usa per il porto)
    "CNNGB",  # Ningbo
    "GRPAT",  # Patrasso
    "ITMIL",  # Milano (compare per errore al posto di un porto ligure)
}


def scarica(url: str) -> bytes:
    print(f"  scarico {url}")
    with urllib.request.urlopen(url, timeout=180) as risposta:
        return risposta.read()


def carica_locode() -> list:
    dati = scarica(URL_LOCODE)
    if dati[:2] == b"PK":  # eventuale zip
        with zipfile.ZipFile(io.BytesIO(dati)) as z:
            nome = [n for n in z.namelist() if n.lower().endswith(".csv")][0]
            dati = z.read(nome)
    testo = dati.decode("utf-8", errors="replace")
    return list(csv.DictReader(io.StringIO(testo)))


def e_porto(riga: dict) -> bool:
    funzione = riga.get("Function") or ""
    codice = (riga.get("Country") or "") + (riga.get("Location") or "")
    return funzione.startswith("1") or codice in FORZA_PORTO


def nome_pulito(riga: dict) -> str:
    nome = re.sub(r"\s+", " ", (riga.get("NameWoDiacritics") or riga.get("Name") or "").strip())
    # nell'elenco ufficiale le localita' cancellate hanno tutto il nome fra
    # parentesi; le parentesi interne invece sono nomi alternativi da tenere
    # (es. "El Iskandariya (Alexandria)") e le gestisce l'app.
    if nome.startswith("(") and nome.endswith(")"):
        nome = nome[1:-1].strip()
    return nome


def serializza(righe: list) -> str:
    """Formato compatto: una riga "IT" apre il paese, poi "CTA,Catania"."""
    per_paese = {}
    for riga in righe:
        paese = (riga.get("Country") or "").strip().upper()
        localita = (riga.get("Location") or "").strip().upper()
        nome = nome_pulito(riga)
        if len(paese) != 2 or len(localita) != 3 or not nome:
            continue
        per_paese.setdefault(paese, {}).setdefault(localita, nome)
    pezzi = []
    for paese in sorted(per_paese):
        pezzi.append(paese)
        for localita in sorted(per_paese[paese]):
            pezzi.append(f"{localita},{per_paese[paese][localita]}")
    return "\n".join(pezzi)


def scrivi_js(percorso: Path, nome_variabile: str, contenuto: dict) -> None:
    percorso.parent.mkdir(parents=True, exist_ok=True)
    corpo = json.dumps(contenuto, ensure_ascii=False, separators=(",", ":"))
    percorso.write_text(
        "/* File generato da strumenti/genera_dati_porti.py - non modificare a mano. */\n"
        f"(function(g){{ g.{nome_variabile} = {corpo}; }})"
        "(typeof self !== 'undefined' ? self : globalThis);\n",
        encoding="utf-8",
    )
    kb = percorso.stat().st_size / 1024
    print(f"  scritto {percorso.relative_to(RADICE)} ({kb:.0f} KB)")


def main() -> int:
    print("Generazione dati porti")
    righe = carica_locode()
    paesi_en = json.loads(scarica(URL_PAESI_EN).decode("utf-8"))
    paesi_it = json.loads(scarica(URL_PAESI_IT).decode("utf-8"))

    porti = [r for r in righe if e_porto(r)]
    altre = [r for r in righe if not e_porto(r)]
    print(f"  {len(porti)} porti, {len(altre)} altre localita'")

    paesi = {}
    for codice in sorted(set(paesi_en) | set(paesi_it)):
        nomi = []
        for nome in (paesi_en.get(codice), paesi_it.get(codice)):
            if nome and nome not in nomi:
                nomi.append(nome)
        if nomi:
            paesi[codice.upper()] = nomi

    scrivi_js(
        CARTELLA_DATI / "porti.js",
        "DATI_PORTI",
        {
            "fonte": "UN/LOCODE (UNECE) - sottoinsieme localita' portuali",
            "generato": date.today().isoformat(),
            "paesi": paesi,
            "elenco": serializza(porti),
        },
    )
    scrivi_js(
        CARTELLA_DATI / "porti-estesi.js",
        "DATI_PORTI_ESTESI",
        {
            "fonte": "UN/LOCODE (UNECE) - altre localita'",
            "generato": date.today().isoformat(),
            "elenco": serializza(altre),
        },
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
