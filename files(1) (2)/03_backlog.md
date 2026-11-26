# Backlog produit – Plateforme Tontine

Priorité : **P0** = MVP indispensable · **P1** = MVP souhaitable · **P2** = après MVP
Estimation en points (1 = très simple, 2, 3, 5, 8, 13 = très complexe)

---

## EPIC 1 – Authentification et comptes

| ID   | User story                                                                | Critères d'acceptation                                                        | Prio | Pts |
| ---- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---- | --- |
| A-01 | En tant que visiteur, je m'inscris avec nom, téléphone et mot de passe    | Téléphone unique ; OTP SMS 6 chiffres valable 10 min ; compte actif après OTP | P0   | 5   |
| A-02 | En tant qu'utilisateur, je me connecte par téléphone ou email             | JWT 15 min + refresh 30 j ; verrouillage 15 min après 5 échecs                | P0   | 3   |
| A-03 | En tant que membre créé par un président, j'active mon compte via un lien | Lien à usage unique, expire en 7 j ; je choisis mon mot de passe              | P0   | 3   |
| A-04 | J'ai oublié mon mot de passe                                              | OTP envoyé ; réponse identique que le compte existe ou non                    | P0   | 3   |
| A-05 | J'active la 2FA (TOTP)                                                    | Obligatoire pour président, trésorier, admin                                  | P1   | 5   |
| A-06 | Je soumets ma pièce d'identité (KYC)                                      | Fichier chiffré ; statut visible ; admin valide/rejette                       | P0   | 5   |
| A-07 | J'ajoute mon compte de réception Mobile Money                             | OTP requis ; actif après 24 h ; nom du titulaire affiché                      | P0   | 5   |
| A-08 | Je gère mes sessions actives                                              | Liste + révocation                                                            | P2   | 3   |

## EPIC 2 – Gestion des groupes

| ID   | User story                                                      | Critères d'acceptation                                                            | Prio | Pts |
| ---- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---- | --- |
| G-01 | Je crée un groupe et je deviens président                       | Tous les paramètres du §4.1 ; code d'invitation généré                            | P0   | 5   |
| G-02 | Je configure règlement, pénalités, frais, règle de décaissement | Champs figés après lancement                                                      | P0   | 3   |
| G-03 | Je lance le groupe                                              | Min. 10 membres actifs, ordre défini ; calendrier généré ; notifications envoyées | P0   | 8   |
| G-04 | Je consulte la liste de mes groupes et mon rôle                 | Une carte par groupe avec prochain tour                                           | P0   | 2   |
| G-05 | Je clôture un cycle et en démarre un nouveau                    | Mêmes membres ou ajustements                                                      | P1   | 5   |
| G-06 | Je partage un lien/code d'invitation                            | Lien profond ; expiration réglable                                                | P1   | 3   |
| G-07 | Je duplique un groupe pour un nouveau cycle                     | Copie des paramètres                                                              | P2   | 2   |

## EPIC 3 – Gestion des membres et rôles

| ID   | User story                                 | Critères d'acceptation                                      | Prio | Pts |
| ---- | ------------------------------------------ | ----------------------------------------------------------- | ---- | --- |
| M-01 | En tant que président, je crée un membre   | Nom + téléphone ; lien d'activation SMS ; max 100           | P0   | 5   |
| M-02 | J'importe des membres par CSV              | Rapport ligne par ligne des erreurs                         | P1   | 5   |
| M-03 | Je valide ou refuse une demande d'adhésion | Notification au demandeur                                   | P0   | 3   |
| M-04 | J'attribue ou retire un rôle               | Le Super Admin peut tout ; le président gère son groupe     | P0   | 3   |
| M-05 | J'accepte le règlement du groupe           | Horodaté, obligatoire avant paiement                        | P0   | 2   |
| M-06 | Je suspends un membre                      | Plus de nouvelles cotisations ; historique conservé         | P1   | 3   |
| M-07 | Je remplace un membre en cours de cycle    | Reprise de la position et des dettes ; validation président | P1   | 8   |
| M-08 | Je vois les membres à risque               | Marqueur après X retards                                    | P1   | 3   |

## EPIC 4 – Calendrier et tours

