# Ultimi dieci approdi ISPS → PMIS

### 👉 <https://geraxai.github.io/Claude/>

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

1. Aprire con Safari <https://geraxai.github.io/Claude/>.
2. Toccare il pulsante di condivisione (il quadrato con la freccia) e poi
   **Aggiungi alla schermata Home**: compare un'icona come quella di una normale app.
3. Da quel momento funziona anche senza rete e il PDF si può prendere da **File**,
   da **Mail** o da **OneDrive**.
4. Per salvare il risultato conviene **Condividi**: si può mettere il .txt in File, su
   OneDrive, o inviarlo per posta. In alternativa **Copia il testo** e incollarlo dove serve.

### Windows

Due possibilità, entrambe senza installare programmi.

**A. Dal browser (consigliata).**
Aprire <https://geraxai.github.io/Claude/> con Edge o Chrome. Con *Impostazioni → Salva e condividi →
Aggiungi alla barra delle applicazioni* si ottiene un'icona sul desktop. Dopo la prima
apertura funziona anche senza rete, scansioni comprese.

**B. Un solo file sul PC.**
Copiare il file **`Ultimi-10-approdi-ISPS.html`** dove si vuole (anche in OneDrive) e
aprirlo con un doppio clic: contiene già tutto e legge sia i PDF con testo sia le scansioni.
Unica differenza rispetto alla modalità A: per le scansioni serve il collegamento a internet,
perché aperto come file locale il browser non gli lascia usare la copia del riconoscimento
del testo che sta lì accanto e deve scaricarla al momento.

---

## L'indirizzo dell'app

L'app è pubblicata con GitHub Pages, senza costi, a questo indirizzo:

**<https://geraxai.github.io/Claude/>**

È quello da aprire sull'iPhone e sul PC, e da mandare a chi deve usarla. Si aggiorna da
solo a ogni modifica portata sul ramo `main`.

La pubblicazione è già configurata (*Settings → Pages*, ramo `main`, cartella `/ (root)`).
Va rifatta solo se si sposta il progetto in un altro repository; in quel caso l'indirizzo
cambia di conseguenza. Se il repository venisse reso privato, GitHub Pages non sarebbe più
disponibile: resterebbero la versione a file unico o la pubblicazione su un altro spazio
web dell'ufficio.

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
| mese scritto a parole (`28 AUG 2026`, `28/ago/2026`) | lo riporta in cifre |
| giorno inesistente (`31/04`) | lo riporta all'ultimo giorno del mese |
| arrivo e partenza invertiti | scambia le due date |
| righe in ordine dal più vecchio al più recente | se ne accorge e mantiene la coerenza |
| livello di sicurezza vuoto o illeggibile (`l`, `7`) | lo porta a 1, 2 o 3 e lo segnala |
| port facility con spazi o sporcizia dell'OCR (`EGPSD 0007`) | la riscrive come `EGPSD-0007` |
| codice della port facility di un altro porto | lo allinea all'UN/LOCODE della riga |
| tabella che continua sulla pagina seguente | la legge per intero |
| scansione entrata nello scanner coricata | riprova a leggerla girando la pagina |

Le date, il formato della port facility e l'ordine delle righe si possono cambiare nel
riquadro **Opzioni**.

Il riconoscimento si appoggia all'elenco ufficiale UN/LOCODE dell'UNECE (oltre 17.000
località portuali) incluso nell'app, quindi funziona anche senza rete.

---

## Velocità

Con i PDF che contengono testo il lavoro vero dura pochi decimi di secondo: quasi tutta
l'attesa, la prima volta, è il tempo di scaricare l'app. Perciò i pezzi grossi (pdf.js, il
suo *worker* e l'elenco dei porti) non vengono aspettati per mostrare la pagina: partono
insieme e arrivano mentre si sceglie il file. Il risultato, misurato su rete lenta da
telefono, è che l'app diventa utilizzabile circa tre volte prima.

| | pagina utilizzabile | dieci righe a schermo |
| --- | --- | --- |
| rete veloce | 0,1 s | 0,3 s |
| 4G lenta | 1,4 s | 4,5 s |
| 3G | 5,0 s | 16,7 s |

Dalla seconda apertura non si scarica più nulla, perché l'app resta in memoria del browser:
i tempi diventano quelli della riga "rete veloce".

Altre scelte fatte per non far aspettare:

- l'elenco dei porti serve solo alla correzione finale, quindi il PDF viene aperto e letto
  senza attenderlo;
- il *worker* di pdf.js viene avviato in anticipo e poi riusato, invece di essere chiesto al
  primo file scelto;
- la copia dell'app per l'uso senza rete viene messa da parte solo dopo che è arrivato il
  necessario, per non rubare banda a chi sta aspettando;
- con le scansioni il motore di riconoscimento si prepara mentre la prima pagina viene
  disegnata, e la lettura si ferma appena la tabella è stata trovata.

Sulle scansioni la risoluzione resta 200 DPI: scendere a 150 farebbe risparmiare pochissimo
tempo (il costo è quasi tutto fisso) e la lettura della tabella crollerebbe da dieci righe
corrette su dieci a una.

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
test/misura_prestazioni.mjs tempi in un browser vero, con la rete rallentata
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
node test/test_estrattore.mjs            # 112 verifiche automatiche
npm install --no-save tesseract.js@5.1.1 && node test/test_ocr.mjs   # prova OCR
```

Per misurare i tempi in un browser vero, con la rete rallentata come su un telefono
(serve un server locale attivo, per esempio `python3 -m http.server 8080`):

```bash
npm install --no-save puppeteer-core@23 && node test/misura_prestazioni.mjs
```

Controlla anche che nessun file dell'app venga scaricato due volte: è il modo tipico in
cui il caricamento in parallelo si rompe senza dare errori.

---

## Avvertenza

L'app fa il lavoro di trascrizione e segnala quello che corregge, ma la responsabilità del
dato inserito nel PMIS resta di chi compila: prima di salvare conviene sempre un'occhiata
alle righe evidenziate in giallo.
