
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// BVH: hace que las colisiones sean muy rápidas aunque el mapa sea pesado
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;


// ======================================
// CONFIGURACIÓN
// ======================================

const CFG = {
    alturaPersonaje: 0.07,
    tamanoMapa: 150,
    alturaCamaraObjetivo: 1.1,
    velocidad: 1.0,           // caminar
    velocidadCorrer: 1.7,     // con Shift
    gravedad: 12,
    fuerzaSalto: 3.2,
    alturaEscalon: 0.06,
    distanciaActivacion: 1.2, // distancia por defecto a la que aparece la letra
    pixelRatioMax: 1.0,       // evita renderizar más píxeles de los que suelen ser necesarios
    pixelRatioMin: 0.65,      // resolución mínima a la que puede bajar
    meteoros: 25,             // cantidad de meteoritos (bájalo si va lento)
    anisotropia: 4,           // calidad de texturas lejanas

    // --- Día / Tarde / Noche ---
    ambienteInicial: 'tarde', // 'dia', 'tarde' o 'noche'
    duracionFase: 40,         // segundos que dura cada fase en modo Auto
    duracionCambio: 2.5       // segundos que tarda la transición al elegir una fase
};

// --- Animación de reposo (quieto.fbx) ---
const MODO_REPOSO = 'absoluto';
const CORRECCION_REPOSO_GRADOS = { x: 0, y: 0, z: 0 };

const radioJugador = Math.max(0.08, CFG.alturaPersonaje * 0.25);


// ======================================
// DÍA / TARDE / NOCHE (definición de cada ambiente)
// ======================================

const AMBIENTES_DEF = {
    dia: {
        nombre: 'Día',
        fondo0: '#2f6fb5', fondo1: '#7db8e8', fondo2: '#d8ecf8',
        niebla: '#c4dcee', nieblaDens: 0.0010,
        amb: '#cfd8e6', ambInt: 0.8,
        hemiSky: '#cfe6ff', hemiGround: '#6b5a45', hemiInt: 1.0,
        solColor: '#fff1d0', solInt: 2.8, solPos: [20, 40, 15],
        luz2Color: '#a8c8e8', luz2Int: 1.0,
        focoColor: '#ffffff', focoInt: 0.2,
        exposicion: 1.0,
        partColor: '#ffffff', partOpacidad: 0.12, partTam: 0.08,
        meteoros: 0
    },
    tarde: {
        nombre: 'Tarde',
        fondo0: '#2a2f66', fondo1: '#c9603a', fondo2: '#f2b24f',
        niebla: '#b9683e', nieblaDens: 0.0015,
        amb: '#8a6a58', ambInt: 1.3,
        hemiSky: '#f0a070', hemiGround: '#3a2418', hemiInt: 1.0,
        solColor: '#ff9340', solInt: 4.0, solPos: [30, 10, 22],
        luz2Color: '#8a78c0', luz2Int: 1.5,
        focoColor: '#ffb070', focoInt: 1.5,
        exposicion: 1.3,
        partColor: '#ffc890', partOpacidad: 0.45, partTam: 0.12,
        meteoros: 0
    },
    noche: {
        nombre: 'Noche',
        fondo0: '#02040a', fondo1: '#0a1426', fondo2: '#1b2338',
        niebla: '#0c1220', nieblaDens: 0.0018,
        amb: '#46508a', ambInt: 1.6,
        hemiSky: '#35507a', hemiGround: '#1a1208', hemiInt: 0.9,
        solColor: '#7f9ccf', solInt: 1.8, solPos: [-12, 30, -18],
        luz2Color: '#4c6fa8', luz2Int: 1.6,
        focoColor: '#9fb8ff', focoInt: 1.2,
        exposicion: 1.3,
        partColor: '#dbe6ff', partOpacidad: 0.9, partTam: 0.18,
        meteoros: 1
    }
};

const FASES = ['dia', 'tarde', 'noche'];   // orden del ciclo automático

const CLAVES_COLOR = [
    'fondo0', 'fondo1', 'fondo2', 'niebla', 'amb', 'hemiSky', 'hemiGround',
    'solColor', 'luz2Color', 'focoColor', 'partColor'
];
const CLAVES_NUM = [
    'nieblaDens', 'ambInt', 'hemiInt', 'solInt', 'luz2Int', 'focoInt',
    'exposicion', 'partOpacidad', 'partTam', 'meteoros'
];

function crearAmbiente(def) {
    const a = { nombre: def.nombre, solPos: new THREE.Vector3(def.solPos[0], def.solPos[1], def.solPos[2]) };
    CLAVES_COLOR.forEach(function(k) { a[k] = new THREE.Color(def[k]); });
    CLAVES_NUM.forEach(function(k) { a[k] = def[k]; });
    return a;
}

function copiarAmbiente(origen, destino) {
    CLAVES_COLOR.forEach(function(k) { destino[k].copy(origen[k]); });
    CLAVES_NUM.forEach(function(k) { destino[k] = origen[k]; });
    destino.solPos.copy(origen.solPos);
}

function mezclarAmbientes(A, B, k, salida) {
    CLAVES_COLOR.forEach(function(c) { salida[c].copy(A[c]).lerp(B[c], k); });
    CLAVES_NUM.forEach(function(n) { salida[n] = A[n] + (B[n] - A[n]) * k; });
    salida.solPos.copy(A.solPos).lerp(B.solPos, k);
}

function suavizar(x) {
    x = Math.min(1, Math.max(0, x));
    return x * x * (3 - 2 * x);
}

const AMBIENTES = {};
Object.keys(AMBIENTES_DEF).forEach(function(k) { AMBIENTES[k] = crearAmbiente(AMBIENTES_DEF[k]); });

const ambienteActual = crearAmbiente(AMBIENTES_DEF.tarde);
const ambienteDesde = crearAmbiente(AMBIENTES_DEF.tarde);
const ambienteMeta = crearAmbiente(AMBIENTES_DEF.tarde);

let claveObjetivo = 'tarde';
let modoAuto = false;
let autoT = 0;
let transProg = 1;
let meteorosVisibles = false;

// Luces y elementos que cambian con el ambiente
let luzAmbiente, luzHemi, luzSol, luzLuna, luzFoco;
let particulasMat = null;
let fondoCanvas, fondoCtx, fondoTextura;


// ======================================
// ANIMALES Y CASCO
// ======================================

const CARPETA_LOCAL = 'animales/';

const REPOS = [
    'https://raw.githubusercontent.com/huarayogabriel8-netizen/AnimalesCascoOruro/master/',
    'https://raw.githubusercontent.com/huarayogabriel8-netizen/AnimalesCascoOruro/main/'
];

const FUENTE_ANF = {
    autor: 'Voces Que Cuentan (ANF)',
    titulo: 'La leyenda de las cuatro plagas es símbolo de la Diablada (15/12/2023)',
    url: 'https://bolivianthoughts.com/2023/12/17/the-legend-of-the-four-plagues-is-a-symbol-of-the-diablada-la-leyenda-de-las-cuatro-plagas-es-simbolo-de-la-diablada'
};
const FUENTE_UPM = {
    autor: 'Universidad Politécnica de Madrid (cita a C. Decker-Delgado, 1988)',
    titulo: 'Mitos mineros y el Tío',
    url: 'https://oa.upm.es/id/eprint/9894/contents'
};
const FUENTE_CASCO_2011 = {
    autor: 'Notas de Turismo en Bolivia (autor no indicado)',
    titulo: 'Oruro da la bienvenida a sus visitantes con gigantescas esculturas de chatarra (20/02/2011)',
    url: 'https://www.boliviaviajes.org/2011/02/oruro-da-la-bienvenida-sus-visitantes.html'
};
const FUENTE_CASCO_2015 = {
    autor: 'Blogs Oruro (autor no indicado)',
    titulo: 'De la mitología al casco del minero (06/06/2015)',
    url: 'https://blogsoruro.blogspot.com/2015/06/de-la-mitologia-al-casco-del-minero.html'
};
const FUENTE_CASCO_2016 = {
    autor: 'El Diario (autor no indicado)',
    titulo: 'Escultura de Virgen y Casco de Minero (28/02/2016)',
    url: 'https://www.pub.eldiario.net/noticias/2016/2016_02/nt160228/nacional.php?n=36'
};
const FUENTE_CASCO_2017 = {
    autor: 'Blogs Oruro (autor no indicado)',
    titulo: 'El Casco del Minero: donde la mitología se contrasta con la esencia minera (11/02/2017)',
    url: 'https://blogsoruro.blogspot.com/2017/02/el-casco-del-minero-donde-la-mitologia.html'
};
const FUENTE_CASCO_TIWY = {
    autor: 'Rem Sapozhnikov (Tiwy.com)',
    titulo: 'Monumento Casco de Minero, Oruro (feb. 2008)',
    url: 'https://www.tiwy.com/pais/bolivia/oruro/casco_del_minero/esp.phtml'
};

