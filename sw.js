/*
 * Service worker: tiene l'app in memoria del browser cosi' funziona anche
 * senza rete (utile a bordo o in banchina). Il PDF non esce mai dal
 * dispositivo, qui si conservano solo i file dell'app.
 */
'use strict';

var VERSIONE = 'isps-pmis-4';
var DEPOSITO = VERSIONE;

/* Quello che serve sempre: viene scaricato alla prima visita. */
var ESSENZIALE = [
  './',
  'index.html',
  'css/stile.css',
  'js/database-porti.js',
  'js/estrattore.js',
  'js/correzioni.js',
  'js/app.js',
  'dati/porti.js',
  'vendor/pdfjs/pdf.min.js',
  'vendor/pdfjs/pdf.worker.min.js',
  'manifest.webmanifest',
  'icona.svg',
  'icona-180.png',
  'icona-192.png'
];

/* Pesante e non sempre necessario (serve solo per le scansioni): viene
   conservato quando lo si usa, oppure su richiesta dall'app. */
var OCR = [
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-simd.wasm.js',
  'vendor/tesseract/tesseract-core.wasm.js',
  'vendor/tesseract/eng.traineddata.gz'
];

self.addEventListener('install', function (evento) {
  evento.waitUntil(
    caches.open(DEPOSITO).then(function (deposito) {
      // 'reload' salta la copia che il browser tiene per conto suo: senza,
      // subito dopo un aggiornamento il deposito nuovo rischia di riempirsi
      // con i file vecchi ancora validi per la cache di rete, e l'app
      // resterebbe indietro fino alla loro scadenza
      var elenco;
      try {
        elenco = ESSENZIALE.map(function (indirizzo) {
          return new Request(indirizzo, { cache: 'reload' });
        });
      } catch (senzaModoCache) {
        elenco = ESSENZIALE;
      }
      return deposito.addAll(elenco);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil(
    caches.keys().then(function (nomi) {
      return Promise.all(nomi.map(function (nome) {
        return nome === DEPOSITO ? null : caches.delete(nome);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (evento) {
  if (!evento.data || evento.data.tipo !== 'prepara-offline') { return; }
  var risposta = evento.ports && evento.ports[0];
  caches.open(DEPOSITO).then(function (deposito) {
    return deposito.addAll(OCR);
  }).then(function () {
    if (risposta) { risposta.postMessage({ esito: 'ok' }); }
  }).catch(function (errore) {
    if (risposta) { risposta.postMessage({ esito: 'errore', messaggio: String(errore) }); }
  });
});

self.addEventListener('fetch', function (evento) {
  var richiesta = evento.request;
  if (richiesta.method !== 'GET') { return; }
  var indirizzo = new URL(richiesta.url);
  if (indirizzo.origin !== self.location.origin) { return; }

  /*
   * La pagina esce dal deposito, non dalla rete, cosi' l'HTML e i file
   * JavaScript arrivano sempre dalla stessa versione dell'app: quando il
   * service worker si aggiorna li sostituisce tutti insieme e al ricaricamento
   * successivo la pagina e' quella nuova. Prendendo invece l'HTML dalla rete e
   * il resto dal deposito poteva capitare la pagina nuova con il codice
   * vecchio: cercava un pezzo di pagina che non c'era piu' e l'app si fermava
   * con "Cannot read properties of null".
   */
  if (richiesta.mode === 'navigate') {
    evento.respondWith(
      caches.open(DEPOSITO).then(function (deposito) {
        return deposito.match('index.html');
      }).then(function (salvata) {
        return salvata || fetch(richiesta);
      }).catch(function () { return fetch(richiesta); })
    );
    return;
  }

  evento.respondWith(
    caches.match(richiesta).then(function (salvata) {
      if (salvata) { return salvata; }
      return fetch(richiesta).then(function (risposta) {
        if (risposta && risposta.ok && risposta.type === 'basic') {
          var copia = risposta.clone();
          caches.open(DEPOSITO).then(function (deposito) {
            deposito.put(richiesta, copia);
          });
        }
        return risposta;
      });
    })
  );
});
