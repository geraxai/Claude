/*
 * Test del percorso OCR: parte da una finta scansione (immagine storta,
 * sfocata e sporca) e verifica che l'app ricostruisca comunque le dieci righe.
 *
 * Nel browser l'OCR gira con il Tesseract incluso in vendor/tesseract; qui usa
 * il pacchetto npm tesseract.js (stesso motore) con i dati di lingua di
 * vendor/tesseract, percio' verifica anche che quel file sia utilizzabile.
 *
 * Preparazione:  npm install --no-save tesseract.js@5.1.1
 * Esecuzione:    node test/test_ocr.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createWorker } from 'tesseract.js';

const require = createRequire(import.meta.url);
const radice = join(dirname(fileURLToPath(import.meta.url)), '..');

require(join(radice, 'dati/porti.js'));
const Estrattore = require(join(radice, 'js/estrattore.js'));
const ModuloDatabase = require(join(radice, 'js/database-porti.js'));
const Correzioni = require(join(radice, 'js/correzioni.js'));

const database = new ModuloDatabase.DatabasePorti().carica(globalThis.DATI_PORTI);
Correzioni.collegaDatabase(database);

const ATTESO = [
  'MTMLA:28/08/2026:30/08/2026:1:MTMLA-0002',
  'GRPIR:24/08/2026:26/08/2026:1:GRPIR-0011',
  'TRAMB:18/08/2026:20/08/2026:1:TRAMB-0005',
  'ROCND:12/08/2026:14/08/2026:2:ROCND-0003',
  'UAODS:06/08/2026:08/08/2026:2:UAODS-0001',
  'EGALY:30/07/2026:01/08/2026:1:EGALY-0004',
  'EGPSD:24/07/2026:26/07/2026:1:EGPSD-0007',
  'ITGOA:18/07/2026:20/07/2026:1:ITGOA-0021',
  'ESBCN:10/07/2026:12/07/2026:1:ESBCN-0009',
  'ESALG:02/07/2026:05/07/2026:1:ESALG-0012'
];

console.log('Test OCR su scansione finta');
const lavoratore = await createWorker('eng', 1, {
  langPath: join(radice, 'vendor/tesseract'),
  gzip: true,
  logger: () => {}
});
// Tesseract.js userebbe la modalita' "blocco unico", che sui moduli a tabella
// perde interi contenuti di cella: serve la segmentazione automatica.
await lavoratore.setParameters({ tessedit_pageseg_mode: '3' });
const riconoscimento = await lavoratore.recognize(
  join(radice, 'test/pdf/scansione.png'), {}, { blocks: true }
);
await lavoratore.terminate();

const parole = [];
for (const blocco of riconoscimento.data.blocks || []) {
  for (const paragrafo of blocco.paragraphs || []) {
    for (const riga of paragrafo.lines || []) {
      for (const parola of riga.words || []) { parole.push(parola); }
    }
  }
}
console.log('  parole riconosciute: ' + parole.length);

const estratto = Estrattore.estraiDaParole([Estrattore.paroleDaOcr(parole)]);
const esito = Correzioni.correggi(estratto, database, { oggi: new Date(Date.UTC(2026, 8, 7)) });
const righe = Correzioni.formattaTesto(esito.righe).trim().split('\n');

let falliti = 0;
console.log('  righe estratte: ' + esito.righe.length);
for (let i = 0; i < ATTESO.length; i++) {
  if (righe[i] === ATTESO[i]) {
    console.log('  ok   riga ' + (i + 1));
  } else {
    falliti++;
    console.log('  NO   riga ' + (i + 1) + '\n       ottenuto:  ' + righe[i] +
      '\n       atteso:    ' + ATTESO[i]);
  }
}
for (const riga of esito.righe) {
  if (riga.note.length) { console.log('  nota riga ' + riga.numero + ': ' + riga.note.join(' ')); }
}
console.log(falliti ? '\nRisultato: ' + falliti + ' righe diverse dall\'atteso' : '\nRisultato: OCR corretto su tutte le righe');
process.exit(falliti ? 1 : 0);
