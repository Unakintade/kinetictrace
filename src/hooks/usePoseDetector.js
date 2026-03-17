import { useEffect, useRef, useState } from 'react';
import * as poseDetection from '@tensorflow-models/pose-detection';
import '@tensorflow/tfjs-backend-webgl';
import * as tf from '@tensorflow/tfjs';

// MoveNet Lightning runs internally on a 192×192 grid.
// All returned keypoint coords are in that space and must be scaled to target dims.
const MOVENET_INPUT_SIZE = 192;

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
   * Detects a person in the video frame and returns keypoints scaled to (targetW, targetH).
   * MoveNet outputs coords in a 192×192 space — we scale them to the canvas resolution.
   */
  const detectPerson = async (videoEl, targetW = MOVENET_INPUT_SIZE, targetH = MOVENET_INPUT_SIZE) => {
    if (!detectorRef.current || !videoEl || videoEl.readyState < 2) return null;
    const poses = await detectorRef.current.estimatePoses(videoEl);
    if (!poses || poses.length === 0) return null;
    const kp = poses[0].keypoints;

    const scaleX = targetW / MOVENET_INPUT_SIZE;
    const scaleY = targetH / MOVENET_INPUT_SIZE;

    const get = (name) => {
      const k = kp.find(k => k.name === name);
      if (!k) return null;
      return { x: k.x * scaleX, y: k.y * scaleY, score: k.score };
    };

    const leftHip = get('left_hip');
    const rightHip = get('right_hip');
    if (!leftHip || !rightHip || leftHip.score < 0.2 || rightHip.score < 0.2) return null;

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