/*
 * Misura i tempi dell'app in un browser vero, con la rete rallentata come su
 * un telefono, e riporta tre momenti:
 *
 *   utilizzabile         si puo' gia' scegliere il file
 *   risultati (testo)    dalle dieci righe a schermo, partendo da un PDF con testo
 *   risultati (scansione) lo stesso, ma passando dal riconoscimento del testo
 *
 * Serve a non peggiorare le prestazioni senza accorgersene: i pezzi grossi
 * (pdf.js, il suo worker, l'elenco dei porti) vengono caricati in parallelo e
 * un errore in quell'intreccio si vede qui, non nei test di correttezza.
 *
 * Preparazione:  npm install --no-save puppeteer-core@23
 *                python3 -m http.server 8080   (dalla radice del progetto)
 * Esecuzione:    node test/misura_prestazioni.mjs [indirizzo]
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const radice = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDIRIZZO = process.argv[2] || 'http://localhost:8080/index.html';
const CROMO = process.env.CHROME || '/usr/local/bin/google-chrome';
const GIRI = 3;

const PROFILI = [
  ['rete veloce', null],
  ['4G lenta', { downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8, latency: 150 }],
  ['3G', { downloadThroughput: 400e3 / 8, uploadThroughput: 400e3 / 8, latency: 400 }]
];

async function misura(profilo, pdf) {
  const browser = await puppeteer.launch({
    executablePath: CROMO,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const pagina = await browser.newPage();
    if (profilo) {
      const cdp = await pagina.createCDPSession();
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', Object.assign({ offline: false }, profilo));
    }
    const chieste = [];
    pagina.on('request', (r) => chieste.push(r.url()));

    await pagina.goto(INDIRIZZO, { waitUntil: 'domcontentloaded', timeout: 300000 });
    const utilizzabile = await pagina.evaluate(
      () => performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd
    );

    const campo = await pagina.$('#campoFile');
    await campo.uploadFile(join(radice, 'test/pdf', pdf));
    await pagina.waitForFunction(
      () => !document.getElementById('riquadroFile').classList.contains('nascosto'),
      { timeout: 600000 }
    );
    const risultati = await pagina.evaluate(() => performance.now());
    const righe = await pagina.evaluate(
      () => document.getElementById('testoFinale').value.trim().split('\n').length
    );

    // ogni file dell'app deve arrivare una volta sola: un doppio download e'
    // il modo tipico in cui il caricamento in parallelo si rompe
    const doppioni = Object.entries(chieste.reduce((c, u) => {
      const nome = u.replace(/^https?:\/\/[^/]+\//, '');
      if (/\.(js|json)$/.test(nome)) { c[nome] = (c[nome] || 0) + 1; }
      return c;
    }, {})).filter(([, n]) => n > 1).map(([nome]) => nome);

    return { utilizzabile, risultati, righe, doppioni };
  } finally {
    await browser.close();
  }
}

function mediana(valori) {
  const v = valori.slice().sort((a, b) => a - b);
  return Math.round(v[Math.floor(v.length / 2)]);
}

let problemi = 0;
console.log('Prestazioni di ' + INDIRIZZO);

for (const [nome, profilo] of PROFILI) {
  const riga = [nome.padEnd(12)];
  let utilizzabile = [];
  for (const [etichetta, pdf, attese] of [
    ['testo', 'modulo_con_errori.pdf', 10],
    ['scansione', 'modulo_scansione.pdf', 10]
  ]) {
    const prove = [];
    for (let giro = 0; giro < GIRI; giro++) { prove.push(await misura(profilo, pdf)); }
    utilizzabile = utilizzabile.concat(prove.map((p) => p.utilizzabile));
    riga.push(etichetta + ' ' + String(mediana(prove.map((p) => p.risultati))).padStart(6) + ' ms');
    for (const prova of prove) {
      if (prova.righe !== attese) {
        problemi++;
        console.log('  NO   ' + nome + '/' + etichetta + ': ' + prova.righe + ' righe invece di ' + attese);
      }
      if (prova.doppioni.length) {
        problemi++;
        console.log('  NO   ' + nome + '/' + etichetta + ': scaricati due volte ' + prova.doppioni.join(', '));
      }
    }
  }
  console.log('  ' + riga[0] + '  utilizzabile ' + String(mediana(utilizzabile)).padStart(6) + ' ms   ' +
    riga.slice(1).join('   '));
}

console.log(problemi ? '\n' + problemi + ' problemi rilevati' : '\nNessun problema rilevato');
process.exit(problemi ? 1 : 0);
