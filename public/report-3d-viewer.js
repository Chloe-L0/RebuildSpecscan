import { readState } from './state.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let viewerContainer = null;

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

// Convert hex color to THREE.Color
const hexToColor = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return new THREE.Color(r, g, b);
};

// Calculate heat mapping color based on defect count
// All sections use the same color scheme:
// >20 defects: red (255, 0, 0)
// 10 defects: yellow (255, 186, 0)
// 3 defects: green (70, 255, 58)
// 0 defects: white (255, 255, 255)
// Gradient: red -> yellow -> green -> white as defects decrease
const calculateHeatColor = (defectCount, sectionName) => {
    // All sections start at white (255, 255, 255) for 0 defects
    if (defectCount === 0) {
        return new THREE.Color(1, 1, 1); // White: rgb(255, 255, 255)
    }
    
    // Color definitions (RGB 0-255)
    const red = { r: 255, g: 0, b: 0 };        // >20 defects
    const yellow = { r: 255, g: 186, b: 0 };   // 10 defects
    const green = { r: 70, g: 255, b: 58 };    // 3 defects
    const white = { r: 255, g: 255, b: 255 };  // 0 defects
    
    let r, g, b;
    
    if (defectCount > 20) {
        // More than 20 defects: red
        r = red.r / 255;
        g = red.g / 255;
        b = red.b / 255;
    } else if (defectCount >= 10) {
        // 10 to 20 defects: gradient from yellow to red
        const factor = (defectCount - 10) / 10; // 0 at 10 defects, 1 at 20 defects
        r = (yellow.r + (red.r - yellow.r) * factor) / 255;
        g = (yellow.g + (red.g - yellow.g) * factor) / 255;
        b = (yellow.b + (red.b - yellow.b) * factor) / 255;
    } else if (defectCount >= 3) {
        // 3 to 10 defects: gradient from green to yellow
        const factor = (defectCount - 3) / 7; // 0 at 3 defects, 1 at 10 defects
        r = (green.r + (yellow.r - green.r) * factor) / 255;
        g = (green.g + (yellow.g - green.g) * factor) / 255;
        b = (green.b + (yellow.b - green.b) * factor) / 255;
    } else {
        // 1 to 3 defects: gradient from white to green
        const factor = defectCount / 3; // 0 at 0 defects, 1 at 3 defects
        r = (white.r + (green.r - white.r) * factor) / 255;
        g = (white.g + (green.g - white.g) * factor) / 255;
        b = (white.b + (green.b - white.b) * factor) / 255;
    }
    
    return new THREE.Color(r, g, b);
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
                base = texColor.rgb;
                ` : ''}
                
                vec3 finalColor = base;
                
                // Apply each section mask - replace with heat color where mask is active
                // White areas (maskValue = 1.0) get full heat color
                // Black areas (maskValue = 0.0) keep original material color
                // Grayscale areas get smooth interpolation
                ${validSections.map((_, i) => `
                {
                    vec4 mask_${i} = texture2D(u_mask_${i}, vUv);
                    float maskValue_${i} = mask_${i}.r;
                    
                    // Check if heat color is white (no defects) - if so, keep original color
                    vec3 heatColor_${i} = u_heatColor_${i};
                    float isWhite_${i} = step(0.99, heatColor_${i}.r) * step(0.99, heatColor_${i}.g) * step(0.99, heatColor_${i}.b);
                    
                    // Only apply heat color if it's not white (has defects)
                    // Replace base color with heat color in masked areas
                    finalColor = mix(finalColor, heatColor_${i}, maskValue_${i} * (1.0 - isWhite_${i}));
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
        const width = viewerContainer.clientWidth || 500;
        const height = Math.max(400, viewerContainer.clientHeight || 500);
        
        if (width === 0 || height === 0) {
            console.warn('3D Viewer container has zero dimensions, using defaults');
        }
        
        console.log('3D Viewer dimensions:', width, 'x', height);
        camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        camera.position.set(1,1, 1);
        camera.lookAt(0, 0, 0);

        // Set up renderer
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        viewerContainer.innerHTML = ''; // Clear any existing content
        viewerContainer.appendChild(renderer.domElement);
        
        // Show loading state
        console.log('3D Viewer renderer created and added to container');

        // Set up controls
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.minDistance = 0.5;
        controls.maxDistance = 3;

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

        // Start animation loop - render immediately even before model loads
        const animate = () => {
            animationFrameId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();
        console.log('3D Viewer animation loop started, viewer ready:', viewerReady);
        
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
const initializeViewer = () => {
    viewerContainer = document.getElementById('report3DViewer');
    if (viewerContainer) {
        console.log('3D Viewer container found, initializing...', viewerContainer);
        // Small delay to ensure container has dimensions
        setTimeout(() => {
            initViewer().catch((error) => {
                console.error('Error initializing 3D viewer:', error);
                if (viewerContainer) {
                    viewerContainer.innerHTML = '<p style="padding: 20px; color: #676767;">Failed to load 3D visualization. Please check console for errors.</p>';
                }
            });
        }, 100);
        // Cleanup on page unload
        window.addEventListener('beforeunload', cleanup);
    } else {
        console.error('3D Viewer container not found: #report3DViewer');
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeViewer);
} else {
    // If DOM is already loaded, wait a bit more to ensure all scripts are ready
    setTimeout(initializeViewer, 50);
}

// Wait for viewer to be ready (with timeout)
const waitForViewerReady = async (maxWait = 5000) => {
    const startTime = Date.now();
    while (!viewerReady || !model || !scene || !camera || !renderer || !controls) {
        if (Date.now() - startTime > maxWait) {
            console.warn('3D viewer not ready after timeout');
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return true;
};

// Enhanced capture function that waits for viewer
const captureTechnicalViewsWithWait = async () => {
    const isReady = await waitForViewerReady();
    if (!isReady) {
        console.warn('3D viewer not ready, returning empty views');
        return { top: null, side: null, front: null };
    }
    return await captureTechnicalViews();
};

// Export functions for PDF generation
window.captureTechnicalViews = captureTechnicalViews;
window.captureTechnicalViewsWithWait = captureTechnicalViewsWithWait;
window.waitForViewerReady = waitForViewerReady;