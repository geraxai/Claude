/*
 * Test automatici del motore di estrazione e correzione.
 *
 * Usa gli stessi file js dell'app e il pdf.js incluso in vendor/, quindi
 * verifica esattamente il codice che gira nel browser.
 *
 * Esecuzione:  node test/test_estrattore.mjs
 * I PDF di prova si rigenerano con:  python3 test/genera_pdf_prova.py
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const radice = join(dirname(fileURLToPath(import.meta.url)), '..');

const pdfjs = require(join(radice, 'vendor/pdfjs/pdf.min.js'));
pdfjs.GlobalWorkerOptions.workerSrc = join(radice, 'vendor/pdfjs/pdf.worker.min.js');
require(join(radice, 'dati/porti.js'));
require(join(radice, 'dati/porti-estesi.js'));
const Estrattore = require(join(radice, 'js/estrattore.js'));
const ModuloDatabase = require(join(radice, 'js/database-porti.js'));
const Correzioni = require(join(radice, 'js/correzioni.js'));

const database = new ModuloDatabase.DatabasePorti().carica(globalThis.DATI_PORTI);
Correzioni.collegaDatabase(database);

const OGGI = new Date(Date.UTC(2026, 8, 7));

let superati = 0;
let falliti = 0;

function verifica(descrizione, condizione, dettaglio) {
  if (condizione) {
    superati++;
    console.log('  ok   ' + descrizione);
  } else {
    falliti++;
    console.log('  NO   ' + descrizione + (dettaglio ? '\n       ' + dettaglio : ''));
  }
}

function confronta(descrizione, ottenuto, atteso) {
  verifica(descrizione, ottenuto === atteso, 'ottenuto:  ' + ottenuto + '\n       atteso:    ' + atteso);
}

async function elabora(nomeFile, opzioni) {
  const dati = new Uint8Array(readFileSync(join(radice, 'test/pdf', nomeFile)));
  const documento = await pdfjs.getDocument({ data: dati, isEvalSupported: false }).promise;
  const pagine = await Estrattore.paroleDaDocumentoPdf(documento);
  const estratto = Estrattore.estraiDaParole(pagine);
  return {
    estratto,
    esito: Correzioni.correggi(estratto, database, Object.assign({ oggi: OGGI }, opzioni || {}))
  };
}

const ATTESO_PULITO = [
  'MTMLA;28/08/2026;30/08/2026;SL1;0002',
  'GRPIR;24/08/2026;26/08/2026;SL1;0011',
  'TRAMB;18/08/2026;20/08/2026;SL1;0005',
  'ROCND;12/08/2026;14/08/2026;SL2;0003',
  'UAODS;06/08/2026;08/08/2026;SL2;0001',
  'EGALY;30/07/2026;01/08/2026;SL1;0004',
  'EGPSD;24/07/2026;26/07/2026;SL1;0007',
  'ITGOA;18/07/2026;20/07/2026;SL1;0021',
  'ESBCN;10/07/2026;12/07/2026;SL1;0009',
  'ESALG;02/07/2026;05/07/2026;SL1;0012'
];

/* La tabella del modulo vero: dieci righe, tre volte lo stesso porto e un
   codice che non risulta nell'elenco UNECE. */
const ATTESO_REALE = [
  'MTMLA;28/07/2025;29/07/2025;SL1;0000',
  'EGDAM;19/07/2025;23/07/2025;SL1;0004',
  'TRALI;10/07/2025;17/07/2025;SL1;0002',
  'GRKLM;06/07/2025;08/07/2025;SL1;0002',
  'BGBAL;01/07/2025;02/07/2025;SL1;0001',
  'TRALI;26/06/2025;28/06/2025;SL1;0002',
  'ROCND;16/06/2025;24/06/2025;SL1;0106',
  'TRGEM;06/06/2025;14/06/2025;SL1;0001',
  'GRREU;30/05/2025;04/06/2025;SL1;0002',
  'TRALI;22/05/2025;29/05/2025;SL1;0002'
];

async function testModuloPulito() {
  console.log('\nModulo compilato correttamente');
  const { estratto, esito } = await elabora('modulo_pulito.pdf');
  confronta('dieci approdi estratti', esito.righe.length, 10);
  confronta('pagina della tabella', estratto.pagina, 1);
  verifica('intestazione della tabella riconosciuta', estratto.diagnostica.intestazioneTrovata === true);
  confronta('data del modulo (ETA) riconosciuta', Correzioni.formattaData(esito.dataModulo), '03/09/2026');
  const righe = Correzioni.formattaTesto(esito.righe).trim().split('\n');
  for (let i = 0; i < ATTESO_PULITO.length; i++) {
    confronta('riga ' + (i + 1), righe[i], ATTESO_PULITO[i]);
  }
  const conNote = esito.righe.filter((r) => r.note.length);
  verifica('nessuna correzione inventata', conNote.length === 0,
    conNote.map((r) => r.unlocode + ': ' + r.note.join(' ')).join('\n       '));
}