const ANIMALES = [
    {
        id: 'hormiga', nombre: 'Hormiga', letra: 'H', tecla: 'KeyH',
        archivos: ['hormiga.glb'],
        buscar: /hormiga|(^|[^a-z])ants?([^a-z]|$)/,
        posicion: { x: -0.36, z: 6.34, radio: 0.4 },
        activacion: 1.6,
        foto: '', fotoAutor: '', fotoLink: '',
        leyenda: 'Desde el Este llegó un ejército de hormigas que, según el relato, nació de la cabeza del lagarto decapitado. Cuando los urus pedían ayuda a la Ñusta, ella detuvo la plaga y la convirtió en dunas de arena.',
        explicacion: 'La hormiga simboliza la plaga que devora y arrasa. Según la tradición, el arenal cercano a la ciudad de Oruro es esa plaga petrificada. En la Diablada, las hormigas aparecen como símbolo en los trajes y las máscaras.',
        fuentes: [FUENTE_ANF, FUENTE_UPM]
    },
    {
        id: 'serpiente', nombre: 'Serpiente', letra: 'C', tecla: 'KeyC',
        archivos: ['serpiente2.glb'],
        buscar: /serpiente|culebra|snake|cobra|vibora/,
        posicion: { x: 4.82, z: 6.28, radio: 0.4 },
        activacion: 1.6,
        foto: '', fotoAutor: '', fotoLink: '',
        leyenda: 'Por el Sur apareció una gigantesca víbora entre los cerros. Los urus clamaron a la Ñusta, quien partió su cuerpo con una espada y la dejó convertida en piedra.',
        explicacion: 'La serpiente representa el peligro que viene de las montañas. Según algunas versiones, la víbora petrificada se ve partida en dos mitades en el cerro donde está la ermita de Chiripujio. En los trajes de los diablos, las víboras son parte del adorno.',
        fuentes: [FUENTE_ANF, FUENTE_UPM]
    },
    {
        id: 'sapo', nombre: 'Sapo', letra: 'S', tecla: 'KeyS',
        archivos: ['sapo4.glb'],
        buscar: /sapo|toad|frog|(^|[^a-z])rana/,
        posicion: { x: 3.17, z: 8.95, radio: 0.4 },
        activacion: 1.6,
        foto: '', fotoAutor: '', fotoLink: '',
        leyenda: 'Por el Norte llegó un sapo de tamaño colosal. La Ñusta lo enfrentó con una honda y lo convirtió en piedra.',
        explicacion: 'El sapo es otra de las plagas enviadas por Huari. Una versión ubica su cuerpo petrificado junto al cerro de San Pedro. Las versiones de la leyenda difieren en las direcciones y en los detalles, porque es una tradición oral.',
        fuentes: [FUENTE_ANF, FUENTE_UPM]
    },
    {
        id: 'lagarto', nombre: 'Lagarto', letra: 'L', tecla: 'KeyL',
        archivos: ['lagarto2.glb'],
        buscar: /lagarto|lagartija|lizard|gecko|iguana/,
        posicion: { x: 1.97, z: 4.02, radio: 0.4 },
        activacion: 1.6,
        foto: '', fotoAutor: '', fotoLink: '',
        leyenda: 'Por el Oeste, Huari envió un enorme lagarto, que fue decapitado. Cerca de Oruro, en Cala Cala, hay una laguna cuyas aguas se ven rojizas a cierta hora del día. La leyenda dice que se formó con la sangre del lagarto.',
        explicacion: 'El lagarto es la plaga más ligada al propio Huari: una versión cuenta que él adoptó esa forma. En el Carnaval se recuerda el episodio cuando, según la tradición, algunas mujeres suben a los cerros a matar lagartijas.',
        fuentes: [FUENTE_ANF, FUENTE_UPM]
    },
    {
        id: 'casco', nombre: 'Casco del Minero', letra: 'E', tecla: 'KeyE',
        archivos: ['casco.glb'],
        posicion: { x: 2.19, z: 7.31, radio: 0.5 },
        activacion: 1.5,
        tituloLeyenda: 'Historia',
        tituloExplicacion: 'Significado',
        foto: '', fotoAutor: '', fotoLink: '',
        leyenda: 'El Casco del Minero es una escultura monumental de hojalata y metal, de unos 6 metros, en la zona Norte de Oruro, dentro de la plaza circular por donde se entra a la ciudad desde la doble vía. Es obra del artista Fernando Crespo y forma parte de las esculturas de chatarra que la alcaldía impulsó en la gestión de Edgar Bazán, junto a Finelez Llanque y Tito Yugar, para dar la bienvenida a los visitantes con las danzas del Carnaval. En su superficie aparecen la actividad minera, los palliris, los mineros, los ferrocarriles y las cuatro plagas de la leyenda. En el lugar de la linterna está la imagen de la Virgen del Socavón, patrona de los mineros. El diseño original tenía un dragón encima, pero por su peso se cayó. Ya existía en 2008 y en 2016 se mejoró el lugar con fuentes de agua, jardineras, iluminación LED y una sala de exposición del Carnaval bajo el casco.',
        explicacion: 'El casco une dos ideas de Oruro: la minería, que sostiene su identidad, y la mitología del Carnaval. En las jardineras de la plaza están la víbora, las hormigas, el sapo y el lagarto, por eso los cuatro animales que visitaste forman un solo conjunto con el casco.',
        fuentes: [FUENTE_CASCO_2011, FUENTE_CASCO_2015, FUENTE_CASCO_2016, FUENTE_CASCO_2017, FUENTE_CASCO_TIWY]
    }
];

let ajusteCoordenadasMapa = {
    escala: 1,
    centroAnterior: new THREE.Vector3(),
    centroActual: new THREE.Vector3()
};

function transformarPuntoMapa(x, y, z) {
    return new THREE.Vector3(
        ajusteCoordenadasMapa.centroActual.x +
            (x - ajusteCoordenadasMapa.centroAnterior.x) * ajusteCoordenadasMapa.escala,
        ajusteCoordenadasMapa.centroActual.y +
            (y - ajusteCoordenadasMapa.centroAnterior.y) * ajusteCoordenadasMapa.escala,
        ajusteCoordenadasMapa.centroActual.z +
            (z - ajusteCoordenadasMapa.centroAnterior.z) * ajusteCoordenadasMapa.escala
    );
}

function ajustarCoordenadasAlMapa(centroAnterior, centroActual, escala) {
    ajusteCoordenadasMapa = {
        escala: escala,
        centroAnterior: centroAnterior,
        centroActual: centroActual
    };

    ANIMALES.forEach(function(animal) {
        if (!animal.posicion) return;
        const punto = transformarPuntoMapa(animal.posicion.x, 0, animal.posicion.z);
        animal.posicion.x = punto.x;
        animal.posicion.z = punto.z;
        animal.posicion.radio *= escala;
        animal.activacion *= escala;
    });

    const inicio = transformarPuntoMapa(puntoRespawn.x, puntoRespawn.y, puntoRespawn.z);
    puntoRespawn.copy(inicio);

    Object.keys(VISTAS).forEach(function(clave) {
        const vista = VISTAS[clave];
        const posicion = transformarPuntoMapa(vista.pos[0], vista.pos[1], vista.pos[2]);
        const mira = transformarPuntoMapa(vista.mira[0], vista.mira[1], vista.mira[2]);
        vista.pos = [posicion.x, posicion.y, posicion.z];
        vista.mira = [mira.x, mira.y, mira.z];
    });
}

const marcadoresDestinos = Array.from(document.querySelectorAll('[data-marcador]'))
    .map(function(elemento) {
        return {
            elemento: elemento,
            animal: ANIMALES.find(function(item) {
                return item.id === elemento.dataset.marcador;
            })
        };
    });


// ======================================
// VARIABLES
// ======================================

let escena, camara, renderizador, composer, outlinePass;
let jugador, modeloPersonaje, grupoMapa, mixer;
let clipCaminarPersonaje = null;
const personajesSecundarios = [];
let accionActual;
const acciones = {};

const reloj = new THREE.Clock();
const relojEfectos = new THREE.Clock();

let explorando = false;
let pausado = false;
let informacionAbierta = false;
let visorAbierto = false;
let recursosListos = 0;
let falloCarga = false;
let contadorFrames = 0;

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);
loader.setMeshoptDecoder(MeshoptDecoder);

const fbxLoader = new FBXLoader();
const contenedor = document.getElementById('contenedor');
const teclas = {};
const teclasTactiles = new Map();

// Física
let vx = 0, vy = 0, vz = 0;
let enSuelo = false;
let tiempoCoyote = 0;
let bufferSalto = 0;
let corriendo = false;
let ladoDesvioJugador = 1;
const puntoRespawn = new THREE.Vector3(-8, 5, 8);

// Límites del mapa
const limitesMapa = new THREE.Box3(
    new THREE.Vector3(-1e6, -1e6, -1e6),
    new THREE.Vector3(1e6, 1e6, 1e6)
);

// Colisiones
let objetosColision = [];
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
const ABAJO = new THREE.Vector3(0, -1, 0);

// Cámara
let camaraYaw = 0;
let camaraPitch = 0.22;
let distanciaCamara = 2.6;
let arrastrando = false;

// ---------- Vistas fijas de cámara (teclas 5 a 9, 0 = volver al personaje) ----------
// pos = dónde está la cámara, mira = hacia dónde apunta. [x, y, z]
// El centro del monumento está cerca de x=2.2, z=6.6. Ajusta los números a tu gusto.
const VISTAS = {
    Digit5: { nombre: 'Arriba',    pos: [2.2, 14, 6.9],  mira: [2.2, 0, 6.6] },
    Digit6: { nombre: 'Frente',    pos: [2.2, 3, 16],    mira: [2.2, 1.5, 7.3] },
    Digit7: { nombre: 'Lado',      pos: [13, 3, 7],      mira: [2.2, 1.5, 7] },
    Digit8: { nombre: 'Atrás',     pos: [2.2, 3, -3],    mira: [2.2, 1.5, 6.5] },
    Digit9: { nombre: 'Panorama',  pos: [22, 25, 28],    mira: [0, 0, 0] }
};
let vistaFija = null;
const miraActual = new THREE.Vector3();
const _vPos = new THREE.Vector3();
const _vMira = new THREE.Vector3();

// Meteoritos
let arrayMeteoros = [];

// Zonas de animales / casco
let zonas = [];
let zonaActual = null;
let mostrarCoords = false;
let textoCoordsAnterior = '';
let destinoInfoPendiente = null;

// Calidad adaptativa
let pixelRatioActual = Math.min(window.devicePixelRatio || 1, CFG.pixelRatioMax);
let acumTiempo = 0;
let acumFrames = 0;
let tiempoMarcadores = 0;
const ESCALA_CONTORNO = 0.75;


// ======================================
// UTILIDADES
// ======================================

function textoCarga(mensaje) {
    if (falloCarga) return;
    document.getElementById('cargando').textContent = mensaje;
}

function errorDeCarga(mensaje) {
    falloCarga = true;
    const c = document.getElementById('cargando');
    c.style.display = 'flex';
    c.textContent = mensaje;
}

function aplicarPixelRatio() {
    renderizador.setPixelRatio(pixelRatioActual);
    composer.setPixelRatio(pixelRatioActual);
    composer.setSize(window.innerWidth, window.innerHeight);
    ajustarResolucionContorno();
}

function ajustarResolucionContorno() {
    if (!outlinePass) return;
    outlinePass.setSize(
        Math.max(1, Math.round(window.innerWidth * ESCALA_CONTORNO * pixelRatioActual)),
        Math.max(1, Math.round(window.innerHeight * ESCALA_CONTORNO * pixelRatioActual))
    );
}

function vigilarRendimiento(dtReal) {
    if (dtReal > 0.5) return;
    acumTiempo += dtReal;
    acumFrames++;
    if (acumFrames < 90) return;

    const promedio = acumTiempo / acumFrames;
    acumTiempo = 0;
    acumFrames = 0;

    if (promedio > 0.034 && pixelRatioActual > CFG.pixelRatioMin) {
        pixelRatioActual = Math.max(CFG.pixelRatioMin, pixelRatioActual - 0.25);
        aplicarPixelRatio();
        console.log('Rendimiento bajo: resolución ajustada a', pixelRatioActual);
    }
}

function esperarLibre() {
    return new Promise(function(resolver) {
        if ('requestIdleCallback' in window) requestIdleCallback(function() { resolver(); }, { timeout: 2000 });
        else setTimeout(resolver, 300);
    });
}


// ======================================
// FONDO Y PARTÍCULAS
// ======================================

function crearFondo() {
    fondoCanvas = document.createElement('canvas');
    fondoCanvas.width = 1;
    fondoCanvas.height = 256;
    fondoCtx = fondoCanvas.getContext('2d');
    fondoTextura = new THREE.CanvasTexture(fondoCanvas);
    fondoTextura.colorSpace = THREE.SRGBColorSpace;
    escena.background = fondoTextura;
}

function pintarFondo(c0, c1, c2) {
    const g = fondoCtx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#' + c0.getHexString());
    g.addColorStop(0.6, '#' + c1.getHexString());
    g.addColorStop(1, '#' + c2.getHexString());
    fondoCtx.fillStyle = g;
    fondoCtx.fillRect(0, 0, 1, 256);
    fondoTextura.needsUpdate = true;
}

