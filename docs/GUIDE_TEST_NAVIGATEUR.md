# Guide de recette dans le navigateur

Document de test manuel des parcours de la plateforme Tontine. Chaque parcours indique les
prérequis, les étapes, le résultat attendu et les points à vérifier. Cochez les cases au fur et à
mesure.

## 1. Environnement et comptes

| Élément                                 | Valeur                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| Application web                         | http://localhost:3050                                                             |
| API                                     | http://localhost:3051 (documentation : http://localhost:3051/docs)                |
| Mot de passe commun                     | `Tontine2026!`                                                                    |
| Super Admin                             | `+237600000000`                                                                   |
| Président du groupe démo et Super Admin | `+237677000001` (Awa Ngo Bakang)                                                  |
| Membres du groupe démo                  | `+237677000002` à `+237677000010`                                                 |
| Groupe démo                             | « Tontine des amis de Douala », code `DEMO2026`, 10 membres, cotisation 5 000 XAF |

Le fournisseur Mobile Money est simulé : aucun argent réel n'est débité. Un paiement est confirmé
automatiquement par un webhook quelques secondes après l'initiation. Pour simuler un échec, utiliser
un numéro payeur se terminant par `0000`.

Le groupe démo est actuellement en statut **recrutement**, sans tour. Ses 10 membres et leur ordre
de passage existent déjà. Le premier tour doit être lancé (parcours 3), puis ouvert par le job
automatique (toutes les 15 minutes) ou par la commande de recette rapide du parcours 3.

> Les SMS sont simulés : les codes OTP et messages apparaissent dans les logs de l'API. En
> développement, un code OTP fixe peut aussi être affiché sur l'écran de vérification.

### Vérification de départ

- [ ] http://localhost:3050 affiche la page d'accueil.
- [ ] La connexion Super Admin fonctionne.
- [ ] La connexion Président fonctionne.
- [ ] La cloche de notifications est visible après connexion.

## 2. Parcours 1 — Connexion, profil, session

**Compte** : Président `+237677000001`.

1. Ouvrir http://localhost:3050/connexion.
2. Saisir le téléphone et un mauvais mot de passe.
3. Vérifier le message d'erreur, puis saisir `Tontine2026!`.
4. Ouvrir **Profil** depuis l'en-tête.
5. Modifier le nom ou l'email, enregistrer, recharger la page.
6. Se déconnecter, puis rouvrir une page protégée (`/groupes`).

**Attendu**

- [ ] Un mauvais mot de passe affiche une erreur en français, sans révéler si le compte existe.
- [ ] La connexion redirige vers le profil.
- [ ] Les modifications sont conservées après rechargement.
- [ ] Après déconnexion, `/groupes` renvoie vers la connexion.

## 3. Parcours 2 — Groupe démo : lancement et consultation

**Compte** : Président.

1. Ouvrir **Groupes**, puis « Tontine des amis de Douala ».
2. Onglet **Réglages** : vérifier les règles (cotisation 5 000 XAF, mensuel, 10 membres).
   - Si la date de début est ancienne, la remplacer par la date du jour et enregistrer.
3. Onglet **Membres** : vérifier les 10 membres actifs, le président et les positions.
4. Onglet **Tours** : cliquer **Tirer l'ordre au sort** (ou conserver l'ordre existant).
5. Cliquer **Lancer le groupe** et confirmer.
6. Recharger le groupe.

**Attendu**

- [ ] Le tirage affiche une graine et un ordre complet des 10 membres.
- [ ] Le lancement fige les réglages financiers et affiche « Groupe lancé le … ».
- [ ] Le calendrier contient 10 tours, chacun avec un bénéficiaire et une date.
- [ ] Le tableau de bord du groupe apparaît avec le taux de paiement, le séquestre et le prochain
      décaissement.
- [ ] Le bouton **Relevé CSV** est visible pour le président.

### Ouvrir immédiatement le premier tour (recette rapide)

Le job d'ouverture passe toutes les 15 minutes. Pour ne pas attendre, exécuter dans un terminal,
après le lancement :

```bash
docker exec tontine-postgres psql -U tontine -d tontine -c \
"UPDATE rounds SET opens_on = CURRENT_DATE, due_date = CURRENT_DATE, payout_date = CURRENT_DATE, status = 'open' \
WHERE group_id = (SELECT id FROM groups WHERE invite_code = 'DEMO2026') AND round_number = 1;"
```

