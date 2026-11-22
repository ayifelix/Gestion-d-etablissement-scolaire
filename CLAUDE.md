# Conventions du projet

## Architecture

- Monolithe modulaire : API TypeScript/Express, Prisma/PostgreSQL et interface React/Vite.
- Le cahier des charges PDF est la référence fonctionnelle.
- Les données de démonstration sont fictives ; coefficients et règles officielles restent versionnés et modifiables par année et cycle.
- Les règles métier doivent être validées côté API et couvertes par des tests.
- Aucun effacement de notes validées : utiliser un workflow tracé de correction.

## Commandes

- `npm.cmd run dev` : API et interface de développement.
- `npm.cmd test` : tests de règles.
- `npm.cmd run build` : compilation API et interface.
- `npm.cmd run db:migrate` puis `npm.cmd run db:seed` : schéma et données de démonstration.

## Accès et sécurité

- Vérifier le rôle, la portée et les dates côté serveur.
- L'administrateur technique ne reçoit aucun droit pédagogique ou financier.
- Le professeur ne vérifie pas ses propres feuilles.
- Une absence n'est jamais un zéro.
- Les secrets de production doivent être configurés hors du dépôt.

## Identité visuelle

- Palette « Atelier de tissage » : vert `#006A4E`, jaune `#F2B705`, rouge terre `#C0392B`, indigo `#1F3A6E`, crème `#FBF6EA`, sable `#F1E8D2`, encre `#1C1B18`. Le jaune n'est jamais utilisé comme texte sur fond clair ; les états ont des couleurs, icônes et libellés distincts de la marque.
- Français, priorité mobile, états et erreurs explicites, prise en compte de `prefers-reduced-motion`.
- L'identité de l'établissement est lue depuis `SchoolIdentity`, jamais codée en dur dans les documents ou l'interface. Les pages publiques n'exposent aucun dossier individuel.
- Les armoiries de la République Togolaise sont réservées aux documents officiels, au bandeau institutionnel, à la connexion et à la vérification publique. Elles sont chargées uniquement par `branding.tsx` / `EnTeteOfficiel` et ne sont jamais utilisées comme favicon, PWA, bouton, chargement ou décoration.
- Le logo du lycée est conservé dans son original non modifié avec son empreinte SHA-256. Ses dérivés sont générés, jamais recolorés ni déformés. Un nouveau logo accepté par la direction doit avoir au moins 600 px de large et produit des versions 64/128/256/512/1024 px.
- Les documents déjà émis sont figés avec l'identité et la version du logo utilisées à leur émission. Tout document issu des données fictives porte automatiquement « SPÉCIMEN - DONNÉES FICTIVES ».

## Accueil public et sécurité

- La page `/` est publique ; `/connexion` mène à l'espace défini par les rôles actifs après authentification.
- La direction modifie l'identité et les annonces avec la permission `site.gerer_contenu`, une portée établissement, des dates valides et une trace d'audit.
- Les données publiées doivent être relues avant publication et ne contenir aucun nom, matricule, résultat individuel ou contact privé.
- Les secrets TOTP ne sont jamais retournés par `/api/me`. L'activation est auditable ; le caractère obligatoire par rôle reste à décider avant production.
- Pour la production, servir le front et l'API en HTTPS derrière un reverse proxy qui fournit CSP et HSTS ; `VITE_API_URL` peut désigner l'API séparée.

## Définition de terminé

Un module est terminé après migrations, contrôles d'accès, API, interface, tests exécutés et documentation à jour. Un jalon n'est déclaré validé qu'après ses scénarios de recette réellement exécutés.
