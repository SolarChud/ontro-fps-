import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

let camera, scene, renderer, controls;
const objects = []; // Buildings and static walls for collision
const shootableObjects = []; // Shootable meshes (future players)
let raycaster;

// Settings State
let globalSettings = {
    fov: 75,
    sens: 1.0,
    volume: 1.0,
    shadows: true
};

// HUD Elements
const healthBarFill = document.getElementById('health-bar-fill');
const healthText = document.getElementById('health-text');
const ammoUI = document.getElementById('ammo-ui');
const scoreText = document.querySelector('#score span');
const killfeed = document.getElementById('killfeed');
const weaponUIElement = document.getElementById('weapon-ui');

// UI Menus and Settings Modals
const settingsModal = document.getElementById('settings-modal');
const settingsOpenBtn = document.getElementById('settings-open-btn');
const settingsCloseBtn = document.getElementById('settings-close-btn');

const fovSlider = document.getElementById('fov-slider');
const fovVal = document.getElementById('fov-val');
const sensSlider = document.getElementById('sens-slider');
const sensVal = document.getElementById('sens-val');
const volSlider = document.getElementById('vol-slider');
const volVal = document.getElementById('vol-val');
const shadowsCheck = document.getElementById('shadows-check');

// Setup interactions
settingsOpenBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
});
settingsCloseBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

[fovSlider, sensSlider, volSlider, shadowsCheck].forEach(el => {
    el.addEventListener('input', updateSettings);
});

function updateSettings() {
    globalSettings.fov = parseInt(fovSlider.value);
    fovVal.innerText = globalSettings.fov;
    if(camera) {
        camera.fov = globalSettings.fov;
        camera.updateProjectionMatrix();
    }

    globalSettings.sens = parseFloat(sensSlider.value);
    sensVal.innerText = globalSettings.sens.toFixed(1);
    
    globalSettings.volume = parseInt(volSlider.value) / 100;
    volVal.innerText = parseInt(volSlider.value);
    
    globalSettings.shadows = shadowsCheck.checked;
    if(renderer) {
        renderer.shadowMap.enabled = globalSettings.shadows;
        scene.traverse((child) => {
            if(child.isMesh) {
                child.castShadow = globalSettings.shadows;
                child.receiveShadow = globalSettings.shadows;
                child.material.needsUpdate = true;
            }
        });
    }
}

// Multiplayer Variables
const otherPlayers = {}; // Store Three.js groups of other players
let socket;
let myId = null;
let isPlaying = false;

let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let canJump = false;

let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

// Weapons System
let currentWeapon = 0;
const weapons = [];
const weaponStats = [
    { name: 'PISTOL', damage: 34, fireRate: 300, sound: 'pistol', spread: 0, maxAmmo: 12, ammo: 12 },
    { name: 'ASSAULT RIFLE', damage: 20, fireRate: 100, sound: 'rifle', spread: 0.02, maxAmmo: 30, ammo: 30 },
    { name: 'SHOTGUN', damage: 15, fireRate: 800, sound: 'shotgun', spread: 0.1, pellets: 8, maxAmmo: 8, ammo: 8 }
];
let lastFireTime = 0;

let score = 0;

// Audio setup
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playShootSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    if (type === 'pistol') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(300, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.2 * globalSettings.volume, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    } else if (type === 'rifle') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        gainNode.gain.setValueAtTime(0.3 * globalSettings.volume, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
    } else if (type === 'shotgun') {
        // Use sawtooth + some noise approximation for shotgun
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.4 * globalSettings.volume, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    }

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
}

function playHitSound(isHeadshot) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'sine';
    
    if (isHeadshot) {
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.6 * globalSettings.volume, audioCtx.currentTime);
    } else {
        osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.3 * globalSettings.volume, audioCtx.currentTime);
    }
    
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

// Ensure the game only starts after connecting
const startBtn = document.getElementById('start-btn');
const mainMenu = document.getElementById('main-menu-container');
const playerNameInput = document.getElementById('player-name');
const connectionStatus = document.getElementById('connection-status');
const uiElements = ['crosshair', 'instructions', 'hud-top', 'hud-bottom'];

startBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim() || 'Guest';
    if(typeof io !== 'undefined') {
        socket = io();
        setupMultiplayer(name);
    } else {
        connectionStatus.innerText = "Error: Cannot connect to server. Did you start Node.js?";
        connectionStatus.style.color = "red";
    }
});

