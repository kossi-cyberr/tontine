# Tontine — plateforme de cotisation en ligne (Cameroun)

Monorepo de la plateforme de tontine : API NestJS, front Next.js (PWA), PostgreSQL, Redis/BullMQ.
Les montants sont des **entiers en XAF**.

## Prérequis

- Node.js 20+ et npm 9+
- Docker et Docker Compose

## Démarrage

```bash
cp .env.example .env       # une seule fois
npm install
npm run db:generate        # client Prisma typé
docker compose up -d postgres redis mailhog
npm run db:migrate         # applique db/migrations
npm run db:seed            # données de démonstration
npm run dev                # api sur :3001, web sur :3000
```

- API : http://localhost:3051/health — documentation Swagger : http://localhost:3051/docs
- Web : http://localhost:3050
- Recette manuelle : [`docs/GUIDE_TEST_NAVIGATEUR.md`](docs/GUIDE_TEST_NAVIGATEUR.md) (comptes, parcours, attendus)

> Ports choisis pour ne pas entrer en conflit avec les autres projets de la machine (3000 et 3010
> étaient déjà pris). Modifiables via `API_PORT` / `WEB_URL` dans `.env` et le script `dev` du web.

- MailHog (courriels de dev) : http://localhost:8025
- Adminer (profil outils) : `docker compose --profile tools up -d adminer` → http://localhost:8080

## Scripts utiles

| Commande                             | Effet                                          |
| ------------------------------------ | ---------------------------------------------- |
| `npm run dev`                        | API + web en mode watch                        |
| `npm run build`                      | Build de `shared-types`, l'API et le web       |
| `npm run lint` / `npm run typecheck` | Qualité statique                               |
| `npm test`                           | Tests Jest (API)                               |
| `npm run test:e2e -w @tontine/web`   | Tests Playwright (API et web démarrés, Chrome) |
| `npm run db:migrate`                 | `prisma migrate deploy` sur `db/schema.prisma` |
| `npm run db:seed`                    | Super admin, président, 9 membres, groupe démo |

## Structure

```
apps/api              NestJS (préfixe /v1, Swagger, filtre d'erreurs commun)
apps/web              Next.js App Router + Tailwind (PWA)
packages/shared-types Énumérations et types partagés (build tsc → dist)
db/schema.prisma      Datasource + generator Prisma
db/migrations         Migration initiale en SQL brut (source : 01_schema.sql)
db/seed.ts            Données de démonstration
```

## Authentification (Phase 1)

| Route                             | Rôle                                                      |
| --------------------------------- | --------------------------------------------------------- |
| `POST /v1/auth/register`          | inscription + OTP SMS (10 min)                            |
| `POST /v1/auth/verify-otp`        | activation du compte, vérification OTP                    |
| `POST /v1/auth/login`             | connexion téléphone/email, TOTP si activé                 |
| `POST /v1/auth/refresh`           | rotation du refresh token                                 |
| `POST /v1/auth/logout`            | révocation de session                                     |
| `POST /v1/auth/forgot-password`   | OTP de réinitialisation (réponse identique compte ou non) |
| `POST /v1/auth/reset-password`    | nouveau mot de passe, sessions révoquées                  |
| `POST /v1/auth/2fa/enable`        | secret TOTP + URL otpauth                                 |
| `GET/PATCH /v1/me`                | profil                                                    |
| `POST /v1/me/kyc`                 | pièce d'identité chiffrée (JPEG/PNG/PDF, 5 Mo)            |
| `GET/POST /v1/me/payout-accounts` | comptes Mobile Money (OTP, actif après 24 h)              |

## Groupes et membres (Phase 2)