function crearParticulas() {
    const v = [];
    for (let i = 0; i < 600; i++) {
        v.push(
            (Math.random() - 0.5) * 60,
            (Math.random() - 0.5) * 50 + 10,
            (Math.random() - 0.5) * 60 - 20
        );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    particulasMat = new THREE.PointsMaterial({
        color: 0xe0a96d, size: 0.15, sizeAttenuation: true, transparent: true, opacity: 0.6
    });
    escena.add(new THREE.Points(geo, particulasMat));
}


// ======================================
// AMBIENTE: aplicar, cambiar y animar día / tarde / noche
// ======================================

function aplicarAmbiente(a) {
    luzAmbiente.color.copy(a.amb);
    luzAmbiente.intensity = a.ambInt;

    luzHemi.color.copy(a.hemiSky);
    luzHemi.groundColor.copy(a.hemiGround);
    luzHemi.intensity = a.hemiInt;

    luzSol.color.copy(a.solColor);
    luzSol.intensity = a.solInt;
    luzSol.position.copy(a.solPos);

    luzLuna.color.copy(a.luz2Color);
    luzLuna.intensity = a.luz2Int;

    luzFoco.color.copy(a.focoColor);
    luzFoco.intensity = a.focoInt;

    escena.fog.color.copy(a.niebla);
    escena.fog.density = a.nieblaDens;

    renderizador.toneMappingExposure = a.exposicion;

    if (particulasMat) {
        particulasMat.color.copy(a.partColor);
        particulasMat.opacity = a.partOpacidad;
        particulasMat.size = a.partTam;
    }

    pintarFondo(a.fondo0, a.fondo1, a.fondo2);

    const ver = a.meteoros > 0.5;
    if (ver !== meteorosVisibles) {
        meteorosVisibles = ver;
        for (const m of arrayMeteoros) m.visible = ver;
    }
}

function marcarBotonAmbiente(clave) {
    document.querySelectorAll('.amb-btn').forEach(function(b) {
        b.classList.toggle('activo', b.dataset.amb === clave);
    });
}

function cambiarAmbiente(clave) {
    if (!AMBIENTES[clave]) return;
    modoAuto = false;
    claveObjetivo = clave;
    copiarAmbiente(ambienteActual, ambienteDesde);
    transProg = 0;
    marcarBotonAmbiente(clave);
}

function activarAuto() {
    const i = FASES.indexOf(claveObjetivo);
    autoT = i >= 0 ? i : 0;
    modoAuto = true;
    copiarAmbiente(ambienteActual, ambienteDesde);
    transProg = 0;
    marcarBotonAmbiente('auto');
}

function elegirAmbiente(clave) {
    if (clave === 'auto') {
        if (modoAuto) {
            const i = Math.round(autoT) % FASES.length;
            cambiarAmbiente(FASES[i]);
        } else {
            activarAuto();
        }
    } else {
        cambiarAmbiente(clave);
    }
}

function configurarPanelAmbiente() {
    document.querySelectorAll('.amb-btn').forEach(function(b) {
        b.addEventListener('click', function() {
            elegirAmbiente(b.dataset.amb);
            b.blur();
        });
    });
}

function iniciarAmbiente() {
    claveObjetivo = AMBIENTES[CFG.ambienteInicial] ? CFG.ambienteInicial : 'tarde';
    copiarAmbiente(AMBIENTES[claveObjetivo], ambienteActual);
    copiarAmbiente(ambienteActual, ambienteDesde);
    transProg = 1;
    aplicarAmbiente(ambienteActual);
    marcarBotonAmbiente(claveObjetivo);
    configurarPanelAmbiente();
}

function actualizarAmbiente(dt) {
    let meta;

    if (modoAuto) {
        autoT = (autoT + dt / CFG.duracionFase) % FASES.length;
        const i = Math.floor(autoT);
        const f = autoT - i;
        const k = suavizar((f - 0.4) / 0.6);
        mezclarAmbientes(
            AMBIENTES[FASES[i]],
            AMBIENTES[FASES[(i + 1) % FASES.length]],
            k, ambienteMeta
        );
        meta = ambienteMeta;
    } else {
        meta = AMBIENTES[claveObjetivo];
    }

    if (transProg < 1) {
        transProg = Math.min(1, transProg + dt / CFG.duracionCambio);
        mezclarAmbientes(ambienteDesde, meta, suavizar(transProg), ambienteActual);
    } else if (modoAuto) {
        copiarAmbiente(meta, ambienteActual);
    } else {
        return;
    }

    aplicarAmbiente(ambienteActual);
}


// ======================================
// VISTAS DE CÁMARA (teclas 5-9 y 0)
// ======================================

function marcarBotonVista(clave) {
    document.querySelectorAll('.vista-btn').forEach(function(b) {
        b.classList.toggle('activo', b.dataset.vista === clave);
    });
}

function elegirVista(clave) {
    if (clave === 'Digit0' || !VISTAS[clave]) {
        destinoInfoPendiente = null;
        vistaFija = null;
        marcarBotonVista(clave === 'Digit0' ? 'Digit0' : null);
        if (clave === 'Digit0') setTimeout(function() { marcarBotonVista(null); }, 600);
        return;
    }
    destinoInfoPendiente = null;
    if (!vistaFija) {
        camara.getWorldDirection(_vMira);
        miraActual.copy(camara.position).addScaledVector(_vMira, 5);
    }
    vistaFija = VISTAS[clave];
    marcarBotonVista(clave);
}

function configurarPanelVistas() {
    document.querySelectorAll('.vista-btn').forEach(function(b) {
        b.addEventListener('click', function() {
            if (puedeControlar()) elegirVista(b.dataset.vista);
            b.blur();
        });
    });
}


// ======================================
// MÚSICA (YouTube)
// ======================================

const VIDEO_MUSICA = 'QKv2B-Z6_nc';
let ytPlayer = null;
let ytListo = false;
let ytApiCargando = false;
let musicaActiva = false;
let musicaPendiente = false;

function cargarAPIYouTube() {
    if (ytListo || ytApiCargando) return;
    ytApiCargando = true;

    window.onYouTubeIframeAPIReady = function() {
        ytPlayer = new YT.Player('ytPlayer', {
            width: '200', height: '200', videoId: VIDEO_MUSICA,
            playerVars: { autoplay: 0, controls: 0, loop: 1, playlist: VIDEO_MUSICA, playsinline: 1, rel: 0 },
            events: {
                onReady: function() {
                    ytListo = true;
                    ytApiCargando = false;
                    ytPlayer.setVolume(50);
                    if (musicaPendiente) ponerMusica(true);
                },
                onError: function(e) {
                    console.warn('YouTube error código:', e.data);
                    musicaActiva = false;
                    document.getElementById('btnMusica').textContent =
                        '⚠️ Video no disponible (error ' + e.data + ')';
                }
            }
        });
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = function() {
        ytApiCargando = false;
        musicaPendiente = false;
        musicaActiva = false;
        console.warn('No se pudo cargar la API de YouTube.');
        document.getElementById('btnMusica').textContent = '⚠️ No se pudo cargar YouTube';
    };
    document.head.appendChild(s);
}

function actualizarBotonMusica() {
    document.getElementById('btnMusica').textContent =
        musicaActiva ? '🔊 Música encendida' : '🔇 Música apagada';
}

function ponerMusica(encender) {
    musicaActiva = encender;
    if (!ytListo) {
        musicaPendiente = encender; // se activa sola apenas cargue el reproductor
        if (encender) cargarAPIYouTube();
    } else if (encender) {
        ytPlayer.unMute();
        ytPlayer.setVolume(50);
        ytPlayer.playVideo();
    } else {
        ytPlayer.pauseVideo();
    }
    actualizarBotonMusica();
}

function configurarBotonMusica() {
    const b = document.getElementById('btnMusica');
    b.addEventListener('click', function() {
        ponerMusica(!musicaActiva);
        b.blur();
    });
}


// ======================================
// INICIAR ESCENA
// ======================================

function iniciarEscena() {

    escena = new THREE.Scene();
    crearFondo();
    escena.fog = new THREE.FogExp2(0x1e252b, 0.0018);

    camara = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 2000);
    camara.position.set(0, 4, 8);

    renderizador = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderizador.setSize(window.innerWidth, window.innerHeight);
    renderizador.setPixelRatio(pixelRatioActual);
    renderizador.outputColorSpace = THREE.SRGBColorSpace;
    renderizador.toneMapping = THREE.ACESFilmicToneMapping;
    renderizador.toneMappingExposure = 1.3;
    renderizador.shadowMap.enabled = true;
    renderizador.shadowMap.type = THREE.PCFSoftShadowMap;
    renderizador.shadowMap.autoUpdate = false;
    renderizador.shadowMap.needsUpdate = true;
    contenedor.appendChild(renderizador.domElement);

    renderizador.domElement.addEventListener('webglcontextlost', function(e) {
        e.preventDefault();
        errorDeCarga('Se perdió el contexto gráfico (poca memoria de video). Cierra otras pestañas y recarga la página (F5).');
    });

    composer = new EffectComposer(renderizador);
    composer.setPixelRatio(pixelRatioActual);
    composer.addPass(new RenderPass(escena, camara));

    outlinePass = new OutlinePass(
        new THREE.Vector2(window.innerWidth, window.innerHeight), escena, camara
    );
    outlinePass.visibleEdgeColor.set(0xd48837);
    outlinePass.hiddenEdgeColor.set(0x8c5319);
    outlinePass.edgeStrength = 3.5;
    outlinePass.edgeGlow = 0.5;
    outlinePass.edgeThickness = 2;
    composer.addPass(outlinePass);
    ajustarResolucionContorno();

    luzAmbiente = new THREE.AmbientLight(0xffffff, 1);
    escena.add(luzAmbiente);

    luzHemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    luzHemi.position.set(0, 30, 0);
    escena.add(luzHemi);

    luzSol = new THREE.DirectionalLight(0xffffff, 1);
    luzSol.position.set(15, 25, 20);
    luzSol.castShadow = true;
    luzSol.shadow.mapSize.set(1024, 1024);
    luzSol.shadow.bias = -0.001;
    luzSol.shadow.camera.left = -60;
    luzSol.shadow.camera.right = 60;
    luzSol.shadow.camera.top = 60;
    luzSol.shadow.camera.bottom = -60;
    luzSol.shadow.camera.far = 150;
    escena.add(luzSol);

    luzLuna = new THREE.DirectionalLight(0x739cb3, 1);
    luzLuna.position.set(-20, 15, -15);
    escena.add(luzLuna);

    luzFoco = new THREE.SpotLight(0xffe0b2, 1);
    luzFoco.position.set(0, 40, 5);
    luzFoco.angle = Math.PI / 4;
    luzFoco.penumbra = 0.7;
    escena.add(luzFoco);

    crearParticulas();
    iniciarAmbiente();

    cargarEscenario();
    cargarPersonaje();

    window.addEventListener('resize', redimensionar);
    document.addEventListener('keydown', teclaPresionada);
    document.addEventListener('keyup', teclaSoltada);
    window.addEventListener('blur', limpiarTeclas);

    configurarMouse();
    configurarControlesMoviles();
    configurarAvisoAnimal();
    configurarMenuDestinos();
    configurarPanelVistas();
    configurarBotonMusica();
    animar();
}


// ======================================
// CARGAR MAPA
// ======================================

function construirColisiones(mallas, alTerminar) {
    let i = 0;
    const total = mallas.length;

    (function lote() {
        const inicioLote = performance.now();
        while (i < total && (i === 0 || performance.now() - inicioLote < 8)) {
            const g = mallas[i].geometry;
            if (!g.boundsTree) g.computeBoundsTree();
            i++;
        }
        textoCarga('Preparando colisiones... ' + Math.round((i / Math.max(1, total)) * 100) + '%');

        if (i < total) setTimeout(lote, 0);
        else alTerminar();
    })();
}

function cargarEscenario() {
    loader.load('trabajo1.glb', function(gltf) {

        grupoMapa = gltf.scene;

        const caja = new THREE.Box3().setFromObject(grupoMapa);
        const centro = caja.getCenter(new THREE.Vector3());
        const tamano = caja.getSize(new THREE.Vector3());

        const escalaAnterior = 100 / Math.max(tamano.x, tamano.y, tamano.z);
        const escala = CFG.tamanoMapa / Math.max(tamano.x, tamano.y, tamano.z);
        grupoMapa.scale.setScalar(escala);

        grupoMapa.position.set(
            -centro.x * escala + 2.5,
            -caja.min.y * escala,
            -centro.z * escala
        );
        grupoMapa.rotation.y = Math.PI * 0.28;

        escena.add(grupoMapa);
        grupoMapa.updateMatrixWorld(true);

        const cos = Math.cos(grupoMapa.rotation.y);
        const sin = Math.sin(grupoMapa.rotation.y);
        const centroAnterior = new THREE.Vector3(
            2.5 + (cos - 1) * centro.x * escalaAnterior + sin * centro.z * escalaAnterior,
            (centro.y - caja.min.y) * escalaAnterior,
            -sin * centro.x * escalaAnterior + (cos - 1) * centro.z * escalaAnterior
        );
        const centroActual = grupoMapa.localToWorld(centro.clone());
        ajustarCoordenadasAlMapa(centroAnterior, centroActual, escala / escalaAnterior);

        objetosColision = [];
        const maxAniso = Math.min(CFG.anisotropia, renderizador.capabilities.getMaxAnisotropy());

        grupoMapa.traverse(function(obj) {
            if (obj.isMesh && obj.visible) {
                obj.castShadow = true;
                obj.receiveShadow = true;

                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(function(m) {
                    if (!m) return;
                    m.side = THREE.DoubleSide;
                    if (m.map) m.map.anisotropy = maxAniso;
                    m.needsUpdate = true;
                });

                objetosColision.push(obj);
            }
        });

        escena.updateMatrixWorld(true);

        grupoMapa.traverse(function(o) { o.matrixAutoUpdate = false; });

        limitesMapa.setFromObject(grupoMapa);

        console.log('Mapa cargado. Mallas de colisión:', objetosColision.length);

        construirColisiones(objetosColision, function() {
            construirZonasAnimales();
            recursoListo();

            precargarAnimales();
            cargarMeteoros();
        });

    }, function(xhr) {
        if (xhr.lengthComputable && xhr.total > 0) {
            textoCarga('Cargando mapa... ' + Math.round((xhr.loaded / xhr.total) * 100) + '%');
        } else {
            textoCarga('Cargando mapa... ' + (xhr.loaded / 1048576).toFixed(1) + ' MB');
        }
    }, function(error) {
        console.error('Error cargando mapa:', error);
        errorDeCarga('No se pudo cargar trabajo1.glb. Revisa que esté junto a index.html y abre la página desde un servidor (no con doble clic).');
    });
}


// ======================================
// ZONAS (ANIMALES Y CASCO)
// ======================================

function construirZonasAnimales() {

    zonas = [];

    ANIMALES.forEach(function(animal) {

        let caja = null;

        if (animal.posicion) {
            const r = animal.posicion.radio || 0.3;
            caja = new THREE.Box3(
                new THREE.Vector3(animal.posicion.x - r, -1e3, animal.posicion.z - r),
                new THREE.Vector3(animal.posicion.x + r, 1e3, animal.posicion.z + r)
            );
        }

        if (!caja && animal.buscar) {
            const encontrada = new THREE.Box3();
            let cantidad = 0;

            grupoMapa.traverse(function(o) {
                if (!o.name) return;
                if (animal.buscar.test(o.name.toLowerCase())) {
                    encontrada.expandByObject(o);
                    cantidad++;
                }
            });

            if (cantidad > 0 && !encontrada.isEmpty()) {
                caja = encontrada;
                console.log('Zona "' + animal.id + '": ' + cantidad + ' objeto(s) encontrados.');
            }
        }

        if (!caja) {
            console.warn('No se encontró "' + animal.nombre + '" en el mapa. ' +
                'Camina hasta él, presiona P para ver tus coordenadas y ponlas en posicion: { x, z }.');
            return;
        }

        zonas.push({
            animal: animal,
            caja: caja,
            activacion: animal.activacion || CFG.distanciaActivacion
        });
    });
}

function distanciaXZ(caja, p) {
    const dx = Math.max(caja.min.x - p.x, 0, p.x - caja.max.x);
    const dz = Math.max(caja.min.z - p.z, 0, p.z - caja.max.z);
    return Math.hypot(dx, dz);
}

function actualizarZonaAnimal() {
    let mejor = null;
    let mejorDist = Infinity;

    if (jugador && puedeControlar()) {
        for (const z of zonas) {
            const d = distanciaXZ(z.caja, jugador.position);
            if (d < z.activacion && d < mejorDist) {
                mejor = z;
                mejorDist = d;
            }
        }
    }

    if (mejor === zonaActual) return;
    zonaActual = mejor;

    const aviso = document.getElementById('avisoAnimal');
    if (zonaActual) {
        document.getElementById('avisoLetra').textContent = zonaActual.animal.letra;
        document.getElementById('avisoNombre').textContent = zonaActual.animal.nombre;
        aviso.style.display = 'flex';
    } else {
        aviso.style.display = 'none';
    }
}

function configurarAvisoAnimal() {
    document.getElementById('avisoAnimal').addEventListener('click', function() {
        if (zonaActual && puedeControlar()) abrirVisor(zonaActual.animal);
    });
}

function configurarMenuDestinos() {
    const menu = document.getElementById('menuDestinos');
    const boton = document.getElementById('btnMenuDestinos');
    const lista = document.getElementById('listaDestinos');
    const estado = document.getElementById('estadoDestinos');

    function seleccionarDestino(id) {
        if (!puedeControlar()) return;

        const animal = ANIMALES.find(function(item) { return item.id === id; });
        if (!animal) return;

        if (enfocarDestino(animal)) {
            lista.hidden = true;
            boton.setAttribute('aria-expanded', 'false');
            estado.textContent = '';
        } else {
            estado.textContent = 'No se pudo mostrar ese destino.';
        }
    }

    boton.addEventListener('click', function() {
        const abierto = boton.getAttribute('aria-expanded') === 'true';
        boton.setAttribute('aria-expanded', String(!abierto));
        lista.hidden = abierto;
        if (abierto) estado.textContent = '';
    });

    lista.querySelectorAll('[data-destino]').forEach(function(opcion) {
        opcion.addEventListener('click', function() {
            seleccionarDestino(opcion.dataset.destino);
            boton.blur();
        });
    });

    marcadoresDestinos.forEach(function(marcador) {
        marcador.elemento.addEventListener('click', function() {
            seleccionarDestino(marcador.elemento.dataset.marcador);
        });
    });

    document.addEventListener('pointerdown', function(event) {
        if (!menu.contains(event.target)) {
            lista.hidden = true;
            boton.setAttribute('aria-expanded', 'false');
            estado.textContent = '';
        }
    });
}

function enfocarDestino(animal) {
    if (!camara || !animal.posicion) return false;

    const x = animal.posicion.x;
    const z = animal.posicion.z;
    const altura = 1.5;

    camara.getWorldDirection(_vMira);
    miraActual.copy(camara.position).addScaledVector(_vMira, 5);
    destinoInfoPendiente = animal;
    vistaFija = {
        nombre: animal.nombre,
        pos: [x, altura + 3, z + 5],
        mira: [x, altura, z]
    };
    marcarBotonVista(null);
    return true;
}

const _posicionMarcador = new THREE.Vector3();

function actualizarMarcadoresDestinos() {
    const ancho = window.innerWidth;
    const alto = window.innerHeight;

    for (const { elemento, animal } of marcadoresDestinos) {
        if (!animal || !animal.posicion) {
            elemento.hidden = true;
            continue;
        }

        const punto = _posicionMarcador.set(
            animal.posicion.x,
            1.5,
            animal.posicion.z
        ).project(camara);
        const x = (punto.x + 1) * ancho / 2;
        const y = (1 - punto.y) * alto / 2;
        const visible = punto.z >= -1 && punto.z <= 1 &&
            x >= 0 && x <= ancho && y >= 0 && y <= alto;

        elemento.hidden = !visible;
        if (visible) {
            elemento.style.left = x + 'px';
            elemento.style.top = y + 'px';
        }
    }
}


// ======================================
// VISOR 3D
// ======================================

const visor = {
    renderer: null,
    escena: null,
    camara: null,
    controles: null,
    grupo: null,
    mixer: null,
    reloj: new THREE.Clock()
};

const cacheModelos = {};
const descargasEnCurso = {};
let visorActual = null;

function iniciarVisor() {
    if (visor.renderer) return;

    const cont = document.getElementById('visorCanvas');

    visor.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    visor.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    visor.renderer.outputColorSpace = THREE.SRGBColorSpace;
    visor.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    visor.renderer.toneMappingExposure = 1.2;
    cont.appendChild(visor.renderer.domElement);

    visor.escena = new THREE.Scene();

    visor.camara = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
    visor.camara.position.set(0, 0.7, 4);

    visor.escena.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));

    const luzA = new THREE.DirectionalLight(0xffffff, 2.8);
    luzA.position.set(3, 5, 4);
    visor.escena.add(luzA);

    const luzB = new THREE.DirectionalLight(0xffd9a0, 1.4);
    luzB.position.set(-4, 2, -3);
    visor.escena.add(luzB);

    visor.controles = new OrbitControls(visor.camara, visor.renderer.domElement);
    visor.controles.enableDamping = true;
    visor.controles.enablePan = false;
    visor.controles.autoRotate = true;
    visor.controles.autoRotateSpeed = 2;
    visor.controles.minDistance = 0.8;
    visor.controles.maxDistance = 12;

    new ResizeObserver(ajustarVisor).observe(cont);
}

