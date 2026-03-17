import { useEffect, useRef, useState } from 'react';
import * as poseDetection from '@tensorflow-models/pose-detection';
import '@tensorflow/tfjs-backend-webgl';
import * as tf from '@tensorflow/tfjs';

export default function usePoseDetector() {
  const detectorRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await tf.setBackend('webgl');
      await tf.ready();
      const detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
      );
      if (!cancelled) {
        detectorRef.current = detector;
        setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Returns center-of-hips point from detected pose, or null
  const detectPerson = async (videoEl) => {
    if (!detectorRef.current || !videoEl || videoEl.readyState < 2) return null;
    const poses = await detectorRef.current.estimatePoses(videoEl);
    if (!poses || poses.length === 0) return null;
    const kp = poses[0].keypoints;
    // Use midpoint of left hip + right hip as tracking point
    const leftHip = kp.find(k => k.name === 'left_hip');
    const rightHip = kp.find(k => k.name === 'right_hip');
    if (!leftHip || !rightHip) return null;
    if (leftHip.score < 0.3 || rightHip.score < 0.3) return null;
    return {
      x: (leftHip.x + rightHip.x) / 2,
      y: (leftHip.y + rightHip.y) / 2,
    };
  };

  return { ready, detectPerson };
}