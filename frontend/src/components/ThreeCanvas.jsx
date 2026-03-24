import { useMemo, Suspense, useState, useRef } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html, Environment, Center, useGLTF, Image, Line } from '@react-three/drei';
import { triggerVisionOptimization } from '../utils/visionLabeling';
import { Sparkles, Circle, Square, Zap } from 'lucide-react';

function formatPartName(name, fallbackIndex = 0) {
  if (!name || typeof name !== 'string') return `Part ${fallbackIndex + 1}`;
  return name
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function getNumeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}


function GLTFModelWithLabels({ url, parts, hoveredPart, onHoverStart, onHoverEnd }) {
  const { scene } = useGLTF(url);

  const bounds = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const min = box.min.clone();
    const max = box.max.clone();
    const size = max.clone().sub(min);

    return {
      min,
      max,
      size: {
        x: Math.max(size.x, 1),
        y: Math.max(size.y, 1),
        z: Math.max(size.z, 1),
      },
    };
  }, [scene]);

  return (
    <>
      <primitive object={scene} />
      {Array.isArray(parts) && parts.length > 0 &&
        parts.slice(0, 8).map((part, idx) => {
          const positionObj = part?.position || {};
          const nx = getNumeric(positionObj.x, 0);
          const ny = getNumeric(positionObj.y, 0);
          const nz = getNumeric(positionObj.z, 0);

          // Map semantic normalized coordinates [-0.5, 0.5] to model bounding box
          // Using min + (coord + 0.5) * size formula
          const markerPos = [
            bounds.min.x + (nx + 0.5) * bounds.size.x,
            bounds.min.y + (ny + 0.5) * bounds.size.y,
            bounds.min.z + (nz + 0.5) * bounds.size.z,
          ];

          return (
            <LabelMarker
              key={`${part?.name || 'marker'}-${idx}`}
              part={part}
              index={idx}
              markerPosition={markerPos}
              isHovered={hoveredPart?.index === idx}
              onHoverStart={onHoverStart}
              onHoverEnd={onHoverEnd}
            />
          );
        })}
    </>
  );
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
      <Html transform distanceFactor={7} position={[0, 0.7, 0]} pointerEvents="auto">
        <div
          className="bg-slate-900/72 backdrop-blur text-white w-4 h-4 rounded text-[8px] leading-none border border-slate-700/70 flex items-center justify-center cursor-pointer select-none"
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

