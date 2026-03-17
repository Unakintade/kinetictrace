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
        { modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER }
      );
      if (!cancelled) {
        detectorRef.current = detector;
        setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Detects a person and returns keypoints in the video element's native pixel space.
   * MoveNet's estimatePoses() already returns coords scaled to the input element's
   * intrinsic dimensions — no manual rescaling needed.
   */
  const detectPerson = async (videoEl) => {
    if (!detectorRef.current || !videoEl || videoEl.readyState < 2) return null;
    const poses = await detectorRef.current.estimatePoses(videoEl);
    if (!poses || poses.length === 0) return null;
    const kp = poses[0].keypoints;

    const get = (name) => {
      const k = kp.find(k => k.name === name);
      if (!k) return null;
      return { x: k.x, y: k.y, score: k.score };
    };

    const leftHip = get('left_hip');
    const rightHip = get('right_hip');
    if (!leftHip || !rightHip || leftHip.score < 0.1 || rightHip.score < 0.1) return null;

    return {
      hipCenter: {
        x: (leftHip.x + rightHip.x) / 2,
        y: (leftHip.y + rightHip.y) / 2,
      },
      leftHip,
      rightHip,
      leftKnee: get('left_knee'),
      rightKnee: get('right_knee'),
      leftAnkle: get('left_ankle'),
      rightAnkle: get('right_ankle'),
    };
  };

  return { ready, detectPerson };
}