function setupMultiplayer(name) {
    connectionStatus.innerText = "Connecting...";
    
    socket.on('connect', () => {
        myId = socket.id;
        socket.emit('joinGame', name);
        
        // Hide menu, show UI, start rendering mechanics
        mainMenu.style.display = 'none';
        uiElements.forEach(id => document.getElementById(id).style.display = 'block');
        
        isPlaying = true;
        init();
        animate();
    });

    socket.on('initPlayers', (serverPlayers) => {
        for (let id in serverPlayers) {
            if (id !== myId) addOtherPlayer(serverPlayers[id]);
        }
    });

    socket.on('playerJoined', (playerData) => {
        addOtherPlayer(playerData);
    });

    socket.on('playerMoved', (playerData) => {
        if (otherPlayers[playerData.id]) {
            const bot = otherPlayers[playerData.id];
            // Smoothly move towards target in a real game, here we snap
            bot.group.position.set(playerData.x, playerData.y, playerData.z);
            bot.group.rotation.set(playerData.rx, playerData.ry, playerData.rz);
        }
    });

    socket.on('playerLeft', (id) => {
        if (otherPlayers[id]) {
            scene.remove(otherPlayers[id].group);
            // remove from shootable
            otherPlayers[id].meshes.forEach(m => {
                const idx = shootableObjects.indexOf(m);
                if(idx > -1) shootableObjects.splice(idx, 1);
            });
            delete otherPlayers[id];
        }
    });

    socket.on('playerHit', (data) => {
        if (data.id === myId) {
            // I got hit
            // Update local health UI
            const hpWidth = Math.max(0, data.hp) + '%';
            healthBarFill.style.width = hpWidth;
            healthText.innerText = Math.max(0, data.hp);
            
            // Flash health bar red
            healthBarFill.style.background = "linear-gradient(90deg, #ff0000, #ff5252)";
            setTimeout(() => {
                healthBarFill.style.background = "linear-gradient(90deg, #4CAF50, #8BC34A)";
            }, 300);

            // Flash screen red
            const overlay = document.createElement('div');
            overlay.style.position = 'absolute';
            overlay.style.top = '0'; overlay.style.left = '0'; overlay.style.width = '100vw'; overlay.style.height = '100vh';
            overlay.style.backgroundColor = 'rgba(255, 0, 0, 0.4)';
            overlay.style.pointerEvents = 'none';
            document.body.appendChild(overlay);
            setTimeout(() => document.body.removeChild(overlay), 150);
        } else if (otherPlayers[data.id]) {
            // Another player got hit
            const p = otherPlayers[data.id];
            p.meshes.forEach(m => {
                const orig = m.material.color.getHex();
                m.material.color.setHex(0xffffff);
                setTimeout(() => m.material.color.setHex(orig), 100);
            });
        }
    });

    socket.on('playerDied', (data) => {
        if (data.killer === myId) {
            score += 100;
            scoreText.innerText = score;
            
            // Add to killfeed
            const killMsg = document.createElement('div');
            killMsg.style.color = '#ff9800';
            killMsg.style.fontWeight = 'bold';
            killMsg.style.textShadow = '1px 1px 2px black';
            killMsg.innerText = `You eliminated ${otherPlayers[data.victim]? otherPlayers[data.victim].name : 'a player'} +100`;
            killfeed.appendChild(killMsg);
            setTimeout(() => { killMsg.remove(); }, 3000);
        }
    });

    socket.on('respawn', () => {
        controls.getObject().position.set(
            (Math.random() - 0.5) * 200, 
            30, 
            (Math.random() - 0.5) * 200
        );
        velocity.set(0, 0, 0);
        
        // Reset full health UI
        healthBarFill.style.width = '100%';
        healthText.innerText = '100';
        
        // Refill Ammo
        weaponStats.forEach(w => w.ammo = w.maxAmmo);
        updateAmmoUI();
    });

    socket.on('playShootEffect', (data) => {
        const stats = weaponStats.find(w => w.name === data.weapon) || weaponStats[0];
        playShootSound(stats.sound);
    });
}