function ajustarVisor() {
    if (!visor.renderer) return;
    const cont = document.getElementById('visorCanvas');
    const w = Math.max(1, cont.clientWidth);
    const h = Math.max(1, cont.clientHeight);
    visor.renderer.setSize(w, h, false);
    visor.camara.aspect = w / h;
    visor.camara.updateProjectionMatrix();
}

function limpiarModeloVisor() {
    if (visor.mixer) {
        visor.mixer.stopAllAction();
        visor.mixer = null;
    }
    if (visor.grupo) {
        visor.escena.remove(visor.grupo);
        visor.grupo = null;
    }
}

function colocarModeloVisor(datos) {
    limpiarModeloVisor();

    const obj = SkeletonUtils.clone(datos.obj);
    obj.position.set(0, 0, 0);

    const grupo = new THREE.Group();
    grupo.add(obj);
    grupo.updateMatrixWorld(true);

    const caja = new THREE.Box3().setFromObject(grupo);
    const centro = caja.getCenter(new THREE.Vector3());
    const tamano = caja.getSize(new THREE.Vector3());
    const maximo = Math.max(tamano.x, tamano.y, tamano.z) || 1;

    obj.position.sub(centro);
    grupo.scale.setScalar(2.2 / maximo);

    obj.traverse(function(o) { if (o.isMesh) o.frustumCulled = false; });

    visor.escena.add(grupo);
    visor.grupo = grupo;

    if (datos.anims && datos.anims.length > 0) {
        visor.mixer = new THREE.AnimationMixer(obj);
        visor.mixer.clipAction(datos.anims[0]).play();
    }

    visor.camara.position.set(0, 0.7, 4);
    visor.controles.target.set(0, 0, 0);
    visor.controles.update();
}

