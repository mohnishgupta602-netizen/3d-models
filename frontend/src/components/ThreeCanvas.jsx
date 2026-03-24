import { useMemo, Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html, Environment, Center, useGLTF, Image } from '@react-three/drei';

function formatPartName(name, fallbackIndex = 0) {
  if (!name || typeof name !== 'string') return `Part ${fallbackIndex + 1}`;
  return name
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function GLTFModel({ url }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

function BillboardImage({ url }) {
  return (
    <Image url={url} scale={[3, 3]} transparent opacity={1} />
  );
}

const ProceduralShape = ({ part, index, explodedOffset, isHovered, onHoverStart, onHoverEnd }) => {
  const primitive = (part?.primitive || 'cube').toLowerCase();
  const params = part?.parameters || {};
  const positionObj = part?.position || {};
  const basePos = [positionObj.x || 0, positionObj.y || 0, positionObj.z || 0];
  const finalPos = [basePos[0] + explodedOffset * (index % 2 === 0 ? -0.5 : 0.5), basePos[1], basePos[2]];

  const color = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#a855f7'][index % 5];

  let geometry;
  if (primitive === 'sphere') {
    geometry = <sphereGeometry args={[params.radius || 0.7, params.widthSegments || 24, params.heightSegments || 24]} />;
  } else if (primitive === 'cylinder' || primitive === 'tube') {
    geometry = <cylinderGeometry args={[params.radiusTop || 0.5, params.radiusBottom || 0.5, params.height || 1.5, params.radialSegments || 24]} />;
  } else if (primitive === 'cone') {
    geometry = <coneGeometry args={[params.radius || 0.6, params.height || 1.5, params.radialSegments || 24]} />;
  } else {
    geometry = <boxGeometry args={[params.width || 1, params.height || 1, params.depth || 1]} />;
  }

  return (
    <mesh
      position={finalPos}
      castShadow
      receiveShadow
      onPointerOver={(e) => {
        e.stopPropagation();
        onHoverStart?.(part, index);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onHoverEnd?.();
      }}
    >
      {geometry}
      <meshStandardMaterial
        color={color}
        roughness={0.35}
        metalness={0.15}
        emissive={isHovered ? '#ffffff' : '#000000'}
        emissiveIntensity={isHovered ? 0.18 : 0}
      />
      <Html transform distanceFactor={10} position={[0, 0.9, 0]} pointerEvents="auto">
        <div
          className="bg-slate-900/72 backdrop-blur text-white w-5 h-5 rounded-md text-[9px] leading-none border border-slate-700/70 flex items-center justify-center cursor-pointer select-none"
          style={{ pointerEvents: 'auto' }}
          onMouseEnter={(e) => {
            e.stopPropagation();
            onHoverStart?.(part, index);
          }}
          onMouseLeave={(e) => {
            e.stopPropagation();
            onHoverEnd?.();
          }}
          title={formatPartName(part?.name, index)}
        >
          {index + 1}
        </div>
      </Html>
    </mesh>
  );
};

const LabelMarker = ({ part, index, isHovered, onHoverStart, onHoverEnd }) => {
  const positionObj = part?.position || {};
  const markerPos = [positionObj.x || 0, (positionObj.y || 0) + 0.2, positionObj.z || 0];

  return (
    <group position={markerPos}>
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation();
          onHoverStart?.(part, index);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          onHoverEnd?.();
        }}
      >
        <sphereGeometry args={[isHovered ? 0.08 : 0.06, 16, 16]} />
        <meshStandardMaterial color={isHovered ? '#38bdf8' : '#22d3ee'} emissive={isHovered ? '#38bdf8' : '#000000'} emissiveIntensity={isHovered ? 0.6 : 0} />
      </mesh>
      <Html transform distanceFactor={11} position={[0, 0.16, 0]} pointerEvents="auto">
        <div
          className="bg-slate-900/72 backdrop-blur text-white w-5 h-5 rounded-md text-[9px] leading-none border border-cyan-500/50 flex items-center justify-center cursor-pointer select-none"
          style={{ pointerEvents: 'auto' }}
          onMouseEnter={(e) => {
            e.stopPropagation();
            onHoverStart?.(part, index);
          }}
          onMouseLeave={(e) => {
            e.stopPropagation();
            onHoverEnd?.();
          }}
          title={formatPartName(part?.name, index)}
        >
          {index + 1}
        </div>
      </Html>
    </group>
  );
};

