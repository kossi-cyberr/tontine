# Prompts pour faire développer la plateforme Tontine par une IA

## Mode d'emploi

1. Placez dans votre dossier de projet (ou joignez à l'IA) les fichiers : `01_schema.sql`, `02_openapi.yaml`, `03_backlog.md`, `04_diagrammes_et_regles.md` et le dossier de conception.
2. Collez le **PROMPT MAÎTRE** une seule fois au début (ou dans le fichier `CLAUDE.md` / `AGENTS.md` / règles du projet si vous utilisez Claude Code, Cursor, Windsurf, etc.).
3. Lancez ensuite les **PROMPTS DE PHASE** un par un, dans l'ordre. Ne passez à la phase suivante que lorsque les tests de la phase en cours passent.
4. Après chaque phase, relisez le code, lancez les tests et faites un commit.

---

# PROMPT MAÎTRE (à coller en premier)

```
Tu es un ingénieur logiciel senior full-stack, spécialisé dans les applications financières (paiements, ledger, sécurité). Tu vas développer, étape par étape, une plateforme web de TONTINE en ligne pour le Cameroun.

## 1. Contexte métier
Une tontine est un groupe de 10 à 100 membres qui cotisent à intervalle régulier. À chaque tour, un bénéficiaire désigné reçoit la totalité des cotisations.
Fonctionnement attendu :
- Le président d'un groupe crée le groupe, crée/invite les membres, définit l'ordre des tours (tirage au sort vérifiable ou manuel) et lance le groupe.
- Un membre peut aussi créer son compte lui-même, puis demander à rejoindre un groupe avec un code d'invitation. Le président (ou le Super Admin) valide et attribue le rôle.
- Chaque membre se connecte, voit immédiatement QUI REÇOIT ce tour, et paie sa cotisation (Mobile Money).
- L'argent collecté est BLOQUÉ dans un compte séquestre logique du groupe (tenu par un ledger interne immuable, adossé à un compte réel chez un agrégateur de paiement).
- Le jour du décaissement, tout l'argent collecté est versé sur le compte du bénéficiaire (après contrôle des conditions, et validation éventuelle du président).
- Rôles : Super Admin (plateforme), Président, Trésorier, Membre, Observateur.

## 2. Documents de référence (source de vérité)
Lis intégralement avant de coder :
- `01_schema.sql` : schéma PostgreSQL. Ne le contredis pas ; si tu dois le modifier, crée une migration et explique pourquoi.
- `02_openapi.yaml` : contrat d'API. Les routes, noms de champs, codes HTTP doivent y correspondre.
- `03_backlog.md` : user stories, critères d'acceptation, priorités (P0 = MVP).
- `04_diagrammes_et_regles.md` : séquences, états, règles de calcul, jobs, structure de projet.
- Dossier de conception : règles métier détaillées (§4), sécurité (§13).
Si une information manque ou si deux documents se contredisent, NE DEVINE PAS : liste la question, propose une option par défaut raisonnable, signale-la clairement et continue.

## 3. Stack technique imposée
- Monorepo : `apps/api` (NestJS + TypeScript strict), `apps/web` (Next.js App Router + TypeScript + Tailwind, PWA), `packages/shared-types`.
- Base : PostgreSQL 14+ avec migrations versionnées (Prisma ou TypeORM/Knex : choisis-en un et justifie). Redis + BullMQ pour les files et jobs planifiés.
- Auth : JWT d'accès court (15 min) + refresh token en base (haché, révocable), mots de passe Argon2id, OTP SMS, TOTP 2FA.
- Validation : class-validator/zod sur toutes les entrées. Documentation Swagger générée et conforme à `02_openapi.yaml`.
- Tests : Jest (unitaires + intégration avec base de test), Playwright pour les parcours critiques.
- Docker Compose pour le développement local (api, web, postgres, redis, mailhog).
- Langue de l'interface : français (i18n prête pour l'anglais). Devise XAF, montants en ENTIERS.

## 4. Règles d'ingénierie NON NÉGOCIABLES
Finance et intégrité :
1. Aucun calcul d'argent en flottant. Entiers uniquement.
2. Le ledger (`ledger_entries`) est append-only : jamais d'UPDATE/DELETE. Une erreur se corrige par une écriture inverse.
3. Toute opération financière (confirmation de paiement, décaissement) s'exécute dans UNE transaction SQL atomique incluant : statut du paiement/contribution, écriture ledger, mise à jour du tour et du solde séquestre.
4. Idempotence partout : header `Idempotency-Key` sur paiements et décaissements ; webhooks dédoublonnés par `(provider, event_id)` ; un seul payout actif par tour (index unique partiel + verrou `SELECT ... FOR UPDATE`).
5. Un webhook n'est traité que si sa signature est valide. Jamais de confiance au statut renvoyé par le navigateur.
6. Le statut « payé » vient UNIQUEMENT du webhook ou d'une vérification serveur auprès de l'agrégateur.
7. Les adaptateurs de paiement sont derrière une interface `PaymentProvider` (collect, payout, getStatus, verifyWebhook). Fournis un adaptateur `MockProvider` complet pour le développement et les tests, et un squelette pour un vrai agrégateur. Ne mets jamais de clé secrète dans le code.

Sécurité :
8. Contrôle d'accès côté serveur sur CHAQUE route : rôle + appartenance au groupe (jamais de confiance à l'ID envoyé par le client). Écris des tests de permission pour chaque route sensible.
9. Protection OWASP : requêtes paramétrées, rate limiting (surtout auth, OTP, paiement), CORS strict, en-têtes de sécurité (helmet), CSRF si cookies, journaux sans donnée sensible.
10. Documents KYC chiffrés au repos, URLs signées à durée courte.
11. Changement de compte de réception : OTP + délai de 24 h avant qu'il serve à un décaissement.
12. Le demandeur d'un décaissement ne peut pas être son approbateur ; double validation au-delà du seuil du groupe.
13. Journal d'audit pour toute action sensible (rôle, lancement, tirage, décaissement, changement de compte, KYC).

Qualité :
14. TypeScript strict, pas de `any` injustifié, ESLint + Prettier, architecture modulaire (controller → service → repository), logique métier pure testable séparément (calcul de calendrier, pénalités, éligibilité au décaissement, tirage).
15. Chaque fonctionnalité livrée avec ses tests. Couverture visée > 80 % sur la logique métier et financière.
16. Messages d'erreur clairs en français pour l'utilisateur, codes d'erreur stables pour le front.
17. Commits atomiques et conventionnels (feat:, fix:, test:, chore:).
18. UX mobile d'abord, légère (connexions faibles), accessible, avec états de chargement et d'erreur partout.

## 5. Façon de travailler
- Avant chaque phase : résume ce que tu vas faire, liste les fichiers à créer/modifier, signale les ambiguïtés.
- Pendant : implémente par petites étapes, lance les tests/lint/build régulièrement et corrige avant de continuer.
- Après : donne (a) ce qui est fait, (b) comment lancer et tester, (c) les écarts par rapport aux documents, (d) les points restant à valider, (e) la suite proposée.
- Ne fais PAS plusieurs phases d'un coup. Ne code pas de fonctionnalité hors périmètre. Ne simule pas un résultat : si tu ne peux pas exécuter quelque chose, dis-le.
- Si une règle métier est ambiguë (ex. : le bénéficiaire cotise-t-il ? règle de décaissement stricte ou souple ?), rends-la CONFIGURABLE par groupe comme prévu dans le schéma plutôt que de la figer.

Confirme que tu as compris, liste les questions bloquantes éventuelles, puis attends la consigne de la Phase 0.
```

---

# PROMPTS DE PHASE

## PHASE 0 – Initialisation du projet

```
PHASE 0 – Fondations du dépôt.

Objectif : un monorepo fonctionnel qui démarre en une commande.

À faire :
1. Crée la structure décrite dans `04_diagrammes_et_regles.md` §9 (apps/api, apps/web, packages/shared-types, db, docs).
2. Configure TypeScript strict, ESLint, Prettier, Husky + lint-staged, commitlint.
3. docker-compose.yml : postgres, redis, mailhog (et adminer en option) avec volumes.
4. API NestJS : module de configuration (validation des variables d'environnement avec schéma), logger structuré (pino), endpoint GET /health, Swagger sur /docs, gestion globale des erreurs au format { code, message, details }.
5. Web Next.js : layout de base, Tailwind, page d'accueil, thème mobile-first, configuration PWA (manifest).
6. Migrations : importe `01_schema.sql` comme migration initiale (ou traduis-le dans l'ORM choisi sans rien perdre : types, index, contraintes, trigger append-only du ledger, index unique partiel des payouts). Ajoute un script de seed (1 super admin, 1 groupe de 10 membres de démonstration).
7. GitHub Actions : lint + tests + build sur chaque PR.
8. README : installation, commandes, variables d'environnement (.env.example).

Critères de fin : `docker compose up` + `npm run dev` démarrent api et web ; /health répond ; migrations et seed passent ; la CI est verte. Un test prouve que UPDATE et DELETE sur ledger_entries sont refusés.
```

## PHASE 1 – Authentification et comptes (Epic 1)

```
PHASE 1 – Authentification (stories A-01 à A-07 de 03_backlog.md).

Implémente côté API ET web :
- Inscription (A-01) avec OTP SMS ; connexion téléphone/email + mot de passe (A-02) ; activation de compte par lien pour les membres créés par un président (A-03) ; mot de passe oublié (A-04) ; 2FA TOTP (A-05) ; soumission KYC (A-06) ; comptes de réception Mobile Money avec OTP et délai d'activation de 24 h (A-07).
- Interface `SmsProvider` avec une implémentation console/mailhog pour le dev et un squelette réel.
- Guards : JwtAuthGuard, RolesGuard (rôle plateforme), décorateurs @CurrentUser.
- Rate limiting et verrouillage après 5 échecs.
- Pages web : inscription, vérification OTP, connexion, activation, mot de passe oublié, profil, KYC, comptes de réception.

Tests obligatoires : OTP expiré/réutilisé/trop d'essais, verrouillage, refresh token révoqué, réponse identique pour compte inexistant au « mot de passe oublié », accès refusé sans jeton.
Respecte exactement les routes et schémas de `02_openapi.yaml`.
```

## PHASE 2 – Groupes, membres et rôles (Epics 2 et 3)

```
PHASE 2 – Groupes et membres (G-01 à G-04, M-01 à M-06).

- CRUD groupe avec tous les paramètres (règle de décaissement, bénéficiaire cotise ou non, pénalités, frais, délais, seuil de double validation). Le créateur devient président. Génère un code d'invitation unique.
- Création de membre par le président (nom + téléphone → compte « pending » + SMS d'activation), import CSV avec rapport d'erreurs par ligne, limite stricte de 100 membres (et minimum configurable).
- Demande d'adhésion par code d'invitation, validation/refus, attribution/retrait de rôle (le Super Admin peut tout ; le président gère son groupe ; personne ne peut s'attribuer Super Admin).
- Acceptation du règlement intérieur (horodatée) obligatoire avant tout paiement.
- Suspension de membre.
- Un utilisateur peut appartenir à plusieurs groupes avec des rôles différents : tous les contrôles d'accès se font PAR GROUPE.
- Web : liste de mes groupes, création/paramétrage, gestion des membres (ajout, import, validation, rôles), page d'invitation.

Tests : matrice de permissions complète (§3.2 du dossier) route par route, limites min/max, modification des règles financières refusée après lancement, doublon de membre refusé.
```

## PHASE 3 – Tirage, calendrier et tours (Epic 4)

```
PHASE 3 – Ordre et calendrier (T-01 à T-05, G-03).

- Fonctions PURES et testées : génération du calendrier (§8.5), tirage Fisher-Yates avec graine CSPRNG enregistrée dans cycles.draw_seed (§8.4), calcul du montant attendu (§8.1).
- Endpoints : POST /groups/{id}/draw, PUT /groups/{id}/order, POST /groups/{id}/launch (vérifie minimum de membres, ordre complet, règlement accepté ; crée cycle, tours, cotisations de chaque tour, compte séquestre ; verrouille membres et ordre), GET rounds, rounds/current, détail d'un tour.
- Jobs BullMQ idempotents : open_rounds (ouvre les tours à échéance), mark_late (passe en retard et calcule les pénalités).
- Web : écran de tirage (animation simple + affichage de la graine), calendrier complet avec mon tour mis en évidence, TABLEAU DE BORD MEMBRE avec en tête la carte « Qui reçoit ce tour » (nom, montant, date, progression de la collecte).

Tests : calendrier pour weekly/biweekly/monthly (fin de mois incluse), tirage reproductible avec la même graine, impossibilité de modifier l'ordre après lancement, jobs rejouables sans doublons.
```

## PHASE 4 – Ledger, paiements et séquestre (Epics 5 et 6)

```
PHASE 4 – Cœur financier (P-01 à P-04, P-08, E-01 à E-03). C'est la phase la plus critique : applique à la lettre les règles non négociables 1 à 7.

- Service Ledger : seule porte d'entrée pour écrire des mouvements ; méthodes creditContribution, debitPayout, etc. ; calcul du solde depuis les écritures et comparaison avec escrow_accounts.balance_cached (alerte si écart).
- Interface PaymentProvider + MockProvider (simule succès, échec, délai, webhook rejoué, webhook hors ordre, signature invalide) + squelette d'un vrai agrégateur.
- POST /contributions/{id}/pay : vérifie membre actif, règlement accepté, tour ouvert, cotisation non payée ; crée le payment (initiated) avec Idempotency-Key ; appelle le provider ; renvoie 202.
- POST /webhooks/payments/{provider} : vérifie la signature, enregistre dans webhook_events (anti-rejeu), puis en UNE transaction : payment=confirmed, contribution=paid, écriture ledger, collected_amount, balance_cached ; passe le tour à « ready » si les conditions sont remplies.
- Reçu PDF avec numéro unique ; historique des paiements ; consultation du solde et du ledger (lecture seule).
- Web : bouton Payer (choix MTN/Orange, numéro, affichage des frais, écran d'attente avec polling du statut), reçu, historique.

Tests indispensables : double clic sur Payer (une seule écriture), même webhook reçu 3 fois, webhook avant la réponse HTTP, signature invalide rejetée, échec puis nouvelle tentative, 100 paiements simultanés sur un tour (cohérence du total), tentative de payer le tour d'un autre groupe (refusée), invariants : somme du ledger = collected_amount.
```

## PHASE 5 – Décaissement (Epic 7)

```
PHASE 5 – Décaissement (D-01 à D-07, E-04).

- Fonction pure `isEligibleForPayout(round, group, contributions, guarantee, destinationAccount, now)` implémentant §8.3 (règles stricte et souple), avec tests exhaustifs.
- Machine à états du tour et du payout conforme à `04_diagrammes_et_regles.md` §5 ; transitions interdites rejetées.
- Job process_payouts : pour chaque tour éligible, crée le payout (pending_approval), calcule brut/frais/net (§8.1), applique l'approbation si requise.
- POST payout/request et payout/approve (OTP obligatoire, demandeur ≠ approbateur, double validation au-delà du seuil).
- Exécution : verrou FOR UPDATE sur le tour, appel provider avec Idempotency-Key, puis sur webhook de succès, en UNE transaction : écritures ledger (payout + frais), payout=success, tour=paid_out, ouverture du tour suivant. Échec : retry automatique ×3 puis alerte Super Admin.
- Blocage du décaissement si le compte de réception a été modifié depuis moins de 24 h.
- Réconciliation quotidienne (job reconcile) : compare ledger et rapport de l'agrégateur (le MockProvider fournit un rapport), enregistre dans `reconciliations`, alerte en cas d'écart.
- Web : écran président « décaissement du tour » (état, approbation avec OTP), notification et justificatif pour le bénéficiaire.

Tests : tour partiellement payé (stricte vs souple), double déclenchement du job, payout échoué puis réussi sans doublon, approbateur = demandeur refusé, compte de réception modifié récemment, écart de réconciliation détecté.
```

## PHASE 6 – Notifications, rappels et tableaux de bord (Epics 8 et 9)

```
PHASE 6 – Notifications et pilotage (N-01 à N-04, R-01 à R-04, P-05).

- Service de notifications multi-canaux (SMS, email, in-app) avec gabarits en français et file BullMQ (retries, statut sent/failed).
- Événements : invitation, activation, tour ouvert, rappels J-3/J-1/J/J+1 (non-payeurs seulement), paiement reçu, retard, décaissement effectué, litige.
- Pénalités de retard appliquées selon les paramètres du groupe et versées à la caisse de garantie (guarantee_balance + écriture ledger guarantee_in).
- Tableaux de bord : membre (prochain tour, mon rang, mes paiements), président/trésorier (taux de paiement, retards, solde, prochain décaissement, bouton de relance), export PDF/Excel du relevé du groupe.
- Centre de notifications dans l'application.

Tests : un rappel n'est jamais envoyé deux fois, pas de rappel après paiement, calcul des pénalités fixe/pourcentage, export cohérent avec le ledger.
```

## PHASE 7 – Administration, litiges et audit (Epic 10)

```
PHASE 7 – Back-office (L-01 à L-05).

- Interface Super Admin : liste des groupes et utilisateurs, validation/rejet KYC avec motif, réconciliation et écarts, paramètres globaux, journal d'audit filtrable.
- Litiges : ouverture par un membre/président (avec pièces jointes), traitement par l'admin (statuts, décision motivée), annulation d'un tour avec remboursement par écritures correctives dans le ledger.
- Audit : middleware/intercepteur qui enregistre acteur, action, entité, IP pour toutes les actions sensibles listées en règle 13.
- Changement de membre (remplacement) avec reprise de position et dettes.

Tests : seul le Super Admin accède à /admin/*, remboursement = écritures inverses (le ledger reste cohérent), l'audit trace chaque action sensible.
```

## PHASE 8 – Sécurité, performance et recette

```
PHASE 8 – Durcissement et mise en production.

1. Audit de sécurité du code : relis toutes les routes et vérifie authentification, rôle, appartenance au groupe, validation d'entrée, fuite de données (réponses, logs). Produis un rapport de findings et corrige.
2. Tests de charge (k6 ou autocannon) : 100 membres qui paient dans la même minute ; objectif p95 < 2 s, aucune incohérence ledger.
3. Tests end-to-end Playwright : parcours complet « président crée le groupe → ajoute 10 membres → tirage → lancement → tous paient → décaissement → tour suivant ouvert ».
4. Scénarios de chaos avec le MockProvider : webhook perdu (le job de vérification interroge getStatus), provider indisponible, payout bloqué, double webhook.
5. Observabilité : Sentry, métriques (paiements/min, échecs, écarts de réconciliation), alertes.
6. Sauvegardes automatiques + script de restauration testé.
7. Dockerfiles de production, configuration staging/prod, migrations automatisées, procédure de rollback.
8. Documentation : guide d'exploitation, guide utilisateur (président, membre), FAQ.
9. Checklist de mise en production (clés, webhooks, domaines HTTPS, limites, sauvegardes, supervision) et checklist légale à valider par un juriste avant le premier vrai paiement.

Fournis un rapport final : couverture de tests, risques résiduels, points à valider par le client.
```

---

# PROMPTS UTILITAIRES (à utiliser à tout moment)

**Relecture critique d'une phase**

```
Relis le code que tu viens d'écrire en tant que reviewer senior hostile. Cherche : failles de sécurité, contournements de permissions, conditions de concurrence, doublons possibles d'écritures financières, cas limites non testés, écarts avec 02_openapi.yaml et 01_schema.sql. Liste chaque problème avec sa gravité, puis corrige-les et ajoute les tests manquants.
```

**Correction d'un bug**

```
Bug : [description + étapes pour reproduire + message d'erreur]. Écris d'abord un test qui échoue et reproduit le bug, trouve la cause racine (pas un contournement), corrige, vérifie que tout le reste des tests passe, et explique la cause en 3 phrases.
```

**Vérification de conformité aux documents**

```
Compare l'implémentation actuelle avec 02_openapi.yaml, 01_schema.sql et le backlog P0. Donne un tableau : élément / conforme / écart / action. Ne modifie rien avant de me présenter ce tableau.
```

**Ajout d'une fonctionnalité**

```
Je veux ajouter : [fonctionnalité]. Avant de coder : impact sur le schéma, l'API, les règles financières et la sécurité ; liste des fichiers touchés ; proposition de tests. Attends ma validation, puis implémente avec migration et mise à jour de l'OpenAPI.
```

**Génération de maquettes/UI**

```
Conçois l'écran [nom] en mobile-first (largeur 360 px) avec Tailwind. États à prévoir : chargement, vide, erreur, succès. Textes en français simples. Boutons principaux accessibles au pouce. Affiche toujours le statut de paiement avec couleur ET texte.
```

---

# CONSEILS POUR BIEN UTILISER CES PROMPTS

- Travaillez **une phase à la fois** et validez par les tests avant de continuer. Les phases 4 et 5 (argent) méritent une relecture humaine attentive, idéalement par un second développeur.
- Gardez toujours `MockProvider` actif tant que le contrat avec l'agrégateur réel n'est pas signé. Ne branchez le réel qu'en sandbox, puis en production avec de petits montants.
- Ne laissez jamais l'IA inventer une règle métier : faites-la poser la question, puis notez la décision dans le dossier de conception.
- Faites relire les phases 1, 4, 5 et 8 par quelqu'un de compétent en sécurité avant le lancement.
- Avant tout paiement réel : validation juridique du séquestre et choix de l'entité qui détient les fonds.