function addOtherPlayer(data) {
    if(!scene) return; // If scene not yet running
    
    const botGroup = new THREE.Group();
    
    const bodyGeo = new THREE.CylinderGeometry(2, 2, 6, 12);
    const bodyMat = new THREE.MeshPhongMaterial({color: data.color || 0x3333ff});
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 3;
    body.castShadow = true;
    
    const headGeo = new THREE.BoxGeometry(3, 3, 3);
    const headMat = new THREE.MeshPhongMaterial({color: 0xffccaa});
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 7.5;
    head.castShadow = true;

    // Visor
    const eyeGeo = new THREE.BoxGeometry(2, 0.8, 0.2);
    const eyeMat = new THREE.MeshPhongMaterial({color: 0x111111});
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(0, 0, -1.6);
    head.add(eye);
    
    botGroup.add(body);
    botGroup.add(head);
    
    botGroup.position.set(data.x, data.y, data.z);
    scene.add(botGroup);

    // Give them a nametag (using simple DOM element overlay for easy implementation without canvas textures)
    const tag = document.createElement('div');
    tag.innerText = data.name;
    tag.style.position = 'absolute';
    tag.style.color = 'white';
    tag.style.textShadow = '1px 1px 2px black';
    tag.style.pointerEvents = 'none';
    tag.style.transform = 'translate(-50%, -50%)';
    tag.style.display = 'none';
    document.body.appendChild(tag);
    
    const userData = { isPlayer: true, id: data.id };
    body.userData = { ...userData, isHead: false };
    head.userData = { ...userData, isHead: true };
    shootableObjects.push(body, head);
    
    otherPlayers[data.id] = { group: botGroup, meshes: [body, head], tag: tag };
}

// Initial calls moved inside setupMultiplayer
// init();
// animate();

function createGuns() {
    // Shared metallic material
    const metalMat = new THREE.MeshStandardMaterial({
        color: 0x444444, 
        roughness: 0.4, 
        metalness: 0.8
    });
    const darkMat = new THREE.MeshStandardMaterial({
        color: 0x111111, 
        roughness: 0.7, 
        metalness: 0.2
    });
    const accentMat = new THREE.MeshStandardMaterial({
        color: 0xff9800, 
        roughness: 0.3, 
        metalness: 0.9
    });

    // 0: Pistol (Detailed)
    const pistolGroup = new THREE.Group();
    // Slide/Barrel
    const pBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 2.2), metalMat);
    pBarrel.position.set(0, 0, -1);
    // Grip
    const pGrip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.0, 0.6), darkMat);
    pGrip.position.set(0, -0.6, 0.2);
    pGrip.rotation.x = -0.2;
    // Trigger guard
    const pGuard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.5), darkMat);
    pGuard.position.set(0, -0.4, -0.4);
    // Iron sights
    const pSight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.2), accentMat);
    pSight.position.set(0, 0.27, -1.9);
    
    pistolGroup.add(pBarrel, pGrip, pGuard, pSight);
    pistolGroup.position.set(1.5, -1.2, -2.5);
    pistolGroup.scale.set(0.8, 0.8, 0.8);
    weapons.push(pistolGroup);

    // 1: Assault Rifle (Detailed)
    const rifleGroup = new THREE.Group();
    // Main Body
    const rBody = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 3), darkMat);
    rBody.position.set(0, 0, 0);
    // Barrel extending
    const rBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.5, 8), metalMat);
    rBarrel.rotation.x = Math.PI / 2;
    rBarrel.position.set(0, 0.1, -2.5);
    // Magazine
    const rMag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.7), metalMat);
    rMag.position.set(0, -0.8, -0.3);
    rMag.rotation.x = 0.1;
    // Stock
    const rStock = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.8, 2), darkMat);
    rStock.position.set(0, -0.1, 2.5);
    // Scope Rail & Scope
    const rRail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 1.5), metalMat);
    rRail.position.set(0, 0.4, 0);
    const rScope = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.8, 12), darkMat);
    rScope.rotation.x = Math.PI / 2;
    rScope.position.set(0, 0.6, 0);
    const rScopeLens = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.81, 12), new THREE.MeshStandardMaterial({color: 0xff0000, emissive: 0x550000}));
    rScopeLens.rotation.x = Math.PI / 2;
    rScopeLens.position.set(0, 0.6, 0);

    rifleGroup.add(rBody, rBarrel, rMag, rStock, rRail, rScope, rScopeLens);
    rifleGroup.position.set(1.5, -1.3, -2.5);
    rifleGroup.scale.set(0.7, 0.7, 0.7);
    weapons.push(rifleGroup);

    // 2: Shotgun (Detailed)
    const shotgunGroup = new THREE.Group();
    // Receiver
    const sReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 2.5), darkMat);
    sReceiver.position.set(0, 0, 0.5);
    // Main Barrel
    const sBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.5, 12), metalMat);
    sBarrel.rotation.x = Math.PI / 2;
    sBarrel.position.set(0, 0.1, -2.5);
    // Under barrel tube
    const sTube = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.0, 12), darkMat);
    sTube.rotation.x = Math.PI / 2;
    sTube.position.set(0, -0.2, -2.2);
    // Pump handle
    const sPump = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.2, 8), accentMat);
    sPump.rotation.x = Math.PI / 2;
    sPump.position.set(0, -0.2, -1.5);
    // Stock
    const sStock = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 2), darkMat);
    sStock.position.set(0, -0.2, 2.5);
    sStock.rotation.x = -0.1;

    shotgunGroup.add(sReceiver, sBarrel, sTube, sPump, sStock);
    shotgunGroup.position.set(1.5, -1.5, -2.5);
    shotgunGroup.scale.set(0.7, 0.7, 0.7);
    weapons.push(shotgunGroup);

    switchWeapon(0);
}

