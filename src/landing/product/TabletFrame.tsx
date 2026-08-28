import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import tabletShell from '../../assets/koma-tablet-shell-3d.png';
import tabletModelUrl from '../../assets/models/koma-tablet-reference.obj?url';
import { ProductScreen } from './ProductScreen';

interface TabletFrameProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  className?: string;
  style?: React.CSSProperties;
}

export function TabletFrame({ view = 'mesas', className = '', style }: TabletFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [modelFailed, setModelFailed] = useState(false);

  useLayoutEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;

    const updateScale = () => {
      const scale = Math.min(screen.clientWidth / 1280, screen.clientHeight / 800);
      screen.style.setProperty('--koma-preview-scale', `${Math.max(scale, 0.1)}`);
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(screen);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let disposed = false;
    let renderer: import('three').WebGLRenderer | null = null;
    let scene: import('three').Scene | null = null;
    let camera: import('three').PerspectiveCamera | null = null;
    let model: import('three').Object3D | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const loadModel = async () => {
      try {
        const [THREE, { OBJLoader }] = await Promise.all([
          import('three'),
          import('three/examples/jsm/loaders/OBJLoader.js'),
        ]);

        if (disposed) return;

        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'low-power',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setClearColor(0x000000, 0);

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(28, 1, 0.01, 10);
        camera.position.set(0, 0, 1.72);
        camera.lookAt(0, 0, 0);

        scene.add(new THREE.HemisphereLight(0xc9fff5, 0x101614, 1.65));

        const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
        keyLight.position.set(-1.4, 1.6, 2.5);
        scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0x00d2a9, 1.15);
        rimLight.position.set(1.8, -0.6, 1.5);
        scene.add(rimLight);

        const bodyMaterial = new THREE.MeshStandardMaterial({
          color: 0x20272b,
          metalness: 0.64,
          roughness: 0.3,
          side: THREE.DoubleSide,
        });
        const bezelMaterial = new THREE.MeshStandardMaterial({
          color: 0x080d0e,
          metalness: 0.28,
          roughness: 0.42,
          side: THREE.DoubleSide,
        });
        const screenMaterial = new THREE.MeshStandardMaterial({
          color: 0x101719,
          metalness: 0.12,
          roughness: 0.48,
          side: THREE.DoubleSide,
        });
        const cameraMaterial = new THREE.MeshStandardMaterial({
          color: 0x010303,
          metalness: 0.5,
          roughness: 0.2,
          side: THREE.DoubleSide,
        });
        const buttonMaterial = new THREE.MeshStandardMaterial({
          color: 0x00b894,
          emissive: 0x004f40,
          emissiveIntensity: 0.65,
          metalness: 0.35,
          roughness: 0.26,
          side: THREE.DoubleSide,
        });

        const object = await new OBJLoader().loadAsync(tabletModelUrl);
        if (disposed) return;

        object.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const name = child.name.toLowerCase();
          child.material = name.includes('screen')
            ? screenMaterial
            : name.includes('bezel')
              ? bezelMaterial
              : name.includes('camera')
                ? cameraMaterial
                : name.includes('home_button')
                  ? buttonMaterial
                  : bodyMaterial;
          child.castShadow = false;
          child.receiveShadow = false;
        });

        const bounds = new THREE.Box3().setFromObject(object);
        const center = bounds.getCenter(new THREE.Vector3());
        object.position.sub(center);
        object.rotation.z = -Math.PI / 2;
        object.rotation.x = THREE.MathUtils.degToRad(1.5);
        scene.add(object);
        model = object;
        setModelReady(true);

        const resize = () => {
          if (!renderer || !camera) return;
          const { clientWidth, clientHeight } = container;
          if (!clientWidth || !clientHeight) return;
          renderer.setSize(clientWidth, clientHeight, false);
          camera.aspect = clientWidth / clientHeight;
          camera.updateProjectionMatrix();
          renderer.render(scene!, camera);
        };

        resize();
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);
      } catch {
        if (!disposed) setModelFailed(true);
      }
    };

    loadModel();

    return () => {
      disposed = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      resizeObserver?.disconnect();
      if (model) {
        model.traverse((child) => {
          if (!('geometry' in child) || !('material' in child)) return;
          const mesh = child as import('three').Mesh;
          mesh.geometry.dispose();
          const material = mesh.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material.dispose();
        });
      }
      renderer?.dispose();
      scene = null;
      camera = null;
      renderer = null;
    };
  }, []);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const updatePointerLight = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const element = containerRef.current;
    if (!element || event.pointerType === 'touch') return;

    const target = event.currentTarget;
    const lightX = Math.min(1, Math.max(0, event.nativeEvent.offsetX / target.offsetWidth));
    const lightY = Math.min(1, Math.max(0, event.nativeEvent.offsetY / target.offsetHeight));

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      element.style.setProperty('--tablet-shell-light-x', `${lightX * 100}%`);
      element.style.setProperty('--tablet-shell-light-y', `${lightY * 100}%`);
      element.style.setProperty('--tablet-shell-light-opacity', '1');
      element.style.setProperty('--tablet-shell-tilt-x', `${(0.5 - lightY) * 0.8}deg`);
      element.style.setProperty('--tablet-shell-tilt-y', `${(lightX - 0.5) * 0.8}deg`);
    });
  }, []);

  const resetPointerLight = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    element.style.setProperty('--tablet-shell-light-x', '68%');
    element.style.setProperty('--tablet-shell-light-y', '20%');
    element.style.setProperty('--tablet-shell-light-opacity', '0');
    element.style.setProperty('--tablet-shell-tilt-x', '0deg');
    element.style.setProperty('--tablet-shell-tilt-y', '0deg');
  }, []);

  return (
    <div
      ref={containerRef}
      className={`koma-tablet-3d koma-tablet-obj ${className}`}
      style={style}
      aria-hidden="true"
    >
      <div className="koma-tablet-3d-stage">
        <img
          src={tabletShell}
          alt=""
          className={`koma-tablet-obj-fallback ${modelReady && !modelFailed ? 'is-hidden' : ''}`}
          draggable={false}
          decoding="async"
        />

        <canvas ref={canvasRef} className={`koma-tablet-obj-canvas ${modelReady ? 'is-ready' : ''}`} />

        <div ref={screenRef} className="koma-tablet-obj-screen">
          <ProductScreen view={view} scaleLogicalWidth={1280} />
        </div>

        <div
          className="koma-tablet-3d-glare"
          onPointerMove={updatePointerLight}
          onPointerLeave={resetPointerLight}
        />
      </div>
    </div>
  );
}