export default function ThreeCanvas({ modelData, explodedValue = 0 }) {
  const [hoveredPart, setHoveredPart] = useState(null);
  const fallbackImageUrl = modelData?.fallback_2d_image_url || modelData?.image_url;

  // If we have procedural data from the backend fallback
  const proceduralComponents = useMemo(() => {
    if (!modelData || !modelData.procedural_data) return null;

    const parts = modelData.procedural_data.parts;
    if (Array.isArray(parts) && parts.length > 0) {
      return parts;
    }

    const comps = (modelData.procedural_data.components || []).filter((comp) => typeof comp === 'string' && comp.trim().length > 0);
    return comps.map((comp, idx) => ({
      name: `part_${idx + 1}`,
      primitive: comp,
      parameters: {},
      position: { x: (idx - (comps.length - 1) / 2) * 2, y: 0, z: 0 },
    }));
  }, [modelData]);

  const partDefinitions = useMemo(() => {
    if (Array.isArray(modelData?.part_definitions) && modelData.part_definitions.length > 0) {
      return modelData.part_definitions;
    }

    if (Array.isArray(modelData?.geometry_details?.shapes) && modelData.geometry_details.shapes.length > 0) {
      return modelData.geometry_details.shapes;
    }

    return Array.isArray(proceduralComponents) ? proceduralComponents : [];
  }, [modelData, proceduralComponents]);

  const isOriginalLabeledTest = modelData?.labeling_mode === 'original-3d-test';
  const builtInAnnotationsCount = Number(modelData?.built_in_annotations_count || 0);
  const shouldUseEmbedForOriginalTest =
    isOriginalLabeledTest &&
    (modelData?.source || '').toLowerCase() === 'original 3d labeling test' &&
    !!modelData?.embed_url &&
    builtInAnnotationsCount > 0;

  return (
    <div className="w-full h-[600px] rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-2xl relative">
      {fallbackImageUrl && !proceduralComponents ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-[#020617]">
          <div className="relative w-full h-full flex items-center justify-center group">
            <img 
              src={fallbackImageUrl}
              alt={modelData.title}
              className="max-w-full max-h-full object-contain rounded-xl shadow-2xl transition-transform duration-500 group-hover:scale-[1.02]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-6 pointer-events-none">
               <span className="text-blue-400 font-bold text-xs uppercase tracking-widest mb-2">2D Concept Visualization</span>
               <p className="text-slate-200 text-sm italic">"No 3D model was available, so a high-fidelity 2D concept was generated."</p>
            </div>
          </div>
        </div>
      ) : modelData?.embed_url && (!isOriginalLabeledTest || shouldUseEmbedForOriginalTest) ? (
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

          {shouldUseEmbedForOriginalTest && (
            <div className="absolute top-3 left-3 z-20 text-[10px] uppercase tracking-wider text-cyan-300 bg-slate-900/80 border border-cyan-600/30 rounded px-2 py-1 pointer-events-none">
              Using Sketchfab built-in annotations ({builtInAnnotationsCount})
            </div>
          )}
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
                {isOriginalLabeledTest && Array.isArray(partDefinitions) && partDefinitions.length > 0 && (
                  partDefinitions.slice(0, 8).map((part, idx) => (
                    <LabelMarker
                      key={`${part?.name || 'marker'}-${idx}`}
                      part={part}
                      index={idx}
                      isHovered={hoveredPart?.index === idx}
                      onHoverStart={(p, i) => setHoveredPart({ ...p, index: i })}
                      onHoverEnd={() => setHoveredPart(null)}
                    />
                  ))
                )}
              </Suspense>
            ) : proceduralComponents ? (
              proceduralComponents.map((part, idx) => (
                <ProceduralShape 
                  key={`${part?.name || part?.primitive || 'part'}-${idx}`}
                  part={part}
                  index={idx}
                  explodedOffset={explodedValue}
                  isHovered={hoveredPart?.index === idx}
                  onHoverStart={(p, i) => setHoveredPart({ ...p, index: i })}
                  onHoverEnd={() => setHoveredPart(null)}
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

          {isOriginalLabeledTest && !modelData?.model_url && (
            <Html position={[0, -2.4, 0]} center>
              <div className="text-[10px] uppercase tracking-wider text-cyan-300 bg-slate-900/80 border border-cyan-600/30 rounded px-3 py-1">
                Original source is embedded; showing labeled proxy preview.
              </div>
            </Html>
          )}
        </Canvas>
      )}

      {Array.isArray(partDefinitions) && partDefinitions.length > 0 && (
        <div className="absolute top-4 left-4 z-20 max-w-sm bg-slate-950/80 backdrop-blur border border-slate-700 rounded-xl p-3 text-slate-100">
          <h4 className="text-xs tracking-widest uppercase text-blue-300 mb-2">Part Definitions</h4>
          <ul className="space-y-1 max-h-44 overflow-y-auto pr-1 text-xs">
            {partDefinitions.slice(0, 8).map((part, idx) => (
              <li key={`${part?.name || 'part'}-${idx}`} className="leading-relaxed">
                <span className="font-semibold text-white">{idx + 1}.</span>
                <span className="text-slate-200"> {formatPartName(part?.name, idx)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-slate-400 mt-2">Hover a numbered part to view full description.</p>
        </div>
      )}

      {hoveredPart && (
        <div className="absolute bottom-4 left-4 z-20 max-w-sm bg-slate-950/85 backdrop-blur border border-blue-500/40 rounded-xl p-3 text-slate-100">
          <h4 className="text-sm font-semibold text-blue-300">
            {formatPartName(hoveredPart.name, hoveredPart.index)}
            <span className="text-slate-400 font-normal"> ({hoveredPart.primitive || 'shape'})</span>
          </h4>
          <p className="text-xs text-slate-200 mt-1">
            {hoveredPart.description || 'No additional description available.'}
          </p>
        </div>
      )}
    </div>
  );
}