async function testModuloConErrori() {
  console.log('\nModulo con gli errori tipici');
  const { esito } = await elabora('modulo_con_errori.pdf');
  confronta('dieci approdi estratti', esito.righe.length, 10);
  const righe = Correzioni.formattaTesto(esito.righe).trim().split('\n');
  for (let i = 0; i < ATTESO_PULITO.length; i++) {
    confronta('riga ' + (i + 1) + ' corretta', righe[i], ATTESO_PULITO[i]);
  }
  verifica('riga 1: segnalata la correzione del codice', esito.righe[0].note.length > 0);
  confronta('riga 2: porto italiano tradotto nel nome ufficiale', esito.righe[1].porto, 'Piraeus');
  verifica('riga 2: colonna UN/LOCODE vuota segnalata',
    esito.righe[1].note.join(' ').indexOf('GRPIR') >= 0, esito.righe[1].note.join(' '));
  verifica('riga 3: citta\' corretta con il porto',
    esito.righe[2].note.join(' ').toLowerCase().indexOf('trist') >= 0, esito.righe[2].note.join(' '));
  verifica('riga 4: anno corretto',
    esito.righe[3].note.join(' ').toLowerCase().indexOf('anno') >= 0, esito.righe[3].note.join(' '));
  verifica('riga 6: giorno e mese invertiti segnalati',
    esito.righe[5].note.join(' ').toLowerCase().indexOf('invert') >= 0, esito.righe[5].note.join(' '));
  verifica('riga 8: livello di sicurezza mancante segnalato',
    esito.righe[7].note.join(' ').toLowerCase().indexOf('livello') >= 0, esito.righe[7].note.join(' '));
  verifica('riga 9: nome del porto storpiato riconosciuto',
    esito.righe[8].note.join(' ').indexOf('Barcelona') >= 0, esito.righe[8].note.join(' '));
  verifica('riga 10: date invertite scambiate',
    esito.righe[9].note.join(' ').toLowerCase().indexOf('scambiate') >= 0, esito.righe[9].note.join(' '));
}

async function testOrdineInverso() {
  console.log('\nModulo compilato dal piu\' vecchio al piu\' recente');
  const { esito } = await elabora('modulo_ordine_inverso.pdf');
  confronta('dieci approdi estratti', esito.righe.length, 10);
  verifica('ordine crescente riconosciuto', esito.ordineCrescenteNelPdf === true);
  const righe = Correzioni.formattaTesto(esito.righe).trim().split('\n');
  const atteso = ATTESO_PULITO.slice().reverse();
  for (let i = 0; i < atteso.length; i++) {
    confronta('riga ' + (i + 1), righe[i], atteso[i]);
  }
}

async function testRigheParziali() {
  console.log('\nModulo con solo quattro approdi (righe restanti vuote)');
  const { esito } = await elabora('modulo_righe_parziali.pdf');
  confronta('quattro approdi estratti', esito.righe.length, 4);
  const righe = Correzioni.formattaTesto(esito.righe).trim().split('\n');
  for (let i = 0; i < 4; i++) {
    confronta('riga ' + (i + 1), righe[i], ATTESO_PULITO[i]);
  }
  verifica('nessuna riga inventata dalle celle vuote',
    esito.righe.every((riga) => riga.unlocode && riga.arrivo && riga.partenza));
}

async function testTabellaSuDuePagine() {
  console.log('\nModulo con la tabella spezzata su due pagine');
  const { estratto, esito } = await elabora('modulo_due_pagine.pdf');
  confronta('pagine del PDF', estratto.diagnostica.pagine, 2);
  confronta('dieci approdi estratti', esito.righe.length, 10);
  const righe = Correzioni.formattaTesto(esito.righe).trim().split('\n');
  for (let i = 0; i < ATTESO_PULITO.length; i++) {
    confronta('riga ' + (i + 1), righe[i], ATTESO_PULITO[i]);
  }
}

/*
 * Il caso che conta davvero: il .txt deve rispecchiare la tabella del PDF
 * riga per riga, senza saltare i porti ripetuti e senza sostituire i codici
 * che non risultano nell'elenco UN/LOCODE.
 */