function descargarModelo(animal) {
    if (cacheModelos[animal.id]) return Promise.resolve(cacheModelos[animal.id]);
    if (descargasEnCurso[animal.id]) return descargasEnCurso[animal.id];

    const promesa = (async function() {
        const bases = [CARPETA_LOCAL, ...REPOS];
        let ultimoError = null;

        for (const base of bases) {
            for (const archivo of animal.archivos) {
                const url = base + archivo;
                try {
                    let obj, anims;

                    if (/\.fbx$/i.test(archivo)) {
                        obj = await fbxLoader.loadAsync(url);
                        anims = obj.animations;
                    } else {
                        const gltf = await loader.loadAsync(url);
                        obj = gltf.scene;
                        anims = gltf.animations;
                    }

                    console.log('Modelo cargado:', url);
                    cacheModelos[animal.id] = { obj: obj, anims: anims };
                    return cacheModelos[animal.id];

                } catch (e) {
                    ultimoError = e;
                }
            }
        }

        throw ultimoError || new Error('No hay archivos para ' + animal.id);
    })();

    descargasEnCurso[animal.id] = promesa;
    promesa.catch(function() { delete descargasEnCurso[animal.id]; });
    return promesa;
}

async function precargarAnimales() {
    for (const animal of ANIMALES) {
        await esperarLibre();
        try { await descargarModelo(animal); } catch (e) { /* se reintentará al abrir el visor */ }
    }
}

function mostrarInfoAnimal(animal) {
    const cont = document.getElementById('visorInfo');
    cont.innerHTML = '';
    cont.scrollTop = 0;

    const agregar = function(tag, texto, clase) {
        const el = document.createElement(tag);
        el.textContent = texto;
        if (clase) el.className = clase;
        cont.appendChild(el);
        return el;
    };

    if (animal.foto) {
        const img = document.createElement('img');
        img.src = animal.foto;
        img.alt = animal.nombre;
        img.className = 'foto';
        img.loading = 'lazy';
        cont.appendChild(img);

        const credito = agregar('p', 'Foto: ' + (animal.fotoAutor || 'autor no indicado') + ' · ', 'foto-credito');
        if (animal.fotoLink) {
            const a = document.createElement('a');
            a.href = animal.fotoLink;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = 'ver original';
            credito.appendChild(a);
        }

        img.onerror = function() { img.remove(); credito.remove(); };
    }

    agregar('h3', animal.tituloLeyenda || 'Leyenda');
    agregar('p', animal.leyenda || '');

    agregar('h3', animal.tituloExplicacion || 'Explicación');
    agregar('p', animal.explicacion || '');

    if (animal.fuentes && animal.fuentes.length) {
        agregar('h3', 'Fuentes');
        const ul = document.createElement('ul');
        animal.fuentes.forEach(function(f) {
            const li = document.createElement('li');
            li.className = 'fuente';
            li.appendChild(document.createTextNode(f.autor + ' — ' + f.titulo + ' '));
            const a = document.createElement('a');
            a.href = f.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = f.url;
            li.appendChild(a);
            ul.appendChild(li);
        });
        cont.appendChild(ul);
    }
}

async function abrirVisor(animal) {
    if (visorAbierto) return;

    visorAbierto = true;
    visorActual = animal.id;
    limpiarTeclas();
    arrastrando = false;

    document.getElementById('visorTitulo').textContent = animal.nombre;
    mostrarInfoAnimal(animal);

    const estado = document.getElementById('visorEstado');
    const yaEnCache = !!cacheModelos[animal.id];
    estado.textContent = 'Cargando modelo 3D...';
    estado.style.display = yaEnCache ? 'none' : 'flex';

    document.getElementById('visor').style.display = 'flex';

    iniciarVisor();
    ajustarVisor();
    limpiarModeloVisor();
    visor.reloj.getDelta();

    try {
        const datos = await descargarModelo(animal);
        if (!visorAbierto || visorActual !== animal.id) return;

        colocarModeloVisor(datos);
        estado.style.display = 'none';

    } catch (e) {
        console.error('No se pudo cargar el modelo de ' + animal.nombre + ':', e);
        if (visorAbierto && visorActual === animal.id) {
            estado.style.display = 'flex';
            estado.textContent = 'No se pudo cargar el modelo de "' + animal.nombre + '". ' +
                'Revisa los nombres en ANIMALES > archivos (mira la consola con F12).';
        }
    }
}

window.cerrarVisor = function() {
    if (!visorAbierto) return;
    visorAbierto = false;
    visorActual = null;
    document.getElementById('visor').style.display = 'none';
    reloj.getDelta();
};

function renderVisor() {
    if (!visor.renderer) return;
    const dt = Math.min(visor.reloj.getDelta(), 0.1);
    if (visor.mixer) visor.mixer.update(dt);
    visor.controles.update();
    visor.renderer.render(visor.escena, visor.camara);
}


// ======================================
// ADAPTAR quieto.fbx AL ESQUELETO DE personaje1.glb
// ======================================

function normalizarNombre(n) {
    return n.toLowerCase()
        .replace(/^.*[|:]/, '')
        .replace(/^(mixamorig\d*|armature_?|bip\d*)/, '')
        .replace(/[^a-z0-9]/g, '');
}

function rotacionesEnModelo(raiz) {
    const mapa = new Map();
    mapa.set(raiz, new THREE.Quaternion());
    raiz.traverse(function(o) {
        if (o === raiz) return;
        mapa.set(o, mapa.get(o.parent).clone().multiply(o.quaternion));
    });
    return mapa;
}

function crearClipReposo(clipFBX, fbx) {

    modeloPersonaje.updateMatrixWorld(true);
    fbx.updateMatrixWorld(true);

    const huesosFBX = new Map();
    fbx.traverse(o => { if (o.isBone) huesosFBX.set(normalizarNombre(o.name), o); });

    const pares = new Map();
    const sinPar = [];
    let totalGLB = 0;

    modeloPersonaje.traverse(function(o) {
        if (!o.isBone) return;
        totalGLB++;
        const s = huesosFBX.get(normalizarNombre(o.name));
        if (s) pares.set(o, s); else sinPar.push(o.name);
    });

    console.log('Reposo: huesos emparejados =', pares.size, 'de', totalGLB);

    if (pares.size === 0) {
        const nombresGLB = [];
        modeloPersonaje.traverse(o => { if (o.isBone) nombresGLB.push(o.name); });
        console.warn('Ningún hueso de quieto.fbx coincide con personaje1.glb.');
        console.warn('Huesos del personaje (GLB):', nombresGLB);
        console.warn('Huesos de la animación (FBX):', [...huesosFBX.keys()]);
        return null;
    }
    if (sinPar.length) console.log('Huesos sin pareja:', sinPar);

    const restoS = rotacionesEnModelo(fbx);
    const restoT = rotacionesEnModelo(modeloPersonaje);

    const correccion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(CORRECCION_REPOSO_GRADOS.x),
        THREE.MathUtils.degToRad(CORRECCION_REPOSO_GRADOS.y),
        THREE.MathUtils.degToRad(CORRECCION_REPOSO_GRADOS.z)
    ));

    let F = new THREE.Quaternion();
    if (MODO_REPOSO === 'relativo') {
        const cadera = [...pares.keys()].find(b => normalizarNombre(b.name) === 'hips') || [...pares.keys()][0];
        const s = pares.get(cadera);
        F = restoT.get(cadera).clone().multiply(restoS.get(s).clone().invert());
    }
    F.premultiply(correccion);
    const Finv = F.clone().invert();

    const mixerFBX = new THREE.AnimationMixer(fbx);
    mixerFBX.clipAction(clipFBX).play();

    const fps = 30;
    const frames = Math.max(2, Math.ceil(clipFBX.duration * fps) + 1);
    const tiempos = [];
    const valores = new Map();
    const previo = new Map();
    pares.forEach((s, t) => valores.set(t, []));

    for (let i = 0; i < frames; i++) {

        const t = Math.min(i / fps, clipFBX.duration);
        mixerFBX.setTime(t);

        const SA = rotacionesEnModelo(fbx);
        const TA = new Map();
        TA.set(modeloPersonaje, new THREE.Quaternion());

        modeloPersonaje.traverse(function(o) {
            if (o === modeloPersonaje) return;

            const padre = TA.get(o.parent);
            const s = pares.get(o);
            let ta;

            if (s) {
                if (MODO_REPOSO === 'relativo') {
                    const D = SA.get(s).clone().multiply(restoS.get(s).clone().invert());
                    ta = F.clone().multiply(D).multiply(Finv).multiply(restoT.get(o));
                } else {
                    ta = correccion.clone().multiply(SA.get(s));
                }

                const local = padre.clone().invert().multiply(ta);

                const prev = previo.get(o);
                if (prev && prev.dot(local) < 0) {
                    local.set(-local.x, -local.y, -local.z, -local.w);
                }
                previo.set(o, local.clone());

                valores.get(o).push(local.x, local.y, local.z, local.w);
            } else {
                ta = padre.clone().multiply(o.quaternion);
            }

            TA.set(o, ta);
        });

        tiempos.push(t);
    }

    mixerFBX.stopAllAction();
    mixerFBX.uncacheRoot(fbx);

    const tracks = [];
    valores.forEach(function(vals, hueso) {
        tracks.push(new THREE.QuaternionKeyframeTrack(hueso.name + '.quaternion', tiempos, vals));
    });

    return new THREE.AnimationClip('reposo', clipFBX.duration, tracks);
}


// ======================================
// CARGAR PERSONAJE
// ======================================

