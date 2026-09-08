/*
 * app.js
 * ------
 * Collega l'interfaccia al motore: apre il PDF con pdf.js, usa l'OCR
 * (Tesseract) solo se il PDF e' una scansione, mostra le righe corrette e
 * prepara il file di testo per il PMIS.
 */
(function () {
  'use strict';

  var RADICE = new URL('.', window.location.href).href;

  /*
   * Da dove prendere il riconoscimento del testo (OCR). Si prova prima la
   * copia inclusa nella cartella dell'app (funziona anche senza rete); se non
   * c'e' - per esempio nella versione a file singolo - si ripiega sulla copia
   * pubblica, che richiede il collegamento a internet.
   */
  var FONTI_OCR = [
    {
      nome: 'copia inclusa nell\'app',
      script: RADICE + 'vendor/tesseract/tesseract.min.js',
      lavoratore: RADICE + 'vendor/tesseract/worker.min.js',
      nucleo: RADICE + 'vendor/tesseract/',
      lingua: RADICE + 'vendor/tesseract'
    },
    {
      nome: 'copia pubblica su internet',
      script: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
      lavoratore: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      nucleo: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/',
      lingua: 'https://tessdata.projectnaptha.com/4.0.0_fast'
    }
  ];

  /* Aperta con doppio clic (file://) la pagina non puo' leggere i file
     accanto a se': in quel caso l'unica strada per l'OCR e' la copia pubblica. */
  var FONTI_OCR_UTILI = window.location.protocol === 'file:'
    ? FONTI_OCR.slice(1)
    : FONTI_OCR;

  var DPI_OCR = 200;
  var SCADENZA_AVVIO_OCR = 90000;
  var SCADENZA_PAGINA_OCR = 300000;
  var LATO_MASSIMO_OCR = 2600; // limite prudente per la memoria dell'iPhone
  var GIRI_OCR = [0, 90, 270, 180]; // orientamenti provati sulle scansioni coricate
  var ATTESA_SERVICE_WORKER = 20000;

  var elementi = {};
  var stato = {
    nomeBase: 'ultimi_10_approdi',
    righe: [],
    testoModificatoAMano: false,
    databasePronto: false,
    inElaborazione: false
  };

  /*
   * pdf.js e l'elenco dei porti pesano insieme circa 250 kB compressi, e il
   * "worker" di pdf.js altri 300. Aspettarli prima di mostrare la pagina
   * significa fissare per qualche secondo una schermata vuota, sul telefono
   * con la rete dei dati. Partono invece tutti insieme appena la pagina si
   * apre: l'app e' subito utilizzabile e di solito sono gia' arrivati quando
   * l'utente ha finito di scegliere il file. Nella versione a file unico sono
   * gia' dentro la pagina e le promesse si chiudono immediatamente.
   */
  var pdfPronto = window.pdfjsLib
    ? Promise.resolve()
    : caricaScript(RADICE + 'vendor/pdfjs/pdf.min.js');

  var database = null;
  var databasePronto = (self.DATI_PORTI
    ? Promise.resolve()
    : caricaScript(RADICE + 'dati/porti.js')
  ).then(function () {
    database = new self.DatabasePortiModulo.DatabasePorti().carica(self.DATI_PORTI);
    self.CorrezioniIsps.collegaDatabase(database);
    stato.databasePronto = true;
    mostraFonteDati();
    return database;
  });

  /*
   * pdf.js svolge il lavoro in un "worker" a parte, un altro megabyte che
   * normalmente viene chiesto solo quando si apre il primo PDF. Lo avviamo
   * invece appena pdf.js e' qui, mentre l'utente sta ancora scegliendo il
   * file, e poi lo riusiamo: l'attesa se ne va dove non da' fastidio.
   * Nella versione a file unico il worker e' dentro la pagina (pdfjsWorker) e
   * non c'e' nulla da preparare.
   */
  var workerPdf = null;

  function preparaWorkerPdf() {
    if (workerPdf || window.pdfjsWorker || !window.pdfjsLib) { return; }
    if (window.location.protocol === 'file:') { return; }
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = RADICE + 'vendor/pdfjs/pdf.worker.min.js';
      // va assegnato subito, non quando sara' avviato: se il PDF arriva prima
      // pdf.js ne creerebbe un secondo, scaricando il file due volte
      workerPdf = new pdfjsLib.PDFWorker({ name: 'isps-pmis' });
      workerPdf.promise.catch(function () { workerPdf = null; });
    } catch (errore) {
      workerPdf = null; // si fara' come sempre, al momento dell'apertura
    }
  }

  pdfPronto.then(preparaWorkerPdf, function () { /* nulla da preparare */ });

  /* Il primo file scelto non deve trovare l'app a meta': si aspetta cio' che
     manca ancora, quasi sempre nulla, con un messaggio comprensibile se la
     rete e' caduta a metà. */
  function attesa(promessa, cosa) {
    return promessa.catch(function () {
      throw new Error('Non riesco a caricare ' + cosa + '. Controlla il ' +
        'collegamento a internet e ricarica la pagina.');
    });
  }

  function componentiPronti() {
    return Promise.all([
      attesa(pdfPronto, 'il lettore di PDF'),
      attesa(databasePronto, 'l\'elenco dei porti')
    ]);
  }

  /* --------------------------------------------------------------- utilita' */

  function elemento(id) { return document.getElementById(id); }

  function mostra(nodo, visibile) {
    if (nodo) { nodo.classList[visibile ? 'remove' : 'add']('nascosto'); }
  }

  function stampaStato(testo, percentuale) {
    mostra(elementi.avanzamento, true);
    elementi.testoStato.textContent = testo;
    if (typeof percentuale === 'number') {
      elementi.barraAvanzamento.style.width = Math.max(0, Math.min(100, percentuale)) + '%';
    }
  }

  function mostraErrore(messaggio) {
    elementi.erroreBox.textContent = messaggio;
    mostra(elementi.erroreBox, true);
    mostra(elementi.avanzamento, false);
  }

  function nascondiErrore() { mostra(elementi.erroreBox, false); }

  /* ------------------------------------------------------- lettura del PDF */

  function apriDocumento(datiPdf) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = RADICE + 'vendor/pdfjs/pdf.worker.min.js';
    var opzioni = {
      data: datiPdf,
      isEvalSupported: false,
      useWorkerFetch: false,
      standardFontDataUrl: RADICE + 'vendor/pdfjs/standard_fonts/'
    };
    if (workerPdf) {
      opzioni.worker = workerPdf;
      // per un eventuale secondo PDF ne preparera' uno nuovo, con il file
      // ormai in memoria del browser
      workerPdf = null;
    }
    return pdfjsLib.getDocument(opzioni).promise;
  }

  /* Il PDF ha davvero un livello di testo? Se no si passa all'OCR. */
  function leggiTestoNativo(documento) {
    stampaStato('Lettura del testo del PDF\u2026', 12);
    return self.EstrattoreIsps.paroleDaDocumentoPdf(documento, function (numero, totale) {
      stampaStato('Lettura del testo del PDF: pagina ' + numero + ' di ' + totale + '\u2026',
        12 + (numero / totale) * 20);
    });
  }

  /* --------------------------------------------------------------- OCR */

  function supportaSimd() {
    try {
      return WebAssembly.validate(new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
        10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
      ]));
    } catch (errore) {
      return false;
    }
  }

  function caricaScript(indirizzo) {
    return new Promise(function (risolvi, rifiuta) {
      var script = document.createElement('script');
      script.src = indirizzo;
      script.onload = risolvi;
      script.onerror = function () { rifiuta(new Error('script non raggiungibile: ' + indirizzo)); };
      document.head.appendChild(script);
    });
  }

  /* Una promessa che non arriva mai bloccherebbe l'app: le mettiamo un tempo
     massimo, cosi' l'utente vede un messaggio invece di una barra ferma. */
  function conScadenza(promessa, millisecondi, messaggio) {
    return new Promise(function (risolvi, rifiuta) {
      var scaduta = false;
      var orologio = window.setTimeout(function () {
        scaduta = true;
        rifiuta(new Error(messaggio));
      }, millisecondi);
      promessa.then(function (valore) {
        if (scaduta) { return; }
        window.clearTimeout(orologio);
        risolvi(valore);
      }, function (errore) {
        if (scaduta) { return; }
        window.clearTimeout(orologio);
        rifiuta(errore);
      });
    });
  }

  /* Prepara il motore OCR provando le fonti in ordine. */
  function creaLavoratoreOcr(indiceFonte) {
    var indice = indiceFonte || 0;
    if (indice >= FONTI_OCR_UTILI.length) {
      /* Aperta come file locale l'unica fonte possibile e' quella su internet:
         se non si e' avviata, quasi sempre manca il collegamento. */
      return Promise.reject(new Error(window.location.protocol === 'file:'
        ? 'Il PDF è una scansione e per leggerla serve il riconoscimento del testo, ' +
          'che questo file da solo non contiene: scaricalo collegandoti a internet e ' +
          'riprova, oppure inserisci le righe a mano qui sotto.'
        : 'Il PDF è una scansione e per leggerla serve il riconoscimento del testo, ' +
          'che qui non riesco ad avviare. Riprova ricaricando la pagina, oppure ' +
          'inserisci le righe a mano qui sotto.'
      ));
    }
    var fonte = FONTI_OCR_UTILI[indice];
    var nucleo = fonte.nucleo + (supportaSimd() ? 'tesseract-core-simd.wasm.js' : 'tesseract-core.wasm.js');
    var preparazione = self.Tesseract
      ? Promise.resolve()
      : caricaScript(fonte.script);

    return preparazione.then(function () {
      return conScadenza(self.Tesseract.createWorker('eng', 1, {
        workerPath: fonte.lavoratore,
        corePath: nucleo,
        langPath: fonte.lingua,
        gzip: true,
        logger: function (messaggio) {
          if (messaggio.status === 'recognizing text' && typeof messaggio.progress === 'number') {
            stampaStato('Riconoscimento del testo in corso\u2026', 40 + messaggio.progress * 50);
          }
        }
      }), SCADENZA_AVVIO_OCR, 'avvio del riconoscimento del testo troppo lento (' + fonte.nome + ')');
    }).then(function (lavoratore) {
      // senza segmentazione automatica Tesseract perde il contenuto delle
      // celle delle tabelle
      return lavoratore.setParameters({ tessedit_pageseg_mode: '3' }).then(function () {
        return lavoratore;
      });
    }).catch(function (errore) {
      if (window.console) { window.console.warn('OCR: ' + fonte.nome + ' non utilizzabile', errore); }
      return creaLavoratoreOcr(indice + 1);
    });
  }

  function disegnaPagina(pagina, gradi) {
    var scala = DPI_OCR / 72;
    var rotazione = ((pagina.rotate || 0) + (gradi || 0)) % 360;
    var vista = pagina.getViewport({ scale: scala, rotation: rotazione });
    var lato = Math.max(vista.width, vista.height);
    if (lato > LATO_MASSIMO_OCR) {
      scala = scala * (LATO_MASSIMO_OCR / lato);
      vista = pagina.getViewport({ scale: scala, rotation: rotazione });
    }
    var tela = document.createElement('canvas');
    tela.width = Math.floor(vista.width);
    tela.height = Math.floor(vista.height);
    var contesto = tela.getContext('2d', { alpha: false });
    contesto.fillStyle = '#ffffff';
    contesto.fillRect(0, 0, tela.width, tela.height);
    return pagina.render({ canvasContext: contesto, viewport: vista }).promise.then(function () {
      return tela;
    });
  }

  function paroleDaRiconoscimento(dati) {
    var parole = [];
    var blocchi = dati.blocks || [];
    for (var b = 0; b < blocchi.length; b++) {
      var paragrafi = blocchi[b].paragraphs || [];
      for (var p = 0; p < paragrafi.length; p++) {
        var righe = paragrafi[p].lines || [];
        for (var r = 0; r < righe.length; r++) {
          var elencoParole = righe[r].words || [];
          for (var w = 0; w < elencoParole.length; w++) { parole.push(elencoParole[w]); }
        }
      }
    }
    if (!parole.length && dati.words) { parole = dati.words; }
    return parole;
  }

  /* Riconosce le pagine una alla volta e si ferma appena trova la tabella. Se
     con la pagina diritta non trova nulla riprova girandola: alcune scansioni
     arrivano coricate. */
  function leggiConOcr(documento) {
    stampaStato('Il PDF è una scansione: preparazione del riconoscimento del testo\u2026', 34);

    /* Preparare il motore OCR (13 MB da scaricare e avviare) e disegnare la
       prima pagina sono lavori indipendenti: avviandoli insieme si aspetta il
       piu' lento dei due invece della somma. */
    var primaTela = documento.getPage(1).then(function (pagina) {
      return disegnaPagina(pagina, 0);
    });
    primaTela.catch(function () { /* l'errore ricompare quando la tela serve */ });

    function telaDellaPagina(numero, gradi) {
      if (numero === 1 && !gradi) { return primaTela; }
      return documento.getPage(numero).then(function (pagina) {
        return disegnaPagina(pagina, gradi);
      });
    }

    return creaLavoratoreOcr().then(function (lavoratore) {

      function scansiona(gradi) {
        var pagine = [];
        var giro = gradi ? ', pagina girata di ' + gradi + '\u00b0' : '';
        function prossima(numero) {
          if (numero > documento.numPages) { return Promise.resolve(pagine); }
          stampaStato('Riconoscimento del testo: pagina ' + numero + ' di ' + documento.numPages +
            giro + ' (può richiedere qualche minuto)\u2026', 36);
          return telaDellaPagina(numero, gradi).then(function (immagine) {
            var riconoscimento = conScadenza(
              lavoratore.recognize(immagine, {}, { blocks: true }),
              SCADENZA_PAGINA_OCR,
              'il riconoscimento del testo di questa pagina non è riuscito entro il tempo previsto'
            );
            return riconoscimento.then(function (esito) {
              pagine.push(self.EstrattoreIsps.paroleDaOcr(paroleDaRiconoscimento(esito.data)));
              if (self.EstrattoreIsps.estraiDaParole(pagine).righe.length) { return pagine; }
              return prossima(numero + 1);
            });
          });
        }
        return prossima(1);
      }

      /* Girare la pagina ha senso solo se non e' stata riconosciuta nemmeno
         l'intestazione della tabella: se quella c'e', la scansione era diritta
         e il problema sta altrove, quindi non facciamo aspettare altri tre
         giri di OCR per niente. Teniamo comunque il primo tentativo, cosi' i
         messaggi restano quelli della scansione come e' arrivata. */
      function tentaOrientamenti(indice, ripiego) {
        if (indice >= GIRI_OCR.length) { return Promise.resolve(ripiego); }
        return scansiona(GIRI_OCR[indice]).then(function (pagine) {
          var esito = self.EstrattoreIsps.estraiDaParole(pagine);
          if (esito.righe.length) { return pagine; }
          if (esito.diagnostica.intestazioneTrovata) { return ripiego.length ? ripiego : pagine; }
          return tentaOrientamenti(indice + 1, ripiego.length ? ripiego : pagine);
        });
      }

      return tentaOrientamenti(0, []).then(function (risultato) {
        return lavoratore.terminate().then(function () { return risultato; }, function () {
          return risultato;
        });
      }, function (errore) {
        lavoratore.terminate();
        throw errore;
      });
    });
  }

  /* ------------------------------------------------------ ciclo principale */

  function alFileScelto(file) {
    if (!file || stato.inElaborazione) { return; }
    stato.inElaborazione = true;
    nascondiErrore();
    mostra(elementi.riquadroRisultati, false);
    mostra(elementi.riquadroFile, false);
    elementi.nomeFile.textContent = file.name;
    stato.nomeBase = file.name.replace(/\.pdf$/i, '').replace(/[^\w\-. ]+/g, '_') || 'ultimi_10_approdi';
    stato.testoModificatoAMano = false;
    mostra(elementi.avvisoModificaManuale, false);

    stampaStato('Apertura del PDF\u2026', 5);

    /* Per aprire il PDF basta pdf.js: l'elenco dei porti serve solo alla
       correzione, in fondo, e nel frattempo finisce di arrivare da se'. Anche
       la lettura del file dal disco procede in parallelo. */
    Promise.all([leggiFile(file), attesa(pdfPronto, 'il lettore di PDF')])
      .then(function (esiti) { return apriDocumento(new Uint8Array(esiti[0])); })
      .then(function (documento) {
        return leggiTestoNativo(documento).then(function (pagine) {
          if (self.EstrattoreIsps.testoUtilizzabile(pagine)) { return pagine; }
          return leggiConOcr(documento);
        });
      })
      .then(function (pagine) {
        stampaStato('Controllo e correzione dei dati\u2026', 94);
        var estratto = self.EstrattoreIsps.estraiDaParole(pagine);
        if (!estratto.righe.length) {
          throw new Error(
            'Nella tabella "List the last ten calls at port facilities" non ho trovato ' +
            'righe leggibili. Se il PDF è una scansione molto sporca conviene ripeterla ' +
            'più nitida, oppure inserire le righe a mano qui sotto.'
          );
        }
        return attesa(databasePronto, 'l\'elenco dei porti').then(function () {
          mostraRisultati(estratto);
          stampaStato('Fatto.', 100);
          window.setTimeout(function () { mostra(elementi.avanzamento, false); }, 1200);
        });
      })
      .catch(function (errore) {
        mostraErrore(errore && errore.message ? errore.message :
          'Errore inatteso durante la lettura del PDF.');
        if (window.console) { window.console.error(errore); }
      })
      .then(function () { stato.inElaborazione = false; });
  }

  function leggiFile(file) {
    if (file.arrayBuffer) { return file.arrayBuffer(); }
    return new Promise(function (risolvi, rifiuta) {
      var lettore = new FileReader();
      lettore.onload = function () { risolvi(lettore.result); };
      lettore.onerror = function () { rifiuta(new Error('Non riesco a leggere il file.')); };
      lettore.readAsArrayBuffer(file);
    });
  }

  function opzioniCorrezione() {
    return {
      formatoData: elementi.opzioneFormatoData.value,
      formatoFacility: elementi.opzioneFormatoFacility.value,
      ordine: elementi.opzioneOrdine.value
    };
  }

  var ultimoEstratto = null;

  function mostraRisultati(estratto) {
    ultimoEstratto = estratto;
    var esito = self.CorrezioniIsps.correggi(estratto, database, opzioniCorrezione());
    stato.righe = esito.righe;
    disegnaRiepilogo(esito);
    disegnaApprodi();
    aggiornaTesto();
    mostra(elementi.riquadroRisultati, true);
    mostra(elementi.riquadroFile, true);
    elementi.riquadroRisultati.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function ricalcola() {
    if (ultimoEstratto) { mostraRisultati(ultimoEstratto); }
  }

  function disegnaRiepilogo(esito) {
    var daControllare = esito.righe.filter(function (riga) { return riga.note.length; }).length;
    var etichette = [];
    etichette.push({
      testo: esito.righe.length + (esito.righe.length === 1 ? ' approdo letto' : ' approdi letti'),
      classe: esito.righe.length === 10 ? 'etichetta-ok' : 'etichetta-attenzione'
    });
    etichette.push(daControllare
      ? { testo: daControllare + (daControllare === 1 ? ' riga corretta o da verificare' : ' righe corrette o da verificare'), classe: 'etichetta-attenzione' }
      : { testo: 'nessuna correzione necessaria', classe: 'etichetta-ok' });
    if (esito.dataModulo) {
      etichette.push({
        testo: 'data del modulo: ' + self.CorrezioniIsps.formattaData(esito.dataModulo),
        classe: 'etichetta-neutra'
      });
    }
    if (esito.ordineCrescenteNelPdf) {
      etichette.push({ testo: 'sul modulo le righe partono dall\'approdo più vecchio', classe: 'etichetta-neutra' });
    }

    elementi.riepilogoEsito.innerHTML = '';
    etichette.forEach(function (voce) {
      var span = document.createElement('span');
      span.className = 'etichetta ' + voce.classe;
      span.textContent = voce.testo;
      elementi.riepilogoEsito.appendChild(span);
    });
  }

  var CAMPI = [
    { chiave: 'unlocode', etichetta: 'UN/LOCODE', larghezza: false },
    { chiave: 'arrivo', etichetta: 'Arrivo', larghezza: false },
    { chiave: 'partenza', etichetta: 'Partenza', larghezza: false },
    { chiave: 'sl', etichetta: 'Livello', larghezza: false },
    { chiave: 'facility', etichetta: 'Port facility', larghezza: true }
  ];

  function disegnaApprodi() {
    elementi.elencoApprodi.innerHTML = '';
    stato.righe.forEach(function (riga, indice) {
      elementi.elencoApprodi.appendChild(creaSchedaApprodo(riga, indice));
    });
  }

  function creaSchedaApprodo(riga, indice) {
    var scheda = document.createElement('div');
    scheda.className = 'approdo';
    if (riga.note.length) { scheda.classList.add('da-controllare', 'con-note'); }
    if (!riga.unlocode || !riga.arrivo || !riga.partenza) { scheda.classList.add('incompleta'); }

    var testa = document.createElement('div');
    testa.className = 'approdo-testa';

    var numero = document.createElement('span');
    numero.className = 'numero-riga';
    numero.textContent = String(indice + 1);
    testa.appendChild(numero);

    var descrizione = document.createElement('span');
    descrizione.className = 'descrizione-approdo';
    var pezzi = [];
    if (riga.porto) { pezzi.push(riga.porto); }
    if (riga.nomePaese) { pezzi.push(riga.nomePaese); }
    descrizione.textContent = pezzi.join(' \u00b7 ') || 'porto da completare';
    testa.appendChild(descrizione);

    var elimina = document.createElement('button');
    elimina.type = 'button';
    elimina.className = 'bottone bottone-secondario bottone-minuto';
    elimina.textContent = 'Elimina';
    elimina.setAttribute('aria-label', 'Elimina la riga ' + (indice + 1));
    elimina.addEventListener('click', function () {
      stato.righe.splice(indice, 1);
      disegnaApprodi();
      aggiornaTesto(true);
    });
    testa.appendChild(elimina);

    scheda.appendChild(testa);

    var campi = document.createElement('div');
    campi.className = 'campi';
    CAMPI.forEach(function (definizione) {
      campi.appendChild(creaCampo(riga, definizione));
    });
    scheda.appendChild(campi);

    if (riga.note.length) {
      var note = document.createElement('div');
      note.className = 'note-riga';
      var elenco = document.createElement('ul');
      riga.note.forEach(function (nota) {
        var voce = document.createElement('li');
        voce.textContent = nota;
        elenco.appendChild(voce);
      });
      note.appendChild(elenco);
      scheda.appendChild(note);
    }

    return scheda;
  }

  function creaCampo(riga, definizione) {
    var etichetta = document.createElement('label');
    etichetta.className = 'campo' + (definizione.larghezza ? ' campo-largo' : '');
    var titolo = document.createElement('span');
    titolo.textContent = definizione.etichetta;
    etichetta.appendChild(titolo);

    var controllo;
    if (definizione.chiave === 'sl') {
      controllo = document.createElement('select');
      ['1', '2', '3'].forEach(function (valore) {
        var opzione = document.createElement('option');
        opzione.value = valore;
        opzione.textContent = valore;
        if (riga.sl === valore) { opzione.selected = true; }
        controllo.appendChild(opzione);
      });
    } else {
      controllo = document.createElement('input');
      controllo.type = 'text';
      controllo.value = riga[definizione.chiave] || '';
      controllo.autocapitalize = definizione.chiave === 'unlocode' ? 'characters' : 'off';
      controllo.autocomplete = 'off';
      controllo.spellcheck = false;
      if (!controllo.value) { controllo.classList.add('vuoto'); }
    }

    controllo.addEventListener('input', function () {
      var valore = controllo.value;
      if (definizione.chiave === 'unlocode') {
        valore = valore.toUpperCase();
        controllo.value = valore;
        aggiornaDescrizione(etichetta, riga, valore);
      }
      riga[definizione.chiave] = valore;
      controllo.classList[valore ? 'remove' : 'add']('vuoto');
      aggiornaTesto(true);
    });
    controllo.addEventListener('change', function () {
      riga[definizione.chiave] = controllo.value;
      aggiornaTesto(true);
    });

    etichetta.appendChild(controllo);
    return etichetta;
  }

  /* Se l'utente sistema il codice a mano, aggiorniamo porto e paese mostrati
     in testa alla riga leggendoli dall'elenco UN/LOCODE. */
  function aggiornaDescrizione(campo, riga, codice) {
    var nome = database.nomeDiCodice(codice);
    var scheda = campo.closest ? campo.closest('.approdo') : null;
    if (!scheda) { return; }
    var descrizione = scheda.querySelector('.descrizione-approdo');
    if (!descrizione) { return; }
    if (nome) {
      riga.porto = nome;
      riga.paese = codice.slice(0, 2);
      riga.nomePaese = database.nomeDiPaese(riga.paese) || riga.paese;
      descrizione.textContent = riga.porto + ' \u00b7 ' + riga.nomePaese;
    } else {
      descrizione.textContent = codice
        ? 'codice ' + codice + ' non presente nell\'elenco UN/LOCODE'
        : 'porto da completare';
    }
  }

  function aggiornaTesto(daModifica) {
    if (stato.testoModificatoAMano && daModifica) { return; }
    elementi.testoFinale.value = self.CorrezioniIsps.formattaTesto(stato.righe);
  }

  /* ------------------------------------------------------ salvataggio file */

  function nomeFileUscita() { return stato.nomeBase + '_pmis.txt'; }

  function contenutoFile() {
    var testo = elementi.testoFinale.value;
    if (testo && testo.charAt(testo.length - 1) !== '\n') { testo += '\n'; }
    return testo;
  }

  function numeroRighe(testo) {
    return testo.split('\n').filter(function (riga) { return riga.trim(); }).length;
  }

  function scaricaFile() {
    var blob = new Blob([contenutoFile()], { type: 'text/plain;charset=utf-8' });
    var indirizzo = URL.createObjectURL(blob);
    var collegamento = document.createElement('a');
    collegamento.href = indirizzo;
    collegamento.download = nomeFileUscita();
    collegamento.rel = 'noopener';
    document.body.appendChild(collegamento);
    collegamento.click();
    document.body.removeChild(collegamento);
    window.setTimeout(function () { URL.revokeObjectURL(indirizzo); }, 4000);
    elementi.suggerimentoSalvataggio.textContent =
      'File salvato come "' + nomeFileUscita() + '" fra i download del dispositivo.';
  }

  function condividiFile() {
    var file = new File([contenutoFile()], nomeFileUscita(), { type: 'text/plain' });
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
      scaricaFile();
      return;
    }
    navigator.share({ files: [file], title: nomeFileUscita() }).catch(function () { /* annullato */ });
  }

  function copiaTesto() {
    var testo = contenutoFile();
    function riuscito() {
      elementi.bottoneCopia.textContent = 'Copiato';
      window.setTimeout(function () { elementi.bottoneCopia.textContent = 'Copia il testo'; }, 1800);
      // la scritta sul bottone dura poco: la conferma resta anche qui, dove
      // compaiono gli altri messaggi di salvataggio
      elementi.suggerimentoSalvataggio.textContent =
        'Le ' + numeroRighe(testo) + ' righe sono state copiate: puoi incollarle nel PMIS.';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(testo).then(riuscito, selezionaTesto);
    } else {
      selezionaTesto();
    }
  }

  function selezionaTesto() {
    elementi.testoFinale.focus();
    elementi.testoFinale.select();
    elementi.suggerimentoSalvataggio.textContent =
      'Testo selezionato: copialo con il menu del dispositivo.';
  }

  /* --------------------------------------------------------------- avvio */

  function rigaVuota() {
    return {
      numero: stato.righe.length + 1,
      unlocode: '', porto: '', paese: '', nomePaese: '',
      arrivo: '', partenza: '', sl: '1', facility: '', note: [], completa: false
    };
  }

  function collegaEventi() {
    elementi.bottoneScegli.addEventListener('click', function () { elementi.campoFile.click(); });
    elementi.campoFile.addEventListener('change', function (evento) {
      alFileScelto(evento.target.files && evento.target.files[0]);
      elementi.campoFile.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (nome) {
      elementi.zonaFile.addEventListener(nome, function (evento) {
        evento.preventDefault();
        elementi.zonaFile.classList.add('evidenziata');
      });
    });
    ['dragleave', 'drop'].forEach(function (nome) {
      elementi.zonaFile.addEventListener(nome, function (evento) {
        evento.preventDefault();
        elementi.zonaFile.classList.remove('evidenziata');
      });
    });
    elementi.zonaFile.addEventListener('drop', function (evento) {
      var file = evento.dataTransfer && evento.dataTransfer.files && evento.dataTransfer.files[0];
      if (file) { alFileScelto(file); }
    });

    elementi.bottoneAggiungi.addEventListener('click', function () {
      stato.righe.push(rigaVuota());
      disegnaApprodi();
      aggiornaTesto(true);
    });

    elementi.testoFinale.addEventListener('input', function () {
      stato.testoModificatoAMano = true;
      mostra(elementi.avvisoModificaManuale, true);
    });
    elementi.bottoneRigenera.addEventListener('click', function () {
      stato.testoModificatoAMano = false;
      mostra(elementi.avvisoModificaManuale, false);
      aggiornaTesto();
    });

    elementi.bottoneScarica.addEventListener('click', scaricaFile);
    elementi.bottoneCondividi.addEventListener('click', condividiFile);
    elementi.bottoneCopia.addEventListener('click', copiaTesto);

    [elementi.opzioneFormatoData, elementi.opzioneFormatoFacility, elementi.opzioneOrdine]
      .forEach(function (controllo) {
        controllo.addEventListener('change', function () {
          stato.testoModificatoAMano = false;
          mostra(elementi.avvisoModificaManuale, false);
          ricalcola();
        });
      });

    // nella versione a file unico il comando per l'uso senza rete non c'e'
    if (elementi.bottoneOffline) {
      elementi.bottoneOffline.addEventListener('click', preparaUsoOffline);
    }
  }

  /* Il service worker viene registrato quando il resto e' arrivato, quindi
     puo' non avere ancora il controllo della pagina: se si preme il comando
     appena aperta l'app, conviene aspettarlo invece di dire che la funzione
     non c'e'. */
  function serviceWorkerAlComando() {
    if (navigator.serviceWorker.controller) {
      return Promise.resolve(navigator.serviceWorker.controller);
    }
    return new Promise(function (risolvi) {
      var orologio = window.setTimeout(function () {
        risolvi(navigator.serviceWorker.controller);
      }, ATTESA_SERVICE_WORKER);
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        window.clearTimeout(orologio);
        risolvi(navigator.serviceWorker.controller);
      }, { once: true });
    });
  }

  /* Chiede al service worker di conservare anche i file dell'OCR. */
  function preparaUsoOffline() {
    if (!navigator.serviceWorker || window.location.protocol.indexOf('http') !== 0) {
      elementi.statoOffline.textContent =
        'Per questa funzione apri l\'app dal suo indirizzo internet (non come file locale) e riprova.';
      return;
    }
    elementi.bottoneOffline.disabled = true;
    elementi.statoOffline.textContent = 'Scaricamento in corso, tieni la pagina aperta\u2026';

    serviceWorkerAlComando().then(function (controllore) {
      if (!controllore) {
        elementi.bottoneOffline.disabled = false;
        elementi.statoOffline.textContent =
          'Non riesco a preparare l\'uso senza rete: ricarica la pagina e riprova.';
        return;
      }
      var canale = new MessageChannel();
      canale.port1.onmessage = function (evento) {
        elementi.bottoneOffline.disabled = false;
        elementi.statoOffline.textContent = evento.data && evento.data.esito === 'ok'
          ? 'Pronta: adesso anche le scansioni si leggono senza collegamento a internet.'
          : 'Scaricamento non riuscito: controlla il collegamento e riprova.';
      };
      controllore.postMessage({ tipo: 'prepara-offline' }, [canale.port2]);
    });
  }

  /* Chiamata due volte, perche' l'elenco dei porti e l'interfaccia possono
     essere pronti in un ordine qualunque: scrive quando ci sono entrambi. */
  function mostraFonteDati() {
    if (!elementi.pieDati || !self.DATI_PORTI) { return; }
    elementi.pieDati.textContent = 'Elenco porti: ' + (self.DATI_PORTI.fonte || 'UN/LOCODE') +
      ' \u00b7 aggiornato al ' + (self.DATI_PORTI.generato || '');
  }

  function preparaInterfaccia() {
    [
      'campoFile', 'bottoneScegli', 'zonaFile', 'nomeFile', 'avanzamento', 'testoStato',
      'barraAvanzamento', 'erroreBox', 'riquadroRisultati', 'riepilogoEsito', 'elencoApprodi',
      'bottoneAggiungi', 'riquadroFile', 'testoFinale', 'avvisoModificaManuale',
      'bottoneRigenera', 'bottoneScarica', 'bottoneCondividi', 'bottoneCopia',
      'suggerimentoSalvataggio', 'opzioneFormatoData', 'opzioneFormatoFacility',
      'opzioneOrdine', 'pieDati', 'suggerimentoZona', 'bottoneOffline', 'statoOffline'
    ].forEach(function (id) { elementi[id] = elemento(id); });

    if (navigator.canShare) {
      var prova = new File(['prova'], 'prova.txt', { type: 'text/plain' });
      if (navigator.canShare({ files: [prova] })) {
        mostra(elementi.bottoneCondividi, true);
        elementi.suggerimentoSalvataggio.textContent =
          'Su iPhone conviene "Condividi": puoi salvare il file in File, in OneDrive o inviarlo per posta.';
      }
    }

    mostraFonteDati();
    collegaEventi();

    /* Registrandosi, il service worker mette da parte tutta l'app (worker di
       pdf.js compreso, 1 MB) per l'uso senza rete. E' roba che serve dopo:
       se partisse adesso ruberebbe banda a chi sta aspettando di lavorare. */
    if ('serviceWorker' in navigator && window.location.protocol.indexOf('http') === 0) {
      componentiPronti().then(function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* niente offline */ });
      }, function () { /* senza componenti non c'e' nulla da conservare */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', preparaInterfaccia);
  } else {
    preparaInterfaccia();
  }
}());