async function testModuloReale() {
  console.log('\nTabella copiata da un modulo vero');
  const { esito } = await elabora('modulo_reale.pdf');
  confronta('dieci approdi estratti', esito.righe.length, 10);
  const testo = Correzioni.formattaTesto(esito.righe);
  const righe = testo.trim().split('\n');
  confronta('dieci righe nel file', righe.length, 10);
  for (let i = 0; i < ATTESO_REALE.length; i++) {
    confronta('riga ' + (i + 1), righe[i], ATTESO_REALE[i]);
  }
  confronta('lo stesso porto toccato tre volte',
    esito.righe.filter((r) => r.unlocode === 'TRALI').length, 3);
  verifica('port facility 0000 tenuta com\'e\'', esito.righe[0].facility === '0000',
    esito.righe[0].facility);
  verifica('codice fuori elenco lasciato sul suo posto',
    esito.righe[8].unlocode === 'GRREU', esito.righe[8].unlocode);
  verifica('codice fuori elenco segnalato',
    esito.righe[8].note.join(' ').indexOf('GRREU') >= 0, esito.righe[8].note.join(' '));

  const altreNote = esito.righe.filter((r, i) => i !== 8 && r.note.length);
  verifica('nessun\'altra riga da verificare', altreNote.length === 0,
    altreNote.map((r) => r.unlocode + ': ' + r.note.join(' ')).join('\n       '));
}

/* Gli approdi devono incastrarsi: niente sovrapposizioni fra una riga e la
   successiva, e la partenza non puo' venire prima dell'arrivo. */
function testConsecutivita() {
  console.log('\nApprodi consecutivi');
  const finto = {
    righe: [
      { numero: 1, arrivo: '28/08/2026', partenza: '30/08/2026', porto: 'Valletta', paese: 'Malta', unlocode: 'MTMLA', facility: '0002', sl: '1' },
      { numero: 2, arrivo: '20/08/2026', partenza: '29/08/2026', porto: 'Piraeus', paese: 'Greece', unlocode: 'GRPIR', facility: '0011', sl: '1' },
      { numero: 3, arrivo: '10/08/2026', partenza: '12/08/2026', porto: 'Ambarli', paese: 'Turkey', unlocode: 'TRAMB', facility: '0005', sl: '1' }
    ]
  };
  const esito = Correzioni.correggi(finto, database, { oggi: OGGI });
  verifica('sovrapposizione segnalata, con il numero dell\'altro approdo',
    esito.righe[0].note.join(' ').indexOf('sovrappone all\'approdo n. 2') >= 0,
    esito.righe[0].note.join(' '));
  confronta('le date restano quelle del modulo', Correzioni.formattaRiga(esito.righe[1]),
    'GRPIR;20/08/2026;29/08/2026;SL1;0011');
  verifica('le righe in fila non sono segnalate',
    esito.righe[1].note.length === 0 && esito.righe[2].note.length === 0,
    esito.righe[1].note.concat(esito.righe[2].note).join(' '));
}

async function testOpzioni() {
  console.log('\nOpzioni');
  const invertito = await elabora('modulo_pulito.pdf', { ordine: 'vecchio' });
  confronta('ordine dal piu\' vecchio', invertito.esito.righe[0].unlocode, 'ESALG');
  confronta('ordine dal piu\' recente',
    (await elabora('modulo_pulito.pdf', { ordine: 'recente' })).esito.righe[0].unlocode, 'MTMLA');
}

function testDatabase() {
  console.log('\nRicerche nell\'elenco UN/LOCODE');
  confronta('codice esistente', database.nomeDiCodice('ITCTA'), 'Catania');
  confronta('nome italiano di porto estero', database.cercaPerNome('Pireo', 'GR').codice, 'GRPIR');
  confronta('nome inglese di porto italiano', database.cercaPerNome('Genoa', 'IT').codice, 'ITGOA');
  confronta('nome con errore di battitura', database.cercaPerNome('Barcelonna', 'ES').codice, 'ESBCN');
  confronta('nome storico', database.cercaPerNome('Leghorn', null).codice, 'ITLIV');
  confronta('porto con nome fra parentesi', database.cercaPerNome('Alexandria', 'EG').codice, 'EGALY');
  confronta('paese in italiano', database.paeseDaNome('Grecia'), 'GR');
  confronta('paese in inglese', database.paeseDaNome('Turkey'), 'TR');
  confronta('sigla di paese', database.paeseDaNome('IT'), 'IT');
  confronta('paese con errore di battitura', database.paeseDaNome('Ucrainia'), 'UA');
  confronta('codice sbagliato di una lettera', database.correggiCodice('MTM1A', 'MT').codice, 'MTMLA');
  confronta('nome che non esiste', database.cercaPerNome('Zzzqqxx', null), null);
}