function updateAmmoUI() {
    const stats = weaponStats[currentWeapon];
    ammoUI.innerText = `${stats.ammo} / ${stats.maxAmmo}`;
    if (stats.ammo <= 0) {
        ammoUI.style.color = '#ff5252';
    } else {
        ammoUI.style.color = 'white';
    }
}

function switchWeapon(index) {
    if(index < 0 || index >= weapons.length) return;
    weapons.forEach(w => camera.remove(w));
    currentWeapon = index;
    camera.add(weapons[currentWeapon]);
    weaponUIElement.innerText = weaponStats[index].name;
    updateAmmoUI();
}

// Bot spawning removed. Reserved for player spawning logic via multiplayer.

function buildCity() {
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    
    // create better Standard materials for buildings
    const materials = [
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.6 }),
        new THREE.MeshStandardMaterial({ color: 0x34495e, roughness: 0.9 })
    ];

    for (let i = 0; i < 60; i++) {
        const building = new THREE.Mesh(boxGeometry, materials[Math.floor(Math.random() * materials.length)]);
        
        const width = 15 + Math.random() * 40;
        const depth = 15 + Math.random() * 40;
        const height = 40 + Math.random() * 120;
        
        building.scale.set(width, height, depth);
        
        let x, z;
        do {
            x = (Math.random() - 0.5) * 800;
            z = (Math.random() - 0.5) * 800;
        } while (Math.abs(x) < 40 && Math.abs(z) < 40); // clear center area
        
        building.position.set(x, height / 2, z);
        
        // Settings control shadows on init
        building.castShadow = globalSettings.shadows;
        building.receiveShadow = globalSettings.shadows;

        scene.add(building);
        objects.push(building);
        
        // Add random cool glowing neon strips to buildings
        if(Math.random() > 0.6) {
            const neonGeo = new THREE.BoxGeometry(width + 0.2, 2, depth + 0.2);
            const neonMat = new THREE.MeshBasicMaterial({color: (Math.random() > 0.5 ? 0x00ffcc : 0xff9800) });
            const neon = new THREE.Mesh(neonGeo, neonMat);
            neon.position.set(x, Math.random() * height, z);
            scene.add(neon);
        }
    }
}

