# Avancement de la plateforme

Mise à jour : 22 novembre 2026

## J0 — Cadrage

- [x] Base de monorepo et démarrage local
- [x] Choix technique documenté
- [x] Exemple de données fictives
- [ ] Arbitrages de la direction (coefficients officiels, hébergement, conservation, référent)

## J1 — Socle

- [x] Modèles de structure, années, élèves, inscriptions, personnel
- [x] Comptes et rôles de base, journal d'audit
- [x] Import Excel en prévisualisation
- [ ] Matrice d'accès complète et tests par rôle
- [ ] Import transactionnel, dossiers et fusion contrôlée des doublons

## J2 — Notes et bulletins

- [x] Évaluations, grille de notes, statuts explicites d'absence et de dispense
- [x] Soumission, vérification ligne à ligne, renvoi avec motif, verrouillage après visa
- [x] Demandes de correction avec approbation par une autre personne
- [x] Règles de calcul versionnées et moyennes pondérées, rangs ex aequo
- [x] Checklist de bulletin, appréciations de titulaire, instantanés et rangs par matière/classe
- [ ] PDF, QR imprimable de feuille, génération de 1 500 bulletins par tâche de fond
- [ ] Checklist complète incluant les absences (module J3)
- [x] Parcours API de démonstration exécuté : notes → visa indépendant → appréciation → bulletin figé
- [ ] Tests automatisés d'intégration pour les rôles et parcours Playwright / vérification visuelle

## J3 — Pédagogie et vie scolaire

- [~] M7 : campagnes d'orientation, vœux famille, avis et décision finale ; pas encore de SMS ni de lien externe
- [~] M8 : décisions par élève et procès-verbal ; fiche préparatoire basée sur les bulletins existants, seuils de proposition à paramétrer
- [x] M9 : créneaux, salles, séances datées ; blocage des conflits classe/enseignant/salle/indisponibilité
- [~] M10 : appels, synthèse journalière, incidents, barème configurable et suivi par élève ; justificatifs téléversés, envoi SMS et hors connexion à faire
- [x] M15 : cahier de textes par classe/matière/date, devoirs et cours non assurés

## J4 — Finances et documents

- [~] M11 : frais configurables, affectations, soldes recalculés, remises, échéanciers, paiements, annulations tracées, reçus séquentiels et clôture de caisse ; QR graphique, relances SMS et recette complète à faire
- [~] M12 : tableau mensuel par enseignant et cycle, prévision depuis les affectations, heures d'emploi du temps et cahier de textes, heures supplémentaires, alertes de dépassement, vue des vacataires/volontaires et export CSV ; recette métier complète à faire
- [~] M14 : certificats, attestations, relevés et duplicatas émis avec numéro unique/QR, vérification publique minimale, annulation et audit ; test d'impression réelle et recette J4 restant à faire

## Accueil public et identité de l'établissement

- [x] Identité paramétrable en base, seedée avec les mentions institutionnelles fournies ; contacts non confirmés laissés vides
- [x] Page publique responsive `/` : sections familles/personnels, annonces, contrôle de reçus et documents, présentation, contact et FAQ
- [x] Éditeur de l'accueil réservé à DIR avec permission `site.gerer_contenu`, portée établissement et journalisation
- [x] Téléversement direction de logo/photo en PNG, JPEG ou WebP, limite 5 Mo et contrôle de signature binaire
- [x] Connexion harmonisée, redirection initiale selon rôle, TOTP activable par l'utilisateur et page d'aide au mot de passe
- [x] Identité appliquée à l'en-tête des bulletins, feuilles de notes et reçus imprimés
- [x] Cache PWA du shell et mise en cache locale des annonces publiques ; stratégie de rafraîchissement du service worker corrigée
- [~] Documents M14 imprimables avec QR ; export/rendu PDF par navigateur non encore testé
 - [x] Logo et armoiries joints copiés sans modification avec SHA-256 vérifiées
 - [x] Dérivés du logo (64/128/256/512/1024 px, compact, PWA, partage, impression) générés
 - [x] Palette marine/rouge/or/vert/crème/sable mise en place dans l'accueil, la connexion et les documents
 - [x] Permission `etablissement.gerer_identite`, écran d'identité, historique et restauration ajoutés
 - [x] Snapshots d'identité ajoutés aux bulletins, reçus et documents officiels
 - [x] Mention « SPÉCIMEN - DONNÉES FICTIVES » prévue pour les données du seed
 - [ ] Migration locale d'identité non appliquée : Docker Desktop ne fournit pas encore le moteur PostgreSQL
- [ ] Politique de rôles rendant le TOTP obligatoire à arbitrer

## J5 — Communication, examens et clôture

- [ ] Portail parents et notifications SMS (M16)
- [ ] Examens blancs, candidats et statistiques (M13)
- [ ] Alertes et suivi des élèves (M17)
- [ ] Clôture annuelle et bilans (M18)