function cargarPersonaje() {
    loader.load('personaje1.glb', function(gltf) {

        modeloPersonaje = gltf.scene;

        const caja = new THREE.Box3().setFromObject(modeloPersonaje);
        const centro = caja.getCenter(new THREE.Vector3());
        const tamano = caja.getSize(new THREE.Vector3());

        const escala = CFG.alturaPersonaje / (tamano.y || 1);
        modeloPersonaje.scale.setScalar(escala);

        modeloPersonaje.position.set(
            -centro.x * escala,
            -caja.min.y * escala,
            -centro.z * escala
        );

        jugador = new THREE.Group();
        jugador.add(modeloPersonaje);
        jugador.position.copy(puntoRespawn);
        jugador.rotation.y = Math.PI;
        escena.add(jugador);

        const meshes = [];
        modeloPersonaje.traverse(function(obj) {
            if (obj.isMesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
                obj.frustumCulled = false;
                meshes.push(obj);
            }
        });
        outlinePass.selectedObjects = meshes;

        mixer = new THREE.AnimationMixer(modeloPersonaje);
        const anims = gltf.animations || [];
        const buscar = (...claves) => anims.find(a =>
            claves.some(c => a.name.toLowerCase().includes(c)));
        const caminar = buscar('walk', 'caminar', 'run') || anims[0];
        const salto = buscar('jump', 'salto');

        clipCaminarPersonaje = caminar || null;
        if (caminar) acciones.caminar = mixer.clipAction(caminar);
        if (salto) {
            acciones.salto = mixer.clipAction(salto);
            acciones.salto.setLoop(THREE.LoopOnce, 1);
            acciones.salto.clampWhenFinished = true;
        }

        fbxLoader.load('quieto.fbx', function(fbx) {

            try {
                const clipOriginal = fbx.animations[0];

                if (!clipOriginal) {
                    console.error('El archivo quieto.fbx no contiene animaciones.');
                } else {
                    const clipReposo = crearClipReposo(clipOriginal, fbx);
                    if (clipReposo) acciones.reposo = mixer.clipAction(clipReposo);
                }
            } catch (e) {
                console.error('Error preparando la animación de reposo:', e);
            }

            cambiarAnimacion('reposo');
            recursoListo();

        }, undefined, function(error) {
            console.error('Error cargando quieto.fbx:', error);
            recursoListo();
        });

    }, undefined, function(error) {
        console.error('Error cargando personaje:', error);
        errorDeCarga('No se pudo cargar personaje1.glb. Revisa que esté junto a index.html y abre la página desde un servidor.');
    });
}


function recursoListo() {
    recursosListos++;
    if (recursosListos < 2 || falloCarga) return;

    crearPersonajesSecundarios();

    const inicioSeguro = buscarPuntoRespawn();
    if (!inicioSeguro) {
        errorDeCarga('No se encontró una superficie transitable en trabajo1.glb.');
        return;
    }
    puntoRespawn.copy(inicioSeguro);

    reaparecer();

    document.getElementById('cargando').style.display = 'none';
    actualizarCamara(0, true);
}

function reaparecer() {
    jugador.position.copy(puntoRespawn);
    vx = vy = vz = 0;
    enSuelo = false;
}


// ======================================
// ANIMACIONES
// ======================================

function cambiarAnimacion(tipo) {
    const nueva = acciones[tipo] || null;

    if (tipo === 'salto' && !nueva) return;
    if (nueva === accionActual) return;

    if (accionActual) accionActual.fadeOut(0.2);
    accionActual = nueva;

    if (nueva) {
        nueva.reset();
        nueva.setEffectiveWeight(1);
        nueva.fadeIn(0.2);
        nueva.play();
    }
}


// ======================================
// FÍSICA Y COLISIONES
// ======================================

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();

function golpeSuelo(x, yOrigen, z, distancia) {
    _o.set(x, yOrigen, z);
    raycaster.set(_o, ABAJO);
    raycaster.near = 0;
    raycaster.far = distancia;
    const hits = raycaster.intersectObjects(objetosColision, false);
    return hits.length ? hits[0] : null;
}

function buscarPuntoRespawn() {
    const altoRayo = limitesMapa.max.y + 10;
    const distanciaRayo = altoRayo - limitesMapa.min.y + 20;
    const direcciones = [
        [0, 0],
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [-1, 1], [1, -1], [-1, -1]
    ];

    for (const radio of [0, 1, 2, 3, 4, 6, 8, 10]) {
        for (const [dx, dz] of direcciones) {
            if (radio === 0 && (dx !== 0 || dz !== 0)) continue;
            if (radio > 0 && dx === 0 && dz === 0) continue;

            const escala = radio / Math.max(Math.abs(dx), Math.abs(dz), 1);
            const x = puntoRespawn.x + dx * escala;
            const z = puntoRespawn.z + dz * escala;
            if (x < limitesMapa.min.x || x > limitesMapa.max.x ||
                z < limitesMapa.min.z || z > limitesMapa.max.z) continue;

            const hit = golpeSuelo(x, altoRayo, z, distanciaRayo);
            if (!hit || !hit.face) continue;

            _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
            if (_n.y < 0.65) continue;

            return new THREE.Vector3(x, hit.point.y + 0.02, z);
        }
    }

    const ancho = limitesMapa.max.x - limitesMapa.min.x;
    const profundidad = limitesMapa.max.z - limitesMapa.min.z;
    const paso = Math.max(1.5, Math.max(ancho, profundidad) / 60);
    const cantidadX = Math.max(1, Math.ceil(ancho / paso));
    const cantidadZ = Math.max(1, Math.ceil(profundidad / paso));
    const candidatos = [];

    for (let i = 0; i < cantidadX; i++) {
        const x = limitesMapa.min.x + (i + 0.5) * ancho / cantidadX;
        for (let j = 0; j < cantidadZ; j++) {
            const z = limitesMapa.min.z + (j + 0.5) * profundidad / cantidadZ;
            const distancia = (x - puntoRespawn.x) ** 2 + (z - puntoRespawn.z) ** 2;
            candidatos.push({ x: x, z: z, distancia: distancia });
        }
    }

    candidatos.sort(function(a, b) { return a.distancia - b.distancia; });

    for (const candidato of candidatos) {
        const hit = golpeSuelo(candidato.x, altoRayo, candidato.z, distanciaRayo);
        if (!hit || !hit.face) continue;

        _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (_n.y < 0.65) continue;

        return new THREE.Vector3(candidato.x, hit.point.y + 0.02, candidato.z);
    }

    return null;
}

function hayMuro(dirX, dirZ, distancia, personaje = jugador) {
    if (!personaje) return true;
    _d.set(dirX, 0, dirZ);
    const lx = -dirZ, lz = dirX;

    const alturas = [
        CFG.alturaEscalon + 0.01,
        CFG.alturaPersonaje * 0.55,
        CFG.alturaPersonaje * 0.9
    ];
    const laterales = [0, radioJugador * 0.7, -radioJugador * 0.7];

    for (const h of alturas) {
        for (const l of laterales) {
            _o.set(
                personaje.position.x + lx * l,
                personaje.position.y + h,
                personaje.position.z + lz * l
            );
            raycaster.set(_o, _d);
            raycaster.near = 0;
            raycaster.far = radioJugador + distancia + 0.02;

            const hits = raycaster.intersectObjects(objetosColision, false);
            for (const hit of hits) {
                if (hit.face) {
                    _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
                    if (Math.abs(_n.y) > 0.8) continue;
                }
                return true;
            }
        }
    }
    return false;
}

function crearPersonajesSecundarios() {
    if (!modeloPersonaje || personajesSecundarios.length) return;
    if (!clipCaminarPersonaje) {
        console.warn('No se crearon personajes secundarios porque personaje1.glb no tiene una animación para caminar.');
        return;
    }

    const rutas = [
        [[-5, 5], [-5, 9], [-3, 9], [-3, 5]],
        [[7, 5], [7, 9], [5, 9], [5, 5]],
        [[-2, 12], [2, 12], [2, 10], [-2, 10]]
    ];
    const altoRayo = limitesMapa.max.y + 10;
    const distanciaRayo = altoRayo - limitesMapa.min.y + 20;

    rutas.forEach(function(ruta, indice) {
        const puntos = [];

        for (const [xOriginal, zOriginal] of ruta) {
            const punto = transformarPuntoMapa(xOriginal, 0, zOriginal);
            const suelo = golpeSuelo(punto.x, altoRayo, punto.z, distanciaRayo);
            if (!suelo) {
                console.warn('No se pudo ubicar el personaje secundario ' + (indice + 1) +
                    ' porque no se encontró suelo en su ruta.');
                return;
            }
            puntos.push(new THREE.Vector3(punto.x, suelo.point.y + 0.02, punto.z));
        }

        const curva = new THREE.CatmullRomCurve3(puntos, true, 'centripetal');
        const modelo = SkeletonUtils.clone(modeloPersonaje);
        const personaje = new THREE.Group();
        personaje.add(modelo);
        personaje.position.copy(curva.getPointAt(0));
        personaje.rotation.y = Math.PI;
        escena.add(personaje);

        modelo.traverse(function(obj) {
            if (obj.isMesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
                obj.frustumCulled = false;
            }
        });

        const mixerSecundario = new THREE.AnimationMixer(modelo);
        const caminar = mixerSecundario.clipAction(clipCaminarPersonaje);
        caminar.setLoop(THREE.LoopRepeat, Infinity);
        caminar.play();
        caminar.time = clipCaminarPersonaje.duration * (indice / rutas.length);
        caminar.timeScale = [0.65, 0.72, 0.68][indice];

        const reposo = acciones.reposo
            ? mixerSecundario.clipAction(acciones.reposo.getClip())
            : null;

        personajesSecundarios.push({
            grupo: personaje,
            mixer: mixerSecundario,
            caminar: caminar,
            reposo: reposo,
            curva: curva,
            longitud: curva.getLength(),
            progreso: 0,
            sentido: 1,
            velocidad: 0.2 + indice * 0.035,
            ritmoAnimacion: [0.94, 1.04, 0.98][indice],
            tiempoChequeo: indice * 0.05,
            intervaloChequeo: 0.15,
            desvioTiempo: 0,
            detenido: false,
            tiempoHastaPausa: 5 + Math.random() * 4,
            tiempoPausa: 0
        });
    });

    console.info('Personajes secundarios caminando:', personajesSecundarios.length);
}