| Route                                           | Rôle                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `POST /v1/groups`                               | création (le créateur devient président, code d'invitation unique) |
| `GET /v1/groups`                                | mes groupes avec mon rôle et le nombre de membres                  |
| `GET/PATCH /v1/groups/:id`                      | détail et paramètres (règles financières figées après lancement)   |
| `POST /v1/groups/join`                          | demande d'adhésion par code (statut `pending`)                     |
| `GET /v1/groups/:id/members`                    | membres, filtrable par statut                                      |
| `POST /v1/groups/:id/members`                   | ajout d'un membre + lien d'activation                              |
| `POST /v1/groups/:id/members/import`            | import CSV `full_name,phone,email` avec rapport par ligne          |
| `POST /v1/groups/:id/members/:memberId/approve` | validation d'une demande                                           |
| `PATCH /v1/groups/:id/members/:memberId/role`   | attribution d'un rôle                                              |
| `POST /v1/groups/:id/members/:memberId/suspend` | suspension                                                         |
| `POST /v1/groups/:id/accept-rules`              | acceptation horodatée du règlement                                 |

Contrôles : président (ou Super Admin) pour la gestion du groupe et des membres, membership active
obligatoire pour consulter, limite de 100 membres et paramètres plateforme (`group_limits`,
`contribution_limits`) appliqués. Les membres invités passent `active` à l'activation de leur compte.

## Tours et calendrier (Phase 3)

| Route                               | Rôle                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `POST /v1/groups/:id/draw`          | tirage Fisher-Yates avec graine CSPRNG conservée (`cycles.draw_seed`)                                  |
| `PUT /v1/groups/:id/order`          | ordre manuel (une fois chaque membre actif)                                                            |
| `POST /v1/groups/:id/launch`        | vérifie minimum, ordre complet et règlement, puis génère cycle, tours, cotisations et compte séquestre |
| `GET /v1/groups/:id/rounds`         | calendrier complet, « mon tour » signalé                                                               |
| `GET /v1/groups/:id/rounds/current` | tour en cours (« qui reçoit ce tour ? »)                                                               |
| `GET /v1/rounds/:roundId`           | détail d'un tour et de ses cotisations                                                                 |

Les calculs de calendrier (§8.5), de montant attendu (§8.1) et de pénalité (§8.2) sont des
fonctions pures testées (`apps/api/src/rounds/calendar.ts`, `test/calendar.spec.ts`).
Après lancement, les membres et l'ordre sont verrouillés.

Deux jobs BullMQ idempotents sont planifiés : `open_rounds` (toutes les 15 min) et `mark_late`
(quotidien à 00:05, applique les pénalités une seule fois).

**OTP en développement** : `OTP_FIXED_CODE=123456` dans `.env` impose le code `123456`, ce qui évite
de lire les journaux à chaque test. Laisser vide hors développement. Sinon le code est affiché par
le fournisseur SMS console dans les logs de l'API.

## Paiements, séquestre et webhooks (Phase 4)

| Route                                  | Rôle                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `POST /v1/contributions/:id/pay`       | initie le paiement Mobile Money d'une cotisation ; header `Idempotency-Key` obligatoire, réponse `202` |
| `GET /v1/payments/:paymentId`          | statut d'un paiement (payeur, président/trésorier ou admin)                                            |
| `GET /v1/payments/:paymentId/receipt`  | reçu PDF d'un paiement confirmé                                                                        |
| `GET /v1/me/payments`                  | mon historique de paiements                                                                            |
| `GET /v1/groups/:id/escrow`            | solde du séquestre, caisse de garantie, contrôle de cohérence                                          |
| `GET /v1/groups/:id/ledger`            | mouvements du grand livre (lecture seule, paginés)                                                     |
| `POST /v1/webhooks/payments/:provider` | webhook signé `X-Signature`, anti-rejeu `(provider, event_id)`                                         |

La confirmation d'un paiement s'exécute dans une seule transaction : paiement `confirmed`, cotisation
`paid`, écritures `contribution` (et `penalty` si retard), `rounds.collected_amount`, statut du tour
(`collecting`, puis `ready` à 100 %) et `escrow_accounts.balance_cached`. Le solde affiché est
recalculé depuis le grand livre et comparé au cache (`consistent`).

En développement, `PAYMENT_PROVIDER=mock` : aucun débit réel. Un numéro se terminant par `0000`
simule un échec ; sinon `MOCK_PROVIDER_AUTO_CONFIRM=true` envoie un webhook signé après 2,5 s.
Les tests désactivent cette confirmation automatique et signent eux-mêmes leurs webhooks.
L'adaptateur d'agrégateur réel est un squelette (`real-payment.provider.ts`), à compléter et tester
en sandbox avant tout paiement réel.

L'interface web propose le paiement depuis la carte du tour en cours (choix MTN/Orange, montant et
frais affichés, attente de confirmation avec polling, reçu PDF), ainsi qu'un onglet « Payer » avec
séquestre, historique et grand livre.

