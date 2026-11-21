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
- Les emblèmes officiels ne sont pas reproduits. Les logos et photos éventuels sont téléversés par la direction ; les pages publiques n'exposent pas de champs individuels d'élèves, parents ou enseignants.
- La double authentification TOTP est activable par l'utilisateur dans son espace et les changements sont audités. Le secret est chiffré au repos avec une clé dérivée de `JWT_SECRET` ; toute rotation de ce secret invalide les clés TOTP existantes. Le cahier des charges ne précise pas les rôles pour lesquels elle doit être obligatoire ; aucun rôle n'est donc verrouillé avant arbitrage de la direction.
- Le front de production utilise `/api` sur la même origine par défaut. Une API séparée se configure avec `VITE_API_URL`; `WEB_ORIGIN` limite les origines CORS de développement. L'hébergement de production doit activer TLS, HSTS et une CSP au niveau du reverse proxy.
