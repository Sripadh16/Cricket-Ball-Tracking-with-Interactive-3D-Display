import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, TextField, Typography, Alert } from '@mui/material';
import api from '../api/client';

export default function PitchCalibration({ videoId, trajectory, onApply, onPick, pickedPoint, open, onOpenChange }) {
  const [corners, setCorners] = useState(trajectory.calibration?.corners || Array.from({ length: 4 }, () => ['', '']));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const width = trajectory.video_info?.width;
  const height = trajectory.video_info?.height;
  const labels = ['Bowler left', 'Bowler right', 'Batter right', 'Batter left'];
  useEffect(() => {
    if (pickedPoint) setCorners(previous => previous.map((pair, i) => i === pickedPoint.index ? [pickedPoint.x, pickedPoint.y] : pair));
  }, [pickedPoint]);
  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.put(`/videos/${videoId}/calibration`, { corners: corners.map(pair => pair.map(Number)) });
      const response = await api.get(`/videos/${videoId}/trajectory`);
      if (alive.current) onApply(response.data);
    } catch (err) {
      if (alive.current) setError(typeof err.response?.data?.detail === 'string' ? err.response.data.detail : 'Could not save pitch landmarks. Try again.');
    } finally { if (alive.current) setSaving(false); }
  };
  return <Box id="pitch-landmarks" component="details" open={open} onToggle={event => onOpenChange(event.currentTarget.open)} sx={{ mt: 1 }}>
    <summary>Pitch landmarks ({corners.filter(pair => pair.every(value => value !== '')).length}/4)</summary>
    <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
      Mark where the two pitch edges meet the wicket lines in the first video frame. Left and right are viewed from bowler to batter.
      {trajectory.can_refit_camera ? ' The app uses the four marks to refit the camera and ball flight.' : ' Reprocess this clip to enable a 3D refit.'}
    </Typography>
    {labels.map((label, i) => <Box key={label} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 1 }}>
      <Button onClick={() => onPick(i, label)} disabled={saving || !width || !height}>Pick {label} in video</Button>
      {[0, 1].map(axis => <TextField key={axis} label={`${label} ${axis ? 'Y' : 'X'}`} type="number" size="small"
        value={corners[i][axis]} disabled={saving} sx={{ flex: 1, minWidth: 100 }}
        inputProps={{ min: 0, max: (axis ? height : width) ? (axis ? height : width) - 1 : undefined, step: 'any' }}
        onChange={e => setCorners(corners.map((pair, index) => index === i ? pair.map((value, a) => a === axis ? e.target.value : value) : pair))} />)}
    </Box>)}
    {error && <Alert severity="error">{error}</Alert>}
    <Button onClick={save} disabled={saving || !width || !height || corners.some(pair => pair.some(value => value === '' || !Number.isFinite(Number(value))))}>
      {saving ? 'Refitting flight…' : trajectory.can_refit_camera ? 'Refit ball flight' : 'Save pitch landmarks'}
    </Button>
    <Typography variant="caption" display="block" color="text.secondary">Reprocessing replaces manual landmarks. Inferred events are cleared when geometry changes; your review notes are retained.</Typography>
  </Box>;
}
