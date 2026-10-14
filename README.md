# Paris rentable – Réservation de dates

Page de réservation mobile pour **Paris rentable**. Le client choisit une date, paie par MonCash, NatCash ou transfert international, puis envoie sa demande avec une capture d'écran. Le propriétaire est averti par **email** et par **WhatsApp**, puis confirme le paiement en un clic. La réservation est alors ajoutée automatiquement dans **Google Sheets**.

## Fonctionnalités

- Calendrier avec dates disponibles, en attente, réservées et indisponibles
- Paiement MonCash, NatCash ou international, avec copie du numéro en un clic
- Formulaire : nom et prénom, numéro WhatsApp, montant envoyé, ID de transaction (optionnel) et capture d'écran
- Maximum de **10 rendez-vous par jour** (même 1 seul rendez-vous peut être maintenu)
- Notifications email (avec la capture jointe) et WhatsApp, avec un lien « Confirmer le paiement »
- La ligne n'est ajoutée à l'onglet **Réservations** qu'après ta confirmation
- Annulation d'un rendez-vous et blocage de dates depuis le Google Sheet
- Mode clair et sombre, optimisé pour téléphone

## Les fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | La page du site (à publier avec GitHub Pages) |
| `google-apps-script.gs` | Le script du Google Sheet : reçoit les demandes, envoie les notifications et gère les confirmations |
| `Paris-rentable-reservations.xlsx` | Le modèle du Google Sheet (à importer dans Google Drive) |

Ajoute aussi ta photo de profil sous le nom `photo.jpg` dans le même dossier (facultatif).

## Installation

### 1. Préparer le Google Sheet

1. Dans Google Drive : **Nouveau > Importer un fichier** et choisis `Paris-rentable-reservations.xlsx`.
2. Ouvre-le avec Google Sheets.
3. Dans l'onglet **Réglages**, remplis les cases jaunes :

| Réglage | Explication |
|---|---|
| `prixHT` | Prix en Haïti (par défaut : 1500 HTG) |
| `prixIntl` | Prix depuis l'étranger (par défaut : 10 USD) |
| `moncash` | Ton numéro MonCash |
| `natcash` | Ton numéro NatCash (vide = NatCash masqué) |
| `max` | Maximum de personnes par jour (10) |
| `emailAdmin` | Ton email pour recevoir les demandes |
| `waPhone` | Ton numéro WhatsApp qui reçoit les alertes (avec l'indicatif, ex. +509…) |
| `waApiKey` | Clé CallMeBot (voir l'étape 3) |

### 2. Installer le script

1. Dans le Sheet : **Extensions > Apps Script**.
2. Remplace tout le contenu par celui de `google-apps-script.gs`, puis enregistre.
3. Lance la fonction `setup()` une fois et accepte les autorisations.

### 3. Activer les alertes WhatsApp (CallMeBot)

1. Depuis ton WhatsApp, envoie le message `I allow callmebot to send me messages` au **+34 644 51 95 23**.
2. Tu reçois une clé : colle-la dans `waApiKey` (onglet Réglages).
3. Dans Apps Script, lance `testerNotifications()` : tu dois recevoir un email et un message WhatsApp de test.

### 4. Publier le script

1. **Déployer > Nouveau déploiement > Application web**.
2. **Exécuter en tant que :** moi. **Accès :** tout le monde.
3. Copie le lien obtenu (il se termine par `/exec`).

Après toute modification du script, utilise **Déployer > Gérer les déploiements > Modifier > Nouvelle version** pour garder le même lien.

### 5. Connecter la page

1. Ouvre `index.html` et colle le lien du déploiement dans `api:""` :

   ```js
   api: "https://script.google.com/macros/s/XXXXXXXX/exec",
   ```

2. Vérifie aussi `whatsapp` (ton numéro, sans le +) et `moncash` dans le bloc `CONFIG`.

### 6. Mettre le site en ligne (GitHub Pages)

1. Crée un dépôt GitHub et ajoute `index.html` (et `photo.jpg`).
2. **Settings > Pages**, puis choisis la branche `main` et le dossier `/ (root)`.
3. Ton site sera disponible à l'adresse `https://TON-PSEUDO.github.io/NOM-DU-DEPOT/`.

## Fonctionnement

1. Le client choisit une date et envoie sa demande avec sa capture.
2. La demande arrive dans l'onglet **Demandes** (statut « en attente »). La capture est enregistrée dans Google Drive, dans le dossier « Paris rentable - captures ».
3. Tu reçois un email et un message WhatsApp. Ils indiquent si le montant est correct (✅ ou ⚠️).
4. Tu cliques sur **Confirmer le paiement** : la ligne passe dans l'onglet **Réservations** avec le statut « confirmé ».
5. Tu contactes le client sur WhatsApp pour fixer l'heure de l'appel.

Une demande en attente bloque la place pendant 48 h.

**Horaires d'appel :** lundi à vendredi de 18h à 20h, samedi et dimanche de 10h à 16h.

## Gérer les rendez-vous

- **Annuler :** mets « annulé » dans la colonne **Statut** (menu déroulant), ou utilise le menu **Paris rentable > Annuler le rendez-vous sélectionné**. La place est libérée.
- **Bloquer une date :** ajoute-la dans l'onglet **Dates fermées** (format `2026-10-18`), ou utilise **Paris rentable > Bloquer une date**.
- **Débloquer :** supprime la ligne de l'onglet **Dates fermées**, ou utilise **Paris rentable > Débloquer une date**.
- **Confirmer ou refuser à la main :** sélectionne la ligne dans **Demandes**, puis utilise le menu **Paris rentable**.

> Les menus personnalisés ne s'affichent pas toujours dans l'application mobile Google Sheets. Sur téléphone, utilise le menu déroulant de la colonne Statut et l'onglet « Dates fermées ».

## Sécurité

- Ne publie jamais ta clé CallMeBot ni ton email dans le code. Ils restent dans l'onglet **Réglages** du Sheet.
- Le site ne reçoit que les réglages publics (prix, numéros de paiement et maximum par jour).
- Les liens de confirmation contiennent un code secret unique par demande : ne les partage pas.

## Dépannage

| Problème | Solution |
|---|---|
| « Envoi impossible » sur le site | Vérifie que `api` contient le bon lien et que l'accès du déploiement est « Tout le monde » |
| Pas d'email reçu | Vérifie `emailAdmin`, puis regarde les spams |
| Pas de message WhatsApp | Vérifie `waPhone` et `waApiKey`, puis relance `testerNotifications()` |
| Une date reste bloquée | Vérifie les onglets **Réservations**, **Demandes** (en attente) et **Dates fermées** |
| Les changements n'apparaissent pas | Redéploie une nouvelle version du script |

## Technologies

HTML, CSS et JavaScript (sans framework), Google Apps Script, Google Sheets, Google Drive et CallMeBot (WhatsApp).

© Paris rentable. Tous droits réservés. 18+ • Les paris comportent des risques, joue de façon responsable.