| ID   | User story                                            | Critères d'acceptation                                               | Prio | Pts |
| ---- | ----------------------------------------------------- | -------------------------------------------------------------------- | ---- | --- |
| T-01 | Le président lance un tirage au sort                  | Aléa cryptographique ; graine enregistrée ; résultat visible de tous | P0   | 5   |
| T-02 | Le président définit l'ordre manuellement             | Glisser-déposer ; verrouillé au lancement                            | P0   | 3   |
| T-03 | Je vois qui reçoit ce tour dès ma connexion           | Carte en tête du tableau de bord                                     | P0   | 3   |
| T-04 | Je vois le calendrier complet                         | Dates et bénéficiaires, mon tour mis en évidence                     | P0   | 3   |
| T-05 | Le système ouvre et clôture les tours automatiquement | Jobs planifiés idempotents                                           | P0   | 8   |
| T-06 | J'échange mon tour avec un autre membre               | Accord des deux + validation président                               | P2   | 8   |

## EPIC 5 – Paiements

| ID   | User story                                     | Critères d'acceptation                                                           | Prio | Pts |
| ---- | ---------------------------------------------- | -------------------------------------------------------------------------------- | ---- | --- |
| P-01 | Je paie ma cotisation par Mobile Money         | Frais affichés avant ; confirmation sur mon téléphone                            | P0   | 13  |
| P-02 | Mon paiement est confirmé automatiquement      | Webhook signé ; idempotent ; ledger crédité ; statut mis à jour en moins de 10 s | P0   | 8   |
| P-03 | Je reçois un reçu PDF et une notification      | Numéro unique de reçu                                                            | P0   | 3   |
| P-04 | Je relance un paiement échoué                  | Même cotisation, nouvelle tentative, pas de double débit                         | P0   | 5   |
| P-05 | Les pénalités de retard sont appliquées        | Selon paramètres du groupe ; versées à la caisse de garantie                     | P1   | 5   |
| P-06 | Je paie par carte bancaire                     | Selon agrégateur                                                                 | P2   | 5   |
| P-07 | Le président enregistre un paiement en espèces | Double validation, tracé                                                         | P2   | 5   |
| P-08 | Je consulte l'historique de mes paiements      | Filtres, export                                                                  | P0   | 3   |

## EPIC 6 – Séquestre et ledger

| ID   | User story                                           | Critères d'acceptation                          | Prio | Pts |
| ---- | ---------------------------------------------------- | ----------------------------------------------- | ---- | --- |
| E-01 | Chaque groupe a un compte séquestre logique          | Créé au lancement                               | P0   | 3   |
| E-02 | Tout mouvement génère une écriture immuable          | Trigger bloquant UPDATE/DELETE                  | P0   | 5   |
| E-03 | Je consulte le solde et les mouvements de mon groupe | Lecture seule pour tous les membres             | P0   | 3   |
| E-04 | Réconciliation quotidienne avec l'agrégateur         | Alerte admin si écart non nul                   | P0   | 8   |
| E-05 | Gestion de la caisse de garantie                     | Entrées (pénalités), sorties (avance de manque) | P1   | 5   |
| E-06 | Remboursement en cas d'annulation d'un tour          | Décision admin ; écritures correctives          | P1   | 5   |

## EPIC 7 – Décaissement

| ID   | User story                                                             | Critères d'acceptation                            | Prio | Pts |
| ---- | ---------------------------------------------------------------------- | ------------------------------------------------- | ---- | --- |
| D-01 | Le système vérifie les conditions de décaissement                      | Règle stricte ou souple appliquée                 | P0   | 5   |
| D-02 | Le décaissement est exécuté vers le compte du bénéficiaire             | Un seul payout actif par tour ; clé d'idempotence | P0   | 13  |
| D-03 | Le président approuve le décaissement (option)                         | OTP ; le demandeur n'est pas l'approbateur        | P0   | 5   |
| D-04 | Double validation au-delà d'un seuil                                   | Deux approbateurs distincts                       | P1   | 3   |
| D-05 | Gestion des échecs de décaissement                                     | 3 tentatives auto, puis alerte admin              | P0   | 5   |
| D-06 | Le bénéficiaire reçoit une notification et un justificatif             | Montant brut, frais, net                          | P0   | 3   |
| D-07 | Blocage de décaissement si le compte de réception vient d'être modifié | Délai de 24 h                                     | P0   | 3   |

## EPIC 8 – Notifications

| ID   | User story                                 | Critères d'acceptation                                  | Prio | Pts |
| ---- | ------------------------------------------ | ------------------------------------------------------- | ---- | --- |
| N-01 | Je reçois des SMS pour les événements clés | Invitation, tour ouvert, rappel, paiement, décaissement | P0   | 5   |
| N-02 | Je reçois des rappels J-3, J-1, J, J+1     | Uniquement aux non-payeurs                              | P0   | 3   |
| N-03 | Notifications dans l'application           | Compteur, marquage lu                                   | P1   | 3   |
| N-04 | Emails transactionnels                     | Gabarits HTML                                           | P1   | 3   |
| N-05 | Préférences de notification                | Par canal                                               | P2   | 2   |

