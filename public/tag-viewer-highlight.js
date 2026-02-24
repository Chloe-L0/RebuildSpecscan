/**
 * Tag viewer area highlight (step 3, viewer-shell.tag-viewer only).
 * When user clicks a button in hotspotToolbar, the corresponding area on the
 * 3D plane is highlighted in green for 0.5s using Assets/Mask UV masks.
 * Does not modify report-3d-viewer.js.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SECTION_MASK_MAP = {
    'FWD Fuselage': 'FWDFuselage.png',
    'MID Fuselage': 'MIDFuselage.png',
    'Wings': 'Wings.png',
    'AFT Fuselage': 'AFTFuselage.png',
    'Engines': 'Engines.png',
    'Vertical Stabilizer': 'VerticalStabilizer.png',
    'Horizontal Stabilizer': 'HorizontalStabilizer.png'
};

const HIGHLIGHT_DURATION_MS = 500;
const FADE_IN_MS = 120;
const FADE_OUT_MS = 120;
const HIGHLIGHT_COLOR = new THREE.Color(0x2d5016);
const COMPOSITE_SIZE = 512;
const GREEN_CSS = 'rgb(45, 80, 22)'; // #2d5016
const VIEWER_EXPOSURE = 2;

let scene, camera, renderer, controls, model, modelBounds, directionalLight;
let originalMaterials = new Map();
let maskCache = new Map();
let animationFrameId = null;
let viewerContainer = null;
/** @type {{ phase: 'fadeIn'|'hold'|'fadeOut', startTime: number } | null} */
let highlightAnimation = null;
/** Overlay meshes (green layer on top); removed on restore */
let highlightOverlayMeshes = [];
/** One shared green-overlay texture state for intensity updates */
/** @type {{ canvas: HTMLCanvasElement, texture: THREE.CanvasTexture, maskImage: HTMLImageElement } | null} */
let highlightOverlayTextureState = null;
let modelViewerEl = null;

function loadMaskTexture(sectionName) {
    const maskFile = SECTION_MASK_MAP[sectionName];
    if (!maskFile) return Promise.resolve(null);
    if (maskCache.has(sectionName)) return Promise.resolve(maskCache.get(sectionName));

    return new Promise((resolve) => {
        const loader = new THREE.TextureLoader();
        loader.load(
            `/assets/Mask/${maskFile}`,
            (texture) => {
                texture.flipY = false;
                texture.wrapS = THREE.ClampToEdgeWrapping;
                texture.wrapT = THREE.ClampToEdgeWrapping;
                texture.minFilter = THREE.LinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.needsUpdate = true;
                maskCache.set(sectionName, texture);
                resolve(texture);
            },
            undefined,
            () => resolve(null)
        );
    });
}

function getImageFromTexture(texture) {
    return texture && texture.image && texture.image.width ? texture.image : null;
}

function colorToCss(color) {
    const r = Math.round(Math.max(0, Math.min(1, color.r)) * 255);
    const g = Math.round(Math.max(0, Math.min(1, color.g)) * 255);
    const b = Math.round(Math.max(0, Math.min(1, color.b)) * 255);
    return `rgb(${r},${g},${b})`;
}

/** Create a canvas with alpha = mask luminance (white in mask = opaque, black = transparent) for UV-accurate masking. */
function createMaskAlphaCanvas(maskImage, w, h) {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    const mctx = maskCanvas.getContext('2d');
    if (!mctx) return null;
    mctx.drawImage(maskImage, 0, 0, w, h);
    const imgData = mctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luminance = Math.min(255, (r + g + b) / 3);
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = luminance;
    }
    mctx.putImageData(imgData, 0, 0);
    return maskCanvas;
}

/** Green-only overlay texture: transparent everywhere, green (with alpha = intensity) only where Assets/Mask is white. Layers on top of original UV. */
function createGreenOverlayTexture(maskImage, intensity) {
    const w = COMPOSITE_SIZE;
    const h = COMPOSITE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { canvas, texture: new THREE.CanvasTexture(canvas) };

    ctx.clearRect(0, 0, w, h);
    if (maskImage && maskImage.complete && maskImage.naturalWidth > 0 && intensity > 0) {
        const maskAlpha = createMaskAlphaCanvas(maskImage, w, h);
        if (maskAlpha) {
            const temp = document.createElement('canvas');
            temp.width = w;
            temp.height = h;
            const tctx = temp.getContext('2d');
            if (tctx) {
                tctx.fillStyle = GREEN_CSS;
                tctx.fillRect(0, 0, w, h);
                tctx.globalCompositeOperation = 'destination-in';
                tctx.drawImage(maskAlpha, 0, 0, w, h);
                tctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = intensity;
                ctx.drawImage(temp, 0, 0, w, h);
                ctx.globalAlpha = 1;
            }
        }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = false;
    texture.needsUpdate = true;
    return { canvas, texture };
}

function updateGreenOverlayTexture(state, intensity) {
    const { canvas, texture, maskImage } = state;
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (maskImage && maskImage.complete && maskImage.naturalWidth > 0 && intensity > 0) {
        const maskAlpha = createMaskAlphaCanvas(maskImage, w, h);
        if (maskAlpha) {
            const temp = document.createElement('canvas');
            temp.width = w;
            temp.height = h;
            const tctx = temp.getContext('2d');
            if (tctx) {
                tctx.fillStyle = GREEN_CSS;
                tctx.fillRect(0, 0, w, h);
                tctx.globalCompositeOperation = 'destination-in';
                tctx.drawImage(maskAlpha, 0, 0, w, h);
                tctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = intensity;
                ctx.drawImage(temp, 0, 0, w, h);
                ctx.globalAlpha = 1;
            }
        }
    }
    texture.needsUpdate = true;
}

function storeOriginalMaterials(mesh) {
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    originalMaterials.set(mesh, materials.map((m) => m.clone()));
}

function restoreOriginalMaterials() {
    highlightOverlayMeshes.forEach((overlay) => {
        if (overlay.parent) overlay.parent.remove(overlay);
        overlay.material?.dispose?.();
    });
    highlightOverlayMeshes = [];
    if (highlightOverlayTextureState) {
        highlightOverlayTextureState.texture.dispose();
        highlightOverlayTextureState = null;
    }
    highlightAnimation = null;
}

function applyHighlightMaterial(maskTexture) {
    if (!maskTexture) return;
    const maskImage = getImageFromTexture(maskTexture);
    if (!maskImage) return;
    restoreOriginalMaterials();
    const { canvas, texture } = createGreenOverlayTexture(maskImage, 0);
    highlightOverlayTextureState = { canvas, texture, maskImage };
    const overlayMat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide
    });
    model.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;
        const overlayMesh = new THREE.Mesh(child.geometry, overlayMat.clone());
        overlayMesh.renderOrder = 1;
        overlayMesh.matrix.copy(child.matrix);
        overlayMesh.matrixAutoUpdate = false;
        const parent = child.parent;
        if (parent) parent.add(overlayMesh);
        highlightOverlayMeshes.push(overlayMesh);
    });
    highlightAnimation = { phase: 'fadeIn', startTime: performance.now() };
}

