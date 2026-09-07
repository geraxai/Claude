# Ultimi dieci approdi ISPS → PMIS

App per preparare l'inserimento nel **PMIS** degli ultimi dieci approdi di una nave.

Si carica il PDF del modulo *Ship Pre-Arrival Security Information Form* (SOLAS XI‑2/9 e
art. 6.3 Reg. CE 725/2004) e si ottiene un file di testo con una riga per approdo:

```
UNLOCODE:data di arrivo:data di partenza:sl:port facility
```

Per esempio:

```
MTMLA:28/08/2026:30/08/2026:1:MTMLA-0002
GRPIR:24/08/2026:26/08/2026:1:GRPIR-0011
```

Il file si scarica, si può modificare e si può salvare dove serve (anche su OneDrive di
Microsoft 365). Il nome del PDF di partenza non conta: va bene qualunque file.

**Niente da installare.** È una pagina web: si apre nel browser del PC e dell'iPhone.
Il PDF viene elaborato dentro il dispositivo e non viene inviato ad alcun server.

---

## Come si usa

1. Si tocca **Scegli il file PDF** e si seleziona il modulo (sul PC si può anche trascinarlo).
2. L'app legge la tabella *List the last ten calls at port facilities*. Se il PDF è una
   scansione, riconosce il testo da sola (serve qualche secondo in più).
3. Nel punto **2. Controllo dei dati** compaiono le dieci righe, con l'elenco delle
   correzioni fatte automaticamente. Ogni casella è modificabile.
4. Nel punto **3. Il file per il PMIS** c'è il testo definitivo, anch'esso modificabile a
   mano, con i pulsanti **Scarica il .txt**, **Condividi** (iPhone) e **Copia il testo**.

---

## Installazione sui dispositivi

### iPhone e iPad