function testLetturaRiga() {
  console.log('\nLettura di righe difficili');
  function leggi(testo) {
    const parole = testo.split(' ').map((t, i) => ({
      testo: t, x0: i * 10, x1: i * 10 + 8, y: 100, altezza: 8
    }));
    return Estrattore.leggiRigaApprodo({ testo, parole, y: 100 });
  }
  const conNomeDoppio = leggi('7 24/07/2026 26/07/2026 Port Said Egypt EGPSD Suez Canal Container Terminal SL = 2');
  confronta('porto su due parole', conNomeDoppio.porto, 'Port Said');
  confronta('paese isolato', conNomeDoppio.paese, 'Egypt');
  confronta('codice riconosciuto', conNomeDoppio.unlocode, 'EGPSD');
  confronta('port facility con nome lungo', conNomeDoppio.facility, 'Suez Canal Container Terminal');
  confronta('livello di sicurezza', conNomeDoppio.sl, '2');

  const nomePortoDiCinqueLettere = leggi('1 28/08/2026 30/08/2026 Genoa Italy ITGOA ITGOA-0021 SL = 1');
  confronta('nome di cinque lettere non confuso col codice', nomePortoDiCinqueLettere.unlocode, 'ITGOA');
  confronta('porto letto correttamente', nomePortoDiCinqueLettere.porto, 'Genoa');

  const senzaCodice = leggi('2 24/08/2026 26/08/2026 Valletta Malta Valletta Cruise Port SL = 1');
  confronta('senza UN/LOCODE: porto', senzaCodice.porto, 'Valletta');
  confronta('senza UN/LOCODE: paese', senzaCodice.paese, 'Malta');
  confronta('senza UN/LOCODE: facility', senzaCodice.facility, 'Valletta Cruise Port');

  const dataSpezzata = leggi('3 18/08/2026 20 / 08 / 2026 Ambarli Turkey TRAMB TRAMB-0005 SL=1');
  confronta('data spezzata in piu\' parole', dataSpezzata.partenza, '20/08/2026');
  confronta('livello attaccato all\'etichetta', dataSpezzata.sl, '1');

  const codiceSpezzato = leggi('4 12/08/2026 14/08/2026 Constanta Romania RO CND ROCND-0003 SL = 2');
  confronta('codice spezzato in due parole', codiceSpezzato.unlocode, 'ROCND');
}

/* L'app decide se vale la pena rileggere una scansione girata guardando se ha
   almeno riconosciuto l'intestazione della tabella. */
function testDiagnostica() {
  console.log('\nDiagnostica dell\'estrazione');
  function parole(testo, y) {
    return testo.split(' ').map((t, i) => ({
      testo: t, x0: i * 12, x1: i * 12 + 10, y: y, altezza: 8
    }));
  }
  const illeggibile = Estrattore.estraiDaParole([parole('yzq wm rrn xdh lkk', 100)]);
  verifica('pagina illeggibile: intestazione non trovata',
    illeggibile.diagnostica.intestazioneTrovata === false);
  confronta('pagina illeggibile: nessuna riga', illeggibile.righe.length, 0);
}

function testDate() {
  console.log('\nCorrezione delle date');
  const soloUnaRiga = (arrivo, partenza) => Correzioni.armonizzaDate(
    [{ arrivo, partenza }],
    { oggi: OGGI, annoRiferimento: 2026 }
  ).esiti[0];

  confronta('cifre lette male dall\'OCR',
    Correzioni.formattaData(soloUnaRiga('l2/O8/2O26', '14/08/2026').arrivo), '12/08/2026');
  confronta('anno a due cifre',
    Correzioni.formattaData(soloUnaRiga('12/08/26', '14/08/26').arrivo), '12/08/2026');
  confronta('anno incompleto',
    Correzioni.formattaData(soloUnaRiga('12/08/202', '14/08/2026').arrivo), '12/08/2026');
  confronta('giorno inesistente',
    Correzioni.formattaData(soloUnaRiga('31/04/2026', '02/05/2026').arrivo), '30/04/2026');
  confronta('data nel futuro riportata all\'anno giusto',
    Correzioni.formattaData(soloUnaRiga('12/08/2027', '14/08/2027').arrivo), '12/08/2026');
  confronta('separatori con punti',
    Correzioni.formattaData(soloUnaRiga('12.08.2026', '14.08.2026').arrivo), '12/08/2026');

  const sequenza = Correzioni.armonizzaDate([
    { arrivo: '28/08/2026', partenza: '30/08/2026' },
    { arrivo: '24/08/2025', partenza: '26/08/2025' },
    { arrivo: '18/08/2026', partenza: '20/08/2026' }
  ], { oggi: OGGI, annoRiferimento: 2026 });
  confronta('anno fuori sequenza corretto',
    Correzioni.formattaData(sequenza.esiti[1].arrivo), '24/08/2026');
}

