import { useRef, useMemo, useState, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Environment, Center, useGLTF, Image } from '@react-three/drei';
import * as THREE from 'three';

function GLTFModel({ url }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

function BillboardImage({ url }) {
  return (
    <Image url={url} scale={[3, 3]} transparent opacity={1} />
  );
}

// Procedural Component Generator
const ProceduralShape = ({ type, position, color, label, explodedOffset }) => {
  const meshRef = useRef();
  
  // Calculate final position based on explosion offset
  const finalPos = useMemo(() => {
    // Basic direction vector away from center
    const dir = new THREE.Vector3(...position).normalize();
    return [
      position[0] + dir.x * explodedOffset,
      position[1] + dir.y * explodedOffset,
      position[2] + dir.z * explodedOffset
    ];
  }, [position, explodedOffset]);

  let geometry;
  switch (type.toLowerCase()) {
    case 'box':
      geometry = <boxGeometry args={[1, 1, 1]} />;
      break;
    case 'sphere':
      geometry = <sphereGeometry args={[0.7, 32, 32]} />;
      break;
    case 'cylinder':
      geometry = <cylinderGeometry args={[0.5, 0.5, 1.5, 32]} />;
      break;
    default:
      geometry = <boxGeometry args={[1, 1, 1]} />;
  }

  // Cross section plane
  const [clippingPlanes, setClippingPlanes] = useState([]);
  
  return (
    <mesh position={finalPos} ref={meshRef} castShadow receiveShadow>
      {geometry}
      <meshStandardMaterial color={color} roughness={0.3} metalness={0.2} />
      
      {/* Interactive Label */}
      <Html distanceFactor={10} position={[0, 1.2, 0]}>
        <div className="bg-slate-900/80 backdrop-blur text-white px-2 py-1 rounded text-sm whitespace-nowrap border border-slate-700 pointer-events-none">
          {label}
        </div>
      </Html>
    </mesh>
  );
};

export default function ThreeCanvas({ modelData, explodedValue = 0 }) {
  // If we have procedural data from the backend fallback
  const proceduralComponents = useMemo(() => {
    if (!modelData || !modelData.procedural_data) return null;
    
    // Map backend intent components to basic 3D shapes with layout
    const comps = modelData.procedural_data.components;
    return comps.map((comp, idx) => {
      // Very basic spread layout along X axis
      const xOffset = (idx - comps.length / 2) * 2;
      return {
        id: `proc_${idx}`,
        type: ['box', 'sphere', 'cylinder'][idx % 3], // cycle through basic shapes
        position: [xOffset + 1, 0, 0],
        color: ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'][idx % 4],
        label: comp.charAt(0).toUpperCase() + comp.slice(1)
      };
    });
  }, [modelData]);

  return (
    <div className="w-full h-[600px] rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-2xl relative">
      {modelData?.source === "Gemini 2D AI" ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-[#020617]">
          <div className="relative w-full h-full flex items-center justify-center group">
            <img 
              src={modelData.image_url} 
              alt={modelData.title}
              className="max-w-full max-h-full object-contain rounded-xl shadow-2xl transition-transform duration-500 group-hover:scale-[1.02]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-6 pointer-events-none">
               <span className="text-blue-400 font-bold text-xs uppercase tracking-widest mb-2">2D Concept Visualization</span>
               <p className="text-slate-200 text-sm italic">"No 3D model was available, so a high-fidelity 2D concept was generated."</p>
            </div>
          </div>
        </div>
      ) : modelData?.embed_url ? (
        <div className="w-full h-full relative group">
          <iframe 
            title="3D Model Viewer"
            src={modelData.embed_url}
            frameBorder="0"
            allow="autoplay; fullscreen; xr-spatial-tracking"
            xr-spatial-tracking="true"
            execution-while-out-of-viewport="true"
            execution-while-not-rendered="true"
            web-share="true"
            className="w-full h-full"
          />
          
          {/* Top Info Mask (Hides Author, Title, Share buttons) */}
          <div className="absolute top-0 left-0 w-full h-[60px] bg-slate-950/90 pointer-events-none z-10" />
          
          {/* Bottom Edge Mask (Hides Sketchfab Watermark and all Bottom Controls) */}
          <div className="absolute bottom-0 left-0 w-full h-[55px] bg-slate-950 pointer-events-none z-10" />
        </div>
      ) : (
        <Canvas shadows camera={{ position: [0, 2, 5], fov: 45 }}>
          <color attach="background" args={['#020617']} />
          
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
          <Environment preset="city" />
          
          <OrbitControls makeDefault autoRotate autoRotateSpeed={0.5} />
          
          <Center>
            {modelData?.model_url ? (
              <Suspense fallback={
                <Html center>
                  <div className="text-primary-400 font-mono text-sm tracking-widest uppercase mt-32 whitespace-nowrap">
                    Loading 3D Model...
                  </div>
                </Html>
              }>
                <GLTFModel url={modelData.model_url} />
              </Suspense>
            ) : proceduralComponents ? (
              proceduralComponents.map((comp) => (
                <ProceduralShape 
                  key={comp.id}
                  type={comp.type}
                  position={comp.position}
                  color={comp.color}
                  label={comp.label}
                  explodedOffset={explodedValue}
                />
              ))
            ) : modelData?.thumbnails?.[0]?.url ? (
              <Suspense fallback={null}>
                <BillboardImage url={modelData.thumbnails[0].url} />
                <Html center position={[0, -2, 0]}>
                  <div className="text-slate-400 font-mono text-sm tracking-widest uppercase whitespace-nowrap bg-slate-900/80 px-4 py-2 rounded-lg backdrop-blur-md">
                    3D Model Not Available (Showing Render)
                  </div>
                </Html>
              </Suspense>
            ) : (
              // Placeholder when no model
              <mesh>
                <icosahedronGeometry args={[1, 1]} />
                <meshStandardMaterial color="#64748b" wireframe />
                <Html center>
                  <div className="text-slate-400 font-mono text-sm tracking-widest uppercase mt-32 whitespace-nowrap">
                    Waiting for Input
                  </div>
                </Html>
              </mesh>
            )}
          </Center>
        </Canvas>
      )}
      
      {/* Optional Overlay UI elements can go here */}
    </div>
  );
}