## J6 — Recette générale

- [ ] Scénarios T1–T17, matrice d'accès et non-régression
- [ ] Charge, hors connexion, sauvegarde/restauration, tests de sécurité
- [ ] Rapport de recette, manuels, formation et captures d'écran

## Vérifications réellement exécutées

- [x] `npm.cmd test` : 23 tests passés (règles J1/J2/J3/J4, TOTP, documents et routes publiques)
- [x] `npm.cmd run build` : API et interface compilées avec l'émission M14 et les QR
- [x] `prisma migrate status` : migration identité/accueil appliquée à la base locale ; seed exécuté
- [x] Tests API : aucune donnée privée dans les réponses publiques, statuts de vérification, limitation de débit, accès direction uniquement et audit
- [x] Tests M14 : portée direction/secrétariat, bulletin publié requis, annulation tracée et réponses publiques minimales
- [x] Parcours navigateur réel : page d'accueil mobile 360 px et ordinateur 1366 px, connexion, éditeur direction et redirections initiales des comptes de démonstration par rôle
- [x] Build Vite de production aperçu via proxy `/api` ; aucune erreur console observée sur l'accueil après chargement propre
- [x] Accueil et sections rendus hors connexion depuis le cache ; une ancienne feuille de style a révélé un cache de service worker obsolète, corrigé puis reconstruit
- [ ] Refaire la recette hors connexion après rafraîchissement complet du service worker versionné
- [x] Captures navigateur de l'accueil (360 px et ordinateur), de la connexion et de l'éditeur de contenu réalisées et inspectées
- [ ] Rapport Lighthouse mobile et test d'export/rendu PDF à produire
- [x] Migrations Prisma J1/J2/J3 et contraintes PostgreSQL des notes appliquées à la base locale
- [x] Migration Prisma J4 appliquée ; `prisma migrate status` confirme le schéma à jour
- [x] Seed J1/J2 exécuté avec comptes et données fictives
- [x] Test API réel du circuit professeur / vérificateur / titulaire / direction
- [x] Test de refus : compte ADM interdit d'accès aux dossiers métier
- [x] Smoke test J3 : API authentifiée, salles/créneaux et appel « présent » par défaut
- [x] Tests du circuit disciplinaire : signalement → décision → notification consignée → clôture
- [x] Smoke test M11 : lectures financières autorisées pour ECO et refusées pour PROF (403)
- [x] Smoke test M12 : rapports mensuels accessibles à CEN/PROF/TIT, accès ADM refusé (403)

## Problèmes connus

- Cette version ne constitue pas une livraison J6 ni une plateforme de production.
- La version actuelle est un monolithe TypeScript et non Django/DRF.
- M14 est implémenté mais n'a pas encore passé la recette d'impression PDF ni un scénario d'émission complet sur la base de démonstration ; les modules J5 et les scénarios J6 restent à réaliser.
- Le TOTP est disponible et activable dans l'espace « Sécurité », mais sa politique obligatoire par rôle n'a pas été arbitrée.
- Les tests navigateur ont été réalisés sur l'accueil et les redirections, mais aucun rapport Lighthouse, recette hors ligne complète, rendu PDF exporté ou rapport de charge n'est disponible.
- La notification disciplinaire est consignée manuellement : aucun SMS n'est réellement envoyé ; les justificatifs ne sont pas téléversés.
- J3 ne couvre pas encore le mode hors connexion, l'export d'emploi du temps, les conseils automatiques selon des seuils, ni les enquêtes par SMS/lien.
- Les pièces papier ne sont pas encore téléchargées/signées dans l'interface ; le numéro de feuille et le jeton interne ne remplacent pas un QR imprimable.
- La base locale ne contient pas encore de types de frais ni de tarifs M11 ; la direction doit les configurer avec les montants officiels avant la recette des encaissements.
- M12 ne calcule pas de paie ni de seuil statutaire de surcharge (aucun seuil n'est fourni) ; les alertes comparent les heures d'affectation, l'emploi du temps et les heures réalisées. Un cours du cahier de textes sans séance horaire liée est signalé, mais ne peut pas être converti en durée.
- La base locale de développement est stockée sous `.postgres/` et utilise l'authentification locale de confiance ; ce n'est pas une configuration de production.
- Les valeurs de calcul des données de démonstration sont fictives ; la direction doit valider les valeurs officielles.
- Les services de développement doivent être relancés après une migration Prisma.
- L'orthographe de « LYCÉE AKONDA GNAWEME » et les coordonnées de l'établissement doivent être confirmées par la direction ; elles ne sont pas des données officielles validées.
- Le reverse proxy de production doit servir le front en HTTPS, définir HSTS/CSP et router `/api` vers l'API ; ces réglages ne sont pas fournis par Vite preview.