## Décaissement et réconciliation (Phase 5)

| Route                                     | Rôle                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /v1/rounds/:roundId/payout/request` | prépare le décaissement d'un tour éligible (président/trésorier) ; `allow_partial` pour la règle souple |
| `POST /v1/rounds/:roundId/payout/approve` | envoie un OTP sans `otp_code`, puis exécute le virement avec le code                                    |
| `GET /v1/rounds/:roundId/payout`          | décaissement du tour et résultat d'éligibilité §8.3                                                     |
| `GET /v1/payouts/:payoutId`               | statut d'un décaissement                                                                                |
| `GET /v1/payouts/:payoutId/receipt`       | justificatif PDF (brut, frais, net) d'un décaissement exécuté                                           |
| `GET /v1/admin/reconciliation`            | historique des réconciliations (super admin)                                                            |
| `POST /v1/admin/reconciliation/run`       | lance une réconciliation immédiate (super admin)                                                        |

L'éligibilité est calculée par une fonction pure (`apps/api/src/payouts/payout-rules.ts`) :

- **stricte** : `collected_amount == expected_amount` ;
- **souple** : date de décaissement atteinte et collecte complète, ou manque couvert par la caisse de
  garantie, ou versement partiel explicitement accepté par le président ;
- dans tous les cas : aucun payout actif, bénéficiaire actif, compte de réception vérifié et actif
  depuis plus de 24 h.

Le décaissement est créé `pending_approval` ; un gestionnaire (président ou trésorier) l'approuve
avec un OTP. Le demandeur ne peut jamais approuver sa propre demande ; au-delà de
`dual_approval_threshold`, deux approbateurs distincts sont exigés. L'exécution prend un verrou
`FOR UPDATE` sur le tour, appelle l'agrégateur avec la clé d'idempotence du payout, puis en une seule
transaction : débits `payout`/`platform_fee`/`provider_fee`, mise à jour du séquestre (et de la
garantie utilisée), payout `success`, tour `paid_out` et ouverture du tour suivant si sa date est
atteinte. En cas d'échec, trois tentatives automatiques maximum puis passage du tour à `failed` et
alerte Super Admin dans les journaux.

Jobs : `process_payouts` (toutes les 10 min) prépare les tours éligibles, `retry_failed_payouts`
(toutes les 30 min) relance les échecs, `reconcile` (quotidien 02:00) compare le grand livre au
rapport de l'agrégateur et enregistre l'écart dans `reconciliations`.

En développement, le mock fait échouer le **premier** décaissement d'un compte se terminant par
`5555` (pour tester la relance), et échoue toujours pour `0000`. Son rapport est conservé en mémoire
depuis le démarrage de l'API : la réconciliation mock ne couvre donc que la vie du processus.

## Notifications, rappels et tableaux de bord (Phase 6)

| Route                                | Rôle                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `GET /v1/me/notifications`           | centre de notifications in-app                                                |
| `GET /v1/me/notifications/count`     | compteur des non-lues                                                         |
| `POST /v1/me/notifications/:id/read` | marquer une notification comme lue                                            |
| `POST /v1/me/notifications/read-all` | tout marquer comme lu                                                         |
| `GET /v1/me/dashboard`               | prochaine cotisation, total versé, mes tours à venir                          |
| `GET /v1/groups/:id/dashboard`       | taux de paiement, retards, séquestre, prochain décaissement, membres à risque |
| `POST /v1/groups/:id/reminders`      | relance manuelle des non-payeurs (président/trésorier, anti-doublon horaire)  |
| `GET /v1/groups/:id/statement.csv`   | relevé du groupe au format CSV/Excel                                          |

Chaque événement crée une notification in-app et un SMS (fournisseur console en développement) :
paiement confirmé, cotisation en retard, tour ouvert, rappel J-3/J-1/J/J+1, décaissement effectué.
Les rappels ne visent que les cotisations `pending` (ou `late` pour J+1) et portent une clé de
déduplication (`reminder:<gabarit>:<cotisation>`), donc un même rappel n'est jamais envoyé deux fois.

Les pénalités de retard (fixe ou pourcentage, §8.2) sont calculées par le job `mark_late` et
notifiées au membre. À l'encaissement, la pénalité est créditée au grand livre (`penalty`) et
reversée à la caisse de garantie : le solde séquestre ne contient que les cotisations, l'invariant
`ledger = balance_cached + guarantee_balance` est vérifié par `GET /groups/:id/escrow`.

Le job `send_reminders` (quotidien 08:00, Africa/Douala) envoie les rappels. Le web affiche le
tableau de bord du groupe (taux, retards, prochain décaissement, membres à risque), le bouton de
relance, l'export CSV et un centre de notifications accessible par la cloche de l'en-tête.

## Administration, litiges et audit (Phase 7)

| Route                                           | Rôle                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `GET /v1/admin/stats`                           | volumes, KYC en attente, séquestre, litiges, écarts               |
| `GET /v1/admin/groups`                          | tous les groupes (recherche, statut, pagination)                  |
| `GET /v1/admin/users`                           | tous les utilisateurs (recherche, KYC, statut)                    |
| `PATCH /v1/admin/users/:id/kyc`                 | valider/rejeter un KYC, motif obligatoire en cas de rejet         |
| `GET/PATCH /v1/admin/settings`                  | paramètres globaux (clés connues uniquement)                      |
| `GET /v1/admin/audit-logs`                      | journal filtrable acteur/action/entité/date                       |
| `POST /v1/admin/rounds/:id/cancel`              | annuler un tour et rembourser par écritures inverses              |
| `GET/POST /v1/disputes`                         | litiges visibles par l’utilisateur, ouverture avec pièces jointes |
| `PATCH /v1/disputes/:id`                        | traitement Super Admin, décision motivée                          |
| `POST /v1/groups/:id/members/:memberId/replace` | remplacement d’un membre (position, dettes, tours à venir)        |

Toutes les routes `/admin/*` et la décision d’un litige sont réservées au rôle `super_admin`.
Un membre ne voit que ses litiges et ceux de ses groupes. Les pièces jointes sont des URLs
(5 maximum) stockées dans `disputes.attachments`.

Le journal d’audit est alimenté par un middleware qui capture l’IP de la requête, puis par des
appels explicites sur les actions sensibles : tirage, ordre, lancement, confirmation de paiement,
validation d’un décaissement, KYC, paramètres globaux, ouverture/traitement d’un litige,
annulation de tour et remplacement de membre.

L’annulation d’un tour rembourse les cotisations encaissées : débit `refund` pour la part
cotisation, débit `adjustment` pour la pénalité, remise à zéro du cache et de la garantie,
passage des paiements et cotisations en `refunded`. Le grand livre reste la somme des écritures
(contrôle `ledger = balance_cached + guarantee_balance`).

L’espace web `/admin` regroupe indicateurs, file KYC, groupes, litiges, audit et paramètres ;
`/litiges` permet à chaque membre d’ouvrir un litige et d’en suivre la décision.

Compte seed Super Admin : `+237600000000` / `Tontine2026!`.

## Sécurité et performance (Phase 8, en cours)

L'audit de sécurité des routes a été réalisé : contrôles d'accès, appartenance aux groupes,
validation d'entrée, uploads, exports, webhooks et secrets. Les correctifs et les risques
résiduels sont détaillés dans [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md).

Mesures locales : `GET /me/dashboard` à 50 clients → p95 77 ms ; 20 paiements concurrents →
p95 588 ms. À 100 paiements concurrents, le ledger reste exact et aucune requête n'échoue,
mais le p95 est de 3,3 s (cible 2 s) à cause du coût de commit du PostgreSQL local (~28 ms).
Le script `npm run load:payments` reproduit la mesure ; ses données restent en base car le
grand livre est append-only (utiliser une base dédiée).

Prochaines étapes Phase 8 : files de notifications, batching des webhooks si le disque cible
ne tient pas la cible, CSP/cookies httpOnly, Sentry et métriques, sauvegardes/restauration,
Dockerfiles de production et parcours Playwright.

Sécurité : mots de passe Argon2id, JWT 15 min, refresh opaque haché et révocable, verrouillage
15 min après 5 échecs, 5 essais par OTP, limitation de débit par IP, secrets TOTP et documents KYC
chiffrés en AES-256-GCM.

## Comptes de démonstration

Mot de passe commun : `Tontine2026!`

| Téléphone                     | Rôle                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| +237600000000                 | super administrateur                                                                          |
| +237677000001                 | président du groupe « Tontine des amis de Douala » et super administrateur (accès à `/admin`) |
| +237677000002 … +237677000010 | membres                                                                                       |

## Grand livre immuable

`ledger_entries` est append-only : un trigger PostgreSQL refuse `UPDATE` et `DELETE`.
Le test `apps/api/test/ledger.spec.ts` le vérifie (inscription acceptée, mutation refusée).

## Choix techniques

- **npm workspaces** pour le monorepo, TypeScript strict partagé via `tsconfig.base.json`.
- **Prisma** : client typé généré depuis la base ; la migration initiale reste du SQL brut car
  le schéma utilise des ENUM, un trigger et des index partiels que Prisma ne génère pas.
- **Validation d'environnement** par zod au démarrage (l'API refuse de démarrer si invalide).
- **Erreurs API** normalisées `{ code, message, details }`.

## État d'avancement

Phase 0 (fondations) terminée : monorepo, Docker, santé, migrations, seed, test d'immuabilité, CI.

Phase 1 (authentification) terminée : inscription OTP, connexion, activation, mot de passe oublié,
2FA TOTP, KYC chiffré, comptes de réception avec OTP et délai de 24 h, guards globaux, pages web
dédiées.

Phase 2 (groupes et membres) terminée : CRUD groupe, rôles par groupe, adhésion par code et
validation, ajout de membres et import CSV, suspension, acceptation du règlement, gel des règles
financières au lancement. L'interface web a été refondue (design system Tailwind, navigation
mobile, pages liste/création/détail/invitation).

Phase 3 (tirage, calendrier et tours) terminée : tirage reproductible avec graine affichée, ordre
manuel, lancement avec génération du cycle, des tours, des cotisations et du compte séquestre,
calendrier complet avec mise en évidence de « mon tour », carte « Qui reçoit ce tour ? » et jobs
BullMQ d'ouverture et de retard.

Phase 4 (ledger, paiements et séquestre) terminée : paiement Mobile Money idempotent, webhook signé
et dédoublonné, confirmation atomique avec écritures du grand livre, reçu PDF, historique, soldes
du séquestre et grand livre en lecture seule. L'adaptateur réel reste à implémenter ; le mock
permet de tester le parcours complet.

Phase 5 (décaissement et réconciliation) terminée : éligibilité stricte/souple §8.3, calcul
brut/frais/net, approbation OTP avec demandeur ≠ approbateur, double validation au-delà du seuil,
exécution idempotente sous verrou avec écritures du ledger, ouverture du tour suivant, relances
automatiques, justificatif PDF, réconciliation quotidienne et écran président de décaissement.

Phase 6 (notifications et pilotage) terminée : notifications in-app + SMS avec déduplication,
rappels J-3/J-1/J/J+1 et relance président, événements paiement/retard/tour/décaissement,
centre de notifications, tableaux de bord membre et groupe, membres à risque, export CSV du relevé
et imputation correcte des pénalités dans la caisse de garantie.

Phase 7 (administration et litiges) terminée : back-office Super Admin, file KYC avec motif,
paramètres globaux, journal d’audit filtrable, litiges avec pièces jointes et décision motivée,
annulation de tour avec remboursements correctifs, remplacement de membre avec reprise des
dettes et des tours à venir, et interface web associée.
