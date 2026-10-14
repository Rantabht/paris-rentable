/* À coller dans Extensions > Apps Script du Google Sheet "Paris rentable - réservations".
   Puis : lance la fonction setup() une fois, et redéploie (Déployer > Gérer les déploiements > Modifier > Nouvelle version).

   Fonctionnement :
   1. Le client envoie sa demande (nom, pseudo, téléphone, montant, ID transaction, capture).
   2. Elle arrive dans l'onglet "Demandes" (statut "en attente"). La capture est enregistrée dans Google Drive.
   3. Tu reçois un email + un message WhatsApp avec un lien "Confirmer le paiement".
   4. Quand tu confirmes, la ligne est ajoutée dans l'onglet "Réservations" (statut "confirmé").
   Statut "annulé" ou "refusé" = la place est libérée. */

const sh = n => SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n);
const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const ds = v => v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd") : String(v).trim();
const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Colonnes communes (Réservations et Demandes) : A..K. Demandes ajoute L = ID, M = Token.
const HEAD_R = ["Envoyé le", "Date", "Nom", "Moyen", "Prix", "Créneau", "ID transaction", "Statut", "Téléphone", "Montant envoyé", "Capture"];
const HEAD_D = HEAD_R.concat(["ID", "Token"]);
const PUBLIC_KEYS = ["prixHT", "prixIntl", "moncash", "natcash", "max"]; // seules ces clés sont visibles sur le site
const PENDING_HOURS = 48; // une demande non traitée bloque la place pendant 48 h

/* ---------- Installation (à lancer une fois) ---------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = sh("Réservations");
  r.getRange(1, 1, 1, HEAD_R.length).setValues([HEAD_R]).setFontWeight("bold");
  r.getRange("N1").clearContent();
  r.getRange("M1").setValue("Statut : « annulé » ou « refusé » libère la place. Tu peux modifier la colonne Prix à la main.");
  const d = sh("Demandes") || ss.insertSheet("Demandes");
  d.getRange(1, 1, 1, HEAD_D.length).setValues([HEAD_D]).setFontWeight("bold");
  d.setFrozenRows(1);
  // Menus déroulants dans la colonne Statut (pratique aussi depuis le téléphone)
  const rule = l => SpreadsheetApp.newDataValidation().requireValueInList(l, true).setAllowInvalid(true).build();
  r.getRange("H2:H1000").setDataValidation(rule(["confirmé", "annulé"]));
  d.getRange("H2:H1000").setDataValidation(rule(["en attente", "confirmé", "refusé", "annulé"]));
  const g = sh("Réglages"), keys = g.getDataRange().getValues().map(x => String(x[0]).trim());
  [
    ["emailAdmin", "", "Ton email pour recevoir les nouvelles demandes"],
    ["waPhone", "", "Ton numéro WhatsApp avec indicatif, ex. +50931772525"],
    ["waApiKey", "", "Clé CallMeBot (voir instructions ci-dessous)"],
    ["", "", ""],
    ["Clé WhatsApp", "", "Depuis ton WhatsApp, envoie « I allow callmebot to send me messages » au +34 644 51 95 23 : tu reçois ta clé. Colle-la dans waApiKey."]
  ].forEach(x => { if (!x[0] || !keys.includes(x[0])) g.appendRow(x); });
  SpreadsheetApp.getUi().alert("Installation terminée. Remplis emailAdmin, waPhone et waApiKey dans l'onglet Réglages.");
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Paris rentable")
    .addItem("Confirmer la demande sélectionnée", "confirmSelected")
    .addItem("Refuser la demande sélectionnée", "refuseSelected")
    .addSeparator()
    .addItem("Annuler le rendez-vous sélectionné", "cancelSelected")
    .addItem("Bloquer une date", "blockDate")
    .addItem("Débloquer une date", "unblockDate")
    .addToUi();
}

/* ---------- Lecture ---------- */
function config() {
  const o = {};
  sh("Réglages").getDataRange().getValues().slice(1).forEach(r => { if (r[0]) o[String(r[0]).trim()] = String(r[1]).trim(); });
  return o;
}
function publicConfig() {
  const c = config(), o = {};
  PUBLIC_KEYS.forEach(k => { if (c[k] !== undefined) o[k] = c[k]; });
  return o;
}
function counts() {
  const o = {}, add = d => { o[d] = (o[d] || 0) + 1; };
  const v = sh("Réservations").getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    const st = String(v[i][7]).trim().toLowerCase();
    if (!v[i][1] || st === "annulé" || st === "refusé") continue;
    add(ds(v[i][1]));
  }
  const dm = sh("Demandes");
  if (dm) {
    const w = dm.getDataRange().getValues(), limit = Date.now() - PENDING_HOURS * 36e5;
    for (let i = 1; i < w.length; i++) {
      if (String(w[i][7]).trim().toLowerCase() !== "en attente" || !w[i][1]) continue;
      if (w[i][0] instanceof Date && w[i][0].getTime() < limit) continue;
      add(ds(w[i][1]));
    }
  }
  return o;
}
function closed() {
  return sh("Dates fermées").getDataRange().getValues().slice(1).map(r => r[0]).filter(x => x !== "").map(ds);
}

