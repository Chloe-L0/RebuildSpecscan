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
const HIGHLIGHT_COLOR = new THREE.Color(0.2, 0.85, 0.35);

let scene, camera, renderer, controls, model, modelBounds;
let originalMaterials = new Map();
let maskCache = new Map();
let animationFrameId = null;
let highlightTimeoutId = null;
let viewerContainer = null;
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

function createHighlightMaterial(originalMaterial, maskTexture) {
    let originalMap = null;
    let baseColor = new THREE.Color(1, 1, 1);
    if (originalMaterial) {
        if (originalMaterial.color) baseColor = originalMaterial.color.clone();
        if (originalMaterial.map) originalMap = originalMaterial.map;
    }

    const hasTexture = originalMap !== null;
    return new THREE.ShaderMaterial({
        uniforms: {
            u_baseColor: { value: baseColor },
            u_highlightColor: { value: HIGHLIGHT_COLOR },
            u_mask: { value: maskTexture },
            ...(hasTexture ? { u_originalTexture: { value: originalMap } } : {})
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 u_baseColor;
            uniform vec3 u_highlightColor;
            uniform sampler2D u_mask;
            ${hasTexture ? 'uniform sampler2D u_originalTexture;' : ''}
            varying vec2 vUv;
            void main() {
                vec3 base = u_baseColor;
                ${hasTexture ? `
                vec4 texColor = texture2D(u_originalTexture, vUv);
                base = mix(base, texColor.rgb, 0.7);
                ` : ''}
                vec4 mask = texture2D(u_mask, vUv);
                float m = mask.r;
                vec3 finalColor = mix(base, u_highlightColor, m);
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        side: originalMaterial?.side ?? THREE.FrontSide,
        transparent: originalMaterial?.transparent ?? false,
        opacity: originalMaterial?.opacity ?? 1.0
    });
}

function storeOriginalMaterials(mesh) {
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    originalMaterials.set(mesh, materials.map((m) => m.clone()));
}

function restoreOriginalMaterials() {
    model.traverse((child) => {
        if (child.isMesh && originalMaterials.has(child)) {
            const mats = originalMaterials.get(child);
            child.material = mats.length === 1 ? mats[0] : mats;
        }
    });
}

function applyHighlightMaterial(maskTexture) {
    if (!maskTexture) return;
    model.traverse((child) => {
        if (child.isMesh && child.material) {
            const orig = originalMaterials.get(child);
            const origMat = orig ? (orig.length === 1 ? orig[0] : orig[0]) : child.material;
            child.material = createHighlightMaterial(origMat, maskTexture);
        }
    });
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
    scene.add(dir);

    loadModel()
        .then((loadedModel) => {
            model = loadedModel;
            modelBounds = getModelBounds(model);
            const scale = 2 / modelBounds.maxDim;
            model.scale.multiplyScalar(scale);
            model.position.sub(modelBounds.center.multiplyScalar(scale));
            modelBounds = getModelBounds(model);

            model.traverse((child) => storeOriginalMaterials(child));
            scene.add(model);

            const buttons = toolbar.querySelectorAll('.area-hotspot');
            buttons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    const area = btn.getAttribute('data-area');
                    if (!area || !SECTION_MASK_MAP[area]) return;
                    if (highlightTimeoutId) {
                        clearTimeout(highlightTimeoutId);
                        highlightTimeoutId = null;
                    }
                    loadMaskTexture(area).then((tex) => {
                        if (!tex) return;
                        applyHighlightMaterial(tex);
                        highlightTimeoutId = setTimeout(() => {
                            restoreOriginalMaterials();
                            highlightTimeoutId = null;
                        }, HIGHLIGHT_DURATION_MS);
                    });
                });
            });
        })
        .catch((err) => console.warn('Tag viewer highlight: failed to load plane model', err));

    function animate() {
        animationFrameId = requestAnimationFrame(animate);
        controls.update();
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