function getModelBounds(m) {
    const box = new THREE.Box3().setFromObject(m);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    return { box, center, size, maxDim };
}

function loadModel() {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
            '/assets/plane.glb',
            (gltf) => resolve(gltf.scene),
            undefined,
            (err) => reject(err)
        );
    });
}

function initViewer() {
    viewerContainer = document.getElementById('viewerShell');
    modelViewerEl = document.getElementById('areaViewer');
    const toolbar = document.getElementById('hotspotToolbar');
    if (!viewerContainer || !viewerContainer.classList.contains('tag-viewer') || !toolbar) return;

    modelViewerEl.style.setProperty('display', 'none');
    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'tag-viewer-three-wrapper';
    canvasWrapper.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    viewerContainer.style.position = 'relative';
    const overlay = document.getElementById('hotspotLayer');
    if (overlay) {
        viewerContainer.insertBefore(canvasWrapper, overlay);
    } else {
        viewerContainer.appendChild(canvasWrapper);
    }

    const width = viewerContainer.clientWidth || 400;
    const height = viewerContainer.clientHeight || 400;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f5f5);
    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(1, 1, 1);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = VIEWER_EXPOSURE;
    canvasWrapper.appendChild(renderer.domElement);
    

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.5;
    controls.maxDistance = 3;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 5);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 1024;
    dir.shadow.mapSize.height = 1024;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 50;
    dir.shadow.camera.left = -5;
    dir.shadow.camera.right = 5;
    dir.shadow.camera.top = 5;
    dir.shadow.camera.bottom = -5;
    dir.shadow.bias = -0.0001;
    scene.add(dir);
    directionalLight = dir;

    loadModel()
        .then((loadedModel) => {
            model = loadedModel;
            modelBounds = getModelBounds(model);
            const scale = 2 / modelBounds.maxDim;
            model.scale.multiplyScalar(scale);
            model.position.sub(modelBounds.center.multiplyScalar(scale));
            modelBounds = getModelBounds(model);

            model.traverse((child) => {
                storeOriginalMaterials(child);
                if (child.isMesh) child.receiveShadow = true;
            });
            scene.add(model);

            const buttons = toolbar.querySelectorAll('.area-hotspot');
            buttons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    const area = btn.getAttribute('data-area');
                    if (!area || !SECTION_MASK_MAP[area]) return;
                    loadMaskTexture(area).then((tex) => {
                        if (!tex) return;
                        applyHighlightMaterial(tex);
                    });
                });
            });
        })
        .catch((err) => console.warn('Tag viewer highlight: failed to load plane model', err));

    const HOLD_MS = Math.max(0, HIGHLIGHT_DURATION_MS - FADE_IN_MS - FADE_OUT_MS);

    function animate() {
        animationFrameId = requestAnimationFrame(animate);
        controls.update();
        if (highlightAnimation && highlightOverlayTextureState) {
            const now = performance.now();
            const elapsed = now - highlightAnimation.startTime;
            let intensity = 0;
            if (highlightAnimation.phase === 'fadeIn') {
                intensity = Math.min(1, elapsed / FADE_IN_MS);
                updateGreenOverlayTexture(highlightOverlayTextureState, intensity);
                if (intensity >= 1) {
                    highlightAnimation.phase = 'hold';
                    highlightAnimation.startTime = now;
                }
            } else if (highlightAnimation.phase === 'hold') {
                updateGreenOverlayTexture(highlightOverlayTextureState, 1);
                if (elapsed >= HOLD_MS) {
                    highlightAnimation.phase = 'fadeOut';
                    highlightAnimation.startTime = now;
                }
            } else if (highlightAnimation.phase === 'fadeOut') {
                intensity = Math.max(0, 1 - elapsed / FADE_OUT_MS);
                updateGreenOverlayTexture(highlightOverlayTextureState, intensity);
                if (intensity <= 0) restoreOriginalMaterials();
            }
        }
        renderer.render(scene, camera);
    }
    animate();

    const onResize = () => {
        const w = viewerContainer.clientWidth;
        const h = viewerContainer.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initViewer);
} else {
    initViewer();
}