function testLivelliEFacility() {
  console.log('\nLivello di sicurezza e port facility');
  const note = [];
  confronta('livello letto come lettera', Correzioni.correggiLivello({ sl: 'l' }, note).sl, '1');
  confronta('livello fuori scala', Correzioni.correggiLivello({ sl: '7' }, note).sl, '1');
  confronta('livello valido', Correzioni.correggiLivello({ sl: '3' }, note).sl, '3');
  confronta('livello assente', Correzioni.correggiLivello({ sl: '' }, note).sl, '1');

  confronta('livello scritto SL1 nel file', Correzioni.formattaLivello('1'), 'SL1');
  confronta('livello gia\' scritto SL2 non raddoppiato', Correzioni.formattaLivello('SL2'), 'SL2');

  confronta('facility con spazio',
    Correzioni.correggiFacility({ facility: 'ITCTA 0001' }, 'ITCTA', note).facility, '0001');
  confronta('facility scritta come solo numero',
    Correzioni.correggiFacility({ facility: '12' }, 'ITCTA', note).facility, '0012');
  confronta('numero zero tenuto',
    Correzioni.correggiFacility({ facility: 'MTMLA-0000' }, 'MTMLA', note).facility, '0000');
  confronta('sporcizia dell\'OCR attorno al codice',
    Correzioni.correggiFacility({ facility: 'Ske MTMLA-0002' }, 'MTMLA', note).facility, '0002');
  confronta('facility con codice di un altro porto: tenuto il numero',
    Correzioni.correggiFacility({ facility: 'ITAUG-0003' }, 'ITCTA', note).facility, '0003');

  const noteDescrittiva = [];
  confronta('facility descrittiva: numero da chiedere',
    Correzioni.correggiFacility({ facility: 'Terminal Rada San Filippo' }, 'ITCTA', noteDescrittiva).facility, '');
  verifica('facility descrittiva segnalata', noteDescrittiva.length === 1, noteDescrittiva.join(' '));
  confronta('nome con numero non confuso con un codice',
    Correzioni.correggiFacility({ facility: 'Malta Freeport Terminal 2' }, 'MTMAR', note).facility, '');
}

/* L'elenco UN/LOCODE non e' completo: un codice che non c'e' non va
   sostituito, a meno che gli altri dati della riga dicano chiaramente altro. */
function testCodiciFuoriElenco() {
  console.log('\nCodici non presenti nell\'elenco');
  const soloCodice = [];
  const tenuto = Correzioni.correggiPorto(
    { unlocode: 'GRREU', porto: 'Aegean anchorage', paese: 'Greece', facility: '0002' },
    database, soloCodice
  );
  confronta('codice ignoto tenuto quando non c\'e\' altro', tenuto.unlocode, 'GRREU');
  verifica('e\' segnalato', soloCodice.join(' ').indexOf('GRREU') >= 0, soloCodice.join(' '));

  const conProve = [];
  const corretto = Correzioni.correggiPorto(
    { unlocode: 'MTM1A', porto: 'Valletta', paese: 'Malta', facility: 'MTMLA-0002' },
    database, conProve
  );
  confronta('codice storpiato corretto se porto e facility concordano', corretto.unlocode, 'MTMLA');
  verifica('la correzione e\' spiegata', conProve.join(' ').indexOf('MTM1A') >= 0, conProve.join(' '));
}

(async function eseguiTest() {
  console.log('Test estrattore ISPS -> PMIS');
  testDatabase();
  testLetturaRiga();
  testDiagnostica();
  testDate();
  testLivelliEFacility();
  testCodiciFuoriElenco();
  testConsecutivita();
  await testModuloPulito();
  await testModuloReale();
  await testModuloConErrori();
  await testOrdineInverso();
  await testRigheParziali();
  await testTabellaSuDuePagine();
  await testOpzioni();
  console.log('\nRisultato: ' + superati + ' verifiche superate, ' + falliti + ' fallite');
  process.exit(falliti ? 1 : 0);
}()).catch((errore) => {
  console.error(errore);
  process.exit(2);
});
