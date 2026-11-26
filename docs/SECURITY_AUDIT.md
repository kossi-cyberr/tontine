# Rapport d'audit — Phase 8 (sécurité, performance, recette)

Date : 26 novembre 2026. Périmètre : API NestJS, web Next.js, base PostgreSQL, fournisseur
Mobile Money simulé. Méthode : inventaire des routes, revue des guards et contrôles
d'appartenance, tests d'autorisation, essais de charge locaux.

## 1. Failles et faiblesses corrigées

| Gravité  | Constat                                                                                                                             | Correction                                                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critique | Injection de formules dans l'export CSV : un nom ou téléphone commençant par `=`, `+`, `-`, `@` s'exécute à l'ouverture dans Excel. | `csvCell` préfixe ces cellules par `'` et double les guillemets.                                                                                                       |
| Élevée   | Le relevé CSV (tous les paiements et téléphones du groupe) était accessible à tout membre actif, y compris observateur.             | Réservé aux gestionnaires et au Super Admin (`assertGroupManager`), bouton masqué côté web.                                                                            |
| Élevée   | L'IP d'audit et de rate limiting pouvait être forgée via `X-Forwarded-For`.                                                         | `trust proxy` désactivé par défaut ; activable uniquement via `TRUST_PROXY=true` derrière un proxy maîtrisé.                                                           |
| Élevée   | Le code OTP fixe de développement pouvait être intégré au bundle web de production si le `.env` de build le contenait.              | `NEXT_PUBLIC_DEV_OTP_CODE` forcé à vide quand `NODE_ENV=production` ; l'API refuse aussi `OTP_FIXED_CODE` en production.                                               |
| Moyenne  | Upload KYC : seul le `Content-Type` déclaré était contrôlé, permettant d'envoyer n'importe quel fichier.                            | Vérification des signatures binaires JPEG/PNG/PDF et cohérence avec le MIME déclaré.                                                                                   |
| Moyenne  | Pièces jointes de litige : une URL `javascript:` pouvait être stockée puis rendue comme lien.                                       | Schémas limités à `http://` et `https://`.                                                                                                                             |
| Moyenne  | Endpoints financiers et d'envoi SMS sans limite d'appels (coût SMS, spam, décaissements).                                           | Limites par IP : paiement 20/min, demande/approbation de décaissement 10/min, KYC 5/min, comptes de réception 10/min, relances 5/min, litiges 10/min, adhésion 20/min. |
| Moyenne  | Un membre en attente pouvait consulter les litiges de ses groupes et en ouvrir.                                                     | Seuls les membres `active` sont pris en compte ; l'ouverture exige une adhésion active.                                                                                |
| Faible   | La Map du limiteur en mémoire pouvait croître sans borne sous attaque multi-IP.                                                     | Purge des fenêtres expirées au-delà de 10 000 entrées.                                                                                                                 |
| Faible   | La notification de paiement était attendue dans le webhook (3 écritures et un SMS avant réponse).                                   | Notification in-app/SMS lancée après le commit, sans bloquer la confirmation ; test ajusté avec attente bornée.                                                        |
| Faible   | Secrets et origines dangereux acceptés en production.                                                                               | Validation : pas de `*` dans `CORS_ORIGINS`, pas de secret de webhook de développement, pas d'OTP fixe en production.                                                  |

En-têtes ajoutés au web : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictive.

## 2. Contrôles vérifiés

- Toutes les routes sont derrière le guard JWT global ; seuls `health`, `auth/*` publics et le
  webhook (signature HMAC obligatoire) sont exemptés.
- `/admin/*` et la décision d'un litige : rôle `super_admin` vérifié côté serveur.
- Paiements et reçus : propriétaire, président/trésorier ou Super Admin.
- Décaissements : appartenance au groupe, demandeur ≠ approbateur, OTP obligatoire.
- Notifications : lecture et marquage limités à l'utilisateur courant.
- Remplacement de membre : président uniquement, compte actif, membre simple.
- Validation Zod systématique des corps, requêtes et paramètres UUID.
- Webhook : signature vérifiée, idempotence par `event_id`, montant contrôlé, verrou par
  cotisation contre les doubles confirmations.
- Aucune stack d'erreur renvoyée au client ; les 500 sont journalisés.

## 3. Risques résiduels (non corrigés dans cette phase)

| Risque                                                                                       | Recommandation                                                                                              |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tokens d'accès et de rafraîchissement dans `localStorage` : un XSS permettrait de les voler. | Passer à des cookies `httpOnly`, `Secure`, `SameSite=Strict` + protection CSRF, et ajouter une CSP à nonce. |
| Rate limiting en mémoire, non partagé entre instances.                                       | Utiliser un compteur Redis dès la réplication de l'API.                                                     |
| Notifications SMS encore envoyées dans le processus API (hors webhook).                      | File BullMQ avec retries et statut `queued/failed` exposé.                                                  |
| Pièces jointes de litige = URLs externes, sans analyse antivirus ni contrôle d'accès.        | Stockage objet privé + URLs signées + scan antivirus.                                                       |
| Compte seed Super Admin `+237600000000` avec mot de passe connu.                             | Changer le mot de passe ou désactiver le compte avant staging/production.                                   |
| Pas de CSP stricte ni de surveillance Sentry active dans cette phase.                        | Phase 8.5 : CSP, Sentry, métriques et alertes.                                                              |

## 4. Mesures de performance

Environnement local : API compilée (`node dist/main.js`, `LOG_LEVEL=warn`), PostgreSQL Docker,
`connection_limit=20`, fournisseur mock. Le script `npm run load:payments` crée un groupe de
100 membres, insère 100 paiements initiés puis envoie 100 webhooks signés simultanément.

| Scénario                                                        | Résultat                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Lecture `GET /v1/me/dashboard`, 600 requêtes, 50 clients (`ab`) | 0 erreur, 733 req/s, p95 **77 ms**                                                             |
| 20 paiements concurrents                                        | p95 **588 ms**, ledger cohérent                                                                |
| 100 paiements concurrents                                       | 0 erreur HTTP, 100 confirmations, ledger = cache = 100 000 XAF, tour `ready`, p95 **3 326 ms** |
| 30 commits PostgreSQL séquentiels                               | **828 ms**, soit ~27,6 ms par commit                                                           |

**Conclusion** : l'objectif p95 < 2 s pour 100 paiements n'est pas atteint sur cet environnement.
Le goulot est le coût de commit du disque local (~28 ms), pas une incohérence applicative : toutes
les confirmations sont exactes et le grand livre est cohérent. Deux actions sont nécessaires avant
la production : mesurer sur le disque cible (SSD/IOPS dédiés) et, si le p95 reste supérieur,
regrouper les confirmations de webhooks en lots (file + worker) pour amortir les commits.

Les données de charge restent en base car `ledger_entries` est append-only ; utiliser une base
dédiée pour les purger.

## 5. Tests

- `npm test -w @tontine/api` : 66 tests, 12 suites (dont 4 tests de sécurité dédiés :
  export CSV restreint, litiges masqués aux membres en attente, contenu KYC falsifié, IP d'audit
  non falsifiable).
- `npm run lint`, `npm run typecheck`, builds API/web : OK.
