# Plateforme de gestion scolaire

Projet monorepo du cahier des charges : socle académique, comptes et rôles, élèves, personnel et affectations.

## Prérequis

- Node.js 20+
- Docker Desktop

## Démarrage

```powershell
docker compose up -d postgres
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

Interface : http://localhost:5173

API : http://localhost:4000

Accueil public : http://localhost:5173/

## Identité de l'établissement et accueil

Les valeurs initiales de l'établissement et le contenu du site sont stockés en base dans `SchoolIdentity` et modifiables depuis l'espace de la direction (« Contenu de l'accueil »). L'orthographe du nom reste à confirmer ; les coordonnées non renseignées restent vides. Les annonces publiées sont publiques : n'y inscrivez aucune donnée individuelle.

La page `/` est consultable sans compte. Le contrôle public prend en charge les reçus de paiement ; les certificats et relevés (M14) ne sont pas encore implémentés. La configuration TOTP se trouve dans l'onglet « Sécurité » de chaque espace. La politique de TOTP obligatoire par rôle reste à arbitrer.

En développement, l'API est sur `http://localhost:4000/api`. Le build de production utilise `/api` sur la même origine ; définissez `VITE_API_URL` lors du build si le backend est hébergé séparément. Configurez TLS, CSP et HSTS sur le reverse proxy de production.

Comptes initiaux :

- Administrateur technique de démonstration : `demo-adm` / `Demo#2026` (sans droits pédagogiques)
- Professeur : `demo-prof` / `Demo#2026`
- Vérificateur : `demo-verificateur` / `Demo#2026`
- Censeur : `demo-cen` / `Demo#2026`
- Direction : `demo-dir` / `Demo#2026`
- Titulaire : `demo-tit` / `Demo#2026`
- Secrétariat : `demo-sec` / `Demo#2026`
- Surveillant général : `demo-sg` / `Demo#2026`
- Économe : `demo-eco` / `Demo#2026`
- Parent : `demo-par` / `Demo#2026`
- Élève : `demo-ele` / `Demo#2026`
- Suppléant de vérification : `demo-suppleant_verif` / `Demo#2026`

Le jeu d'essai (classe, élève, matière et coefficients) est fictif. Changez ces mots de passe et configurez l'authentification multifacteur avant tout déploiement.
Sur une base neuve, le compte initial `admin` / `Admin#2026` est également créé ; une base existante conserve le mot de passe déjà défini, donc utilisez `demo-adm` pour les essais.

## Modules présents

- Structure annuelle, périodes et cycles
- Rôles et droits datés
- Élèves, matricules uniques et détection de doublons
- Inscriptions actives
- Enseignants et affectations datées
- Titulaires de classe
- Journal d'audit chaîné
- Import Excel en mode rapport préalable
- Évaluations, saisie de notes, vérification papier et demandes de correction
- Checklist de bulletins, formules versionnées et instantanés de résultats

Consultez [PROGRESS.md](./PROGRESS.md) pour les limites actuelles et les jalons non livrés, et [DECISIONS.md](./DECISIONS.md) pour les choix de calcul/d'architecture.

## État des jalons

- M11 : frais et paiements configurables, reçus, journal d'annulation et clôture de caisse (configuration des tarifs officiels requise).
- M12 : tableau mensuel de charge des enseignants, alertes de dépassement et export CSV ; aucune paie n'est calculée.
- L'accueil public et l'identité paramétrable sont intégrés. M14, les modules J5 et la recette J6 restent à faire ; consultez [PROGRESS.md](./PROGRESS.md).