/* ---------- Site web ---------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.a === "confirm" || p.a === "refuse") return decisionPage(p);
  return out({ counts: counts(), config: publicConfig(), closed: closed() });
}

function doPost(e) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const b = JSON.parse(e.postData.contents), c = config(), max = Number(c.max) || 10;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) return out({ ok: false });
    if (closed().includes(b.date) || (counts()[b.date] || 0) >= max) return out({ ok: false, full: true });

    const prix = b.meth === "intl" ? c.prixIntl : c.prixHT;           // le prix vient du Sheet, pas du navigateur
    const nom = String(b.nom || "").trim().slice(0, 70);
    const tel = String(b.tel || "").replace(/[^\d+]/g, "").slice(0, 20);
    if (!nom || tel.replace(/\D/g, "").length < 8) return out({ ok: false });

    const wk = new Date(b.date + "T12:00:00").getDay();
    const slot = (wk === 0 || wk === 6) ? "Sam-Dim 10h-16h (heure à confirmer)" : "Lun-Ven 18h-20h (heure à confirmer)";
    const id = Utilities.getUuid().slice(0, 8), token = Utilities.getUuid().replace(/-/g, "");
    const montant = String(b.amt || "").trim().slice(0, 20);
    const attendu = parseInt(String(prix).replace(/\D/g, ""), 10);
    const montantOk = b.meth !== "intl" && attendu && parseFloat(montant.replace(",", ".")) === attendu;

    let blob = null, lien = "";
    if (b.img && b.img.length < 4e6) {
      try {
        blob = Utilities.newBlob(Utilities.base64Decode(String(b.img).split(",").pop()), "image/jpeg", "capture-" + b.date + "-" + id + ".jpg");
        const f = dossier().createFile(blob); lien = f.getUrl();
      } catch (err) { blob = null; }
    }

    const rec = {
      id, token, date: b.date, nom, tel, via: b.via, prix,
      slot, txn: String(b.txn || "").trim().slice(0, 24), montant, montantOk, lien
    };
    sh("Demandes").appendRow([new Date(), "'" + rec.date, rec.nom, rec.via, prix, rec.slot, "'" + rec.txn, "en attente",
      "'" + rec.tel, "'" + rec.montant, lien, id, token]);
    notify(rec, blob, c);
    return out({ ok: true });
  } catch (err) {
    console.error(err);
    return out({ ok: false });
  } finally { lock.releaseLock(); }
}

function dossier() {
  const it = DriveApp.getFoldersByName("Paris rentable - captures");
  return it.hasNext() ? it.next() : DriveApp.createFolder("Paris rentable - captures");
}

/* ---------- Notifications email + WhatsApp ---------- */
function notify(r, blob, c) {
  const base = ScriptApp.getService().getUrl();
  const ok = base + "?a=confirm&id=" + r.id + "&t=" + r.token;
  const no = base + "?a=refuse&id=" + r.id + "&t=" + r.token;
  const ligneMontant = r.montant + (r.montantOk ? " ✅ (montant correct)" : " ⚠️ (attendu : " + r.prix + ")");

  if (c.emailAdmin) {
    try {
      const html = `<div style="font-family:Arial,sans-serif;max-width:480px">
        <h2 style="margin:0 0 8px">Nouvelle demande : ${esc(r.date)}</h2>
        <p><b>${esc(r.nom)}</b><br>
        Tél / WhatsApp : <b>${esc(r.tel)}</b><br>
        Moyen : ${esc(r.via)}<br>
        Montant envoyé : <b>${esc(ligneMontant)}</b><br>
        ID transaction : ${esc(r.txn) || "—"}<br>
        Appel : ${esc(r.slot)}</p>
        <p>${blob ? "Capture jointe à cet email." : "Pas de capture reçue."} ${r.lien ? '<a href="' + esc(r.lien) + '">Voir dans Drive</a>' : ""}</p>
        <p><a href="${esc(ok)}" style="background:#00b200;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold">Confirmer le paiement</a>
        &nbsp; <a href="${esc(no)}" style="color:#b00020">Refuser</a></p></div>`;
      const o = { to: c.emailAdmin, subject: "Paris rentable • " + r.date + " • " + r.nom, htmlBody: html };
      if (blob) o.attachments = [blob];
      MailApp.sendEmail(o);
    } catch (err) { console.error("email", err); }
  }

  if (c.waPhone && c.waApiKey) {
    try {
      const txt = "🆕 Paris rentable\n" + r.date + " • " + r.nom +
        "\n📞 " + r.tel + "\n💰 " + ligneMontant + "\n🧾 " + (r.txn || "—") + "\n\n✅ Confirmer : " + ok;
      UrlFetchApp.fetch("https://api.callmebot.com/whatsapp.php?phone=" + encodeURIComponent(c.waPhone) +
        "&text=" + encodeURIComponent(txt) + "&apikey=" + encodeURIComponent(c.waApiKey), { muteHttpExceptions: true });
    } catch (err) { console.error("whatsapp", err); }
  }
}