Cette commande place le tour 1 « ouvert », échéance aujourd'hui, et rend le décaissement éligible
le jour même. Elle ne doit servir qu'en environnement de démonstration.

## 4. Parcours 3 — Paiement Mobile Money, reçu et notifications

**Compte** : Membre Démo 2 `+237677000002`.

1. Se connecter, ouvrir **Groupes** → groupe démo.
2. Onglet **Payer** : vérifier le bénéficiaire du tour et le montant dû (5 000 XAF).
3. Cliquer **Payer ma cotisation**.
4. Choisir MTN MoMo ou Orange Money, vérifier le numéro payeur, valider.
5. Attendre quelques secondes (confirmation automatique du webhook).
6. Recharger l'onglet **Payer** et ouvrir la cloche de notifications.
7. Cliquer sur la cloche → **Notifications** : lire la notification de paiement.
8. Depuis le paiement confirmé, télécharger le reçu PDF.

**Attendu**

- [ ] Le montant total affiché est correct (cotisation + pénalité éventuelle).
- [ ] Après confirmation, le statut passe à « payé » avec texte et couleur.
- [ ] Une notification « Paiement confirmé » apparaît et le compteur de non-lues diminue après
      lecture.
- [ ] Le reçu PDF s'ouvre et contient le nom, le groupe, le tour, le montant et la référence.
- [ ] Le tableau de bord du groupe (président) montre 1 paiement sur 10 et 10 % de taux.

**Cas d'échec** : refaire un paiement sur une autre cotisation avec le numéro payeur
`+237600000000` (fini par `0000`) ; le paiement doit apparaître en échec et la cotisation rester à
payer.

## 5. Parcours 4 — Rappels et export du relevé

**Compte** : Président.

1. Ouvrir le groupe, s'assurer que des membres n'ont pas payé.
2. Dans le tableau de bord, cliquer **Relancer les N non-payeurs**.
3. Ouvrir la cloche avec un compte de membre non-payeur.
4. Revenir au groupe et cliquer **Relevé CSV**.

**Attendu**

- [ ] La relance affiche un message de succès et crée une notification pour chaque non-payeur,
      jamais pour un membre déjà payé.
