import React, { useState } from 'react';
import { Box, TextField, Button, Alert, Tab, Tabs, CircularProgress, InputAdornment, IconButton } from '@mui/material';
import { ArrowForward, SportsCricket, Visibility, VisibilityOff, PlayArrow } from '@mui/icons-material';
import PitchDiagram from '../components/PitchDiagram';
import api from '../api/client';

export default function AuthPage({ onAuthSuccess, onExploreDemo }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await api.post(mode === 'login' ? '/auth/login' : '/auth/register',
        mode === 'login' ? { email: email.trim(), password } : { email: email.trim(), password, name: name.trim() });
      localStorage.setItem('token', response.data.access_token);
      onAuthSuccess();
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'We could not connect to your account. Check your details and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.post('/auth/guest');
      localStorage.setItem('token', response.data.access_token);
      onAuthSuccess();
    } catch {
      setError('Guest access could not connect. Try again or sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main-content" tabIndex={-1} className="auth-layout">
      <section className="auth-story" aria-label="About the project">
        <div className="wordmark"><span className="brand-symbol"><SportsCricket sx={{ fontSize: 17 }} /></span> crease<span className="muted" style={{ fontWeight: 400 }}>/ lab</span></div>
        <div>
          <h1>See the delivery.<br /><em>Understand the path.</em></h1>
          <p>Follow the ball from the first frame to the final bounce. Inspect the evidence. Explore the geometry.</p>
        </div>
        <PitchDiagram />
        <div className="auth-story-footer eyebrow" style={{ color: '#adb8c7' }}>Track in 2D. Understand in 3D.</div>
      </section>
      <section className="auth-form-panel" aria-label="Account access">
        <div className="auth-form-inner">
          <h2>{mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}</h2>
          <p>{mode === 'login' ? 'Sign in to upload deliveries and revisit your reviews.' : 'Create an account to keep your clips and analysis together.'}</p>
          <Tabs value={mode} onChange={(_, value) => { setMode(value); setError(''); }} variant="fullWidth" aria-label="Account action">
            <Tab value="login" label="Sign in" disabled={loading} /><Tab value="register" label="Create account" disabled={loading} />
          </Tabs>
          <Box component="form" onSubmit={handleSubmit}>
            {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
            {mode === 'register' && <TextField label="Full name" required value={name} onChange={e => setName(e.target.value)} autoComplete="name" disabled={loading} fullWidth />}
            <TextField label="Email address" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" disabled={loading} fullWidth />
            <TextField label="Password" type={showPassword ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={loading} fullWidth InputProps={{ endAdornment: <InputAdornment position="end"><IconButton aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(v => !v)} edge="end">{showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}</IconButton></InputAdornment> }} />
            <Button type="submit" variant="contained" disabled={loading} endIcon={loading ? <CircularProgress size={17} color="inherit" /> : <ArrowForward />} fullWidth>{loading ? 'Connecting…' : mode === 'login' ? 'Open workspace' : 'Create account'}</Button>
          </Box>
          <div className="auth-demo">
            <span className="muted" style={{ fontSize: 13 }}>Explore simulated deliveries. No account needed.</span>
            <Button onClick={onExploreDemo} startIcon={<PlayArrow />} sx={{ mt: 1.5 }} fullWidth>Continue without account</Button>
            <Button onClick={handleGuest} disabled={loading} variant="outlined" fullWidth>Open shared guest workspace</Button>
          </div>
        </div>
      </section>
    </main>
  );
}
