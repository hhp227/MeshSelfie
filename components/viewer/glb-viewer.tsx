"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type GlbViewerProps = {
  modelUrl: string;
  onSignedUrlExpired?: () => void;
};

export function GlbViewer({ modelUrl, onSignedUrlExpired }: GlbViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    let disposed = false;
    let frameId = 0;
    let loadedScene: THREE.Object3D | null = null;

    setLoading(true);
    setError(null);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f4f5);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    camera.position.set(0, 0, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.screenSpacePanning = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x52525b, 2.2));

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdbeafe, 1.5);
    fillLight.position.set(-4, 1, 3);
    scene.add(fillLight);

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(render);
    };
    render();

    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }

        loadedScene = gltf.scene;
        scene.add(gltf.scene);
        frameModel(gltf.scene, camera, controls);
        setLoading(false);
      },
      undefined,
      (loadError) => {
        if (disposed) {
          return;
        }

        console.error("GLB viewer load failed", loadError);
        setLoading(false);
        setError("3D 모델을 불러오지 못했습니다. URL이 만료됐거나 파일이 올바르지 않습니다.");
      },
    );

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();

      if (loadedScene) {
        scene.remove(loadedScene);
        disposeObject(loadedScene);
      }

      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [loadAttempt, modelUrl]);

  function retry() {
    onSignedUrlExpired?.();
    setLoadAttempt((attempt) => attempt + 1);
  }

  return (
    <div className="relative h-full min-h-[460px] w-full overflow-hidden rounded-md bg-zinc-100">
      <div ref={containerRef} className="absolute inset-0" aria-label="3D 모델 뷰어" />

      {loading ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-zinc-100/80 text-sm font-medium text-zinc-600">
          3D 모델을 불러오는 중입니다.
        </div>
      ) : null}

      {error ? (
        <div className="absolute inset-0 grid place-items-center bg-zinc-100/95 p-6 text-center">
          <div>
            <p className="text-sm font-medium text-zinc-800">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-4 rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              새 URL로 다시 시도
            </button>
          </div>
        </div>
      ) : null}

      {!loading && !error ? (
        <p className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/85 px-2 py-1 text-xs text-zinc-600 shadow-sm">
          드래그: 회전 · 휠/핀치: 확대 및 축소
        </p>
      ) : null}
    </div>
  );
}

function frameModel(
  model: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
) {
  const box = new THREE.Box3().setFromObject(model);

  if (box.isEmpty()) {
    return;
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.01);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));

  camera.near = Math.max(distance / 100, 0.001);
  camera.far = Math.max(distance * 100, 100);
  camera.position.set(center.x, center.y, center.z + distance * 1.15);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = radius * 0.35;
  controls.maxDistance = distance * 4;
  controls.update();
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];

    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) {
          value.dispose();
        }
      }
      material.dispose();
    }
  });
}
