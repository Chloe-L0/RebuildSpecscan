import { readState } from './state.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const viewerContainer = document.getElementById('report3DViewer');
if (!viewerContainer) {
    // Container not found, viewer won't be shown (this is okay if section is hidden)
} else {
    let scene, camera, renderer, controls, model, maskTexture;
    let animationFrameId = null;
    let resizeHandler = null;

    // Calculate color based on defect count
    const calculateColor = (defectCount) => {
        if (defectCount === 0) {
            return new THREE.Color(1, 1, 1); // White: rgb(255, 255, 255)
        } else if (defectCount >= 10) {
            return new THREE.Color(255 / 255, 50 / 255, 0 / 255); // Red: rgb(255, 50, 0)
        } else {
            // Linear interpolation for 1-9 defects
            const factor = defectCount / 10;
            const r = 255;
            const g = 255 - 205 * factor; // 255 -> 50
            const b = 255 - 255 * factor; // 255 -> 0
            return new THREE.Color(r / 255, g / 255, b / 255);
        }
    };

    // Create custom shader material that uses the mask
    const createMaskedMaterial = (originalMaterial, maskTexture, color) => {
        // Determine base color from original material
        let baseColor = new THREE.Color(1, 1, 1);
        let originalMap = null;
        
        if (originalMaterial) {
            if (originalMaterial.color) {
                baseColor = originalMaterial.color.clone();
            }
            if (originalMaterial.map) {
                originalMap = originalMaterial.map;
            }
        }

        const uniforms = {
            u_mask: { value: maskTexture },
            u_color: { value: color },
            u_baseColor: { value: baseColor },
            u_intensity: { value: 1.0 }, // Full intensity for mask-based blending
            u_originalTexture: { value: originalMap } // Will be null if no texture
        };

        // Build fragment shader based on whether we have a texture
        const hasTexture = originalMap !== null;
        const fragmentShader = `
            uniform sampler2D u_mask;
            uniform vec3 u_color;
            uniform vec3 u_baseColor;
            uniform float u_intensity;
            ${hasTexture ? 'uniform sampler2D u_originalTexture;' : ''}
            varying vec2 vUv;
            
            void main() {
                vec4 mask = texture2D(u_mask, vUv);
                float maskValue = mask.r; // Use red channel for grayscale mask
                
                // Get base color (from texture if available, otherwise from uniform)
                vec3 base = u_baseColor;
                ${hasTexture ? `
                vec4 texColor = texture2D(u_originalTexture, vUv);
                base = mix(base, texColor.rgb, 0.7); // Blend texture with base color
                ` : ''}
                
                // Blend the visualization color based on mask value
                // White areas (maskValue = 1.0) get full visualization color
                // Black areas (maskValue = 0.0) keep original color
                // Grayscale areas get smooth interpolation
                vec3 finalColor = mix(base, u_color, maskValue * u_intensity);
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;

        return new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: fragmentShader
        });
    };

    // Load mask texture
    const loadMaskTexture = () => {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                '/assets/Mask/Engines.png',
                (texture) => {
                    texture.flipY = false;
                    texture.wrapS = THREE.ClampToEdgeWrapping;
                    texture.wrapT = THREE.ClampToEdgeWrapping;
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.needsUpdate = true;
                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.error('Failed to load mask texture:', error);
                    reject(error);
                }
            );
        });
    };

    // Load GLB model
    const loadModel = () => {
        return new Promise((resolve, reject) => {
            const loader = new GLTFLoader();
            loader.load(
                '/assets/plane.glb',
                (gltf) => {
                    resolve(gltf.scene);
                },
                undefined,
                (error) => {
                    console.error('Failed to load model:', error);
                    reject(error);
                }
            );
        });
    };

    // Apply visualization to the model
    const applyVisualization = (model, maskTexture, color) => {
        model.traverse((child) => {
            if (child.isMesh) {
                const originalMaterial = child.material;
                
                // Create masked material with original material info
                const maskedMaterial = createMaskedMaterial(originalMaterial, maskTexture, color);
                
                // Preserve some properties from original material
                if (originalMaterial) {
                    maskedMaterial.side = originalMaterial.side !== undefined ? originalMaterial.side : THREE.FrontSide;
                    maskedMaterial.transparent = originalMaterial.transparent || false;
                    maskedMaterial.opacity = originalMaterial.opacity !== undefined ? originalMaterial.opacity : 1.0;
                }
                
                child.material = maskedMaterial;
            }
        });
    };

    // Count defects for a specific area, filtering by confidence threshold
    const countDefectsByArea = (state, area) => {
        const threshold = state.analysis.threshold || 0.5;
        let count = 0;
        
        state.detections.forEach((detection) => {
            const photo = state.photos.find((p) => p.id === detection.photoId);
            if (photo?.area === area) {
                // Skip false positives
                if (detection.falsePositive) return;
                
                // Manual detections always count (they bypass threshold)
                if (detection.manual) {
                    count++;
                    return;
                }
                
                // Filter by confidence threshold
                if (typeof detection.confidence === 'number') {
                    if (detection.confidence >= threshold) {
                        count++;
                    }
                } else {
                    // If no confidence value, don't count it (unless it's manual)
                    // This matches the filterDetections logic from results.js
                }
            }
        });
        
        return count;
    };

    // Initialize the 3D viewer
    const initViewer = async () => {
        try {
            // Get defect count for Engines, filtered by confidence threshold
            const state = readState();
            const enginesDefectCount = countDefectsByArea(state, 'Engines');
            
            // Calculate color based on defect count
            const color = calculateColor(enginesDefectCount);
            
            // Set up scene
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0xf5f5f5);

            // Set up camera
            const width = viewerContainer.clientWidth;
            const height = Math.max(400, viewerContainer.clientHeight || 400);
            camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
            camera.position.set(5, 5, 5);
            camera.lookAt(0, 0, 0);

            // Set up renderer
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(width, height);
            renderer.setPixelRatio(window.devicePixelRatio);
            viewerContainer.appendChild(renderer.domElement);

            // Set up controls
            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.minDistance = 2;
            controls.maxDistance = 20;

            // Add lights
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambientLight);
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(5, 10, 5);
            scene.add(directionalLight);

            // Load mask and model
            maskTexture = await loadMaskTexture();
            model = await loadModel();

            // Apply visualization
            applyVisualization(model, maskTexture, color);

            // Add model to scene
            scene.add(model);

            // Center and scale model
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 2 / maxDim;
            model.scale.multiplyScalar(scale);
            model.position.sub(center.multiplyScalar(scale));

            // Start animation loop
            const animate = () => {
                animationFrameId = requestAnimationFrame(animate);
                controls.update();
                renderer.render(scene, camera);
            };
            animate();

            // Handle window resize
            resizeHandler = () => {
                const newWidth = viewerContainer.clientWidth;
                const newHeight = Math.max(400, viewerContainer.clientHeight || 400);
                camera.aspect = newWidth / newHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(newWidth, newHeight);
            };
            window.addEventListener('resize', resizeHandler);

        } catch (error) {
            console.error('Failed to initialize 3D viewer:', error);
            viewerContainer.innerHTML = '<p class="muted">Failed to load 3D visualization.</p>';
        }
    };

    // Cleanup function
    const cleanup = () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        if (resizeHandler) {
            window.removeEventListener('resize', resizeHandler);
        }
        if (controls) {
            controls.dispose();
        }
        if (renderer) {
            renderer.dispose();
        }
        if (maskTexture) {
            maskTexture.dispose();
        }
        if (model) {
            model.traverse((child) => {
                if (child.isMesh && child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
                if (child.geometry) {
                    child.geometry.dispose();
                }
            });
        }
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initViewer);
    } else {
        initViewer();
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', cleanup);
}
