# Roadster Flight Lab

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · **Français** · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md)

**Trois voitures sur un même terrain d’essai. Franchissez un tremplin avec les propulseurs du Roadster, testez la suspension de la Model 3 en virage relevé, puis observez comment le planificateur embarqué du Model Y choisit sa trajectoire en ville.**

[Télécharger pour Windows x64](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/download/v0.10.1/Roadster-Flight-Lab-0.10.1-Windows-x64.exe) · [Télécharger pour Apple Silicon](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/download/v0.10.1/Roadster-Flight-Lab-0.10.1-Mac-arm64.zip) · [notes de version et sommes de contrôle](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/tag/v0.10.1)

![Tesla Garage avec la Model 3 Performance 2018 exposée](docs/images/garage.jpg)

## Votre premier trajet

Choisissez Roadster dans le garage Tesla, sélectionnez Commencer à conduire, puis ouvrez le parc de pente et choisissez D5. Inspectez le profil de la rampe, sautez jusqu'à son point de départ et essayez de rouler à l'énergie électrique. Répétez-le avec Shift enfoncé pour la poussée arrière.

**Langue** · l'anglais est la langue initiale. Sélectionnez une langue dans Tesla Garage pour rouvrir le garage avec votre choix. L'application s'en souvient entre les sessions. Les menus, les instruments, les descriptions de cours et les invites de navigation fonctionnent hors ligne.

## Dans le garage

| Véhicule | Que essayer |
| --- | --- |
| Tesla Roadster | Dix propulseurs à gaz froid permettent d’accélérer, de maintenir le vol stationnaire et de contrôler le roulis et l’atterrissage. Trois modes de vol modifient la stabilisation. Un compresseur recharge les réservoirs de gaz en continu. |
| 2018 Model 3 Performance | Comparez les modes Standard, Performance et Track. Le modèle AWD à double moteur allie freinage par récupération et freinage par friction. La référence de 450 ch est issue d'un essai routier d'époque. |
| 2026 Model Y Performance | Conduisez le SUV performant du marché américain avec sa propre puissance, son châssis et son amortissement. Prenez le même virage ou la même colline que le modèle 3 pour comparer les mouvements du corps. |

## Vingt façons de tester une suspension

Le parc de pistes comprend quatre zones : des départs de côtes sur des pentes de 8 à 45 %, des crêtes et des creux, des sections inclinées et à essieux transversaux et des sauts avec différents atterrissages. Le moteur de rendu et le moteur physique utilisent les mêmes sommets de surface. Une pente à 45 % s'élève de 45 m sur 100 m de distance horizontale.

![Roadster à l'approche du saut en longueur D5](docs/images/jump.jpg)

## Suivez un planificateur local à travers la ville

Choisissez une destination sur la carte et activez FSD. Le réseau de 61,43 km comprend voies rapides, contre-allées, bretelles, tunnels et zones de demi-tour. Plan-R1 prévoit seize positions et orientations sur huit secondes. Le contrôleur suit la trajectoire retenue et ajuste le freinage en fonction du trafic. Le ruban bleu en montre la partie la plus proche du véhicule. Les touches WASD ou la barre d’espace permettent de reprendre la main.

![Un virage en ville avec le tracé prévu visible devant le véhicule](docs/images/city.jpg)

## Commandes du clavier

| Clés | Action |
| --- | --- |
| W / S · A / D | Accélérer, freiner ou reculer ; diriger à gauche ou à droite |
| Space | Frein à main ; prendre le relais en mode ville |
| C · R · Esc | Caméra de vélo ; réinitialiser la voiture ; ouvrir le garage |
| Shift · J / K · H | Boost arrière ; jets verticaux ; basculer le survol |
| T | Changer de mode de vol sur le Roadster ou de mode de conduite sur le Model 3 |

## téléchargements de bureau

Sous Windows 11 avec un processeur Intel ou AMD, double-cliquez sur le fichier EXE portable. Prévoyez environ 3 Go d’espace temporaire pour l’extraction. L'exécutable n'est pas signé, Windows peut donc afficher une invite d'éditeur inconnu.

Sur un Mac Apple Silicon, décompressez le ZIP et ouvrez l'application. Il porte une signature ad hoc et n'a pas été notarié par Apple. Les deux packages de bureau incluent les véhicules, les textures, le moteur physique et le planificateur de processeur.

## Ce qui a été mesuré

Rapier fonctionne à une fréquence fixe de 120 Hz. Chacune des trois voitures a complété les vingt parcours d'une régression physique, pendant soixante passages. Sur 1 788 échantillons de rayons, les hauteurs de collision et de pente visible concordaient à moins de 3 mm. Des tests antérieurs sur simulateur Roadster avaient enregistré 3,502 s pour un lancement électrique de 0 à 100 km/h et 1,0411 s avec assistance par avion. Ce sont des résultats de simulateur. [Données de validation de pente](reports/slope-park/驾驶验证.md)

## Construire à partir des sources

utilisez Node.js 22.12 ou plus récent avec npm. Le référentiel comprend des modèles originaux, des maillages prêts à l'emploi, des textures, le vocabulaire d'action et le point de contrôle Plan-R1. La première installation de dépendance nécessite un accès Internet.

```sh
git clone https://github.com/colasun-ai/Roadster-Flight-Lab.git
cd Roadster-Flight-Lab
npm ci
npm run dev
```

Windows x64 : utilisez Python 3.10 ou version ultérieure pour préparer le runtime intégré, vérifiez l'inférence réelle, puis créez l'EXE portable.

```sh
python scripts/fsd/prepare_windows_runtime.py
node scripts/fsd/smoke_portable.cjs
npm run pack:win
```

Apple Silicon : installez les outils de ligne de commande Xcode et uv avant de préparer le runtime et de créer l'application signée.

```sh
python3 scripts/fsd/bootstrap.py
npm run pack:mac
```

### Exécuter les suites de régression

```sh
npm test
npm run test:vehicles
npm run test:fsd
node tests/slope-park.test.js
```

Les packages Desktop sont écrits dans le répertoire desktop-build. Le répertoire d'impression contient le Roadster 3MF au 1:24 et son script de reconstruction.

## Crédits et licences

Modèles de véhicules par asiphy007, Ameer Studio, BloxBloger et vecarz/heynic. La ville adapte l'environnement historique DriveScene Studio de Peixin et utilise les textures de sol Poly Haven. La planification locale est basée sur le Plan-R1 de Xiaolong Tang et ses collègues. L'actif du modèle Y est CC BY-NC 4.0 et est limité à une utilisation non commerciale. Le point de contrôle en amont n'a pas de licence déclarée séparément. Roadster Flight Lab est un simulateur indépendant. [Actifs originaux, licences et modifications](CREDITS.md)
