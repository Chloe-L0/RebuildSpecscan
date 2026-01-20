import { readState } from './state.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const viewerContainer = document.getElementById('report3DViewer');

// Global state for 3D viewer
let scene, camera, renderer, controls, model, sectionTextures = {}, modelBounds = null;
let animationFrameId = null;
let resizeHandler = null;
let viewerReady = false;

// Section name to mask filename mapping
const SECTION_MASK_MAP = {
    'FWD Fuselage': 'FWDFuselage.png',
    'MID Fuselage': 'MIDFuselage.png',
    'Wings': 'Wings.png',
    'AFT Fuselage': 'AFTFuselage.png',
    'Engines': 'Engines.png',
    'Vertical Stabilizer': 'VerticalStabilizer.png',
    'Horizontal Stabilizer': 'HorizontalStabilizer.png'
};

// Section colors at 10+ defects (RGB values)
const SECTION_MAX_COLORS = {
    'FWD Fuselage': { r: 0, g: 102, b: 76 },      // rgb(0, 102, 76)
    'MID Fuselage': { r: 25, g: 102, b: 0 },      // rgb(25, 102, 0)
    'Wings': { r: 0, g: 31, b: 102 },             // rgb(0, 31, 102)
    'AFT Fuselage': { r: 102, g: 0, b: 0 },        // rgb(102, 0, 0)
    'Engines': { r: 83, g: 0, b: 102 },            // rgb(83, 0, 102)
    'Vertical Stabilizer': { r: 102, g: 57, b: 0 }, // rgb(102, 57, 0)
    'Horizontal Stabilizer': { r: 99, g: 102, b: 0 } // rgb(99, 102, 0)
};

// Convert hex color to THREE.Color
const hexToColor = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return new THREE.Color(r, g, b);
};

// Calculate heat mapping color based on defect count for a specific section
const calculateHeatColor = (defectCount, sectionName) => {
    // All sections start at white (255, 255, 255) for 0 defects
    if (defectCount === 0) {
        return new THREE.Color(1, 1, 1); // White: rgb(255, 255, 255)
    }
    
    // Get the section's max color (at 10+ defects)
    const maxColor = SECTION_MAX_COLORS[sectionName];
    if (!maxColor) {
        // Fallback to white if section not found
        return new THREE.Color(1, 1, 1);
    }
    
    if (defectCount >= 10) {
        // At 10+ defects, use the section's specific color
        return new THREE.Color(maxColor.r / 255, maxColor.g / 255, maxColor.b / 255);
    } else {
        // Linear interpolation for 1-9 defects between white and section max color
        const factor = defectCount / 10;
        const r = (255 - (255 - maxColor.r) * factor) / 255;
        const g = (255 - (255 - maxColor.g) * factor) / 255;
        const b = (255 - (255 - maxColor.b) * factor) / 255;
        return new THREE.Color(r, g, b);
    }
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
            }
        }
    });
    
    return count;
};

// Load mask texture for a section
// Only attempts to load if section is in SECTION_MASK_MAP (only Engines currently)
const loadMaskTexture = (sectionName) => {
    const maskFile = SECTION_MASK_MAP[sectionName];
    if (!maskFile) {
        // Section not in mask map - mask not ready yet, return null silently
        return Promise.resolve(null);
    }
    
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
                resolve(texture);
            },
            undefined,
            (error) => {
                // Log error for sections that should have masks but failed to load
                console.error(`Failed to load mask for ${sectionName} (${maskFile}):`, error);
                resolve(null);
            }
        );
    });
};

