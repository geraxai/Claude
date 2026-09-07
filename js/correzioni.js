/*
 * correzioni.js
 * -------------
 * Sistema quello che l'estrattore ha letto: date, UN/LOCODE, nome del porto,
 * paese, livello di sicurezza e port facility. Ogni modifica viene annotata
 * riga per riga, cosi' chi compila il PMIS vede cosa e' stato corretto.
 *
 * Regole principali:
 *  - il codice porto viene confrontato con il nome del porto e con il paese:
 *    se due indizi su tre concordano, il terzo viene corretto;
 *  - le date devono essere in ordine (dal piu' recente al piu' vecchio),
 *    la partenza non puo' precedere l'arrivo e nessuna data puo' essere
 *    successiva alla data del modulo: l'anno sbagliato viene ricalcolato;
 *  - il livello di sicurezza puo' essere solo 1, 2 o 3.
 *
 * Nessuna dipendenza esterna: funziona sia nel browser sia in Node.
 */
(function (globale) {
  'use strict';

  var Estrattore = globale.EstrattoreIsps ||
    (typeof require === 'function' ? require('./estrattore.js') : null);

  var GIORNO_MS = 24 * 60 * 60 * 1000;
  var GIORNI_MASSIMI_IN_PORTO = 60;      // oltre e' quasi certamente un errore
  var GIORNI_MASSIMI_FRA_APPRODI = 400;  // dieci approdi non durano piu' di un anno

  function giorniNelMese(anno, mese) {
    return new Date(Date.UTC(anno, mese, 0)).getUTCDate();
  }

  function creaData(giorno, mese, anno) {
    if (!(anno >= 1900 && anno <= 2200)) { return null; }
    if (!(mese >= 1 && mese <= 12)) { return null; }
    if (!(giorno >= 1 && giorno <= giorniNelMese(anno, mese))) { return null; }
    return { g: giorno, m: mese, a: anno, ms: Date.UTC(anno, mese - 1, giorno) };
  }

  function dueCifre(numero) {
    return (numero < 10 ? '0' : '') + numero;
  }

  function formattaData(data, formato) {
    if (!data) { return ''; }
    switch (formato) {
      case 'gg/mm/aa':
        return dueCifre(data.g) + '/' + dueCifre(data.m) + '/' + dueCifre(data.a % 100);
      case 'aaaa-mm-gg':
        return data.a + '-' + dueCifre(data.m) + '-' + dueCifre(data.g);
      case 'ggmmaaaa':
        return dueCifre(data.g) + dueCifre(data.m) + data.a;
      default:
        return dueCifre(data.g) + '/' + dueCifre(data.m) + '/' + data.a;
    }
  }

  /* Anni possibili per una cifra dell'anno letta male o incompleta. */
  function anniCandidati(testoAnno, annoRiferimento) {
    var cifre = String(testoAnno).replace(/[^0-9]/g, '');
    var candidati = [];
    function aggiungi(anno) {
      if (anno >= 1990 && anno <= annoRiferimento + 1 && candidati.indexOf(anno) < 0) {
        candidati.push(anno);
      }
    }
    if (cifre.length === 4) {
      aggiungi(parseInt(cifre, 10));
    } else if (cifre.length === 2) {
      aggiungi(2000 + parseInt(cifre, 10));
      aggiungi(1900 + parseInt(cifre, 10));
    } else if (cifre.length === 3) {
      // manca una cifra: la reinseriamo in tutte le posizioni possibili
      for (var d = 0; d <= 9; d++) {
        aggiungi(parseInt(cifre + d, 10));
        aggiungi(parseInt(d + cifre, 10));
        aggiungi(parseInt(cifre.slice(0, 2) + d + cifre.slice(2), 10));
      }
    } else if (cifre.length > 4) {
      // una cifra di troppo
      for (var i = 0; i < cifre.length; i++) {
        aggiungi(parseInt(cifre.slice(0, i) + cifre.slice(i + 1), 10));
      }
    }
    // in ogni caso proviamo gli anni intorno a quello del modulo
    aggiungi(annoRiferimento);
    aggiungi(annoRiferimento - 1);
    return candidati;
  }

  /*
   * Da un testo tipo "l2/O5/2O24" ricava tutte le date plausibili, con una
   * penalita' che dice quanto ci siamo allontanati da quello che c'era scritto.
   */
  function dateCandidate(testo, annoRiferimento) {
    if (!testo) { return []; }
    var lette = Estrattore.trovaDate(testo);
    if (!lette.length) { return []; }
    var parti = lette[0].parti;
    var candidate = [];

    function proponi(giorno, mese, anno, penalita, nota) {
      var data = creaData(giorno, mese, anno);
      if (!data) { return; }
      for (var i = 0; i < candidate.length; i++) {
        if (candidate[i].data.ms === data.ms) {
          if (penalita < candidate[i].penalita) {
            candidate[i].penalita = penalita;
            candidate[i].nota = nota;
          }
          return;
        }
      }
      candidate.push({ data: data, penalita: penalita, nota: nota });
    }

    var primo = parseInt(parti[0].replace(/[^0-9]/g, ''), 10);
    var secondo = parseInt(parti[1].replace(/[^0-9]/g, ''), 10);
    var testoAnno = parti[2];
    var anni = anniCandidati(testoAnno, annoRiferimento);
    var cifreAnnoLette = String(testoAnno).replace(/[^0-9]/g, '');

    for (var i = 0; i < anni.length; i++) {
      var anno = anni[i];
      var penalitaAnno = 0;
      var notaAnno = null;
      if (cifreAnnoLette.length === 4 && anno !== parseInt(cifreAnnoLette, 10)) {
        penalitaAnno = 40;
        notaAnno = 'anno corretto in ' + anno + ' (nel PDF: ' + cifreAnnoLette + ')';
      } else if (cifreAnnoLette.length !== 4) {
        penalitaAnno = 10;
        notaAnno = 'anno completato in ' + anno + ' (nel PDF: ' + cifreAnnoLette + ')';
      }
      // gg/mm/aaaa (formato del modulo)
      proponi(primo, secondo, anno, penalitaAnno, notaAnno);
      // mm/gg/aaaa: capita quando il modulo e' compilato con l'uso americano
      if (primo !== secondo) {
        var notaScambio = 'giorno e mese invertiti (nel PDF: ' + primo + '/' + secondo + ')';
        proponi(secondo, primo, anno, penalitaAnno + 25, notaAnno ? notaAnno + '; ' + notaScambio : notaScambio);
      }
    }

    // giorno impossibile per quel mese (es. 31/04): lo riportiamo all'ultimo
    // giorno del mese
    if (!candidate.length) {
      for (var j = 0; j < anni.length; j++) {
        var giorniMese = giorniNelMese(anni[j], secondo);
        if (secondo >= 1 && secondo <= 12 && primo > giorniMese) {
          proponi(giorniMese, secondo, anni[j], 60,
            'giorno inesistente (' + primo + '/' + secondo + '): portato al ' + giorniMese);
        }
      }
    }

    return candidate;
  }

  /*
   * Sceglie le date di tutte le righe rispettando l'ordine cronologico.
   * righe: array con .arrivo e .partenza (testo letto dal PDF).
   * Restituisce per ogni riga { arrivo, partenza, note }.
   */
  function armonizzaDate(righe, opzioni) {
    var oggi = opzioni.oggi || new Date();
    var annoRiferimento = opzioni.annoRiferimento || oggi.getUTCFullYear();
    var limiteSuperiore = opzioni.dataModulo ? opzioni.dataModulo.ms + GIORNO_MS : Date.UTC(
      oggi.getUTCFullYear(), oggi.getUTCMonth(), oggi.getUTCDate()
    );

    var candidatePerRiga = righe.map(function (riga) {
      return {
        arrivo: dateCandidate(riga.arrivo, annoRiferimento),
        partenza: dateCandidate(riga.partenza, annoRiferimento)
      };
    });

    var ordineCrescente = rilevaOrdineCrescente(candidatePerRiga);
    var sequenza = [];
    for (var i = 0; i < righe.length; i++) { sequenza.push(i); }
    if (ordineCrescente) { sequenza.reverse(); }

    var esiti = righe.map(function () { return { arrivo: null, partenza: null, note: [] }; });
    var tettoCorrente = limiteSuperiore;

    for (var s = 0; s < sequenza.length; s++) {
      var indice = sequenza[s];
      var candidate = candidatePerRiga[indice];
      var esito = esiti[indice];
      // la riga successiva (piu' vecchia) serve da controprova: se la data
      // scelta finisse prima di quella, l'ordine cronologico salterebbe
      var riferimentoSuccessivo = null;
      for (var d = s + 1; d < sequenza.length && riferimentoSuccessivo === null; d++) {
        riferimentoSuccessivo = candidataMigliore(candidatePerRiga[sequenza[d]]);
      }

      var scelta = scegliCoppia(candidate, {
        tetto: tettoCorrente,
        pavimentoIndicativo: riferimentoSuccessivo
      });

      if (scelta) {
        esito.arrivo = scelta.arrivo ? scelta.arrivo.data : null;
        esito.partenza = scelta.partenza ? scelta.partenza.data : null;
        if (scelta.scambiate) {
          esito.note.push('Arrivo e partenza risultavano invertiti: le due date sono state scambiate.');
        }
        if (scelta.arrivo && scelta.arrivo.nota) {
          esito.note.push('Data di arrivo: ' + scelta.arrivo.nota + '.');
        }
        if (scelta.partenza && scelta.partenza.nota) {
          esito.note.push('Data di partenza: ' + scelta.partenza.nota + '.');
        }
      }

      if (!esito.arrivo) {
        esito.note.push(righe[indice].arrivo
          ? 'Data di arrivo non interpretabile ("' + righe[indice].arrivo + '"): da controllare.'
          : 'Data di arrivo assente nel PDF: da inserire a mano.');
      }
      if (!esito.partenza) {
        esito.note.push(righe[indice].partenza
          ? 'Data di partenza non interpretabile ("' + righe[indice].partenza + '"): da controllare.'
          : 'Data di partenza assente nel PDF: da inserire a mano.');
      }

      if (esito.arrivo) {
        tettoCorrente = esito.arrivo.ms;
      } else if (esito.partenza) {
        tettoCorrente = esito.partenza.ms;
      }
    }

    return { esiti: esiti, ordineCrescente: ordineCrescente };
  }

  function candidataMigliore(candidate) {
    var elenco = (candidate.arrivo && candidate.arrivo.length) ? candidate.arrivo : candidate.partenza;
    if (!elenco || !elenco.length) { return null; }
    var migliore = elenco[0];
    for (var i = 1; i < elenco.length; i++) {
      if (elenco[i].penalita < migliore.penalita) { migliore = elenco[i]; }
    }
    return migliore.data.ms;
  }

  /*
   * Sceglie insieme le due date della riga: le combinazioni comprendono anche
   * lo scambio dei ruoli (colonne compilate al contrario). Vince la coppia con
   * il costo minore, dove il costo tiene conto di quanto ci allontaniamo da
   * quello che c'e' scritto e di quanto la coppia rispetta l'ordine.
   */
  function scegliCoppia(candidate, vincoli) {
    var combinazioni = [];
    aggiungiCombinazioni(combinazioni, candidate.arrivo, candidate.partenza, false);
    aggiungiCombinazioni(combinazioni, candidate.partenza, candidate.arrivo, true);

    var migliore = null;
    var miglioreCosto = Infinity;
    for (var i = 0; i < combinazioni.length; i++) {
      var costo = costoCoppia(combinazioni[i], vincoli);
      if (costo < miglioreCosto) {
        miglioreCosto = costo;
        migliore = combinazioni[i];
      }
    }
    return migliore;
  }

  function aggiungiCombinazioni(elenco, candidateArrivo, candidatePartenza, scambiate) {
    var arrivi = (candidateArrivo && candidateArrivo.length) ? candidateArrivo : [null];
    var partenze = (candidatePartenza && candidatePartenza.length) ? candidatePartenza : [null];
    if (scambiate && (arrivi[0] === null || partenze[0] === null)) { return; }
    for (var a = 0; a < arrivi.length; a++) {
      for (var p = 0; p < partenze.length; p++) {
        elenco.push({ arrivo: arrivi[a], partenza: partenze[p], scambiate: scambiate });
      }
    }
  }

  var COSTO_VIOLAZIONE = 1000;
  var COSTO_SCAMBIO = 20;
  var COSTO_ORDINE_ROTTO = 300;

  function costoCoppia(combinazione, vincoli) {
    var arrivo = combinazione.arrivo;
    var partenza = combinazione.partenza;
    var costo = (arrivo ? arrivo.penalita : 30) + (partenza ? partenza.penalita : 30);
    if (combinazione.scambiate) { costo += COSTO_SCAMBIO; }

    if (arrivo && partenza) {
      var sosta = (partenza.data.ms - arrivo.data.ms) / GIORNO_MS;
      if (sosta < 0) { return COSTO_VIOLAZIONE * 2; }
      costo += sosta > GIORNI_MASSIMI_IN_PORTO ? COSTO_VIOLAZIONE : sosta * 0.2;
    }

    var ultima = partenza || arrivo;
    if (ultima && vincoli.tetto != null && ultima.data.ms > vincoli.tetto) {
      costo += COSTO_VIOLAZIONE + (ultima.data.ms - vincoli.tetto) / GIORNO_MS;
    }
    if (ultima && vincoli.tetto != null) {
      var distanzaGiorni = Math.abs(vincoli.tetto - ultima.data.ms) / GIORNO_MS;
      costo += Math.min(distanzaGiorni, GIORNI_MASSIMI_FRA_APPRODI) * 0.35;
      if (distanzaGiorni > GIORNI_MASSIMI_FRA_APPRODI) { costo += 200; }
    }

    var prima = arrivo || partenza;
    if (prima && vincoli.pavimentoIndicativo != null &&
      prima.data.ms < vincoli.pavimentoIndicativo - GIORNO_MS) {
      costo += COSTO_ORDINE_ROTTO;
    }

    return costo;
  }

  /* Le righe sono dal piu' recente al piu' vecchio (come chiede il modulo)
     o al contrario? Guardiamo come si muovono le date leggibili. */
  function rilevaOrdineCrescente(candidatePerRiga) {
    var valori = [];
    for (var i = 0; i < candidatePerRiga.length; i++) {
      var elenco = candidatePerRiga[i].arrivo.length ? candidatePerRiga[i].arrivo : candidatePerRiga[i].partenza;
      if (elenco.length) {
        var migliore = elenco[0];
        for (var c = 1; c < elenco.length; c++) {
          if (elenco[c].penalita < migliore.penalita) { migliore = elenco[c]; }
        }
        valori.push({ indice: i, ms: migliore.data.ms });
      }
    }
    var crescenti = 0;
    var decrescenti = 0;
    for (var j = 1; j < valori.length; j++) {
      if (valori[j].ms > valori[j - 1].ms) { crescenti++; }
      if (valori[j].ms < valori[j - 1].ms) { decrescenti++; }
    }
    return crescenti > decrescenti;
  }

  /* ------------------------------------------------------------------
     Porto, paese e UN/LOCODE
     ------------------------------------------------------------------ */

  function pulisciLocode(testo) {
    return String(testo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  }

  /* Sostituisce le cifre che l'OCR mette al posto delle lettere nelle prime
     due posizioni (il codice paese e' sempre alfabetico). */
  function raddrizzaLocode(codice) {
    var mappa = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G' };
    if (codice.length < 2) { return codice; }
    var testa = codice.slice(0, 2).replace(/[0-9]/g, function (c) { return mappa[c] || c; });
    return testa + codice.slice(2);
  }

  /* Codice porto contenuto nel codice della port facility ("ITCTA-0001"). */
  function locodeDaFacility(testo) {
    var trovato = String(testo || '').match(/([A-Za-z]{2}\s?[A-Za-z0-9]{3})\s*[-\u2010-\u2015\s]\s*\d{1,4}/);
    return trovato ? pulisciLocode(trovato[1]) : '';
  }

  /* Peso dei tre indizi disponibili per il codice porto. */
  var PESO = {
    codiceValido: 1,
    codiceCorretto1: 0.8,
    codiceCorretto2: 0.45,
    nomeEsatto: 1,
    nomeSimile: 0.7,
    facility: 0.6
  };
  var PRIORITA = { codice: 3, nome: 2, facility: 1 };

  /*
   * Decide l'UN/LOCODE confrontando tre indizi: il codice scritto sul modulo,
   * il nome del porto e il prefisso del codice della port facility.
   * Vince l'indizio con il peso complessivo maggiore; a pari peso vale il
   * codice scritto sul modulo. Ogni scostamento finisce nelle note.
   */
  function correggiPorto(riga, database, note) {
    var paeseIso = riga.paese ? database.paeseDaNome(riga.paese) : null;
    if (riga.paese && !paeseIso) {
      note.push('Paese "' + riga.paese + '" non riconosciuto.');
    }

    var lettoDalPdf = pulisciLocode(riga.unlocode);
    var scritto = raddrizzaLocode(lettoDalPdf);
    var perNome = riga.porto ? database.cercaPerNome(riga.porto, paeseIso) : null;
    var daFacility = locodeDaFacility(riga.facility);
    var indizi = [];

    if (scritto && database.esiste(scritto)) {
      indizi.push({ codice: scritto, origine: 'codice', peso: PESO.codiceValido });
      if (scritto !== lettoDalPdf) {
        note.push('UN/LOCODE "' + lettoDalPdf + '" letto come ' + scritto + '.');
      }
    } else if (scritto) {
      var vicino = database.correggiCodice(scritto, paeseIso);
      if (vicino && vicino.distanza <= 2) {
        indizi.push({
          codice: vicino.codice,
          origine: 'codice',
          peso: vicino.distanza === 1 ? PESO.codiceCorretto1 : PESO.codiceCorretto2,
          dettaglio: 'UN/LOCODE "' + lettoDalPdf + '" non esiste nell\'elenco UN/LOCODE: ' +
            'corretto in ' + vicino.codice + ' (' + vicino.nome + ').'
        });
      } else {
        note.push('UN/LOCODE "' + lettoDalPdf + '" non esiste nell\'elenco UN/LOCODE.');
      }
    }

    if (perNome) {
      indizi.push({
        codice: perNome.codice,
        origine: 'nome',
        peso: perNome.distanza === 0 ? PESO.nomeEsatto : PESO.nomeSimile,
        dettaglio: perNome.distanza === 0 ? null :
          'Porto "' + riga.porto + '" riconosciuto come "' + perNome.nome + '".'
      });
    }

    if (daFacility && database.esiste(daFacility)) {
      indizi.push({ codice: daFacility, origine: 'facility', peso: PESO.facility });
    }

    if (!indizi.length) {
      if (riga.porto || riga.unlocode || riga.facility) {
        note.push('UN/LOCODE non determinabile: da inserire a mano.');
      }
      return {
        unlocode: lettoDalPdf,
        porto: riga.porto,
        paese: paeseIso,
        nomePaese: riga.paese,
        sicuro: false
      };
    }

    var punteggi = {};
    for (var i = 0; i < indizi.length; i++) {
      var indizio = indizi[i];
      if (!punteggi[indizio.codice]) {
        punteggi[indizio.codice] = { totale: 0, priorita: 0, origini: [], dettagli: [] };
      }
      var voce = punteggi[indizio.codice];
      voce.totale += indizio.peso;
      voce.priorita = Math.max(voce.priorita, PRIORITA[indizio.origine]);
      voce.origini.push(indizio.origine);
      if (indizio.dettaglio) { voce.dettagli.push(indizio.dettaglio); }
    }

    var codiceFinale = null;
    var miglioreVoce = null;
    for (var codice in punteggi) {
      if (!Object.prototype.hasOwnProperty.call(punteggi, codice)) { continue; }
      var candidata = punteggi[codice];
      if (!miglioreVoce ||
        candidata.totale > miglioreVoce.totale + 0.001 ||
        (Math.abs(candidata.totale - miglioreVoce.totale) <= 0.001 &&
          candidata.priorita > miglioreVoce.priorita)) {
        miglioreVoce = candidata;
        codiceFinale = codice;
      }
    }

    for (var d = 0; d < miglioreVoce.dettagli.length; d++) {
      note.push(miglioreVoce.dettagli[d]);
    }

    var scartati = [];
    for (var altro in punteggi) {
      if (Object.prototype.hasOwnProperty.call(punteggi, altro) && altro !== codiceFinale) {
        scartati.push(altro + ' (' + (database.nomeDiCodice(altro) || 'sconosciuto') + ')');
      }
    }
    if (scartati.length) {
      note.push('Sul modulo gli indizi non concordano: scelto ' + codiceFinale + ' (' +
        (database.nomeDiCodice(codiceFinale) || '?') + ') invece di ' + scartati.join(', ') +
        '; conviene una verifica.');
    } else if (!scritto) {
      note.push('UN/LOCODE assente sul modulo: ricavato ' + codiceFinale + ' (' +
        (database.nomeDiCodice(codiceFinale) || '?') + ').');
    } else if (riga.unlocodeDaFacility) {
      note.push('Colonna UN/LOCODE vuota: preso ' + codiceFinale +
        ' dal codice della port facility.');
    }

    // il nome del porto da' piu' di un risultato possibile: lo segnaliamo solo
    // se il codice non era gia' scritto sul modulo
    if (perNome && perNome.ambiguo && codiceFinale === perNome.codice &&
      (!scritto || !database.esiste(scritto))) {
      note.push('Esistono piu\' localita\' con questo nome: verificare il codice ' + codiceFinale + '.');
    }

    var isoFinale = codiceFinale.slice(0, 2);
    if (paeseIso && paeseIso !== isoFinale) {
      note.push('Paese indicato (' + (database.nomeDiPaese(paeseIso) || paeseIso) +
        ') diverso da quello del codice ' + codiceFinale + ' (' +
        (database.nomeDiPaese(isoFinale) || isoFinale) + '): tenuto il codice.');
    }

    return {
      unlocode: codiceFinale,
      porto: database.nomeDiCodice(codiceFinale) || riga.porto,
      paese: isoFinale,
      nomePaese: database.nomeDiPaese(isoFinale) || riga.paese,
      sicuro: !scartati.length
    };
  }

  /* ------------------------------------------------------------------
     Livello di sicurezza e port facility
     ------------------------------------------------------------------ */

  function correggiLivello(riga, note) {
    var grezzo = String(riga.sl || '').trim();
    if (!grezzo) {
      note.push('Livello di sicurezza assente nel PDF: impostato 1 (da verificare).');
      return { sl: '1', sicuro: false };
    }
    var mappa = { I: '1', l: '1', i: '1', '|': '1', Z: '2', z: '2', S: '5', s: '5', E: '3' };
    var carattere = grezzo.charAt(0);
    var cifra = /[0-9]/.test(carattere) ? carattere : (mappa[carattere] || '');
    if (cifra === '1' || cifra === '2' || cifra === '3') {
      if (cifra !== carattere) {
        note.push('Livello di sicurezza "' + grezzo + '" letto come ' + cifra + '.');
      }
      return { sl: cifra, sicuro: true };
    }
    note.push('Livello di sicurezza "' + grezzo + '" non valido: impostato 1 (da verificare).');
    return { sl: '1', sicuro: false };
  }

  function correggiFacility(riga, unlocode, formato, note) {
    var testo = String(riga.facility || '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,;:.\-|\u00a6\[\]{}_"']+|[\s,;:.|\u00a6\[\]{}_"']+$/g, '')
      .trim();

    if (!testo) {
      note.push('Port facility assente nel PDF: da inserire a mano.');
      return { facility: '', numero: '', sicuro: false };
    }

    // codice GISIS: "ITCTA-0001", "ITCTA 0001", "IT CTA 0001"
    var conCodice = testo.match(/^([A-Za-z]{2})\s?([A-Za-z0-9]{3})\s*[-\u2010-\u2015\s]?\s*(\d{1,4})$/);
    var soloNumero = testo.match(/^n?[.\s]*([0-9]{1,4})$/i);
    var numero = '';
    var codicePorto = '';
    var testoOriginale = testo;

    if (conCodice) {
      codicePorto = (conCodice[1] + conCodice[2]).toUpperCase();
      numero = conCodice[3];
    } else if (soloNumero) {
      numero = soloNumero[1];
    } else if (unlocode) {
      // l'OCR lascia spesso qualche carattere di troppo attorno alla cella:
      // se dentro c'e' il codice del porto seguito dal numero, teniamo solo quello
      var atteso = new RegExp(
        unlocode.slice(0, 2) + '\\s?' + unlocode.slice(2) + '\\s*[-\u2010-\u2015\\s]?\\s*(\\d{1,4})(?!\\d)',
        'i'
      );
      var dentro = testo.match(atteso);
      if (dentro) {
        codicePorto = unlocode;
        numero = dentro[1];
        testo = unlocode + '-' + dentro[1];
      }
    }

    if (numero) {
      while (numero.length < 4) { numero = '0' + numero; }
    }

    if (codicePorto && unlocode && codicePorto !== unlocode) {
      note.push('Il codice della port facility (' + codicePorto +
        ') non coincide con l\'UN/LOCODE ' + unlocode + ': usato ' + unlocode + '.');
      codicePorto = unlocode;
    }

    var risultato = testo;
    if (formato === 'codice' && numero) {
      risultato = (codicePorto || unlocode || '') + '-' + numero;
    } else if (formato === 'numero' && numero) {
      risultato = numero;
    } else if (conCodice) {
      risultato = (codicePorto || unlocode || '') + '-' + numero;
    }

    if (risultato !== testoOriginale) {
      note.push('Port facility "' + testoOriginale + '" scritta come ' + risultato + '.');
    }
    return { facility: risultato, numero: numero, sicuro: true };
  }

  /* ------------------------------------------------------------------
     Correzione completa
     ------------------------------------------------------------------ */

  var OPZIONI_PREDEFINITE = {
    formatoData: 'gg/mm/aaaa',
    formatoFacility: 'originale',
    ordine: 'pdf'
  };

  function correggi(estratto, database, opzioni) {
    var opz = {};
    var chiave;
    for (chiave in OPZIONI_PREDEFINITE) {
      if (Object.prototype.hasOwnProperty.call(OPZIONI_PREDEFINITE, chiave)) {
        opz[chiave] = OPZIONI_PREDEFINITE[chiave];
      }
    }
    for (chiave in (opzioni || {})) {
      if (Object.prototype.hasOwnProperty.call(opzioni, chiave)) {
        opz[chiave] = opzioni[chiave];
      }
    }

    var righeGrezze = estratto.righe || [];
    var oggi = opz.oggi || new Date();
    var dataModulo = null;
    if (estratto.riferimento) {
      var candidateModulo = dateCandidate(estratto.riferimento.testo, oggi.getUTCFullYear());
      if (candidateModulo.length) { dataModulo = candidateModulo[0].data; }
    }
    var annoRiferimento = dataModulo ? dataModulo.a : annoPiuFrequente(righeGrezze, oggi);

    var armonizzate = armonizzaDate(righeGrezze, {
      oggi: oggi,
      annoRiferimento: annoRiferimento,
      dataModulo: dataModulo
    });

    var righe = righeGrezze.map(function (grezza, indice) {
      var note = [];
      var porto = correggiPorto(grezza, database, note);
      var livello = correggiLivello(grezza, note);
      var facility = correggiFacility(grezza, porto.unlocode, opz.formatoFacility, note);
      var date = armonizzate.esiti[indice];
      note = date.note.concat(note);
      return {
        numero: grezza.numero != null ? grezza.numero : indice + 1,
        unlocode: porto.unlocode,
        porto: porto.porto,
        paese: porto.paese,
        nomePaese: porto.nomePaese,
        arrivo: formattaData(date.arrivo, opz.formatoData),
        partenza: formattaData(date.partenza, opz.formatoData),
        arrivoData: date.arrivo,
        partenzaData: date.partenza,
        sl: livello.sl,
        facility: facility.facility,
        note: note,
        completa: !!(porto.unlocode && date.arrivo && date.partenza && facility.facility),
        testoRiga: grezza.testoRiga
      };
    });

    if (opz.ordine === 'recente' || opz.ordine === 'vecchio') {
      righe.sort(function (a, b) {
        var msA = a.arrivoData ? a.arrivoData.ms : 0;
        var msB = b.arrivoData ? b.arrivoData.ms : 0;
        return opz.ordine === 'recente' ? msB - msA : msA - msB;
      });
    }

    return {
      righe: righe,
      dataModulo: dataModulo,
      annoRiferimento: annoRiferimento,
      ordineCrescenteNelPdf: armonizzate.ordineCrescente,
      pagina: estratto.pagina,
      diagnostica: estratto.diagnostica
    };
  }

  function annoPiuFrequente(righe, oggi) {
    var conteggio = {};
    var annoOggi = oggi.getUTCFullYear();
    for (var i = 0; i < righe.length; i++) {
      var testi = [righe[i].arrivo, righe[i].partenza];
      for (var t = 0; t < testi.length; t++) {
        var lette = Estrattore.trovaDate(testi[t] || '');
        if (!lette.length) { continue; }
        var cifre = String(lette[0].parti[2]).replace(/[^0-9]/g, '');
        if (cifre.length !== 4) { continue; }
        var anno = parseInt(cifre, 10);
        if (anno < 1990 || anno > annoOggi + 1) { continue; }
        conteggio[anno] = (conteggio[anno] || 0) + 1;
      }
    }
    var migliore = null;
    for (var anno2 in conteggio) {
      if (!Object.prototype.hasOwnProperty.call(conteggio, anno2)) { continue; }
      if (migliore === null || conteggio[anno2] > conteggio[migliore] ||
        (conteggio[anno2] === conteggio[migliore] && parseInt(anno2, 10) > migliore)) {
        migliore = parseInt(anno2, 10);
      }
    }
    return migliore || annoOggi;
  }

  /* Riga nel formato richiesto dal PMIS:
     UNLOCODE:arrivo:partenza:livello:port facility */
  function formattaRiga(riga) {
    return [riga.unlocode, riga.arrivo, riga.partenza, riga.sl, riga.facility].join(':');
  }

  function formattaTesto(righe) {
    return righe.map(formattaRiga).join('\n') + (righe.length ? '\n' : '');
  }

  /* Collega i riconoscitori dell'estrattore al database dei porti. */
  function collegaDatabase(database) {
    Estrattore.impostaRiconoscitorePaese(function (testo) {
      return !!database.paeseDaNome(testo);
    });
    Estrattore.impostaValidatoreLocode(function (codice) {
      return database.esiste(codice);
    });
  }

  var api = {
    correggi: correggi,
    formattaRiga: formattaRiga,
    formattaTesto: formattaTesto,
    formattaData: formattaData,
    dateCandidate: dateCandidate,
    armonizzaDate: armonizzaDate,
    correggiLivello: correggiLivello,
    correggiFacility: correggiFacility,
    correggiPorto: correggiPorto,
    pulisciLocode: pulisciLocode,
    collegaDatabase: collegaDatabase,
    OPZIONI_PREDEFINITE: OPZIONI_PREDEFINITE
  };

  globale.CorrezioniIsps = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
}(typeof self !== 'undefined' ? self : globalThis));
