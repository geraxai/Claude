/*
 * database-porti.js
 * -----------------
 * Indice UN/LOCODE usato per correggere automaticamente il codice porto,
 * il nome del porto e il paese letti dal modulo ISPS.
 *
 * I dati arrivano dai file dati/porti.js (localita' portuali, caricato
 * subito) e dati/porti-estesi.js (tutte le altre localita', caricato solo
 * se una ricerca non trova nulla nell'indice principale).
 *
 * Nessuna dipendenza esterna: funziona sia nel browser sia in Node.
 */
(function (globale) {
  'use strict';

  // Nomi alternativi/italianizzati che non compaiono nell'elenco ufficiale.
  // Chiave = nome normalizzato (solo A-Z0-9), valore = UN/LOCODE.
  var ALIAS_PORTI = {
    GENOA: 'ITGOA', GENUA: 'ITGOA', GENES: 'ITGOA',
    LEGHORN: 'ITLIV',
    NAPLES: 'ITNAP', NEAPEL: 'ITNAP',
    VENICE: 'ITVCE', VENISE: 'ITVCE',
    ROME: 'ITCVV', ROMA: 'ITCVV', CIVITAVECCHIAROMA: 'ITCVV',
    SYRACUSE: 'ITSIR',
    MESSINA: 'ITMSN',
    TURIN: 'ITTRN',
    MILAN: 'ITMIL',
    PIREO: 'GRPIR', PIRAIEVS: 'GRPIR', PIRAEVS: 'GRPIR', PIRAIAS: 'GRPIR',
    SALONICCO: 'GRSKG', SALONICA: 'GRSKG', SALONIKA: 'GRSKG', THESSALONICA: 'GRSKG',
    ELEUSIS: 'GRELS', ELEFSIS: 'GRELS',
    ISTAMBUL: 'TRIST', COSTANTINOPOLI: 'TRIST',
    AMBARLI: 'TRAMB', AMBARLIISTANBUL: 'TRAMB',
    SMIRNE: 'TRIZM', SMYRNA: 'TRIZM',
    ALEXANDRIA: 'EGALY', ALESSANDRIA: 'EGALY', ALESSANDRIADEGITTO: 'EGALY',
    ELISKANDARIYA: 'EGALY', ISKANDARIYA: 'EGALY',
    PORTSAID: 'EGPSD', PORTOSAID: 'EGPSD', SAIDPORT: 'EGPSD',
    SUEZ: 'EGSUZ', ASSUWAYS: 'EGSUZ',
    DAMIETTA: 'EGDAM', DUMYAT: 'EGDAM',
    VALLETTA: 'MTMLA', LAVALLETTA: 'MTMLA', MALTA: 'MTMLA', MALTAFREEPORT: 'MTMAR',
    BARCELLONA: 'ESBCN',
    ALGECIRAS: 'ESALG',
    VALENZA: 'ESVLC',
    MARSIGLIA: 'FRMRS', MARSEILLES: 'FRMRS',
    ANVERSA: 'BEANR', ANTWERP: 'BEANR', ANVERS: 'BEANR',
    AMBURGO: 'DEHAM',
    ROTTERDAN: 'NLRTM',
    GIBILTERRA: 'GIGIB',
    ALGERI: 'DZALG', ALGIERS: 'DZALG', ALGER: 'DZALG',
    TUNISI: 'TNTUN',
    TRIPOLILIBIA: 'LYTIP', TRIPOLILY: 'LYTIP',
    MISURATA: 'LYMRA', MISRATA: 'LYMRA',
    ODESSA: 'UAODS', ODESA: 'UAODS',
    COSTANZA: 'ROCND', CONSTANTZA: 'ROCND', KONSTANZA: 'ROCND',
    LISBONA: 'PTLIS',
    ANCONA: 'ITAOI',
    LISBOA: 'PTLIS',
    SHANGAI: 'CNSGH',
    PORTOSUDAN: 'SDPZU',
    NUOVAYORK: 'USNYC', NEWYORKCITY: 'USNYC',
    DUBAI: 'AEDXB', JEBELALI: 'AEJEA',
    HAIFA: 'ILHFA',
    LIMASSOL: 'CYLMS', LEMESOS: 'CYLMS',
    DURAZZO: 'ALDRZ', DURRES: 'ALDRZ',
    SPALATO: 'HRSPU', SPLIT: 'HRSPU',
    FIUME: 'HRRJK', RIJEKA: 'HRRJK',
    CAPODISTRIA: 'SIKOP', KOPER: 'SIKOP',
    ANTIVARI: 'MEBAR'
  };

  // Nomi di paese non presenti nell'elenco ISO (sigle e forme comuni).
  var ALIAS_PAESI = {
    UK: 'GB', GREATBRITAIN: 'GB', ENGLAND: 'GB', INGHILTERRA: 'GB', GRANBRETAGNA: 'GB',
    USA: 'US', UNITEDSTATESOFAMERICA: 'US', AMERICA: 'US', STATIUNITIDAMERICA: 'US',
    UAE: 'AE', EMIRATIARABI: 'AE',
    HOLLAND: 'NL', OLANDA: 'NL', THENETHERLANDS: 'NL',
    TURKIYE: 'TR', TURKEY: 'TR', TURCHIA: 'TR',
    KOREA: 'KR', SOUTHKOREA: 'KR', REPUBLICOFKOREA: 'KR', COREA: 'KR',
    RUSSIA: 'RU', RUSSIANFEDERATION: 'RU',
    IVORYCOAST: 'CI', COSTADAVORIO: 'CI',
    LIBYA: 'LY', LIBIA: 'LY',
    SYRIA: 'SY', SIRIA: 'SY',
    EGYPT: 'EG', EGITTO: 'EG',
    GREECE: 'GR', GRECIA: 'GR', HELLAS: 'GR', ELLADA: 'GR',
    SPAIN: 'ES', SPAGNA: 'ES', ESPANA: 'ES',
    FRANCE: 'FR', FRANCIA: 'FR',
    GERMANY: 'DE', GERMANIA: 'DE', DEUTSCHLAND: 'DE',
    ITALY: 'IT', ITALIA: 'IT', ITALIE: 'IT',
    TUNISIA: 'TN', TUNISIE: 'TN',
    ALGERIA: 'DZ', ALGERIE: 'DZ',
    MOROCCO: 'MA', MAROCCO: 'MA', MAROC: 'MA',
    MALTAISLAND: 'MT',
    CHINA: 'CN', CINA: 'CN', PRCHINA: 'CN', PEOPLESREPUBLICOFCHINA: 'CN',
    ROMANIA: 'RO', RUMANIA: 'RO',
    UKRAINE: 'UA', UCRAINA: 'UA',
    ISRAEL: 'IL', ISRAELE: 'IL',
    CYPRUS: 'CY', CIPRO: 'CY',
    ALBANIA: 'AL',
    MONTENEGRO: 'ME',
    CROATIA: 'HR', CROAZIA: 'HR',
    SLOVENIA: 'SI',
    PORTUGAL: 'PT', PORTOGALLO: 'PT',
    BELGIUM: 'BE', BELGIO: 'BE',
    NETHERLAND: 'NL'
  };

  // Parole che nei nomi dei porti non aiutano il riconoscimento.
  var PAROLE_INUTILI = /^(PORT|PORTO|PUERTO|PORTOF|TERMINAL|TERMINALE|HARBOUR|HARBOR|ANCHORAGE|RADA|MOLO|BANCHINA|BERTH|OF|DI|DE|DEL|DELLA|DA|EL|AL|LA|IL|THE)$/;

  var DIACRITICI = /[\u0300-\u036f]/g;

  function normalizza(testo) {
    var t = String(testo == null ? '' : testo);
    if (t.normalize) { t = t.normalize('NFD').replace(DIACRITICI, ''); }
    return t.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  }

  function chiave(testo) {
    return normalizza(testo).replace(/ /g, '');
  }

  /* Distanza di Damerau-Levenshtein con taglio: se supera "limite"
     restituisce limite + 1 senza completare il calcolo. */
  function distanza(a, b, limite) {
    if (a === b) { return 0; }
    if (Math.abs(a.length - b.length) > limite) { return limite + 1; }
    if (!a.length || !b.length) { return Math.max(a.length, b.length); }
    var precedente2 = null;
    var precedente = new Array(b.length + 1);
    var corrente = new Array(b.length + 1);
    var i, j;
    for (j = 0; j <= b.length; j++) { precedente[j] = j; }
    for (i = 1; i <= a.length; i++) {
      corrente[0] = i;
      var minimoRiga = i;
      for (j = 1; j <= b.length; j++) {
        var costo = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var valore = Math.min(
          corrente[j - 1] + 1,
          precedente[j] + 1,
          precedente[j - 1] + costo
        );
        if (
          i > 1 && j > 1 && precedente2 &&
          a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
          a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
        ) {
          valore = Math.min(valore, precedente2[j - 2] + costo);
        }
        corrente[j] = valore;
        if (valore < minimoRiga) { minimoRiga = valore; }
      }
      if (minimoRiga > limite) { return limite + 1; }
      var scambio = precedente2;
      precedente2 = precedente;
      precedente = corrente;
      corrente = scambio || new Array(b.length + 1);
    }
    return precedente[b.length];
  }

  function sogliaNome(lunghezza) {
    if (lunghezza <= 4) { return 1; }
    if (lunghezza <= 7) { return 2; }
    if (lunghezza <= 12) { return 3; }
    return 4;
  }

  /* ------------------------------------------------------------------ */

  function DatabasePorti() {
    this.nomePerCodice = {};      // "ITCTA" -> "Catania"
    this.codiciPerNome = {};      // "CATANIA" -> ["ITCTA", ...]
    this.codiciPerPaese = {};     // "IT" -> ["CTA", ...]
    this.nomiPaese = {};          // "IT" -> ["Italy", "Italia"]
    this.paesePerNome = {};       // "ITALIA" -> "IT"
    this.chiaviNome = [];         // elenco per la ricerca approssimata
    this.esteso = false;
    this.caricato = false;
  }

  DatabasePorti.prototype.aggiungiElenco = function (elenco) {
    var righe = String(elenco || '').split('\n');
    var paese = null;
    for (var i = 0; i < righe.length; i++) {
      var riga = righe[i];
      if (!riga) { continue; }
      if (riga.length === 2) { paese = riga; continue; }
      if (!paese) { continue; }
      var virgola = riga.indexOf(',');
      if (virgola < 0) { continue; }
      var localita = riga.slice(0, virgola);
      var nome = riga.slice(virgola + 1);
      var codice = paese + localita;
      if (this.nomePerCodice[codice]) { continue; }
      this.nomePerCodice[codice] = nome;
      if (!this.codiciPerPaese[paese]) { this.codiciPerPaese[paese] = []; }
      this.codiciPerPaese[paese].push(localita);
      this.indicizzaNome(nome, codice);
    }
  };

  /* Indicizza il nome e le sue varianti: nomi alternativi fra parentesi,
     forme separate da barra, versione senza parole generiche. */
  DatabasePorti.prototype.indicizzaNome = function (nome, codice) {
    var varianti = [];
    var senzaParentesi = nome.replace(/\(([^)]*)\)/g, ' ');
    varianti.push(nome);
    varianti.push(senzaParentesi);
    var interne = nome.match(/\(([^)]*)\)/g) || [];
    for (var i = 0; i < interne.length; i++) {
      varianti.push(interne[i].replace(/[()]/g, ''));
    }
    var pezzi = senzaParentesi.split(/[\/]/);
    if (pezzi.length > 1) { varianti = varianti.concat(pezzi); }

    for (var v = 0; v < varianti.length; v++) {
      var normalizzato = normalizza(varianti[v]);
      if (!normalizzato) { continue; }
      this.registraChiave(chiave(normalizzato), codice);
      var parole = normalizzato.split(' ').filter(function (p) {
        return !PAROLE_INUTILI.test(p);
      });
      if (parole.length) {
        this.registraChiave(parole.join(''), codice);
      }
    }
  };

  DatabasePorti.prototype.registraChiave = function (k, codice) {
    if (!k || k.length < 2) { return; }
    var elenco = this.codiciPerNome[k];
    if (!elenco) {
      this.codiciPerNome[k] = [codice];
      this.chiaviNome.push(k);
    } else if (elenco.indexOf(codice) < 0) {
      elenco.push(codice);
    }
  };

  DatabasePorti.prototype.carica = function (dati) {
    if (!dati) { return this; }
    this.fonte = dati.fonte;
    this.generato = dati.generato;
    if (dati.paesi) {
      for (var iso in dati.paesi) {
        if (!Object.prototype.hasOwnProperty.call(dati.paesi, iso)) { continue; }
        this.nomiPaese[iso] = dati.paesi[iso];
        for (var n = 0; n < dati.paesi[iso].length; n++) {
          this.paesePerNome[chiave(dati.paesi[iso][n])] = iso;
        }
      }
      for (var alias in ALIAS_PAESI) {
        if (Object.prototype.hasOwnProperty.call(ALIAS_PAESI, alias)) {
          this.paesePerNome[alias] = ALIAS_PAESI[alias];
        }
      }
    }
    this.aggiungiElenco(dati.elenco);
    for (var aliasPorto in ALIAS_PORTI) {
      if (Object.prototype.hasOwnProperty.call(ALIAS_PORTI, aliasPorto)) {
        var codice = ALIAS_PORTI[aliasPorto];
        if (this.nomePerCodice[codice]) { this.registraChiave(aliasPorto, codice); }
      }
    }
    this.caricato = true;
    return this;
  };

  /* Aggiunge le localita' non portuali (file dati/porti-estesi.js). */
  DatabasePorti.prototype.caricaEsteso = function (dati) {
    if (!dati || this.esteso) { return this; }
    this.aggiungiElenco(dati.elenco);
    this.esteso = true;
    return this;
  };

  DatabasePorti.prototype.nomeDiCodice = function (codice) {
    return this.nomePerCodice[String(codice || '').toUpperCase()] || null;
  };

  DatabasePorti.prototype.esiste = function (codice) {
    return !!this.nomeDiCodice(codice);
  };

  DatabasePorti.prototype.nomeDiPaese = function (iso) {
    var nomi = this.nomiPaese[String(iso || '').toUpperCase()];
    return nomi ? nomi[0] : null;
  };

  /* Riconosce il paese da un nome scritto in inglese o italiano, tollerando
     errori di battitura/OCR. Accetta anche direttamente la sigla ISO. */
  DatabasePorti.prototype.paeseDaNome = function (testo) {
    var k = chiave(testo);
    if (!k) { return null; }
    if (k.length === 2 && this.nomiPaese[k]) { return k; }
    if (this.paesePerNome[k]) { return this.paesePerNome[k]; }
    var migliore = null;
    var miglioreDistanza = Infinity;
    var limite = sogliaNome(k.length);
    for (var nome in this.paesePerNome) {
      if (!Object.prototype.hasOwnProperty.call(this.paesePerNome, nome)) { continue; }
      var d = distanza(k, nome, limite);
      if (d < miglioreDistanza) {
        miglioreDistanza = d;
        migliore = this.paesePerNome[nome];
      }
    }
    return miglioreDistanza <= limite ? migliore : null;
  };

  /* Cerca il codice a partire dal nome del porto.
     Restituisce { codice, nome, distanza, ambiguo } oppure null. */
  DatabasePorti.prototype.cercaPerNome = function (nomePorto, paeseIso) {
    var k = chiave(nomePorto);
    if (k.length < 2) { return null; }
    var iso = paeseIso ? String(paeseIso).toUpperCase() : null;
    var esatti = this.filtraPerPaese(this.codiciPerNome[k], iso);
    if (esatti && esatti.length) {
      return {
        codice: esatti[0],
        nome: this.nomePerCodice[esatti[0]],
        distanza: 0,
        ambiguo: esatti.length > 1
      };
    }
    // senza parole generiche ("PORT OF X" -> "X")
    var ridotto = normalizza(nomePorto).split(' ').filter(function (p) {
      return !PAROLE_INUTILI.test(p);
    }).join('');
    if (ridotto && ridotto !== k) {
      var perRidotto = this.filtraPerPaese(this.codiciPerNome[ridotto], iso);
      if (perRidotto && perRidotto.length) {
        return {
          codice: perRidotto[0],
          nome: this.nomePerCodice[perRidotto[0]],
          distanza: 0,
          ambiguo: perRidotto.length > 1
        };
      }
    }
    return this.cercaApprossimata(k, iso);
  };

  DatabasePorti.prototype.filtraPerPaese = function (codici, iso) {
    if (!codici || !codici.length) { return null; }
    if (!iso) { return codici; }
    var filtrati = codici.filter(function (c) { return c.slice(0, 2) === iso; });
    return filtrati.length ? filtrati : codici;
  };

  /* Prima cerca dentro il paese indicato; se non trova nulla ripete la
     ricerca su tutto il mondo (il paese sul modulo puo' essere sbagliato). */
  DatabasePorti.prototype.cercaApprossimata = function (k, iso) {
    if (iso) {
      var dentroPaese = this.scansioneApprossimata(k, iso);
      if (dentroPaese) { return dentroPaese; }
    }
    return this.scansioneApprossimata(k, null);
  };

  DatabasePorti.prototype.scansioneApprossimata = function (k, iso) {
    var limite = sogliaNome(k.length);
    var migliore = null;
    var miglioreDistanza = limite + 1;
    var secondaDistanza = limite + 1;
    var chiavi = this.chiaviNome;
    for (var i = 0; i < chiavi.length; i++) {
      var candidata = chiavi[i];
      if (Math.abs(candidata.length - k.length) > limite) { continue; }
      var codici = this.codiciPerNome[candidata];
      if (iso) {
        codici = codici.filter(function (c) { return c.slice(0, 2) === iso; });
        if (!codici.length) { continue; }
      }
      var d = distanza(k, candidata, miglioreDistanza <= limite ? miglioreDistanza : limite);
      if (d < miglioreDistanza) {
        secondaDistanza = miglioreDistanza;
        miglioreDistanza = d;
        migliore = codici[0];
      } else if (d < secondaDistanza) {
        secondaDistanza = d;
      }
      if (miglioreDistanza === 0) { break; }
    }
    if (!migliore || miglioreDistanza > limite) { return null; }
    return {
      codice: migliore,
      nome: this.nomePerCodice[migliore],
      distanza: miglioreDistanza,
      ambiguo: secondaDistanza === miglioreDistanza
    };
  };

  /* Corregge un UN/LOCODE illeggibile cercando il codice valido piu' vicino,
     eventualmente limitandosi al paese indicato. */
  DatabasePorti.prototype.correggiCodice = function (codice, paeseIso) {
    var k = chiave(codice);
    if (k.length < 3) { return null; }
    if (this.nomePerCodice[k]) {
      return { codice: k, nome: this.nomePerCodice[k], distanza: 0 };
    }
    var paesi = [];
    if (paeseIso && this.codiciPerPaese[paeseIso]) {
      paesi.push(paeseIso);
    } else {
      var possibile = k.slice(0, 2);
      if (this.codiciPerPaese[possibile]) { paesi.push(possibile); }
      for (var iso in this.codiciPerPaese) {
        if (Object.prototype.hasOwnProperty.call(this.codiciPerPaese, iso) && iso !== possibile) {
          paesi.push(iso);
        }
      }
    }
    var migliore = null;
    var miglioreDistanza = 3;
    for (var p = 0; p < paesi.length; p++) {
      var elenco = this.codiciPerPaese[paesi[p]];
      for (var i = 0; i < elenco.length; i++) {
        var completo = paesi[p] + elenco[i];
        var d = distanza(k, completo, miglioreDistanza);
        if (d < miglioreDistanza) {
          miglioreDistanza = d;
          migliore = completo;
          if (d === 1) { break; }
        }
      }
      if (miglioreDistanza <= 1) { break; }
    }
    if (!migliore) { return null; }
    return { codice: migliore, nome: this.nomePerCodice[migliore], distanza: miglioreDistanza };
  };

  var api = {
    DatabasePorti: DatabasePorti,
    normalizza: normalizza,
    chiave: chiave,
    distanza: distanza,
    ALIAS_PORTI: ALIAS_PORTI,
    ALIAS_PAESI: ALIAS_PAESI
  };

  globale.DatabasePortiModulo = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
}(typeof self !== 'undefined' ? self : globalThis));
