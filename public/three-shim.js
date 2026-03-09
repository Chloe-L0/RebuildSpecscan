/**
 * Single import point for Three.js and addons to avoid "Multiple instances of Three.js" warning.
 * Use this module instead of importing from 'three' or 'three/addons/...' directly.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export { THREE, GLTFLoader, OrbitControls };
