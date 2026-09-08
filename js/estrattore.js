/*
 * estrattore.js
 * -------------
 * Trova la tabella "List the last ten calls at port facilities" dentro il
 * modulo ISPS (Ship Pre-Arrival Security Information Form) e ne legge le
 * righe cosi' come sono scritte, senza correggerle: le correzioni sono in
 * js/correzioni.js.
 *
 * Lavora su "parole con coordinate", quindi la stessa logica vale sia per i
 * PDF con testo (pdf.js) sia per le scansioni (OCR Tesseract).
 *
 * Nessuna dipendenza esterna: funziona sia nel browser sia in Node.
 */
(function (globale) {
  'use strict';

  var MAX_RIGHE = 10;

  var DIACRITICI = /[\u0300-\u036f]/g;

  /* Frasi da riconoscere anche se l'OCR le storpia. */
  var FRASE_INIZIO = ['LASTTENCALLS', 'TENCALLSATPORTFACILITIES'];
  var FRASE_FINE = [
    'SPECIALORADDITIONALSECURITYMEASURES',
    'SHIPTOSHIPACTIVITIES',
    'GENERALDESCRIPTIONOFTHECARGO',
    'DANGEROUSSUBSTANCES'
  ];
  var FRASE_ETA = ['EXPECTEDDATEANDTIMEOFARRIVAL', 'DATEANDTIMEOFARRIVAL'];

  var REGEX_LOCODE = /^[A-Z]{2}[A-Z0-9]{3}$/;
  var REGEX_SOLO_NUMERO_RIGA = /^\(?(10|[1-9])[\.\)]?$/;

  function senzaAccenti(testo) {
    var t = String(testo == null ? '' : testo);
    return t.normalize ? t.normalize('NFD').replace(DIACRITICI, '') : t;
  }

  function soloAlfanumerico(testo) {
    return senzaAccenti(testo).toUpperCase().replace(/[^A-Z0-9]+/g, '');
  }

  /* Distanza di Levenshtein semplice con taglio. */
  function distanza(a, b, limite) {
    if (a === b) { return 0; }
    if (Math.abs(a.length - b.length) > limite) { return limite + 1; }
    var precedente = [];
    var i, j;
    for (j = 0; j <= b.length; j++) { precedente[j] = j; }
    for (i = 1; i <= a.length; i++) {
      var corrente = [i];
      var minimo = i;
      for (j = 1; j <= b.length; j++) {
        var costo = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        corrente[j] = Math.min(corrente[j - 1] + 1, precedente[j] + 1, precedente[j - 1] + costo);
        if (corrente[j] < minimo) { minimo = corrente[j]; }
      }
      if (minimo > limite) { return limite + 1; }
      precedente = corrente;
    }
    return precedente[b.length];
  }

  /* Cerca "frase" dentro "testo" tollerando qualche carattere sbagliato. */
  function contieneFrase(testo, frase, tolleranza) {
    var t = soloAlfanumerico(testo);
    var f = frase;
    if (t.indexOf(f) >= 0) { return true; }
    if (t.length < f.length - tolleranza) { return false; }
    var tol = tolleranza == null ? Math.max(1, Math.round(f.length / 8)) : tolleranza;
    for (var inizio = 0; inizio + f.length - tol <= t.length; inizio++) {
      for (var lunghezza = f.length - tol; lunghezza <= f.length + tol; lunghezza++) {
        if (inizio + lunghezza > t.length) { break; }
        if (distanza(t.substr(inizio, lunghezza), f, tol) <= tol) { return true; }
      }
    }
    return false;
  }

  function contieneUnaDelleFrasi(testo, frasi, tolleranza) {
    for (var i = 0; i < frasi.length; i++) {
      if (contieneFrase(testo, frasi[i], tolleranza)) { return true; }
    }
    return false;
  }

  /* ------------------------------------------------------------------
     Adattatori: da pdf.js / da OCR a "parole con coordinate".
     Formato comune: { testo, x0, x1, y, altezza }
     con y che cresce verso il basso.
     ------------------------------------------------------------------ */

  function paroleDaTestoPdf(contenutoTesto, altezzaPagina) {
    var parole = [];
    var elementi = contenutoTesto.items || [];
    for (var i = 0; i < elementi.length; i++) {
      var elemento = elementi[i];
      var testo = elemento.str;
      if (!testo || !testo.trim()) { continue; }
      var trasformazione = elemento.transform || [1, 0, 0, 1, 0, 0];
      var x = trasformazione[4];
      var yPdf = trasformazione[5];
      var larghezza = elemento.width || 0;
      var altezza = elemento.height || Math.abs(trasformazione[3]) || 10;
      // pdf.js ha l'origine in basso a sinistra: la ribaltiamo.
      var y = (altezzaPagina || 0) - yPdf;
      var pezzi = testo.split(/\s+/).filter(function (p) { return p !== ''; });
      var caratteriTotali = testo.replace(/\s/g, '').length || 1;
      var scorrimento = x;
      for (var p = 0; p < pezzi.length; p++) {
        var quota = larghezza * (pezzi[p].length / caratteriTotali);
        parole.push({
          testo: pezzi[p],
          x0: scorrimento,
          x1: scorrimento + quota,
          y: y,
          altezza: altezza
        });
        scorrimento += quota + (larghezza / caratteriTotali) * 0.6;
      }
    }
    return parole;
  }

  /* Righelli della tabella che l'OCR legge come caratteri. */
  var SPORCIZIA_OCR = /^[|\u00a6\u2016\[\]{}_"'`\u201c\u201d~^]{1,3}$/;

  /* Parole da Tesseract.js (data.words di una pagina). */
  function paroleDaOcr(paroleOcr) {
    var parole = [];
    for (var i = 0; i < (paroleOcr || []).length; i++) {
      var parola = paroleOcr[i];
      var testo = (parola.text || '').trim();
      if (!testo || SPORCIZIA_OCR.test(testo)) { continue; }
      var riquadro = parola.bbox || {};
      var x0 = riquadro.x0 || 0;
      var x1 = riquadro.x1 || x0 + 1;
      var y0 = riquadro.y0 || 0;
      var y1 = riquadro.y1 || y0 + 1;
      parole.push({
        testo: testo,
        x0: x0,
        x1: x1,
        y: (y0 + y1) / 2,
        altezza: Math.max(1, y1 - y0),
        affidabilita: parola.confidence
      });
    }
    return parole;
  }

  /* ------------------------------------------------------------------
     Da parole a righe di testo
     ------------------------------------------------------------------ */

  function mediana(valori) {
    if (!valori.length) { return 0; }
    var ordinati = valori.slice().sort(function (a, b) { return a - b; });
    return ordinati[Math.floor(ordinati.length / 2)];
  }

  function raggruppaInRighe(parole) {
    if (!parole.length) { return []; }
    var altezzaTipica = mediana(parole.map(function (p) { return p.altezza; })) || 10;
    var tolleranza = Math.max(1.5, altezzaTipica * 0.6);
    var ordinate = parole.slice().sort(function (a, b) {
      return a.y - b.y || a.x0 - b.x0;
    });
    var righe = [];
    var correnti = [ordinate[0]];
    var yCorrente = ordinate[0].y;
    for (var i = 1; i < ordinate.length; i++) {
      if (Math.abs(ordinate[i].y - yCorrente) <= tolleranza) {
        correnti.push(ordinate[i]);
      } else {
        righe.push(componiRiga(correnti));
        correnti = [ordinate[i]];
        yCorrente = ordinate[i].y;
      }
    }
    righe.push(componiRiga(correnti));
    return righe;
  }

  function componiRiga(parole) {
    var ordinate = parole.slice().sort(function (a, b) { return a.x0 - b.x0; });
    return {
      parole: ordinate,
      testo: ordinate.map(function (p) { return p.testo; }).join(' '),
      y: mediana(ordinate.map(function (p) { return p.y; }))
    };
  }

  /* ------------------------------------------------------------------
     Riconoscimento delle date
     ------------------------------------------------------------------ */

  /* Lettere che l'OCR confonde con le cifre. Applicata solo dove
     aspettiamo numeri (date, livello di sicurezza, codici). */
  var CIFRE_CONFUSE = {
    O: '0', o: '0', Q: '0', D: '0', U: '0',
    I: '1', l: '1', i: '1', '|': '1', '!': '1', L: '1', ']': '1', '[': '1',
    Z: '2', z: '2',
    E: '3',
    A: '4', h: '4',
    S: '5', s: '5',
    G: '6', b: '6',
    T: '7', '?': '7',
    B: '8', '&': '8',
    g: '9', q: '9'
  };

  function cifreDaTesto(testo) {
    var risultato = '';
    for (var i = 0; i < testo.length; i++) {
      var carattere = testo.charAt(i);
      if (carattere >= '0' && carattere <= '9') { risultato += carattere; continue; }
      if (CIFRE_CONFUSE[carattere]) { risultato += CIFRE_CONFUSE[carattere]; continue; }
      if (/[\/\.\-\s]/.test(carattere)) { risultato += carattere; continue; }
      risultato += carattere;
    }
    return risultato;
  }

  /* Uniforma i separatori: "12 / 05 / 2024" -> "12/05/2024". */
  function normalizzaPezzoData(testo) {
    return String(testo || '')
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/\s*([\/\.\-])\s*/g, '$1');
  }

  /* Dentro una data accettiamo le cifre e tutte le lettere che l'OCR ci
     scambia per cifre, cosi' "0l/l2/2O24" resta riconoscibile. */
  var CIFRE_O_LETTERE = '0-9' + Object.keys(CIFRE_CONFUSE).map(function (carattere) {
    return /[A-Za-z0-9]/.test(carattere) ? carattere : '\\' + carattere;
  }).join('');
  var REGEX_DATA_TOLLERANTE = new RegExp(
    '([' + CIFRE_O_LETTERE + ']{1,4})[\\/.\\-]([' + CIFRE_O_LETTERE + ']{1,2})[\\/.\\-]([' +
    CIFRE_O_LETTERE + ']{2,4})', 'g'
  );

  var MESI = {
    GEN: 1, JAN: 1, FEB: 2, MAR: 3, APR: 4, MAG: 5, MAY: 5, GIU: 6, JUN: 6,
    LUG: 7, JUL: 7, AGO: 8, AUG: 8, SET: 9, SEP: 9, OTT: 10, OCT: 10,
    NOV: 11, DIC: 12, DEC: 12
  };
  var REGEX_DATA_CON_MESE = /(\d{1,2})\s*[\/.\- ]\s*([A-Za-z]{3,10})\.?\s*[\/.\- ]\s*(\d{2,4})/g;

  /*
   * Cerca le date dentro un testo. Riconosce "28/08/2026", "28.8.26",
   * "28 AUG 2026", "28/ago/2026", "28 08 2026" e "28082026", e sopporta le
   * lettere che l'OCR mette al posto delle cifre ("0l/l2/2O24").
   */
  function trovaDate(testo) {
    var pulito = normalizzaPezzoData(testo);
    var candidati = [];
    var trovato;

    function aggiungi(intero, indice, giorno, mese, anno) {
      candidati.push({
        testo: intero,
        indice: indice,
        parti: [giorno, mese, anno]
      });
    }

    var conMese = new RegExp(REGEX_DATA_CON_MESE.source, 'g');
    while ((trovato = conMese.exec(pulito)) !== null) {
      var numeroMese = MESI[trovato[2].slice(0, 3).toUpperCase()];
      if (numeroMese) {
        aggiungi(trovato[0], trovato.index, trovato[1], String(numeroMese), trovato[3]);
      }
    }

    if (!candidati.length) {
      var tollerante = new RegExp(REGEX_DATA_TOLLERANTE.source, 'g');
      while ((trovato = tollerante.exec(pulito)) !== null) {
        aggiungi(
          trovato[0], trovato.index,
          cifreDaTesto(trovato[1]), cifreDaTesto(trovato[2]), cifreDaTesto(trovato[3])
        );
      }
    }

    // senza separatori accettiamo solo cifre vere, per non trasformare per
    // sbaglio il nome di un porto in una data
    if (!candidati.length) {
      var conSpazi = /(\d{1,2})\s(\d{1,2})\s(\d{2,4})/g;
      while ((trovato = conSpazi.exec(pulito)) !== null) {
        aggiungi(trovato[0], trovato.index, trovato[1], trovato[2], trovato[3]);
      }
    }
    if (!candidati.length) {
      var attaccate = /\b(\d{2})(\d{2})(\d{4})\b/g;
      while ((trovato = attaccate.exec(pulito)) !== null) {
        aggiungi(trovato[0], trovato.index, trovato[1], trovato[2], trovato[3]);
      }
    }

    return candidati;
  }

  /* ------------------------------------------------------------------
     Individuazione della tabella e lettura delle righe
     ------------------------------------------------------------------ */

  function indiceInizioTabella(righe) {
    for (var i = 0; i < righe.length; i++) {
      if (contieneUnaDelleFrasi(righe[i].testo, FRASE_INIZIO, 3)) { return i; }
    }
    // ripiego: riga di intestazione con UN/LOCODE + port facility
    for (var j = 0; j < righe.length; j++) {
      var testo = righe[j].testo;
      if (contieneFrase(testo, 'UNLOCODE', 2) && contieneFrase(testo, 'PORTFACILITY', 3)) {
        return Math.max(0, j - 1);
      }
    }
    return -1;
  }

  function indiceFineTabella(righe, inizio) {
    for (var i = inizio + 1; i < righe.length; i++) {
      if (contieneUnaDelleFrasi(righe[i].testo, FRASE_FINE, 4)) { return i; }
    }
    return righe.length;
  }

  function trovaDataRiferimento(righe) {
    for (var i = 0; i < righe.length; i++) {
      if (!contieneUnaDelleFrasi(righe[i].testo, FRASE_ETA, 4)) { continue; }
      for (var j = i; j < Math.min(righe.length, i + 3); j++) {
        var date = trovaDate(righe[j].testo);
        if (date.length) { return date[0]; }
      }
    }
    return null;
  }

  /*
   * Una riga della tabella e' un approdo se contiene almeno una data. Senza
   * date vale solo se porta un UN/LOCODE vero: il solo "SL = 1" non basta,
   * perche' nel modulo sta in mezzo alla cella e scivola sulla riga sotto
   * quando il nome del porto va a capo ("ZONA" e sotto "COMUN"). Prendendolo
   * per buono nasceva un approdo inesistente, senza date, e tutta la tabella
   * si spostava di una riga.
   */
  function rigaSembraApprodo(riga) {
    var testo = riga.testo;
    if (trovaDate(testo).length >= 1) { return true; }
    if (!/\bS\s*[L1I]\s*[=:]/i.test(testo)) { return false; }
    return contieneLocodeValido(riga.parole);
  }

  function contieneLocodeValido(parole) {
    if (!validatoreLocode) { return false; }
    for (var i = 0; i < parole.length; i++) {
      var pulita = soloAlfanumerico(parole[i].testo);
      if (pulita.length === 5 && REGEX_LOCODE.test(pulita) && validatoreLocode(pulita)) {
        return true;
      }
    }
    return false;
  }

  /* Spezza una riga che contiene piu' approdi (capita quando le celle di due
     righe della tabella finiscono alla stessa altezza). */
  function spezzaRigheMultiple(riga) {
    var parole = riga.parole;
    var gruppi = [];
    var corrente = [];
    var dateNelGruppo = 0;
    for (var i = 0; i < parole.length; i++) {
      var haData = trovaDate(parole[i].testo).length > 0;
      if (haData && dateNelGruppo >= 2) {
        gruppi.push(corrente);
        corrente = [];
        dateNelGruppo = 0;
      }
      corrente.push(parole[i]);
      if (haData) { dateNelGruppo++; }
    }
    if (corrente.length) { gruppi.push(corrente); }
    if (gruppi.length <= 1) { return [riga]; }
    return gruppi.map(componiRiga);
  }

  /* Legge le righe grezze della tabella: i valori restano esattamente come
     sono scritti nel PDF, le correzioni arrivano dopo. */
  function leggiRigheTabella(righe, inizio, fine) {
    var risultato = [];
    for (var i = inizio + 1; i < fine && risultato.length < MAX_RIGHE * 2; i++) {
      var riga = righe[i];
      if (!riga.testo.trim()) { continue; }
      if (eIntestazione(riga.testo)) { continue; }
      if (REGEX_SOLO_NUMERO_RIGA.test(riga.testo.trim())) { continue; }
      if (!rigaSembraApprodo(riga)) {
        // possibile continuazione della riga precedente (nome banchina
        // andato a capo): la attacchiamo alla port facility
        var ultima = risultato[risultato.length - 1];
        if (ultima && riga.testo.trim().length > 1 && !contieneUnaDelleFrasi(riga.testo, FRASE_FINE, 4)) {
          ultima.facility = (ultima.facility + ' ' + riga.testo.trim()).trim();
          ultima.testoRiga += ' ' + riga.testo.trim();
        }
        continue;
      }
      var sottoRighe = spezzaRigheMultiple(riga);
      for (var s = 0; s < sottoRighe.length; s++) {
        var letta = leggiRigaApprodo(sottoRighe[s]);
        if (letta) { risultato.push(letta); }
      }
    }
    return risultato.slice(0, MAX_RIGHE);
  }

  function eIntestazione(testo) {
    return contieneFrase(testo, 'DATEFROM', 2) ||
      contieneFrase(testo, 'DDMMYYYY', 2) ||
      (contieneFrase(testo, 'UNLOCODE', 2) && contieneFrase(testo, 'COUNTRY', 2));
  }

  /* Cerca le date lavorando sulle parole: una data puo' essere spezzata in
     piu' parole ("12", "/05/2024") oppure stare tutta in una.
     Restituisce [{ testo, parti, inizio, fine }] con gli indici di parola. */
  function trovaDateInParole(parole) {
    var trovate = [];
    var i = 0;
    while (i < parole.length) {
      var esito = null;
      var massimo = Math.min(5, parole.length - i);
      for (var n = 1; n <= massimo && !esito; n++) {
        var pezzo = parole.slice(i, i + n).map(function (p) { return p.testo; }).join(' ');
        var date = trovaDate(pezzo);
        if (date.length) {
          esito = { testo: date[0].testo, parti: date[0].parti, inizio: i, fine: i + n - 1 };
        }
      }
      if (esito) {
        trovate.push(esito);
        i = esito.fine + 1;
      } else {
        i++;
      }
    }
    return trovate;
  }

  /* Indice della parola che apre la colonna "Security Level" ("SL =").
     Cerca dalla fine, perche' e' l'ultima colonna del modulo. */
  function indiceLivelloSicurezza(parole) {
    for (var i = parole.length - 1; i >= 0; i--) {
      var pulita = soloAlfanumerico(parole[i].testo);
      if (/^[S5][L1I]$/.test(pulita)) { return i; }
      // "SL2" tutto attaccato, anche quando l'OCR legge la cifra come lettera
      // (2 letto Z, 1 letto I): la cifra vera la ricava poi cifraLivello
      if (/^[S5][L1I][0-9IZS]$/.test(pulita)) { return i; }
      if (/^[S5][L1I]?[=:]/.test(parole[i].testo.toUpperCase())) { return i; }
    }
    return -1;
  }

  function cifraLivello(testo) {
    var pulito = String(testo || '').toUpperCase().replace(/\s/g, '');
    var senzaEtichetta = pulito.replace(/^[S5][L1I]?[=:]*/, '');
    var trovato = senzaEtichetta.match(/[0-9IlZzS]/);
    return trovato ? trovato[0] : '';
  }

  /*
   * Ordine delle colonne del modulo ISPS:
   *   No. | Date from | Date to | Port | Country | UN/LOCODE | Port facility | SL
   * Non ci fidiamo delle coordinate delle colonne (cambiano da modulo a
   * modulo e l'OCR le sposta): ricostruiamo i campi dal contenuto.
   */
  function leggiRigaApprodo(riga) {
    var testoRiga = riga.testo;
    var parole = riga.parole.slice();

    // numero di riga iniziale
    var numeroRiga = null;
    if (parole.length && REGEX_SOLO_NUMERO_RIGA.test(parole[0].testo.trim())) {
      numeroRiga = parseInt(parole[0].testo.replace(/[^\d]/g, ''), 10);
      parole = parole.slice(1);
    }

    // livello di sicurezza (ultima colonna): "SL = 1", "SL=1", "SL 1"
    var sl = '';
    var indiceSl = indiceLivelloSicurezza(parole);
    if (indiceSl >= 0) {
      sl = cifraLivello(parole.slice(indiceSl, indiceSl + 3).map(function (p) {
        return p.testo;
      }).join(''));
      parole = parole.slice(0, indiceSl);
    } else {
      var ultima = parole[parole.length - 1];
      if (ultima && /^[123]$/.test(ultima.testo.trim())) {
        sl = ultima.testo.trim();
        parole = parole.slice(0, parole.length - 1);
      }
    }

    // date: le prime due riconosciute
    var date = trovaDateInParole(parole);
    var arrivo = date.length > 0 ? date[0].testo : '';
    var partenza = date.length > 1 ? date[1].testo : '';
    var ultimaData = date.length > 1 ? date[1] : (date.length ? date[0] : null);
    var coda = ultimaData ? parole.slice(ultimaData.fine + 1) : parole;

    var pezzi = separaCoda(coda.map(function (p) { return p.testo; }));

    if (!arrivo && !partenza && !pezzi.unlocode && !sl) { return null; }

    return {
      numero: numeroRiga,
      arrivo: arrivo,
      partenza: partenza,
      porto: pezzi.porto,
      paese: pezzi.paese,
      unlocode: pezzi.unlocode,
      unlocodeDaFacility: pezzi.unlocodeDaFacility,
      facility: pezzi.facility,
      sl: sl,
      testoRiga: testoRiga
    };
  }

  /* Riconoscitori forniti da correzioni.js (usano l'elenco UN/LOCODE).
     Senza di loro l'estrattore funziona comunque, solo con piu' ipotesi. */
  var riconoscitorePaese = null;
  var validatoreLocode = null;

  function impostaRiconoscitorePaese(funzione) { riconoscitorePaese = funzione; }
  function impostaValidatoreLocode(funzione) { validatoreLocode = funzione; }

  /*
   * Divide le parole rimaste dopo le date nei campi
   * "Port | Country | UN/LOCODE | Port facility".
   * Il paese fa da riferimento: nel modulo il codice viene subito dopo,
   * cosi' non si confonde un nome di porto di 5 lettere (GENOA, MALTA,
   * VARNA...) con un UN/LOCODE.
   */
  function separaCoda(elencoParole) {
    var risultato = { porto: '', paese: '', unlocode: '', facility: '', unlocodeDaFacility: false };
    var parole = (elencoParole || []).map(function (p) {
      return String(p).trim();
    }).filter(function (p) { return p !== ''; });
    if (!parole.length) { return risultato; }

    var paese = trovaPaese(parole);
    var daDove = paese ? paese.inizio + paese.lunghezza : 0;
    var locode = trovaLocode(parole, daDove, !!paese);

    if (paese) {
      risultato.paese = parole.slice(paese.inizio, paese.inizio + paese.lunghezza).join(' ');
      risultato.porto = parole.slice(0, paese.inizio).join(' ');
    }

    if (locode) {
      risultato.unlocode = locode.codice;
      risultato.unlocodeDaFacility = !!locode.facilityInclusa;
      var dopoLocode = parole.slice(locode.fine + 1).join(' ').trim();
      risultato.facility = locode.facilityInclusa
        ? (locode.facilityInclusa + (dopoLocode ? ' ' + dopoLocode : ''))
        : dopoLocode;
      if (!paese) {
        // senza paese riconosciuto: tutto quello che precede il codice e' il
        // nome del porto (eventualmente seguito dal paese non riconosciuto)
        risultato.porto = parole.slice(0, locode.inizio).join(' ');
      }
    } else if (paese) {
      risultato.facility = parole.slice(daDove).join(' ').trim();
    } else {
      // nessun riferimento: prima parola porto, il resto port facility
      risultato.porto = parole[0];
      risultato.facility = parole.slice(1).join(' ').trim();
    }

    risultato.porto = risultato.porto.trim();
    risultato.facility = pulisciFacility(risultato.facility);
    return risultato;
  }

  /* Cerca il nome del paese fra le parole (finestre di 1-3 parole).
     Preferisce una posizione diversa dalla prima, perche' la prima parola
     e' quasi sempre il nome del porto. */
  function trovaPaese(parole) {
    if (!riconoscitorePaese || parole.length < 2) { return null; }
    var inizio, lunghezza;
    for (inizio = 1; inizio < parole.length; inizio++) {
      for (lunghezza = Math.min(3, parole.length - inizio); lunghezza >= 1; lunghezza--) {
        if (riconoscitorePaese(parole.slice(inizio, inizio + lunghezza).join(' '))) {
          return { inizio: inizio, lunghezza: lunghezza };
        }
      }
    }
    for (lunghezza = Math.min(3, parole.length - 1); lunghezza >= 1; lunghezza--) {
      if (riconoscitorePaese(parole.slice(0, lunghezza).join(' '))) {
        return { inizio: 0, lunghezza: lunghezza };
      }
    }
    return null;
  }

  /* Cerca l'UN/LOCODE a partire dalla posizione "da".
     Accetta "ITCTA", "IT CTA" (spezzato dall'OCR) e "ITCTA-0001". */
  function trovaLocode(parole, da, ancorato) {
    for (var i = Math.max(0, da); i < parole.length; i++) {
      var conFacility = parole[i].match(/^([A-Za-z]{2}[A-Za-z0-9]{3})\s*[-\u2010-\u2015]\s*(\d{1,4})$/);
      if (conFacility) {
        return {
          codice: conFacility[1].toUpperCase(),
          inizio: i,
          fine: i,
          facilityInclusa: parole[i].trim()
        };
      }
      var singola = soloAlfanumerico(parole[i]).toUpperCase();
      if (singola.length === 5 && REGEX_LOCODE.test(singola) && accettaLocode(singola, ancorato && i === da)) {
        return { codice: singola, inizio: i, fine: i, facilityInclusa: '' };
      }
      if (i + 1 < parole.length) {
        var unita = (soloAlfanumerico(parole[i]) + soloAlfanumerico(parole[i + 1])).toUpperCase();
        if (unita.length === 5 && REGEX_LOCODE.test(unita) && accettaLocode(unita, false)) {
          return { codice: unita, inizio: i, fine: i + 1, facilityInclusa: '' };
        }
      }
    }
    return null;
  }

  /* Un codice a 5 caratteri e' accettato se sta nell'elenco UN/LOCODE,
     se contiene una cifra (nessun nome di porto la contiene) oppure se si
     trova esattamente nella colonna successiva al paese. */
  function accettaLocode(codice, inPosizione) {
    if (validatoreLocode && validatoreLocode(codice)) { return true; }
    if (/[0-9]/.test(codice)) { return true; }
    return !!inPosizione;
  }

  function pulisciFacility(testo) {
    return String(testo || '')
      .replace(/\bS\s*[L1I]\s*[=:]?\s*[0-9]?\s*$/i, '')
      .replace(/[\s,;]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /* ------------------------------------------------------------------
     Punto di ingresso: dalle parole delle pagine alle righe grezze
     ------------------------------------------------------------------ */

  /*
   * paginaParole: array di array di parole (una voce per pagina).
   * Restituisce { righe, riferimento, pagina, diagnostica }.
   */
  function estraiDaParole(paginaParole) {
    var diagnostica = {
      pagine: paginaParole.length,
      righeTesto: 0,
      // l'intestazione della tabella e' stata riconosciuta: distingue "pagina
      // illeggibile" da "tabella trovata ma righe non interpretabili"
      intestazioneTrovata: false,
      tabellaTrovata: false
    };
    var riferimentoGlobale = null;
    var righePerPagina = [];

    for (var p = 0; p < paginaParole.length; p++) {
      var righe = raggruppaInRighe(paginaParole[p]);
      righePerPagina.push(righe);
      diagnostica.righeTesto += righe.length;
      if (!riferimentoGlobale) {
        var riferimento = trovaDataRiferimento(righe);
        if (riferimento) { riferimentoGlobale = riferimento; }
      }
    }

    for (var pagina = 0; pagina < righePerPagina.length; pagina++) {
      var inizio = indiceInizioTabella(righePerPagina[pagina]);
      if (inizio < 0) { continue; }
      diagnostica.intestazioneTrovata = true;
      // la tabella puo' proseguire sulle pagine successive: le uniamo, tanto
      // la lettura si ferma da sola alla domanda che segue la tabella
      var complessive = righePerPagina[pagina];
      for (var successiva = pagina + 1; successiva < righePerPagina.length; successiva++) {
        complessive = complessive.concat(righePerPagina[successiva]);
      }
      var fine = indiceFineTabella(complessive, inizio);
      var lette = leggiRigheTabella(complessive, inizio, fine);
      if (lette.length) {
        diagnostica.tabellaTrovata = true;
        return {
          righe: lette,
          riferimento: riferimentoGlobale,
          pagina: pagina + 1,
          diagnostica: diagnostica
        };
      }
    }

    return { righe: [], riferimento: riferimentoGlobale, pagina: null, diagnostica: diagnostica };
  }

  /* Legge tutte le pagine di un documento pdf.js gia' aperto e restituisce
     (in una Promise) le parole pagina per pagina. */
  function paroleDaDocumentoPdf(documento, avanzamento) {
    var pagine = [];
    function prossima(numero) {
      if (numero > documento.numPages) { return Promise.resolve(pagine); }
      if (avanzamento) { avanzamento(numero, documento.numPages); }
      return documento.getPage(numero).then(function (pagina) {
        var altezza = pagina.getViewport({ scale: 1 }).height;
        return pagina.getTextContent().then(function (contenuto) {
          pagine.push(paroleDaTestoPdf(contenuto, altezza));
          return prossima(numero + 1);
        });
      });
    }
    return prossima(1);
  }

  /* Il PDF ha un livello di testo utilizzabile o e' una scansione? */
  function testoUtilizzabile(paginaParole) {
    var totale = 0;
    for (var i = 0; i < paginaParole.length; i++) { totale += paginaParole[i].length; }
    if (totale < 20) { return false; }
    for (var p = 0; p < paginaParole.length; p++) {
      var righe = raggruppaInRighe(paginaParole[p]);
      if (indiceInizioTabella(righe) >= 0) { return true; }
    }
    return false;
  }

  var api = {
    MAX_RIGHE: MAX_RIGHE,
    soloAlfanumerico: soloAlfanumerico,
    contieneFrase: contieneFrase,
    distanza: distanza,
    cifreDaTesto: cifreDaTesto,
    normalizzaPezzoData: normalizzaPezzoData,
    trovaDate: trovaDate,
    trovaDateInParole: trovaDateInParole,
    cifraLivello: cifraLivello,
    paroleDaTestoPdf: paroleDaTestoPdf,
    paroleDaDocumentoPdf: paroleDaDocumentoPdf,
    testoUtilizzabile: testoUtilizzabile,
    paroleDaOcr: paroleDaOcr,
    raggruppaInRighe: raggruppaInRighe,
    leggiRigaApprodo: leggiRigaApprodo,
    leggiRigheTabella: leggiRigheTabella,
    indiceInizioTabella: indiceInizioTabella,
    indiceFineTabella: indiceFineTabella,
    estraiDaParole: estraiDaParole,
    impostaRiconoscitorePaese: impostaRiconoscitorePaese,
    impostaValidatoreLocode: impostaValidatoreLocode,
    rigaSembraApprodo: rigaSembraApprodo,
    separaCoda: separaCoda
  };

  globale.EstrattoreIsps = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
}(typeof self !== 'undefined' ? self : globalThis));