- [ ] Une deuxième relance immédiate ne renvoie pas de doublon (message « aucun non-payeur » ou
      compteur 0 selon l'état).
- [ ] Le fichier CSV contient les tours, bénéficiaires, membres, téléphones, montants, pénalités et
      statuts ; il s'ouvre dans Excel sans formule exécutée.
- [ ] Un membre simple ne voit pas le bouton **Relevé CSV**.

## 6. Parcours 5 — Litige membre puis traitement admin

### 6.1 Ouverture

**Compte** : Membre Démo 3 `+237677000003`.

1. Ouvrir l'icône `!` (**Litiges**) dans l'en-tête.
2. Cliquer **Ouvrir un litige**.
3. Choisir le groupe démo, saisir un sujet (ex. « Cotisation débitée deux fois »), une description
   détaillée et une URL de pièce jointe (`https://example.com/recu.pdf`).
4. Envoyer.

**Attendu**

- [ ] Le litige apparaît avec le statut **Ouvert** et la pièce jointe cliquable.
- [ ] Une URL `javascript:` ou un champ trop court est refusé avec un message clair.

### 6.2 Traitement

**Compte** : Super Admin.

1. Ouvrir http://localhost:3050/admin → onglet **Litiges**.
2. Ouvrir le litige, cliquer **Traiter**, choisir **Résoudre**, saisir une décision motivée
   (10 caractères minimum), enregistrer.
3. Revenir avec le compte du membre sur `/litiges`.

**Attendu**

- [ ] La décision admin est refusée sans motif.
- [ ] Le litige passe à **Résolu** avec la décision affichée.
- [ ] Le membre reçoit une notification « Litige traité ».
- [ ] Si le litige est lié à un tour, le bouton **Annuler le tour** demande un motif et rembourse
      les cotisations payées par écritures correctives.

## 7. Parcours 6 — Administration

**Compte** : Super Admin `+237600000000` ou Président `+237677000001` (également Super Admin).

### 7.1 Vue d'ensemble

1. Ouvrir `/admin`.
2. Vérifier les cartes utilisateurs, KYC en attente, groupes, litiges et le total sous séquestre.

- [ ] Les chiffres sont cohérents avec les groupes visités.
- [ ] Un écart de réconciliation éventuel est signalé en rouge.

### 7.2 File KYC

1. Créer un compte via `/inscription`, se connecter, puis ouvrir `/kyc`.
2. Envoyer une image JPEG/PNG ou un PDF valide.
3. Avec le Super Admin, ouvrir **Admin → KYC**.
4. Valider le dossier ; vérifier la notification côté membre.
5. Recommencer avec un autre compte et rejeter avec un motif.

- [ ] La validation sans motif fonctionne, le rejet sans motif est refusé.
- [ ] Un fichier texte renommé en `.png` est refusé (contrôle du contenu binaire).
- [ ] Le membre reçoit « Dossier KYC validé » ou « Dossier KYC rejeté » avec le motif.

### 7.3 Groupes et paramètres

1. Onglet **Groupes** : rechercher « Douala », vérifier membres, séquestre, garantie, statut.
2. Onglet **Paramètres** : modifier `group_limits` en `{"min":3,"max":100}`, enregistrer.
3. Recharger : la valeur est conservée.
4. Remettre `{"min":10,"max":100}`.
5. Tenter une clé inventée : la requête doit être refusée.

- [ ] Les paramètres sont validés en JSON et la modification est traçable.
- [ ] Une clé inconnue affiche une erreur.

### 7.4 Audit

1. Onglet **Audit** : filtrer par action `kyc.verify` ou entité `payments`.
2. Vérifier acteur, IP, entité, horodatage et métadonnées.

- [ ] Chaque action sensible réalisée ci-dessus apparaît.
- [ ] L'IP affichée n'est pas celle d'un en-tête `X-Forwarded-For` forgé.

## 8. Parcours 7 — Contrôles de permissions

- [ ] Un membre simple qui ouvre `/admin` voit « réservé au Super Admin », sans données.
- [ ] Un membre simple ne voit ni le bouton de relance, ni l'export CSV.
- [ ] Un membre en attente ne voit pas les litiges du groupe et ne peut pas en ouvrir.
- [ ] Un utilisateur non connecté qui ouvre `/groupes` est redirigé vers `/connexion`.
- [ ] Un membre d'un autre groupe ne peut pas consulter le détail, le dashboard ou le relevé.

## 9. Parcours différés ou non exposés dans l'interface

Ces parcours sont couverts par les tests automatisés mais nécessitent une préparation :

| Parcours               | Prérequis / état actuel                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Décaissement complet   | Compte de réception actif depuis 24 h, tour `ready`, demande par un gestionnaire puis approbation OTP par un **autre** gestionnaire. Le bouton est dans l'onglet **Payer**. |
| Remplacement de membre | API `POST /groups/:id/members/:memberId/replace` uniquement (pas encore de bouton web).                                                                                     |
| Pénalités de retard    | Job quotidien `mark_late` ou tour échu ; visibles dans le relevé et la notification.                                                                                        |
| Réconciliation         | Onglet admin via l'API ; le job tourne à 02:00.                                                                                                                             |

## 10. Dépannage

| Symptôme                          | Vérification                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Page blanche ou 500               | Vérifier que l'API répond sur `/health` et que le web tourne sur le port 3050.                        |
| Connexion refusée                 | Compte actif, mot de passe `Tontine2026!`, base seedée (`npm run db:seed`).                           |
| Aucun tour ouvert après lancement | Attendre le job (15 min) ou exécuter la commande SQL du parcours 2.                                   |
| Paiement bloqué                   | Un paiement est déjà en cours sur la cotisation ; recharger après quelques secondes.                  |
| OTP introuvable                   | Consulter les logs de l'API (SMS simulé) ou le code affiché à l'écran en développement.               |
| Données de test polluées          | Utiliser une base dédiée pour la recette ; ne pas supprimer directement le grand livre (append-only). |

## 11. Fiche de bug à remplir

```text
Parcours :
Compte utilisé :
URL :
Étapes :
Résultat observé :
Résultat attendu :
Capture / message d'erreur :
Date et heure :
```