/* ---------- Confirmation / refus ---------- */
function findDemande(id) {
  const v = sh("Demandes").getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (String(v[i][11]) === String(id)) return { row: i + 1, v: v[i] };
  return null;
}

// Appelée depuis la page de confirmation, ou depuis le menu du Sheet.
function decide(id, token, action) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const f = findDemande(id);
    if (!f || String(f.v[12]) !== String(token)) return "Lien invalide.";
    const st = String(f.v[7]).trim().toLowerCase();
    if (st !== "en attente") return "Déjà traité (statut : " + f.v[7] + ").";
    const d = sh("Demandes");
    if (action === "confirm") {
      const row = f.v.slice(0, HEAD_R.length);
      row[7] = "confirmé";
      [1, 6, 8, 9].forEach(i => { if (row[i] !== "") row[i] = "'" + ds(row[i]); }); // garde date et numéros en texte
      sh("Réservations").appendRow(row);
      d.getRange(f.row, 8).setValue("confirmé");
      return "✅ Paiement confirmé. La réservation est ajoutée dans l'onglet Réservations.";
    }
    d.getRange(f.row, 8).setValue("refusé");
    return "Demande refusée. La place est libérée.";
  } finally { lock.releaseLock(); }
}

function decisionPage(p) {
  const f = findDemande(p.id);
  if (!f || String(f.v[12]) !== String(p.t)) return HtmlService.createHtmlOutput("<p style='font-family:Arial;padding:20px'>Lien invalide.</p>");
  const v = f.v, confirm = p.a === "confirm";
  const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:24px auto;padding:0 16px">
    <h2>${confirm ? "Confirmer ce paiement ?" : "Refuser cette demande ?"}</h2>
    <p><b>${esc(v[2])}</b><br>Date : ${esc(ds(v[1]))}<br>Tél : ${esc(v[8])}<br>
    Montant envoyé : ${esc(v[9])} (prix : ${esc(v[4])})<br>ID transaction : ${esc(v[6]) || "—"}<br>${v[10] ? '<a href="' + esc(v[10]) + '" target="_blank">Voir la capture</a><br>' : ""}
    Statut actuel : ${esc(v[7])}</p>
    <button id="b" style="width:100%;padding:14px;border:0;border-radius:12px;font-size:16px;font-weight:bold;color:#fff;background:${confirm ? "#00b200" : "#b00020"}">${confirm ? "Oui, confirmer" : "Oui, refuser"}</button>
    <p id="r" style="font-weight:bold"></p></div>
    <script>
      document.getElementById("b").onclick = function () {
        this.disabled = true;
        google.script.run.withSuccessHandler(function (m) { document.getElementById("r").textContent = m; })
          .decide(${JSON.stringify(String(p.id))}, ${JSON.stringify(String(p.t))}, ${JSON.stringify(confirm ? "confirm" : "refuse")});
      };
    </script>`;
  return HtmlService.createHtmlOutput(html).setTitle("Paris rentable");
}

/* ---------- Depuis le Sheet (menu Paris rentable) ---------- */
function selectedDemande_() {
  const s = SpreadsheetApp.getActiveSheet();
  if (s.getName() !== "Demandes" || s.getActiveCell().getRow() < 2) { SpreadsheetApp.getUi().alert("Sélectionne une ligne dans l'onglet Demandes."); return null; }
  return s.getRange(s.getActiveCell().getRow(), 1, 1, HEAD_D.length).getValues()[0];
}
function confirmSelected() { const v = selectedDemande_(); if (v) SpreadsheetApp.getUi().alert(decide(v[11], v[12], "confirm")); }
function refuseSelected() { const v = selectedDemande_(); if (v) SpreadsheetApp.getUi().alert(decide(v[11], v[12], "refuse")); }

/* ---------- Annuler un rendez-vous / bloquer une date ---------- */
// Annuler : sélectionne une ligne dans Réservations (ou Demandes), puis menu Paris rentable > Annuler.
// À la main (ou depuis le téléphone) : mets « annulé » dans la colonne Statut. La place est libérée.
function cancelSelected() {
  const ui = SpreadsheetApp.getUi(), s = SpreadsheetApp.getActiveSheet(), row = s.getActiveCell().getRow();
  if (!["Réservations", "Demandes"].includes(s.getName()) || row < 2) return ui.alert("Sélectionne une ligne dans l'onglet Réservations ou Demandes.");
  const v = s.getRange(row, 1, 1, 3).getValues()[0];
  if (ui.alert("Annuler le rendez-vous de " + v[2] + " (" + ds(v[1]) + ") ?", ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  s.getRange(row, 8).setValue("annulé");
  ui.alert("Rendez-vous annulé. La place est libérée.");
}

// Bloquer / débloquer : ajoute ou retire la date dans l'onglet « Dates fermées ».
function askDate_(titre) {
  const ui = SpreadsheetApp.getUi(), r = ui.prompt(titre, "Format : 17/10/2026", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  const t = r.getResponseText().trim();
  let m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  ui.alert("Date non reconnue. Exemple : 17/10/2026");
  return null;
}
function blockDate() {
  const iso = askDate_("Bloquer quelle date ?"); if (!iso) return;
  if (!closed().includes(iso)) sh("Dates fermées").appendRow(["'" + iso]);
  SpreadsheetApp.getUi().alert(iso + " est bloquée : elle apparaît « indisponible » sur le site.");
}
function unblockDate() {
  const iso = askDate_("Débloquer quelle date ?"); if (!iso) return;
  const g = sh("Dates fermées"), v = g.getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) if (v[i][0] !== "" && ds(v[i][0]) === iso) g.deleteRow(i + 1);
  SpreadsheetApp.getUi().alert(iso + " est de nouveau disponible.");
}

/* ---------- Test : vérifie que tu reçois bien l'email et le WhatsApp ---------- */
// Lance cette fonction une fois depuis l'éditeur (bouton Exécuter) après avoir rempli les Réglages.
function testerNotifications() {
  const rec = { id: "test", token: "test", date: "2026-01-01", nom: "Test Paris rentable", tel: "+509 0000 0000", via: "MonCash Haïti",
    prix: "500 HTG", slot: "Test", txn: "000000", montant: "500", montantOk: true, lien: "" };
  notify(rec, null, config());
}