1. Aprire con Safari l'indirizzo dell'app (vedi *Pubblicare l'app* qui sotto).
2. Toccare il pulsante di condivisione (il quadrato con la freccia) e poi
   **Aggiungi alla schermata Home**: compare un'icona come quella di una normale app.
3. Da quel momento funziona anche senza rete e il PDF si può prendere da **File**,
   da **Mail** o da **OneDrive**.
4. Per salvare il risultato conviene **Condividi**: si può mettere il .txt in File, su
   OneDrive, o inviarlo per posta. In alternativa **Copia il testo** e incollarlo dove serve.

### Windows

Due possibilità, entrambe senza installare programmi.

**A. Dal browser (consigliata: legge anche le scansioni).**
Aprire l'indirizzo dell'app con Edge o Chrome. Con *Impostazioni → Salva e condividi →
Aggiungi alla barra delle applicazioni* si ottiene un'icona sul desktop. Dopo la prima
apertura funziona anche senza rete.

**B. Un solo file sul PC.**
Copiare il file **`Ultimi-10-approdi-ISPS.html`** dove si vuole (anche in OneDrive) e
aprirlo con un doppio clic: contiene già tutto. Nota: aperto così, per limiti dei browser,
legge i PDF che contengono testo ma **non** le scansioni; per quelle serve la modalità A.

---

## Pubblicare l'app (una volta sola)

L'indirizzo si ottiene con GitHub Pages, senza costi:

1. Su GitHub aprire questo repository → **Settings** → **Pages**.
2. In *Build and deployment* scegliere **Deploy from a branch**, ramo `main`, cartella
   `/ (root)`, quindi **Save**.
3. Dopo un paio di minuti l'app è raggiungibile all'indirizzo indicato nella stessa
   pagina, del tipo `https://geraxai.github.io/Claude/`.

Quell'indirizzo è quello da aprire sull'iPhone e sul PC. Se il repository resta privato
GitHub Pages non è disponibile: in quel caso si può usare la versione a file unico
(modalità B) oppure pubblicare la cartella su un altro spazio web dell'ufficio.

---

## Correzioni automatiche

L'app non si limita a copiare quello che legge: incrocia i dati e sistema gli errori più
comuni, elencando sempre quello che ha cambiato.

| Situazione sul modulo | Cosa fa l'app |
| --- | --- |
| UN/LOCODE inesistente o letto male (`MTM1A`, `UA0DS`) | lo corregge con il codice valido più vicino |
| UN/LOCODE della città invece del porto (`TRIST` per Ambarli) | confronta codice, nome del porto e codice della port facility e tiene il valore sostenuto da più indizi |
| colonna UN/LOCODE vuota | ricava il codice dal nome del porto o dalla port facility |
| nome del porto in italiano o storico (`Pireo`, `Leghorn`, `Genova`) | lo riconosce e usa il nome ufficiale UN/LOCODE |
| nome del porto con errori di battitura (`Barcelonna`) | lo riconosce comunque |
| paese in italiano o abbreviato (`Grecia`, `UK`, `USA`) | lo riconosce e ne verifica la coerenza con il codice |
| anno sbagliato (`2025` in mezzo a righe del 2026) | ricalcola l'anno in base all'ordine cronologico delle altre righe |
| anno incompleto o a due cifre (`26`, `202`) | lo completa |
| data in formato americano (`07/30/2026`) | inverte giorno e mese |
| giorno inesistente (`31/04`) | lo riporta all'ultimo giorno del mese |
| arrivo e partenza invertiti | scambia le due date |
| righe in ordine dal più vecchio al più recente | se ne accorge e mantiene la coerenza |
| livello di sicurezza vuoto o illeggibile (`l`, `7`) | lo porta a 1, 2 o 3 e lo segnala |
| port facility con spazi o sporcizia dell'OCR (`EGPSD 0007`) | la riscrive come `EGPSD-0007` |
| codice della port facility di un altro porto | lo allinea all'UN/LOCODE della riga |

Le date, il formato della port facility e l'ordine delle righe si possono cambiare nel
riquadro **Opzioni**.

Il riconoscimento si appoggia all'elenco ufficiale UN/LOCODE dell'UNECE (oltre 17.000
località portuali) incluso nell'app, quindi funziona anche senza rete.

---

## Com'è fatta

```
index.html                 la pagina dell'app
css/stile.css              aspetto grafico
js/estrattore.js           trova la tabella nel PDF e ne legge le righe
js/correzioni.js           correzione di date, codici, livelli e port facility
js/database-porti.js       ricerca nell'elenco UN/LOCODE, tollerante agli errori
js/app.js                  interfaccia, lettura del PDF, OCR, salvataggio del .txt
dati/porti.js              elenco delle località portuali (generato)
dati/porti-estesi.js       altre località, caricate solo se servono (generato)
vendor/pdfjs               lettura dei PDF (Mozilla pdf.js)
vendor/tesseract           riconoscimento del testo delle scansioni (Tesseract.js)
sw.js, manifest.webmanifest funzionamento senza rete e icona sulla schermata Home
Ultimi-10-approdi-ISPS.html  tutta l'app in un unico file (generato)
extra-python/              vecchie versioni per PC con Python, non più necessarie
```

### Rigenerare i file prodotti da script

Serve solo a chi mette mano al progetto (Python 3 e Node.js):

```bash
python3 strumenti/genera_dati_porti.py   # riscarica l'elenco UN/LOCODE aggiornato
python3 strumenti/crea_file_unico.py     # ricrea la versione a file unico
python3 test/genera_pdf_prova.py         # ricrea i PDF di prova (reportlab, pillow, pypdfium2)
node test/test_estrattore.mjs            # 91 verifiche automatiche
npm install --no-save tesseract.js@5.1.1 && node test/test_ocr.mjs   # prova OCR
```

---

## Avvertenza

L'app fa il lavoro di trascrizione e segnala quello che corregge, ma la responsabilità del
dato inserito nel PMIS resta di chi compila: prima di salvare conviene sempre un'occhiata
alle righe evidenziate in giallo.