// Create custom shader material that uses base color and heat mapping
const createSectionMaterial = (originalMaterial, baseColor, heatColor, maskTexture) => {
    let originalMap = null;
    let originalBaseColor = new THREE.Color(1, 1, 1);
    
    if (originalMaterial) {
        if (originalMaterial.color) {
            originalBaseColor = originalMaterial.color.clone();
        }
        if (originalMaterial.map) {
            originalMap = originalMaterial.map;
        }
    }

    const hasMask = maskTexture !== null;
    const hasTexture = originalMap !== null;
    
    const uniforms = {
        u_baseColor: { value: baseColor },
        u_heatColor: { value: heatColor },
        u_originalBaseColor: { value: originalBaseColor },
        u_heatIntensity: { value: 1.0 },
        ...(hasMask ? { u_mask: { value: maskTexture } } : {}),
        ...(hasTexture ? { u_originalTexture: { value: originalMap } } : {})
    };

    const fragmentShader = `
        uniform vec3 u_baseColor;
        uniform vec3 u_heatColor;
        uniform vec3 u_originalBaseColor;
        uniform float u_heatIntensity;
        ${hasMask ? 'uniform sampler2D u_mask;' : ''}
        ${hasTexture ? 'uniform sampler2D u_originalTexture;' : ''}
        varying vec2 vUv;
        
        void main() {
            // Start with original texture or base color
            vec3 base = u_originalBaseColor;
            ${hasTexture ? `
            vec4 texColor = texture2D(u_originalTexture, vUv);
            base = mix(base, texColor.rgb, 0.7);
            ` : ''}
            
            ${hasMask ? `
            // Apply section mask - only apply section color where mask is white
            vec4 mask = texture2D(u_mask, vUv);
            float maskValue = mask.r;
            
            // Blend base section color with original color based on mask
            vec3 sectionedColor = mix(base, u_baseColor, maskValue * 0.8);
            
            // Apply heat mapping on top (heat color tints the section color)
            // White heat color (no defects) = no tint
            // Colored heat color (defects) = tints the section
            vec3 heatTint = mix(vec3(1.0), u_heatColor, maskValue * u_heatIntensity);
            vec3 finalColor = sectionedColor * heatTint;
            ` : `
            // No mask - use original color with slight heat tint globally
            vec3 heatTint = mix(vec3(1.0), u_heatColor, 0.1 * u_heatIntensity);
            vec3 finalColor = base * heatTint;
            `}
            
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
        fragmentShader: fragmentShader,
        side: originalMaterial?.side !== undefined ? originalMaterial.side : THREE.FrontSide,
        transparent: originalMaterial?.transparent || false,
        opacity: originalMaterial?.opacity !== undefined ? originalMaterial.opacity : 1.0
    });
};

// Apply visualization to all sections
const applyVisualization = async (model, state) => {
    // Get all inspected areas (sections that have tagged photos)
    const inspectedAreas = new Set(
        state.photos
            .filter(photo => photo.area) // Only photos with assigned area
            .map(photo => photo.area)
    );
    
    // Process all sections that have masks available
    // Apply visualization to all sections with masks, regardless of inspection status
    // Uninspected sections will show with their base color and no heat mapping (white heat = no tint)
    const sectionsWithMasksAvailable = Object.keys(SECTION_MASK_MAP);
    
    // Collect all sections with masks, their defect counts, and heat colors
    const sections = sectionsWithMasksAvailable.map(area => ({
        name: area,
        defectCount: countDefectsByArea(state, area),
        heatColor: calculateHeatColor(countDefectsByArea(state, area), area)
    }));

    // Load masks for all sections
    const maskPromises = sections.map(section => 
        loadMaskTexture(section.name).then(texture => ({ ...section, maskTexture: texture }))
    );
    const sectionsWithMasks = await Promise.all(maskPromises);

    // Create a combined material that applies all section masks
    // We'll create a shader that blends all sections together
    const createCombinedSectionMaterial = (originalMaterial, sectionsWithMasks) => {
        let originalMap = null;
        let originalBaseColor = new THREE.Color(1, 1, 1);
        
        if (originalMaterial) {
            if (originalMaterial.color) {
                originalBaseColor = originalMaterial.color.clone();
            }
            if (originalMaterial.map) {
                originalMap = originalMaterial.map;
            }
        }

        const hasTexture = originalMap !== null;
        const validSections = sectionsWithMasks.filter(s => s.maskTexture !== null);
        
        // Build uniforms for all sections
        const uniforms = {
            u_originalBaseColor: { value: originalBaseColor },
            u_heatIntensity: { value: 1.0 },
            ...(hasTexture ? { u_originalTexture: { value: originalMap } } : {})
        };
        
        // Add uniforms for each section
        validSections.forEach((section, index) => {
            uniforms[`u_mask_${index}`] = { value: section.maskTexture };
            uniforms[`u_heatColor_${index}`] = { value: section.heatColor };
        });
        
        uniforms.u_sectionCount = { value: validSections.length };

        // Build fragment shader that applies heat colors based on masks
        const fragmentShader = `
            uniform vec3 u_originalBaseColor;
            uniform float u_heatIntensity;
            uniform int u_sectionCount;
            ${hasTexture ? 'uniform sampler2D u_originalTexture;' : ''}
            ${validSections.map((_, i) => `
                uniform sampler2D u_mask_${i};
                uniform vec3 u_heatColor_${i};
            `).join('')}
            varying vec2 vUv;
            
            void main() {
                // Start with original texture or base color
                vec3 base = u_originalBaseColor;
                ${hasTexture ? `
                vec4 texColor = texture2D(u_originalTexture, vUv);
                base = mix(base, texColor.rgb, 0.7);
                ` : ''}
                
                vec3 finalColor = base;
                
                // Apply each section mask - blend heat color only where mask is white
                // White areas (maskValue = 1.0) get full heat color
                // Black areas (maskValue = 0.0) keep original color
                // Grayscale areas get smooth interpolation
                ${validSections.map((_, i) => `
                {
                    vec4 mask_${i} = texture2D(u_mask_${i}, vUv);
                    float maskValue_${i} = mask_${i}.r;
                    
                    // Blend heat color based on mask value
                    finalColor = mix(finalColor, u_heatColor_${i}, maskValue_${i} * u_heatIntensity);
                }
                `).join('')}
                
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
            fragmentShader: fragmentShader,
            side: originalMaterial?.side !== undefined ? originalMaterial.side : THREE.FrontSide,
            transparent: originalMaterial?.transparent || false,
            opacity: originalMaterial?.opacity !== undefined ? originalMaterial.opacity : 1.0
        });
    };

    // Apply materials to model
    model.traverse((child) => {
        if (child.isMesh) {
            const originalMaterial = child.material;
            
            // Create combined material with all sections
            const combinedMaterial = createCombinedSectionMaterial(originalMaterial, sectionsWithMasks);
            
            child.material = combinedMaterial;
        }
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

// Get model bounding box for camera positioning
const getModelBounds = (model) => {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    return { box, center, size, maxDim };
};

// Capture screenshot from current camera position
const captureScreenshot = () => {
    if (!renderer || !scene || !camera) {
        return null;
    }
    
    // Render one frame
    controls.update();
    renderer.render(scene, camera);
    
    // Capture canvas as data URL
    return renderer.domElement.toDataURL('image/png');
};

// Capture technical reference views (Top, Side, Front)
const captureTechnicalViews = async () => {
    if (!viewerReady || !model || !scene || !camera || !renderer || !controls) {
        console.warn('3D viewer not ready for screenshot capture');
        return { top: null, side: null, front: null };
    }

    const state = readState();
    
    // Store original camera state
    const originalPosition = camera.position.clone();
    const originalTarget = controls.target.clone();
    const originalAutoRotate = controls.autoRotate;
    
    // Disable auto-rotate if active
    controls.autoRotate = false;
    
    // Get model bounds if not already calculated
    if (!modelBounds) {
        modelBounds = getModelBounds(model);
    }
    
    const { center, maxDim } = modelBounds;
    const distance = maxDim * 1.5; // Distance from model
    
    const views = {};
    
    try {
        // Top View - Camera above looking down
        camera.position.set(center.x, center.y + distance, center.z);
        camera.lookAt(center);
        controls.target.copy(center);
        controls.update();
        await new Promise(resolve => setTimeout(resolve, 150)); // Wait for render
        renderer.render(scene, camera);
        views.top = captureScreenshot();
        
        // Side View - Camera to the side
        camera.position.set(center.x + distance, center.y, center.z);
        camera.lookAt(center);
        controls.target.copy(center);
        controls.update();
        await new Promise(resolve => setTimeout(resolve, 150));
        renderer.render(scene, camera);
        views.side = captureScreenshot();
        
        // Front View - Camera in front
        camera.position.set(center.x, center.y, center.z + distance);
        camera.lookAt(center);
        controls.target.copy(center);
        controls.update();
        await new Promise(resolve => setTimeout(resolve, 150));
        renderer.render(scene, camera);
        views.front = captureScreenshot();
    } catch (error) {
        console.error('Error capturing technical views:', error);
    } finally {
        // Restore original camera state
        camera.position.copy(originalPosition);
        controls.target.copy(originalTarget);
        controls.autoRotate = originalAutoRotate;
        controls.update();
        renderer.render(scene, camera);
    }
    
    return views;
};

// Initialize the 3D viewer
const initViewer = async () => {
    if (!viewerContainer) {
        return;
    }
    
    try {
        const state = readState();
        
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

        // Load model
        model = await loadModel();
        
        // Calculate and store model bounds
        modelBounds = getModelBounds(model);
        
        // Center and scale model
        const scale = 2 / modelBounds.maxDim;
        model.scale.multiplyScalar(scale);
        model.position.sub(modelBounds.center.multiplyScalar(scale));
        
        // Recalculate bounds after scaling
        modelBounds = getModelBounds(model);

        // Apply visualization with sections and heat mapping
        await applyVisualization(model, state);

        // Add model to scene
        scene.add(model);

        // Start animation loop
        const animate = () => {
            animationFrameId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();
        
        viewerReady = true;

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
        if (viewerContainer) {
            viewerContainer.innerHTML = '<p class="muted">Failed to load 3D visualization.</p>';
        }
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
    Object.values(sectionTextures).forEach(texture => {
        if (texture && texture.dispose) texture.dispose();
    });
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
    viewerReady = false;
};

// Initialize when DOM is ready
if (viewerContainer) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initViewer);
    } else {
        initViewer();
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', cleanup);
}

// Export function for PDF generation
window.captureTechnicalViews = captureTechnicalViews;
