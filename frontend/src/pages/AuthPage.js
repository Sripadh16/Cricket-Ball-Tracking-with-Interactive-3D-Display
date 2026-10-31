import React, { useState } from 'react';
import { Box, TextField, Button, Typography, Paper, Alert, Tab, Tabs, CircularProgress } from '@mui/material';
import { Login, PersonAdd, SportsCricket } from '@mui/icons-material';
import api from '../api/client';

function AuthPage({ onAuthSuccess }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const payload = mode === 'login' 
        ? { email, password }
        : { email, password, name };
      
      const response = await api.post(endpoint, payload);
      localStorage.setItem('token', response.data.access_token);
      onAuthSuccess();
    } catch (err) {
      setError(err.response?.data?.detail || `${mode === 'login' ? 'Login' : 'Registration'} failed`);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    onAuthSuccess();
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      background: 'linear-gradient(135deg, #1a472a 0%, #2d6a4f 100%)',
      p: 3
    }}>
      {/* Logo */}
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <SportsCricket sx={{ fontSize: 64, color: 'white', mb: 1 }} />
        <Typography variant="h4" sx={{ color: 'white', fontWeight: 700 }}>
          Cricket DRS
        </Typography>
        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)' }}>
          Professional Ball Tracking System
        </Typography>
      </Box>

      <Paper sx={{ maxWidth: 400, width: '100%', overflow: 'hidden' }}>
        <Tabs
          value={mode}
          onChange={(_, v) => { setMode(v); setError(null); }}
          variant="fullWidth"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="login" label="Login" icon={<Login />} iconPosition="start" />
          <Tab value="register" label="Register" icon={<PersonAdd />} iconPosition="start" />
        </Tabs>

        <Box component="form" onSubmit={handleSubmit} sx={{ p: 3 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {mode === 'register' && (
            <TextField
              fullWidth
              label="Full Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              margin="normal"
              required
              autoComplete="name"
            />
          )}

          <TextField
            fullWidth
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            margin="normal"
            required
            autoComplete="email"
          />

          <TextField
            fullWidth
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            margin="normal"
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />

          <Button
            fullWidth
            type="submit"
            variant="contained"
            disabled={loading}
            sx={{ mt: 3, mb: 1, bgcolor: '#1a472a', '&:hover': { bgcolor: '#2d6a4f' } }}
          >
            {loading ? <CircularProgress size={24} /> : mode === 'login' ? 'Sign In' : 'Create Account'}
          </Button>

          <Button
            fullWidth
            variant="text"
            onClick={handleSkip}
            sx={{ color: 'text.secondary' }}
          >
            Continue without account
          </Button>
        </Box>
      </Paper>

      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', mt: 4, textAlign: 'center' }}>
        By continuing, you agree to our Terms of Service
      </Typography>
    </Box>
  );
}

export default AuthPage;