function init() {
    camera = new THREE.PerspectiveCamera(globalSettings.fov, window.innerWidth / window.innerHeight, 1, 2000);
    camera.position.y = 10;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0c12); // Night sky
    scene.fog = new THREE.FogExp2(0x0a0c12, 0.002); // Cool thick atmosphere

    const light = new THREE.HemisphereLight(0xeeeeff, 0x777788, 0.6);
    light.position.set(0.5, 1, 0.75);
    scene.add(light);
    
    const dirLight = new THREE.DirectionalLight(0xaaccff, 0.8);
    dirLight.position.set(200, 300, 100);
    dirLight.castShadow = globalSettings.shadows;
    dirLight.shadow.camera.top = 400;
    dirLight.shadow.camera.bottom = -400;
    dirLight.shadow.camera.left = -400;
    dirLight.shadow.camera.right = 400;
    dirLight.shadow.mapSize.width = 4096; // higher res shadows
    dirLight.shadow.mapSize.height = 4096;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 1000;
    scene.add(dirLight);

    // Add ambient neon underlighting to make it look sick
    const ambientNeon = new THREE.HemisphereLight(0xff9800, 0x00ffcc, 0.2);
    scene.add(ambientNeon);

    controls = new PointerLockControls(camera, document.body);

    const instructions = document.getElementById('instructions');
    const blocker = instructions; // We removed blocker in HTML

    instructions.addEventListener('click', function () {
        if(isPlaying) controls.lock();
    });

    controls.addEventListener('lock', function () {
        instructions.style.display = 'none';
    });

    controls.addEventListener('unlock', function () {
        if(isPlaying) instructions.style.display = 'flex';
    });

    scene.add(controls.getObject());

    const onKeyDown = function (event) {
        switch (event.code) {
            case 'ArrowUp': case 'KeyW': moveForward = true; break;
            case 'ArrowLeft': case 'KeyA': moveLeft = true; break;
            case 'ArrowDown': case 'KeyS': moveBackward = true; break;
            case 'ArrowRight': case 'KeyD': moveRight = true; break;
            case 'Space':
                if (canJump === true) velocity.y += 180;
                canJump = false;
                break;
            case 'Digit1': switchWeapon(0); break;
            case 'Digit2': switchWeapon(1); break;
            case 'Digit3': switchWeapon(2); break;
        }
    };

    const onKeyUp = function (event) {
        switch (event.code) {
            case 'ArrowUp': case 'KeyW': moveForward = false; break;
            case 'ArrowLeft': case 'KeyA': moveLeft = false; break;
            case 'ArrowDown': case 'KeyS': moveBackward = false; break;
            case 'ArrowRight': case 'KeyD': moveRight = false; break;
        }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);

    raycaster = new THREE.Raycaster();

    // Floor (Upgraded to look like dark concrete grid)
    const floorGeometry = new THREE.PlaneGeometry(2000, 2000);
    floorGeometry.rotateX(-Math.PI / 2);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x111111,
        roughness: 0.8,
        metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.receiveShadow = globalSettings.shadows;
    scene.add(floor);
    
    // Upgraded Grid
    const gridHelper = new THREE.GridHelper(2000, 100, 0xff9800, 0x222222);
    gridHelper.position.y = 0.1; // slightly above floor
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    buildCity();
    createGuns();

    // No initial bots (reserved for multiplayer)

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // Reload on R
    document.addEventListener('keydown', (e) => {
        if(e.code === 'KeyR' && controls.isLocked) {
            const stats = weaponStats[currentWeapon];
            if(stats.ammo < stats.maxAmmo) {
                stats.ammo = stats.maxAmmo;
                updateAmmoUI();
                
                const weaponGroup = weapons[currentWeapon];
                weaponGroup.rotation.x = -1.0;
                weaponGroup.position.y = -2;
                setTimeout(() => {
                    weaponGroup.rotation.x = 0;
                    weaponGroup.position.y = -1.5; // Default y coordinate
                }, 500);
            }
        }
    });

    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function handleShoot() {
    const stats = weaponStats[currentWeapon];
    if (stats.ammo <= 0) {
        // Play click sound (empty)
        return; 
    }

    stats.ammo--;
    updateAmmoUI();

    playShootSound(stats.sound);
    
    // Animate recoil
    const weaponGroup = weapons[currentWeapon];
    weaponGroup.position.z = -1.5;
    weaponGroup.rotation.x = 0.1;
    setTimeout(() => {
        weaponGroup.position.z = -2;
        weaponGroup.rotation.x = 0;
    }, 100);

    const bullets = stats.pellets || 1;
    for(let i=0; i<bullets; i++) {
        // Apply spread
        const dir = new THREE.Vector3(0, 0, -1);
        if(stats.spread > 0) {
            dir.x += (Math.random() - 0.5) * stats.spread;
            dir.y += (Math.random() - 0.5) * stats.spread;
        }
        dir.transformDirection(camera.matrixWorld);
        
        raycaster.set(camera.getWorldPosition(new THREE.Vector3()), dir);
        
        // We only intersect shootable objects (other players) or buildings
        const combined = [...shootableObjects, ...objects];
        const intersects = raycaster.intersectObjects(combined, false);
        
        if (intersects.length > 0) {
            const hit = intersects[0];
            const target = hit.object;
            const userData = target.userData;
            
            // Placeholder for hitting other players in multiplayer
            if (userData.isPlayer) {
                playHitSound(userData.isHead);
                const dmg = userData.isHead ? stats.damage * 2 : stats.damage;
                socket.emit('hitPlayer', { id: userData.id, damage: dmg });
            } else {
                // Hit building (could add bullet hole here)
            }
        }
    }
}

