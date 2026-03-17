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

  /**
   * Returns full pose keypoints + convenience helpers, or null.
   * {
   *   hipCenter: {x, y},
   *   leftAnkle: {x, y, score},
   *   rightAnkle: {x, y, score},
   *   leftKnee: {x, y, score},
   *   rightKnee: {x, y, score},
   *   leftHip: {x, y, score},
   *   rightHip: {x, y, score},
   * }
   */
  const detectPerson = async (videoEl) => {
    if (!detectorRef.current || !videoEl || videoEl.readyState < 2) return null;
    const poses = await detectorRef.current.estimatePoses(videoEl);
    if (!poses || poses.length === 0) return null;
    const kp = poses[0].keypoints;

    const get = (name) => kp.find(k => k.name === name);
    const leftHip = get('left_hip');
    const rightHip = get('right_hip');
    const leftKnee = get('left_knee');
    const rightKnee = get('right_knee');
    const leftAnkle = get('left_ankle');
    const rightAnkle = get('right_ankle');

    if (!leftHip || !rightHip || leftHip.score < 0.3 || rightHip.score < 0.3) return null;

    return {
      hipCenter: {
        x: (leftHip.x + rightHip.x) / 2,
        y: (leftHip.y + rightHip.y) / 2,
      },
      leftHip: { x: leftHip.x, y: leftHip.y, score: leftHip.score },
      rightHip: { x: rightHip.x, y: rightHip.y, score: rightHip.score },
      leftKnee: leftKnee ? { x: leftKnee.x, y: leftKnee.y, score: leftKnee.score } : null,
      rightKnee: rightKnee ? { x: rightKnee.x, y: rightKnee.y, score: rightKnee.score } : null,
      leftAnkle: leftAnkle ? { x: leftAnkle.x, y: leftAnkle.y, score: leftAnkle.score } : null,
      rightAnkle: rightAnkle ? { x: rightAnkle.x, y: rightAnkle.y, score: rightAnkle.score } : null,
    };
  };

  return { ready, detectPerson };
}