## EPIC 9 – Tableaux de bord et rapports

| ID   | User story                             | Critères d'acceptation                                  | Prio | Pts |
| ---- | -------------------------------------- | ------------------------------------------------------- | ---- | --- |
| R-01 | Tableau de bord membre                 | Prochain tour, mon rang, mes paiements                  | P0   | 5   |
| R-02 | Tableau de bord président              | Taux de paiement, retards, solde, prochain décaissement | P0   | 5   |
| R-03 | Tableau de bord Super Admin            | Volume, groupes actifs, incidents                       | P1   | 8   |
| R-04 | Export PDF/Excel du relevé d'un groupe | Période au choix                                        | P1   | 5   |

## EPIC 10 – Litiges, support et administration

| ID   | User story                                   | Critères d'acceptation        | Prio | Pts |
| ---- | -------------------------------------------- | ----------------------------- | ---- | --- |
| L-01 | J'ouvre un litige sur un paiement ou un tour | Pièces jointes ; suivi        | P1   | 5   |
| L-02 | L'admin traite les litiges                   | Statuts, décision motivée     | P1   | 5   |
| L-03 | Journal d'audit consultable                  | Filtres acteur/entité/date    | P0   | 5   |
| L-04 | Paramètres globaux                           | Limites, frais, textes légaux | P1   | 3   |
| L-05 | Validation KYC par l'admin                   | File d'attente                | P0   | 5   |

## EPIC 11 – Transverse (technique)

| ID   | Tâche                                                                | Prio | Pts |
| ---- | -------------------------------------------------------------------- | ---- | --- |
| X-01 | Mise en place du dépôt, CI/CD, environnements (local, staging, prod) | P0   | 5   |
| X-02 | Migrations de base de données et jeux de données de test             | P0   | 3   |
| X-03 | Gestion des erreurs, journalisation, Sentry                          | P0   | 3   |
| X-04 | Limitation de débit et protections OWASP                             | P0   | 5   |
| X-05 | Sauvegardes automatiques et test de restauration                     | P0   | 3   |
| X-06 | Internationalisation (FR par défaut, EN)                             | P2   | 5   |
| X-07 | PWA (installable, hors-ligne partiel)                                | P1   | 5   |
| X-08 | Tests automatisés (unitaires, intégration, e2e)                      | P0   | 13  |
| X-09 | Documentation technique et guide utilisateur                         | P1   | 5   |

---

## Planification en sprints (2 semaines)

| Sprint | Contenu                                               | Livrable                                |
| ------ | ----------------------------------------------------- | --------------------------------------- |
| 0      | Cadrage, maquettes, choix agrégateur, X-01, X-02      | Maquettes validées, environnement prêt  |
| 1      | A-01 à A-04, A-06, X-03                               | Inscription/connexion/KYC               |
| 2      | G-01 à G-04, M-01, M-03 à M-05                        | Création de groupes et membres          |
| 3      | T-01 à T-04, G-03, M-02                               | Tirage, lancement, calendrier           |
| 4      | E-01, E-02, E-03, P-01 (début)                        | Ledger et début des paiements           |
| 5      | P-01 à P-04, P-08                                     | Paiements complets                      |
| 6      | D-01 à D-03, D-05, D-07, A-07                         | Décaissement                            |
| 7      | T-05, N-01, N-02, E-04, L-03, L-05                    | Automatisation, rappels, réconciliation |
| 8      | R-01, R-02, tests, sécurité (X-04, X-08)              | MVP recette interne                     |
| 9      | Groupe pilote réel de 10 personnes, corrections       | MVP validé                              |
| 10+    | P1 (garantie, pénalités, 2FA, litiges, rapports, PWA) | Version 1.0                             |

**Total MVP (P0)** : environ 190 points. Avec une vélocité de 20 à 25 points par sprint, comptez 8 à 10 sprints.

---

## Définition de « terminé » (DoD)

- Code relu et fusionné après revue.
- Tests unitaires et d'intégration passants.
- Permissions vérifiées côté serveur.
- Aucune donnée sensible dans les logs.
- Documentation API à jour.
- Testé sur mobile (Android entrée de gamme) et desktop.
- Déployé sur staging et validé par le client.
