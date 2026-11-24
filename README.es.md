# Roadster Flight Lab

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · **Español** · [Português (Brasil)](README.pt-BR.md)

**Prueba tres coches en un mismo circuito. Salta una rampa con los propulsores del Roadster, siente la suspensión del Model 3 en una curva peraltada y observa cómo el planificador local del Model Y elige su trayectoria por la ciudad.**

[Descargar para Windows x64](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/download/v0.10.1/Roadster-Flight-Lab-0.10.1-Windows-x64.exe) · [Descargar para Apple Silicon](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/download/v0.10.1/Roadster-Flight-Lab-0.10.1-Mac-arm64.zip) · [notas de versión y sumas de verificación](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/tag/v0.10.1)

![Tesla Garage con el Model 3 Performance 2018 en exhibición](docs/images/garage.jpg)

## tu primer viaje

Elija Roadster en Tesla Garage, seleccione Comenzar a conducir, luego abra el estacionamiento en pendiente y elija D5. Inspecciona el perfil de la rampa, salta a su punto de partida y prueba el funcionamiento con energía eléctrica. Repita esto con Shift presionado para empuje trasero.

**idioma** · El inglés es el idioma inicial. Seleccione un idioma en Tesla Garage para reabrir el garaje con su elección. La aplicación lo recuerda entre sesiones. Los menús, instrumentos, descripciones de cursos e indicaciones de navegación funcionan sin conexión.

## En el garaje

| Vehículo | Qué probar |
| --- | --- |
| Tesla Roadster | Diez propulsores de gas frío permiten acelerar, mantenerse en vuelo estacionario, controlar el alabeo y aterrizar. Hay tres modos de vuelo. Un compresor repone continuamente el gas de los depósitos. |
| 2018 Model 3 Performance | Compara los modos Estándar, Rendimiento y Pista. El modelo AWD de doble motor combina frenado regenerativo y de fricción. La referencia de 450 CV procede de una prueba de carretera de época. |
| 2026 Model Y Performance | Conduce el SUV de alto rendimiento del mercado estadounidense con su propia entrega de potencia, chasis y amortiguación. Tome la misma esquina o colina que el Model 3 para comparar el movimiento del cuerpo. |

## Veinte formas de probar una suspensión

El parque de pistas tiene cuatro áreas: inicios de colinas con pendientes de 8 a 45%, crestas y desniveles, secciones peraltadas y transversales, y saltos con diferentes aterrizajes. El renderizador y el motor de física utilizan los mismos vértices de superficie. Una pendiente del 45% se eleva 45 m en 100 m de distancia horizontal.

![Roadster en la aproximación al salto de longitud D5](docs/images/jump.jpg)

## Sigue a un planificador local por la ciudad.

Elige un destino en el mapa y activa FSD. La red de 61,43 km incluye autopistas, vías de servicio, ramales, túneles y cambios de sentido. Plan-R1 predice dieciséis posiciones y orientaciones para los próximos ocho segundos. El controlador sigue la trayectoria elegida y ajusta la frenada según el tráfico. La franja azul muestra el tramo inmediato por delante del coche. Puedes retomar el control con WASD o la barra espaciadora.

![Giro en ciudad con el camino previsto visible delante del vehículo](docs/images/city.jpg)

## controles del teclado

| llaves | acción |
| --- | --- |
| W / S · A / D | Acelerar, frenar o retroceder; girar hacia la izquierda o hacia la derecha |
| Space | Freno de mano; tomar el control en modo ciudad |
| C · R · Esc | Cámara para bicicletas; restablecer el coche; abre el garaje |
| Shift · J / K · H | Impulso trasero; chorros verticales; alternar desplazamiento |
| T | Cambiar modo de vuelo en el Roadster o modo de conducción en el Model 3 |

## descargas de escritorio

En Windows 11 con una CPU Intel o AMD, haga doble clic en el EXE portátil. Deje aproximadamente 3 GB de espacio temporal para la extracción. El ejecutable no está firmado, por lo que Windows puede mostrar un mensaje de editor desconocido.

en una Apple Silicon Mac, descomprime el ZIP y abre la aplicación. Tiene una firma ad-hoc y no ha sido certificada ante notario por Apple. Ambos paquetes de escritorio incluyen vehículos, texturas, motor de física y planificador de CPU.

## Lo que se ha medido

Rapier funciona a 120 Hz fijos. Cada uno de los tres coches completó los veinte cursos de una regresión física, durante sesenta carreras. En 1.788 muestras de rayos, las alturas de colisión y pendiente visible coincidieron en un margen de 3 mm. Las pruebas anteriores del simulador del Roadster registraron 3,502 s para un lanzamiento eléctrico de 0 a 100 km/h y 1,0411 s con asistencia de jet. Estos son los resultados del simulador. [Datos de validación de pendiente](reports/slope-park/驾驶验证.md)

## compilar desde la fuente

utilice Node.js 22.12 o posterior con npm. El repositorio incluye modelos originales, mallas listas para manejar, texturas, vocabulario de acción y el punto de control Plan-R1. La primera instalación de dependencia requiere acceso a Internet.

```sh
git clone https://github.com/colasun-ai/Roadster-Flight-Lab.git
cd Roadster-Flight-Lab
npm ci
npm run dev
```

Windows x64: use Python 3.10 o posterior para preparar el tiempo de ejecución integrado, verifique la inferencia real y luego cree el EXE portátil.

```sh
python scripts/fsd/prepare_windows_runtime.py
node scripts/fsd/smoke_portable.cjs
npm run pack:win
```

Apple Silicon: instale las herramientas de línea de comandos de Xcode y uv antes de preparar el tiempo de ejecución y crear la aplicación firmada.

```sh
python3 scripts/fsd/bootstrap.py
npm run pack:mac
```

### ejecutar las suites de regresión

```sh
npm test
npm run test:vehicles
npm run test:fsd
node tests/slope-park.test.js
```

Los paquetes de escritorio se escriben en el directorio de compilación de escritorio. El directorio de impresión contiene el Roadster 3MF 1:24 y su script de reconstrucción.

## Créditos y licencias

Modelos de vehículos de asiphy007, Ameer Studio, BloxBloger y vecarz/heynic. La ciudad adapta el entorno histórico de DriveScene Studio de Peixin y utiliza texturas de suelo Poly Haven. La planificación local se basa en el Plan-R1 de Xiaolong Tang y sus colegas. El activo del Modelo Y es CC BY-NC 4.0 y está limitado a uso no comercial. El puesto de control aguas arriba no tiene ninguna licencia indicada por separado. Roadster Flight Lab es un simulador independiente. [Activos originales, licencias y modificaciones](CREDITS.md)
