/**
 * KinematicsCanvas — side-by-side display:
 *   LEFT:  original video with BlazePose skeleton overlay
 *   RIGHT: stick-figure MuJoCo joint angle replay drawn on canvas
 */
import { useEffect, useRef, useCallback } from 'react';

const JOINT_NAMES = [
  'torso_x','torso_z',
  'l_shoulder_x','l_shoulder_z','l_elbow',
  'r_shoulder_x','r_shoulder_z','r_elbow',
  'l_hip_x','l_hip_z','l_knee','l_ankle',
  'r_hip_x','r_hip_z','r_knee','r_ankle',
];

// MoveNet skeleton connections (index pairs)
const SKELETON = [
  [5,7],[7,9],[6,8],[8,10],  // arms
  [5,6],[5,11],[6,12],[11,12], // torso
  [11,13],[13,15],[12,14],[14,16], // legs
];

function drawSkeleton(ctx, landmarks, w, h, color = '#00e5ff') {
  if (!landmarks?.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  for (const [a, b] of SKELETON) {
    const lA = landmarks[a];
    const lB = landmarks[b];
    if (!lA || !lB || (lA.score ?? 1) < 0.1 || (lB.score ?? 1) < 0.1) continue;
    ctx.beginPath();
    ctx.moveTo(lA.x, lA.y);
    ctx.lineTo(lB.x, lB.y);
    ctx.stroke();
  }
  for (const lm of landmarks) {
    if ((lm.score ?? 1) < 0.1) continue;
    ctx.beginPath();
    ctx.arc(lm.x, lm.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = (lm.score ?? 1) > 0.5 ? '#00e5ff' : '#ff6b35';
    ctx.fill();
  }
}

/**
 * Draw a simple sagittal-plane stick figure from qpos.
 * qpos layout matches useMuJoCoIK simpleFKSite.
 */
function drawMuJoCoFigure(ctx, qpos, scale, offX, offY, heightPx) {
  if (!qpos || !scale) return;
  const RAD = Math.PI / 180;
  const ppm = heightPx / ((scale.femur + scale.tibia + scale.torso) * 1.6);

  // Convert 3D site position to canvas coords (right panel, Y flipped)
  const toC = (x, z) => ({
    cx: offX + x * ppm,
    cy: offY + heightPx - z * ppm,
  });

  const baseZ = (scale.femur + scale.tibia + 0.1);
  const hipC = toC(qpos[0] ?? 0, baseZ);

  const tx = (qpos[0] ?? 0) * RAD;
  const shoulderC = toC((qpos[0] ?? 0), baseZ + scale.torso * Math.cos(tx));

  const lhx = (qpos[8] ?? 0) * RAD;
  const lk  = (qpos[10] ?? 0) * RAD;
  const lKneeX = (qpos[0] ?? 0) + scale.femur * Math.sin(lhx);
  const lKneeZ = baseZ - scale.femur * Math.cos(lhx);
  const lAnkleX = lKneeX + scale.tibia * Math.sin(lhx + lk);
  const lAnkleZ = lKneeZ - scale.tibia * Math.cos(lhx + lk);
  const lKneeC  = toC(lKneeX, lKneeZ);
  const lAnkleC = toC(lAnkleX, lAnkleZ);

  const rhx = (qpos[12] ?? 0) * RAD;
  const rk  = (qpos[14] ?? 0) * RAD;
  const rKneeX = (qpos[0] ?? 0) + scale.femur * Math.sin(rhx);
  const rKneeZ = baseZ - scale.femur * Math.cos(rhx);
  const rAnkleX = rKneeX + scale.tibia * Math.sin(rhx + rk);
  const rAnkleZ = rKneeZ - scale.tibia * Math.cos(rhx + rk);
  const rKneeC  = toC(rKneeX, rKneeZ);
  const rAnkleC = toC(rAnkleX, rAnkleZ);

  const lsx = (qpos[2] ?? 0) * RAD;
  const le  = (qpos[4] ?? 0) * RAD;
  const lElbowX = (qpos[0] ?? 0) - scale.humerus * Math.sin(lsx);
  const lElbowZ = baseZ + scale.torso - scale.humerus * Math.cos(lsx);
  const lWristX = lElbowX - scale.forearm * Math.sin(lsx - le);
  const lWristZ = lElbowZ - scale.forearm * Math.cos(lsx - le);
  const lElbowC = toC(lElbowX, lElbowZ);
  const lWristC = toC(lWristX, lWristZ);

  const rsx = (qpos[5] ?? 0) * RAD;
  const re  = (qpos[7] ?? 0) * RAD;
  const rElbowX = (qpos[0] ?? 0) + scale.humerus * Math.sin(rsx);
  const rElbowZ = baseZ + scale.torso - scale.humerus * Math.cos(rsx);
  const rWristX = rElbowX + scale.forearm * Math.sin(rsx - re);
  const rWristZ = rElbowZ - scale.forearm * Math.cos(rsx - re);
  const rElbowC = toC(rElbowX, rElbowZ);
  const rWristC = toC(rWristX, rWristZ);

  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 3;

  const line = (a, b) => {
    ctx.beginPath();
    ctx.moveTo(a.cx, a.cy);
    ctx.lineTo(b.cx, b.cy);
    ctx.stroke();
  };

  // Spine
  line(hipC, shoulderC);
  // Left leg
  ctx.strokeStyle = '#22c55e';
  line(hipC, lKneeC);
  line(lKneeC, lAnkleC);
  // Right leg
  ctx.strokeStyle = '#f97316';
  line(hipC, rKneeC);
  line(rKneeC, rAnkleC);
  // Arms
  ctx.strokeStyle = '#60a5fa';
  line(shoulderC, lElbowC);
  line(lElbowC, lWristC);
  ctx.strokeStyle = '#f472b6';
  line(shoulderC, rElbowC);
  line(rElbowC, rWristC);

  // Joints
  const joints = [hipC, shoulderC, lKneeC, lAnkleC, rKneeC, rAnkleC, lElbowC, lWristC, rElbowC, rWristC];
  for (const j of joints) {
    ctx.beginPath();
    ctx.arc(j.cx, j.cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  // Ground line
  const groundZ = 0;
  const gY = offY + heightPx - groundZ * ppm;
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(offX, gY);
  ctx.lineTo(offX + 400, gY);
  ctx.stroke();
}

export default function KinematicsCanvas({ videoRef, currentFrameIdx, filteredFrames, qposHistory, scale }) {
  const canvasRef = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef?.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const halfW = W / 2;

    ctx.fillStyle = 'hsl(220 18% 6%)';
    ctx.fillRect(0, 0, W, H);

    // ── LEFT: video + skeleton ──
    if (video && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, halfW, H);
    } else {
      ctx.fillStyle = 'hsl(220 15% 10%)';
      ctx.fillRect(0, 0, halfW, H);
      ctx.fillStyle = 'hsl(210 15% 35%)';
      ctx.font = '13px Inter,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Video', halfW / 2, H / 2);
    }

    // Scale skeleton landmarks to left panel
    const frame = filteredFrames?.[currentFrameIdx];
    if (frame?.landmarks && video) {
      const scaleX = halfW / (frame.videoW ?? video.videoWidth ?? halfW);
      const scaleY = H / (frame.videoH ?? video.videoHeight ?? H);
      const scaled = frame.landmarks.map(lm => ({ ...lm, x: lm.x * scaleX, y: lm.y * scaleY }));
      drawSkeleton(ctx, scaled, halfW, H);
    }

    // Left panel label
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, halfW, 22);
    ctx.fillStyle = '#ccc';
    ctx.font = '11px Inter,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('  BlazePose Input', 6, 15);

    // Divider
    ctx.strokeStyle = 'hsl(220 15% 20%)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(halfW, 0);
    ctx.lineTo(halfW, H);
    ctx.stroke();

    // ── RIGHT: MuJoCo stick figure ──
    ctx.fillStyle = 'hsl(220 15% 10%)';
    ctx.fillRect(halfW, 0, halfW, H);

    const qpos = qposHistory?.[currentFrameIdx];
    if (qpos && scale) {
      drawMuJoCoFigure(ctx, qpos, scale, halfW + halfW / 2 - 50, 10, H - 20);
    } else {
      ctx.fillStyle = 'hsl(210 15% 35%)';
      ctx.font = '13px Inter,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('MuJoCo IK', halfW + halfW / 2, H / 2);
    }

    // Right panel label
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(halfW, 0, halfW, 22);
    ctx.fillStyle = '#ccc';
    ctx.font = '11px Inter,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`  MuJoCo Physics IK  (frame ${currentFrameIdx + 1}/${qposHistory?.length ?? 0})`, halfW + 6, 15);
  }, [videoRef, currentFrameIdx, filteredFrames, qposHistory, scale]);

  useEffect(() => {
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={900}
      height={380}
      className="w-full rounded-lg border border-border/40"
      style={{ background: 'hsl(220 18% 6%)' }}
    />
  );
}