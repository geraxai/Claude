/*
 * Service worker: tiene l'app in memoria del browser cosi' funziona anche
 * senza rete (utile a bordo o in banchina). Il PDF non esce mai dal
 * dispositivo, qui si conservano solo i file dell'app.
 */
'use strict';

var VERSIONE = 'isps-pmis-2';
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
      return deposito.addAll(ESSENZIALE);
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

  if (richiesta.mode === 'navigate') {
    evento.respondWith(
      fetch(richiesta).catch(function () {
        return caches.match('index.html').then(function (salvata) {
          return salvata || caches.match('./');
        });
      })
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