const LabelMarker = ({ part, index, markerPosition, isHovered, onHoverStart, onHoverEnd }) => {
  const positionObj = part?.position || {};
  const markerPos = markerPosition || [positionObj.x || 0, (positionObj.y || 0) + 0.2, positionObj.z || 0];
  const textPos = [0, 0.15, 0];
  const linePoints = [markerPos, [markerPos[0] + textPos[0], markerPos[1] + textPos[1], markerPos[2] + textPos[2]]];

  return (
    <group position={markerPos}>
      {/* Marker sphere with enhanced glow */}
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
        <sphereGeometry args={[isHovered ? 0.1 : 0.07, 24, 24]} />
        <meshStandardMaterial
          color={isHovered ? '#0ea5e9' : '#06b6d4'}
          emissive={isHovered ? '#0ea5e9' : '#0891b2'}
          emissiveIntensity={isHovered ? 0.8 : 0.3}
          toneMapped={false}
        />
      </mesh>

      {/* Leader line connecting marker to label */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array(linePoints.flat())}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={isHovered ? '#0ea5e9' : '#06b6d4'} linewidth={2} transparent opacity={isHovered ? 0.8 : 0.4} />
      </lineSegments>

      {/* Label badge */}
      <Html transform distanceFactor={7} position={textPos} pointerEvents="auto">
        <div
          className={`rounded-lg text-white w-5 h-5 flex items-center justify-center cursor-pointer select-none text-[8px] font-semibold border transition-all duration-200 ${
            isHovered
              ? 'bg-cyan-500/90 border-cyan-300/80 shadow-[0_0_12px_rgba(34,211,238,0.6)]'
              : 'bg-cyan-600/70 border-cyan-400/50 shadow-[0_0_8px_rgba(34,211,238,0.3)]'
          }`}
          style={{ backdropFilter: 'blur(4px)', pointerEvents: 'auto' }}
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
  const [optimizingLabels, setOptimizingLabels] = useState(false);
  const [optimizationError, setOptimizationError] = useState(null);
  const [optimizedParts, setOptimizedParts] = useState(null);
  const canvasRef = useRef(null);

  const handleVisionOptimization = async () => {
    if (!canvasRef.current || !partDefinitions || partDefinitions.length === 0) {
      console.error('Cannot optimize: missing canvas or parts');
      setOptimizationError('Missing canvas or parts to optimize');
      return;
    }
    
    setOptimizationError(null);
    setOptimizingLabels(true);
    try {
      console.log('📍 Canvas ref:', canvasRef.current);
      console.log('📍 Canvas ref type:', canvasRef.current?.constructor?.name);
      
      const result = await triggerVisionOptimization(
        modelData?.uid || modelData?.title,
        modelData?.title || 'model',
        partDefinitions,
        canvasRef.current
      );
      
      if (result.error) {
        console.error('Vision optimization error:', result.error);
        setOptimizationError(result.error);
        return;
      }

      if (result.parts) {
        setOptimizedParts(result.parts);
        console.log('✅ Labels optimized successfully');
      }
    } catch (err) {
      console.error('Vision optimization exception:', err);
      setOptimizationError(err.message || 'Unknown error occurred');
    } finally {
      setOptimizingLabels(false);
    }
  };

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

  const getPrimitiveIcon = (primitive) => {
    const iconProps = { size: 14, className: "text-slate-400" };
    switch ((primitive || 'cube').toLowerCase()) {
      case 'sphere':
        return <Circle {...iconProps} />;
      case 'cylinder':
      case 'tube':
        return <Zap {...iconProps} />;
      case 'cube':
      case 'box':
        return <Square {...iconProps} />;
      default:
        return <Square {...iconProps} />;
    }
  };

  return (
    <div className="w-full h-[600px] rounded-2xl overflow-hidden bg-slate-950 border-2 border-slate-700/80 shadow-2xl relative before:absolute before:inset-0 before:rounded-2xl before:shadow-[inset_0_0_20px_rgba(51,65,85,0.3)] before:pointer-events-none">
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
        <Canvas
          shadows
          camera={{ position: [0, 2, 5], fov: 45 }}
          onCreated={({ gl }) => {
            canvasRef.current = gl.domElement;
          }}
        >
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
                <GLTFModelWithLabels
                  url={modelData.model_url}
                  parts={isOriginalLabeledTest ? (optimizedParts || partDefinitions) : []}
                  hoveredPart={hoveredPart}
                  onHoverStart={(p, i) => setHoveredPart({ ...p, index: i })}
                  onHoverEnd={() => setHoveredPart(null)}
                />
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
        <div className="absolute top-4 left-4 z-20 max-w-sm bg-gradient-to-b from-slate-950/85 to-slate-900/80 backdrop-blur border border-slate-700/60 rounded-xl shadow-xl">
          <div className="p-3 border-b border-slate-700/40">
            <h4 className="text-xs tracking-widest uppercase text-blue-300 font-semibold">Part Definitions</h4>
          </div>
          <ul className="space-y-2 max-h-44 overflow-y-auto pr-2 p-3 text-xs">
            {partDefinitions.slice(0, 8).map((part, idx) => (
              <li
                key={`${part?.name || 'part'}-${idx}`}
                className="flex items-start gap-2 p-2 rounded-lg hover:bg-slate-800/40 transition-colors group"
              >
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600/30 border border-blue-500/50 flex items-center justify-center text-[11px] font-semibold text-blue-300">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="text-slate-400 group-hover:text-slate-300 transition-colors">
                      {getPrimitiveIcon(part?.primitive)}
                    </div>
                    <span className="font-semibold text-slate-200 group-hover:text-slate-100 truncate">
                      {formatPartName(part?.name, idx)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="px-3 py-2 border-t border-slate-700/40 text-[10px] text-slate-400">
            Hover over labels to view details.
          </div>
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

      {/* Error notification */}
      {optimizationError && (
        <div className="absolute bottom-4 right-4 z-20 max-w-sm bg-red-950/85 backdrop-blur border border-red-500/40 rounded-xl p-3 text-red-100 text-xs">
          <div className="font-semibold mb-1">⚠️ Optimization Failed</div>
          <div className="text-red-200">{optimizationError}</div>
          <button
            onClick={() => setOptimizationError(null)}
            className="mt-2 text-[10px] text-red-300 hover:text-red-200 underline"
          >
            Dismiss
          </button>
        </div>
      )}

        {/* Vision-based Label Optimization Button */}
        {isOriginalLabeledTest && modelData?.model_url && Array.isArray(partDefinitions) && partDefinitions.length > 0 && !optimizedParts && (
          <button
            onClick={handleVisionOptimization}
            disabled={optimizingLabels}
            className="absolute top-4 right-4 z-20 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold transition-all duration-300 shadow-lg"
            title="Use Gemini vision analysis to optimize label positions based on model geometry"
          >
            <Sparkles size={14} />
            {optimizingLabels ? 'Analyzing...' : 'Optimize with AI'}
          </button>
        )}
        {optimizedParts && (
          <div className="absolute top-4 right-4 z-20 px-3 py-2 rounded-lg bg-green-500/20 border border-green-500/50 text-green-300 text-xs font-semibold backdrop-blur">
            ✓ AI-Optimized Labels
          </div>
        )}
    </div>
  );
}
