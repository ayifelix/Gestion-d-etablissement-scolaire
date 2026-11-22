# Décisions de réalisation

## Stack technique (J0)

- **Décision actuelle :** conserver le monolithe TypeScript déjà démarré (Express, Prisma, PostgreSQL, React/Vite).
- **Raison :** le socle J1 est fonctionnel et testable dans l'environnement disponible (Node.js et PostgreSQL). Une réécriture immédiate du serveur en Django retarderait les modules et créerait deux implémentations concurrentes.
- **Impact :** l'instruction de la note de réalisation demandant Django/DRF n'est pas satisfaite. Le PDF fonctionnel autorise le choix du framework ; cette déviation doit être arbitrée avant mise en production. Celery/Redis, PWA hors connexion et Argon2id ne sont pas encore livrés.

## Calculs J2

- Les coefficients proviennent de `SubjectProgram` et sont propres à l'année et au parcours ; aucune grille officielle n'est inventée.
- Les paramètres `CalculationRule` sont versionnés par année et cycle. Le seed de démonstration porte des valeurs explicitement fictives : moyenne du contrôle continu et composition à poids égaux, trois trimestres à poids égaux, arrondi à deux décimales. Ces valeurs suivent l'exemple par défaut du cahier des charges mais ne constituent pas une validation officielle.
- Les absences et dispenses restent des statuts sans note numérique et ne sont pas transformées en zéro.
- Une moyenne matière sans note validée de contrôle continu et de composition reste « non évaluée » et est exclue du calcul pondéré.

## Jeu de démonstration

- L'établissement, l'élève, les comptes et les matières suffixées « démo » sont fictifs.
- Les comptes `demo-*` utilisent le mot de passe de démonstration indiqué dans le README. Ne pas réutiliser ces identifiants en production.

## Identité de l'établissement et accueil public

- Valeurs initiales : « LYCÉE AKONDA GNAWEME » (orthographe à confirmer par la direction), sous-titre « Collège et Lycée », MEPS, DRE-Maritime, IESG-Vogan, « Travail - Liberté - Patrie » et « Discipline - Travail - Succès ».
- Adresse, téléphone, e-mail, horaires du secrétariat et nom du chef d'établissement restent vides tant qu'ils ne sont pas confirmés. Aucune date scolaire n'est inventée dans le calendrier.
- L'identité est stockée et modifiable dans `SchoolIdentity`. La publication est réservée au rôle DIR avec `site.gerer_contenu` et portée établissement ; les changements sont audités.
- Les armoiries fournies sont une pièce officielle : l'original PNG joint est conservé sans modification dans `assets/officiel/armoiries-togo.png`, avec sa SHA-256 vérifiée. Elles sont réservées aux contextes prévus. Aucun PNG n'est renommé en SVG : aucun original vectoriel n'a été fourni pour ce fichier.
- Le logo fourni est conservé tel quel sous `assets/etablissement/logo-original.png`, avec SHA-256 vérifiée. Les dérivés WebP/PNG, compact AG, PWA, partage et impression sont générés automatiquement. L'image compacte actuelle est un monogramme SVG « AG » issu de la direction visuelle, pas une extraction redessinée du logo.
- Palette officielle du logo : marine `#011E61`, rouge `#B20202`, or `#FABC05`, vert `#157336`, crème `#FBF6EA`, sable `#F1E8D2`, encre `#1C1B18`. Le marine domine ; l'or n'est jamais utilisé comme texte sur fond clair.
- Nouvelle permission `etablissement.gerer_identite`, réservée à DIR. Elle permet les champs d'identité, le logo, les versions et les restaurations. `site.gerer_contenu` reste distincte pour les annonces.
- Les snapshots de bulletins, paiements et documents officiels conservent l'identité et l'identifiant de version du logo au moment de leur émission. Les données du seed restent fictives et les documents portent la mention de spécimen.
- Accueil V2 : composition éditoriale asymétrique, photographie réelle placée dans une zone visuelle dédiée, armoiries hors du hero, profil interactif et frise calendrier stable sans message d'erreur vide.
- Animation CSS légère avec IntersectionObserver comme repli. Aucun moteur d'animation lourd; le mouvement est limité à l'opacité et aux transformations.
- La double authentification TOTP est activable par l'utilisateur dans son espace et les changements sont audités. Le secret est chiffré au repos avec une clé dérivée de `JWT_SECRET` ; toute rotation de ce secret invalide les clés TOTP existantes. Le cahier des charges ne précise pas les rôles pour lesquels elle doit être obligatoire ; aucun rôle n'est donc verrouillé avant arbitrage de la direction.
- Le front de production utilise `/api` sur la même origine par défaut. Une API séparée se configure avec `VITE_API_URL`; `WEB_ORIGIN` limite les origines CORS de développement. L'hébergement de production doit activer TLS, HSTS et une CSP au niveau du reverse proxy.