function actualizarPersonajesSecundarios(dt) {
    for (const npc of personajesSecundarios) {
        if (npc.detenido) {
            npc.mixer.update(dt);
            npc.tiempoPausa -= dt;
            if (npc.tiempoPausa <= 0) {
                npc.detenido = false;
                npc.tiempoHastaPausa = 5 + Math.random() * 5;
                npc.caminar.paused = false;
                npc.caminar.reset().fadeIn(0.35).play();
                if (npc.reposo) npc.reposo.fadeOut(0.35);
            }
            continue;
        }

        npc.mixer.update(dt * npc.ritmoAnimacion);
        npc.tiempoHastaPausa -= dt;
        if (npc.tiempoHastaPausa <= 0 && npc.desvioTiempo <= 0) {
            npc.detenido = true;
            npc.tiempoPausa = 1.5 + Math.random() * 2;
            npc.caminar.fadeOut(0.3);
            if (npc.reposo) {
                npc.reposo.reset().fadeIn(0.3).play();
            } else {
                npc.caminar.paused = true;
            }
            continue;
        }

        if (npc.desvioTiempo > 0) {
            const paso = npc.velocidad * dt;
            if (hayMuro(npc.desvioX, npc.desvioZ, paso, npc.grupo)) {
                npc.desvioTiempo = 0;
                npc.tiempoChequeo = 0;
                continue;
            }

            npc.grupo.position.x += npc.desvioX * paso;
            npc.grupo.position.z += npc.desvioZ * paso;
            npc.desvioTiempo = Math.max(0, npc.desvioTiempo - dt);
            girarPersonajeSuave(npc.grupo, npc.desvioX, npc.desvioZ, dt);
            if (npc.desvioTiempo === 0) npc.tiempoChequeo = 0;
            continue;
        }

        const siguienteProgreso = (npc.progreso +
            npc.sentido * npc.velocidad * dt / npc.longitud + 1) % 1;
        const destino = npc.curva.getPointAt(siguienteProgreso);
        const dx = destino.x - npc.grupo.position.x;
        const dz = destino.z - npc.grupo.position.z;
        const distancia = Math.hypot(dx, dz);
        if (distancia < 1e-5) continue;

        const direccionX = dx / distancia;
        const direccionZ = dz / distancia;

        npc.tiempoChequeo -= dt;
        const revisarColision = npc.tiempoChequeo <= 0;
        if (revisarColision) npc.tiempoChequeo = npc.intervaloChequeo;

        if (revisarColision &&
            hayMuro(direccionX, direccionZ, Math.max(distancia, 0.22), npc.grupo)) {
            const anguloDesvio = Math.PI / 3;
            const distanciaPrueba = Math.max(0.25, radioJugador * 2);
            const candidatos = [
                anguloDesvio * (npc.ladoDesvio || 1),
                -anguloDesvio * (npc.ladoDesvio || 1)
            ];
            let desvioEncontrado = false;

            for (const angulo of candidatos) {
                const cos = Math.cos(angulo);
                const sin = Math.sin(angulo);
                const desvioX = direccionX * cos - direccionZ * sin;
                const desvioZ = direccionX * sin + direccionZ * cos;

                if (!hayMuro(desvioX, desvioZ, distanciaPrueba, npc.grupo)) {
                    npc.desvioX = desvioX;
                    npc.desvioZ = desvioZ;
                    npc.desvioTiempo = 0.4;
                    npc.ladoDesvio = -Math.sign(angulo);
                    desvioEncontrado = true;
                    break;
                }
            }

            if (!desvioEncontrado) continue;

            const pasoDesvio = Math.min(npc.velocidad * dt, distanciaPrueba);
            npc.grupo.position.x += npc.desvioX * pasoDesvio;
            npc.grupo.position.z += npc.desvioZ * pasoDesvio;
            npc.desvioTiempo = Math.max(0, npc.desvioTiempo - dt);
            girarPersonajeSuave(npc.grupo, npc.desvioX, npc.desvioZ, dt);
            if (npc.desvioTiempo === 0) npc.tiempoChequeo = 0;
            continue;
        }

        npc.progreso = siguienteProgreso;
        npc.grupo.position.copy(destino);
        girarPersonajeSuave(npc.grupo, direccionX, direccionZ, dt);
    }
}

function girarPersonajeSuave(personaje, direccionX, direccionZ, dt) {
    const objetivoRotacion = Math.atan2(direccionX, direccionZ);
    let diferencia = objetivoRotacion - personaje.rotation.y;
    diferencia = Math.atan2(Math.sin(diferencia), Math.cos(diferencia));
    personaje.rotation.y += diferencia * (1 - Math.exp(-7 * dt));
}

function moverConColisiones(dx, dz) {
    const total = Math.hypot(dx, dz);
    if (total < 1e-6) return false;

    const pasos = Math.max(1, Math.ceil(total / (radioJugador * 0.5)));
    const px = dx / pasos;
    const pz = dz / pasos;
    let chocoConMuro = false;

    const margen = 0.1;
    const minX = limitesMapa.min.x + margen, maxX = limitesMapa.max.x - margen;
    const minZ = limitesMapa.min.z + margen, maxZ = limitesMapa.max.z - margen;

    for (let i = 0; i < pasos; i++) {
        let bloqueadoX = false;
        let bloqueadoZ = false;
        let seMovioEnPaso = false;

        if (Math.abs(px) > 1e-5) {
            if (!hayMuro(Math.sign(px), 0, Math.abs(px))) {
                const xAnterior = jugador.position.x;
                jugador.position.x = THREE.MathUtils.clamp(jugador.position.x + px, minX, maxX);
                seMovioEnPaso = seMovioEnPaso || jugador.position.x !== xAnterior;
            } else {
                vx = 0;
                chocoConMuro = true;
                bloqueadoX = true;
            }
        }

        if (Math.abs(pz) > 1e-5) {
            if (!hayMuro(0, Math.sign(pz), Math.abs(pz))) {
                const zAnterior = jugador.position.z;
                jugador.position.z = THREE.MathUtils.clamp(jugador.position.z + pz, minZ, maxZ);
                seMovioEnPaso = seMovioEnPaso || jugador.position.z !== zAnterior;
            } else {
                vz = 0;
                chocoConMuro = true;
                bloqueadoZ = true;
            }
        }

        if ((bloqueadoX || bloqueadoZ) && !seMovioEnPaso) {
            const direccion = Math.atan2(pz, px);
            const pasoLateral = Math.min(Math.hypot(px, pz), radioJugador * 0.5);
            let rodeoEncontrado = false;

            for (const lado of [ladoDesvioJugador, -ladoDesvioJugador]) {
                const angulo = direccion + lado * Math.PI / 2;
                const lateralX = Math.cos(angulo);
                const lateralZ = Math.sin(angulo);

                if (!hayMuro(lateralX, lateralZ, pasoLateral)) {
                    jugador.position.x = THREE.MathUtils.clamp(
                        jugador.position.x + lateralX * pasoLateral, minX, maxX
                    );
                    jugador.position.z = THREE.MathUtils.clamp(
                        jugador.position.z + lateralZ * pasoLateral, minZ, maxZ
                    );
                    ladoDesvioJugador = -lado;
                    rodeoEncontrado = true;
                    break;
                }
            }

            if (!rodeoEncontrado) chocoConMuro = true;
        }
    }

    return chocoConMuro;
}

function actualizarJugador(dt) {

    // ---------- ENTRADA ----------
    let adelante = 0, derecha = 0;
    if (teclaActiva('KeyW') || teclaActiva('ArrowUp')) adelante += 1;
    if (teclaActiva('KeyS') || teclaActiva('ArrowDown')) adelante -= 1;
    if (teclaActiva('KeyA') || teclaActiva('ArrowLeft')) derecha -= 1;
    if (teclaActiva('KeyD') || teclaActiva('ArrowRight')) derecha += 1;
    corriendo = !!(teclas['ShiftLeft'] || teclas['ShiftRight']);

    // Al caminar, la cámara vuelve al personaje
    if (vistaFija && (adelante !== 0 || derecha !== 0)) elegirVista('Digit0');

    let dirX = 0, dirZ = 0;

    if (adelante !== 0 || derecha !== 0) {
        dirX = Math.sin(camaraYaw) * adelante + Math.cos(camaraYaw) * derecha;
        dirZ = -Math.cos(camaraYaw) * adelante + Math.sin(camaraYaw) * derecha;
        const l = Math.hypot(dirX, dirZ);
        dirX /= l;
        dirZ /= l;
    }

    // ---------- VELOCIDAD CON INERCIA ----------
    const vel = corriendo ? CFG.velocidadCorrer : CFG.velocidad;
    const k = enSuelo ? 14 : 5;
    const f = 1 - Math.exp(-k * dt);
    vx += (dirX * vel - vx) * f;
    vz += (dirZ * vel - vz) * f;

    if (Math.abs(vx) < 0.001 && dirX === 0) vx = 0;
    if (Math.abs(vz) < 0.001 && dirZ === 0) vz = 0;

    const chocoConMuro = moverConColisiones(vx * dt, vz * dt);

    // ---------- SALTO ----------
    tiempoCoyote = enSuelo ? 0.12 : tiempoCoyote - dt;
    if (chocoConMuro && enSuelo && (adelante !== 0 || derecha !== 0)) {
        bufferSalto = Math.max(bufferSalto, 0.15);
    }
    bufferSalto -= dt;

    if (bufferSalto > 0 && tiempoCoyote > 0) {
        vy = CFG.fuerzaSalto;
        enSuelo = false;
        tiempoCoyote = 0;
        bufferSalto = 0;
        if (acciones.salto) acciones.salto.reset();
    }

    // ---------- GRAVEDAD Y SUELO ----------
    const yAnterior = jugador.position.y;

    if (!enSuelo || vy > 0) {
        vy = Math.max(vy - CFG.gravedad * dt, -30);
        jugador.position.y += vy * dt;
    }

    if (vy <= 0) {
        const pegar = enSuelo ? 0.08 : 0.01;
        const distancia = (yAnterior - jugador.position.y) + CFG.alturaEscalon + pegar;

        const hit = golpeSuelo(
            jugador.position.x,
            yAnterior + CFG.alturaEscalon,
            jugador.position.z,
            distancia
        );

        if (hit) {
            jugador.position.y = hit.point.y;
            vy = 0;
            enSuelo = true;
        } else {
            enSuelo = false;
        }
    }

    if (jugador.position.y < limitesMapa.min.y - 20) reaparecer();

    // ---------- ROTAR HACIA DONDE CAMINA ----------
    const rapidez = Math.hypot(vx, vz);

    if (rapidez > 0.8) {
        const objetivo = Math.atan2(vx, vz);
        let dif = objetivo - jugador.rotation.y;
        dif = Math.atan2(Math.sin(dif), Math.cos(dif));
        jugador.rotation.y += dif * Math.min(1, dt * 12);
    }

    // ---------- ANIMACIÓN ----------
    if (!enSuelo && acciones.salto) {
        cambiarAnimacion('salto');
    } else if (rapidez > 0.8) {
        cambiarAnimacion('caminar');
        if (acciones.caminar) {
            acciones.caminar.timeScale = THREE.MathUtils.clamp(rapidez / CFG.velocidad, 0.6, 1.8);
        }
    } else {
        cambiarAnimacion('reposo');
    }
}


// ======================================
// METEORITOS
// ======================================

function cargarMeteoros() {
    loader.load('assets/meteoro.glb', function(gltf) {
        for (let i = 0; i < CFG.meteoros; i++) {
            const clon = gltf.scene.clone(true);
            clon.position.set(
                (Math.random() - 0.5) * 100,
                Math.random() * 60 + 10,
                (Math.random() - 0.5) * 100
            );
            clon.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            clon.scale.set(4.5, 4.5, 4.5);
            clon.visible = meteorosVisibles;
            clon.userData = {
                caida: (Math.random() * 0.15 + 0.05) * 60,
                rx: (Math.random() - 0.5) * 0.05 * 60,
                ry: (Math.random() - 0.5) * 0.05 * 60,
                rz: (Math.random() - 0.5) * 0.05 * 60
            };
            escena.add(clon);
            arrayMeteoros.push(clon);
        }
    }, undefined, function(e) {
        console.warn('No se pudieron cargar los meteoritos:', e);
    });
}

function actualizarMeteoros(dt) {
    if (!meteorosVisibles) return;
    for (const m of arrayMeteoros) {
        m.position.y -= m.userData.caida * dt;
        m.rotation.x += m.userData.rx * dt;
        m.rotation.y += m.userData.ry * dt;
        m.rotation.z += m.userData.rz * dt;

        if (m.position.y < -15) {
            m.position.set(
                (Math.random() - 0.5) * 100,
                60 + Math.random() * 20,
                (Math.random() - 0.5) * 100
            );
        }
    }
}


// ======================================
// CÁMARA
// ======================================

const _objetivo = new THREE.Vector3();
const _deseada = new THREE.Vector3();
const _dirCam = new THREE.Vector3();