function onMouseDown(event) {
    if (!controls.isLocked) return;
    if (event.button !== 0) return; // Only left click
    
    const now = performance.now();
    const stats = weaponStats[currentWeapon];
    
    if (now - lastFireTime >= stats.fireRate) {
        lastFireTime = now;
        handleShoot();
        
        // simple auto fire for rifle
        if(currentWeapon === 1) {
            // Need a mousedown/up loop for proper auto fire, but this simplifies it
            // as one click = one burst for now. To keep it simple, one click = one shot.
        }
    }
}

// Check collision with buildings
function checkCollision(position) {
    // Simple AABB collision checking vs buildings
    const px = position.x;
    const pz = position.z;
    const radius = 3; // player radius
    
    for(let obj of objects) {
        // building AABB
        const minX = obj.position.x - obj.scale.x / 2 - radius;
        const maxX = obj.position.x + obj.scale.x / 2 + radius;
        const minZ = obj.position.z - obj.scale.z / 2 - radius;
        const maxZ = obj.position.z + obj.scale.z / 2 + radius;
        
        if (px > minX && px < maxX && pz > minZ && pz < maxZ) {
            return true;
        }
    }
    return false;
}

// Placeholder for updating other players in multiplayer
function updatePlayers(delta) {
    // Logic to interpolate other players' movements
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    if (controls.isLocked === true) {
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        velocity.y -= 9.8 * 60.0 * delta; // mass

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        const speed = 400.0 * globalSettings.sens;
        if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

        const prevPos = controls.getObject().position.clone();

        // Apply movement horizontally first
        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);
        
        // Undo if collided
        if(checkCollision(controls.getObject().position)) {
            controls.getObject().position.x = prevPos.x;
            velocity.x = 0;
            // check Z separately 
            controls.moveForward(-velocity.z * delta);
            if(checkCollision(controls.getObject().position)) {
                controls.getObject().position.z = prevPos.z;
                velocity.z = 0;
            }
        }

        // Vertical movement
        controls.getObject().position.y += (velocity.y * delta); 

        if (controls.getObject().position.y < 10) {
            velocity.y = 0;
            controls.getObject().position.y = 10;
            canJump = true;
        }
        // updatePlayers(delta) handled by socket 'playerMoved' event
        
        // Broadcast my position
        if (socket && controls.getObject()) {
            const pos = controls.getObject().position;
            const rot = camera.rotation; // Get camera rotation for pitch/yaw
            
            // Limit network spam by only sending when moved significantly (simplified here)
            socket.emit('updatePosition', {
                x: pos.x, y: pos.y, z: pos.z,
                rx: rot.x, ry: rot.y, rz: rot.z
            });
        }
    }

    // Update nametags
    if (camera) {
        for (let id in otherPlayers) {
            const p = otherPlayers[id];
            const pos = p.group.position.clone();
            pos.y += 10; // above head
            pos.project(camera);
            
            if (pos.z < 1) { // In front of camera
                const x = (pos.x * .5 + .5) * window.innerWidth;
                const y = (pos.y * -.5 + .5) * window.innerHeight;
                p.tag.style.display = 'block';
                p.tag.style.left = `${x}px`;
                p.tag.style.top = `${y}px`;
                
                // Scale text based on distance
                const dist = controls.getObject().position.distanceTo(p.group.position);
                p.tag.style.fontSize = `${Math.max(10, 300 / dist)}px`;
            } else {
                p.tag.style.display = 'none';
            }
        }
    }

    prevTime = time;
    renderer.render(scene, camera);
}