function actualizarCamara(dt = 0.016, inmediata = false) {
    if (!jugador) return;

    // Vista fija: la cámara viaja suavemente al ángulo elegido
    if (vistaFija) {
        const kv = 1 - Math.exp(-4 * dt);
        _vPos.set(vistaFija.pos[0], vistaFija.pos[1], vistaFija.pos[2]);
        _vMira.set(vistaFija.mira[0], vistaFija.mira[1], vistaFija.mira[2]);
        camara.position.lerp(_vPos, kv);
        miraActual.lerp(_vMira, kv);
        camara.lookAt(miraActual);
        if (Math.abs(camara.fov - 65) > 0.01) {
            camara.fov = 65;
            camara.updateProjectionMatrix();
        }
        if (destinoInfoPendiente &&
            camara.position.distanceTo(_vPos) < 0.08 &&
            miraActual.distanceTo(_vMira) < 0.08) {
            const animal = destinoInfoPendiente;
            destinoInfoPendiente = null;
            abrirVisor(animal);
        }
        return;
    }

    _objetivo.set(
        jugador.position.x,
        jugador.position.y + CFG.alturaCamaraObjetivo,
        jugador.position.z
    );

    const dh = Math.cos(camaraPitch);
    _dirCam.set(
        -Math.sin(camaraYaw) * dh,
        Math.sin(camaraPitch),
        Math.cos(camaraYaw) * dh
    ).normalize();

    let distancia = distanciaCamara;

    if (objetosColision.length) {
        raycaster.set(_objetivo, _dirCam);
        raycaster.near = 0;
        raycaster.far = distanciaCamara;
        const hits = raycaster.intersectObjects(objetosColision, false);
        if (hits.length) distancia = Math.max(0.5, hits[0].distance - 0.2);
    }

    _deseada.copy(_objetivo).addScaledVector(_dirCam, distancia);

    if (inmediata) {
        camara.position.copy(_deseada);
    } else {
        camara.position.lerp(_deseada, 1 - Math.exp(-20 * dt));
    }

    camara.lookAt(_objetivo);

    const rapido = corriendo && Math.hypot(vx, vz) > CFG.velocidad;
    const fovObjetivo = rapido ? 72 : 65;
    if (Math.abs(camara.fov - fovObjetivo) > 0.01) {
        camara.fov += (fovObjetivo - camara.fov) * (1 - Math.exp(-6 * dt));
        camara.updateProjectionMatrix();
    }
}


// ======================================
// MOUSE (cámara con arrastre)
// ======================================

function puedeControlar() {
    return explorando && !pausado && !informacionAbierta && !visorAbierto;
}

function configurarMouse() {
    const lienzo = renderizador.domElement;

    lienzo.addEventListener('pointerdown', function(e) {
        if (puedeControlar() && e.button === 0) {
            if (vistaFija) elegirVista('Digit0');   // arrastrar vuelve al personaje
            arrastrando = true;
        }
    });
    window.addEventListener('pointerup', () => { arrastrando = false; });
    window.addEventListener('pointercancel', () => { arrastrando = false; });

    lienzo.addEventListener('pointermove', function(e) {
        if (!puedeControlar() || !arrastrando) return;

        camaraYaw += e.movementX * 0.0025;
        camaraPitch = THREE.MathUtils.clamp(camaraPitch + e.movementY * 0.0025, 0.05, 1.1);
    });

    lienzo.addEventListener('wheel', function(e) {
        if (!explorando || pausado || visorAbierto) return;
        e.preventDefault();
        distanciaCamara = THREE.MathUtils.clamp(distanciaCamara + e.deltaY * 0.005, 2.2, 8);
    }, { passive: false });
}

function configurarControlesMoviles() {
    const controles = document.getElementById('controlesMoviles');
    controles.querySelectorAll('[data-tecla]').forEach(function(boton) {
        const codigo = boton.dataset.tecla;

        function soltar(e) {
            if (e && e.pointerId !== undefined) teclasTactiles.delete(e.pointerId);
            boton.classList.remove('presionado');
        }

        boton.addEventListener('pointerdown', function(e) {
            if (!puedeControlar()) return;
            e.preventDefault();
            teclasTactiles.set(e.pointerId, codigo);
            boton.classList.add('presionado');
            if (boton.setPointerCapture) boton.setPointerCapture(e.pointerId);
        });
        boton.addEventListener('pointerup', soltar);
        boton.addEventListener('pointercancel', soltar);
        boton.addEventListener('lostpointercapture', soltar);
        boton.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    });
}


// ======================================
// INICIAR EXPLORACIÓN (con o sin música)
// ======================================

window.iniciarExploracion = function(conMusica) {
    if (!jugador || recursosListos < 2) {
        alert('Espera a que termine de cargar.');
        return;
    }

    explorando = true;
    pausado = false;
    reloj.getDelta();

    ponerMusica(conMusica === true);

    document.getElementById('portada').style.display = 'none';
    document.getElementById('instrucciones').style.display = 'block';
    document.getElementById('panelAmbiente').style.display = 'flex';
    document.getElementById('panelVistas').style.display = 'flex';
    document.getElementById('btnMusica').style.display = 'block';
    document.getElementById('menuDestinos').classList.add('visible');
    document.getElementById('marcadoresDestinos').classList.add('visible');
    if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) {
        document.getElementById('controlesMoviles').classList.add('visible');
    }

    actualizarCamara(0, true);
};


// ======================================
// TECLADO
// ======================================

const TECLAS_JUEGO = [
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'
];

function teclaPresionada(e) {
    teclas[e.code] = true;

    if (TECLAS_JUEGO.includes(e.code) && !visorAbierto) e.preventDefault();

    // ESC: cierra el visor 3D, o pausa el juego
    if (e.code === 'Escape') {
        if (visorAbierto) {
            window.cerrarVisor();
            return;
        }
        if (explorando && !pausado) pausar();
        return;
    }

    if (e.code === 'Space' && !e.repeat && puedeControlar()) bufferSalto = 0.15;

    // 1 / 2 / 3 / 4: Día, Tarde, Noche, Auto
    if (!e.repeat && explorando && !pausado && !visorAbierto) {
        if (e.code === 'Digit1' || e.code === 'Numpad1') { elegirAmbiente('dia'); return; }
        if (e.code === 'Digit2' || e.code === 'Numpad2') { elegirAmbiente('tarde'); return; }
        if (e.code === 'Digit3' || e.code === 'Numpad3') { elegirAmbiente('noche'); return; }
        if (e.code === 'Digit4' || e.code === 'Numpad4') { elegirAmbiente('auto'); return; }
    }

    // 5-9: vistas de cámara, 0: volver al personaje
    if (!e.repeat && explorando && !pausado && !visorAbierto && !informacionAbierta) {
        const c = e.code.replace('Numpad', 'Digit');
        if (c === 'Digit0' || VISTAS[c]) { elegirVista(c); return; }
    }

    // Tecla de la zona cercana: H C S L (animales) o E (casco)
    if (!e.repeat && zonaActual && puedeControlar() && e.code === zonaActual.animal.tecla) {
        abrirVisor(zonaActual.animal);
        return;
    }

    // E lejos del casco: panel de información general
    if (e.code === 'KeyE' && !e.repeat && explorando && !pausado && !visorAbierto) {
        informacionAbierta ? window.cerrarInformacion() : abrirInformacion();
    }

    // P: muestra tus coordenadas
    if (e.code === 'KeyP' && !e.repeat && explorando) {
        mostrarCoords = !mostrarCoords;
        document.getElementById('coords').style.display = mostrarCoords ? 'block' : 'none';
        if (mostrarCoords && jugador) {
            console.log('Posición del jugador: x =', +jugador.position.x.toFixed(2),
                'z =', +jugador.position.z.toFixed(2));
        }
    }
}

function teclaSoltada(e) { teclas[e.code] = false; }

function teclaActiva(codigo) {
    if (teclas[codigo]) return true;
    for (const codigoTactil of teclasTactiles.values()) {
        if (codigoTactil === codigo) return true;
    }
    return false;
}

function limpiarTeclas() {
    for (const t in teclas) teclas[t] = false;
    teclasTactiles.clear();
    document.querySelectorAll('#controlesMoviles button').forEach(function(boton) {
        boton.classList.remove('presionado');
    });
}


// ======================================
// INFORMACIÓN Y PAUSA
// ======================================

function abrirInformacion() {
    informacionAbierta = true;
    limpiarTeclas();
    arrastrando = false;
    document.getElementById('panelInfo').style.display = 'block';
}

window.cerrarInformacion = function() {
    informacionAbierta = false;
    document.getElementById('panelInfo').style.display = 'none';
    reloj.getDelta();
};

function pausar() {
    if (pausado) return;
    pausado = true;
    limpiarTeclas();
    arrastrando = false;
    if (musicaActiva && ytListo) ytPlayer.pauseVideo();   // la música se pausa con el juego
    document.getElementById('pausa').style.display = 'flex';
}

window.reanudar = function() {
    pausado = false;
    document.getElementById('pausa').style.display = 'none';
    if (musicaActiva && ytListo) ytPlayer.playVideo();    // y continúa al reanudar
    reloj.getDelta();
};


// ======================================
// REDIMENSIONAR
// ======================================

function redimensionar() {
    if (!camara || !renderizador) return;
    camara.aspect = window.innerWidth / window.innerHeight;
    camara.updateProjectionMatrix();
    renderizador.setSize(window.innerWidth, window.innerHeight);
    if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
        ajustarResolucionContorno();
    }
}


// ======================================
// BUCLE PRINCIPAL
// ======================================

function animar() {
    requestAnimationFrame(animar);

    if (visorAbierto) {
        renderVisor();
        return;
    }

    if (pausado) return;

    const crudo = reloj.getDelta();
    const delta = Math.min(crudo, 0.05);

    actualizarAmbiente(delta);

    if (explorando) {
        if (!informacionAbierta) actualizarJugador(delta);
        actualizarPersonajesSecundarios(delta);
        actualizarCamara(delta);
        tiempoMarcadores += delta;
        if (tiempoMarcadores >= 1 / 30) {
            tiempoMarcadores %= 1 / 30;
            actualizarMarcadoresDestinos();
        }
        vigilarRendimiento(crudo);
    }

    actualizarZonaAnimal();

    if (mixer && !informacionAbierta) mixer.update(delta);

    if (mostrarCoords && jugador) {
        const txt = 'x: ' + jugador.position.x.toFixed(2) +
            '   z: ' + jugador.position.z.toFixed(2) +
            '   y: ' + jugador.position.y.toFixed(2);
        if (txt !== textoCoordsAnterior) {
            textoCoordsAnterior = txt;
            document.getElementById('coords').textContent = txt;
        }
    }

    if (outlinePass) {
        const t = relojEfectos.getElapsedTime();
        outlinePass.edgeStrength = 2.0 + Math.sin(t * 4) * 1.8;
        outlinePass.edgeGlow = 0.4 + Math.sin(t * 4) * 0.35;
    }

    actualizarMeteoros(delta);

    contadorFrames++;
    renderizador.shadowMap.needsUpdate = (contadorFrames % 2 === 0);

    if (composer) composer.render();
    else renderizador.render(escena, camara);
}

iniciarEscena();
